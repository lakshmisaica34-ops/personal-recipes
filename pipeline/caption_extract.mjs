// pipeline/caption_extract.mjs
//
// Caption pass: classify each post and, when the caption already contains the
// recipe, extract it. Runs on Groq's free tier and is quota-aware: it stops
// cleanly when the daily/per-minute token budget runs out so another runner can
// pick up the remaining slice.
//
// Input : exports/recipe_scrape_results_final.json
// Output: work/caption_results.jsonl  (append-only, resumable, dedup by code)
//         work/caption_cost.json      (token/time summary)
//
// Usage:
//   node pipeline/caption_extract.mjs --from 0 --to 300 [--mode full|classify]
//
// Env: Groq_api

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'exports/recipe_scrape_results_final.json');
const WORK = path.join(ROOT, 'work');
const OUT = path.join(WORK, 'caption_results.jsonl');
const COST = path.join(WORK, 'caption_cost.json');
fs.mkdirSync(WORK, { recursive: true });

const AUDIT = '/tmp/opencode/caption_audit2.json';
const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const FROM = Number(arg('from', 0));
const TO = Number(arg('to', 1e9));
const MODE = arg('mode', 'full'); // full | classify
const ORDER = arg('order', 'priority'); // priority | index
const LIMIT = Number(arg('limit', 1e9));
const MODEL = arg('model', process.env.GROQ_MODEL || 'openai/gpt-oss-120b');
const KEY = process.env.Groq_api;
if (!KEY) throw new Error('missing Groq_api');
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const PROMPT = (caption, mode) => {
  const head = `Audit this Instagram cooking post. Return ONE compact JSON object, no markdown, no explanation.

A) food_post: true if the post is about making or presenting a food or drink. A caption that only names a dish plus recipe/cooking hashtags IS true (the recipe is shown in the video). False for: non-food ads, product promos, health/diet tips, book promos, fitness, restaurant tours, someone only eating, personal vlogs.
B) completeness of the CAPTION ALONE:
   "full"    = ingredient list AND a usable method
   "partial" = ingredients only, method only, or vague hints
   "none"    = dish name / hashtags / teaser only
C) dish (original language), dish_en, language ("en","te","hi","mr",...), reason (max 12 words).`;
  if (mode === 'classify') {
    return `${head}

Return exactly: {"food_post":bool,"completeness":"full|partial|none","dish":"","dish_en":"","language":"","reason":""}

Caption:
"""${caption || ''}"""`;
  }
  return `${head}
D) Extract, but ONLY when completeness is full or partial:
   ingredients: [{"item","quantity","item_en"}] - quantity exactly as written, "" if absent
   steps: ordered imperative instructions from the caption only; merge broken fragments
   steps_en: English translation of each step, same order
   Keep item/steps in the creator's original language. Never invent ingredients, quantities, times or steps. If none, use [].

Return exactly: {"food_post":bool,"completeness":"full|partial|none","dish":"","dish_en":"","language":"","ingredients":[{"item":"","quantity":"","item_en":""}],"steps":[],"steps_en":[],"reason":""}

Caption:
"""${caption || ''}"""`;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadDone() {
  const done = new Map();
  if (!fs.existsSync(OUT)) return done;
  for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try {
      const j = JSON.parse(l);
      if (j.code && !j.error) done.set(j.code, j);
    } catch {}
  }
  return done;
}

function writeCost(rows) {
  const ok = rows.filter((r) => !r.error);
  const sum = (f) => ok.reduce((s, r) => s + (f(r) || 0), 0);
  const summary = {
    model: MODEL,
    mode: MODE,
    posts_done: ok.length,
    food_posts: ok.filter((r) => r.food_post).length,
    full: ok.filter((r) => r.completeness === 'full').length,
    partial: ok.filter((r) => r.completeness === 'partial').length,
    none: ok.filter((r) => r.completeness === 'none').length,
    needs_video: ok.filter((r) => r.food_post && r.completeness !== 'full').length,
    prompt_tokens: sum((r) => r.usage?.prompt_tokens),
    completion_tokens: sum((r) => r.usage?.completion_tokens),
    total_tokens: sum((r) => (r.usage?.prompt_tokens || 0) + (r.usage?.completion_tokens || 0)),
    total_api_s: +sum((r) => r.elapsed_s).toFixed(1),
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(COST, JSON.stringify(summary, null, 2));
  return summary;
}

const recs = JSON.parse(fs.readFileSync(SRC, 'utf8')).slice(FROM, TO);
const audit = new Map();
if (fs.existsSync(AUDIT)) {
  for (const a of JSON.parse(fs.readFileSync(AUDIT, 'utf8'))) audit.set(a.code, a);
}
const PRIORITY = { FULL: 0, METHOD_ONLY: 1, ING_ONLY: 2, EMPTY: 3, NONE: 4 };
const done = loadDone();
const todo = recs
  .filter((r) => !done.has(r.code))
  .map((r) => ({ r, h: audit.get(r.code)?.cat || 'NONE' }))
  .sort((a, b) =>
    ORDER === 'priority' ? (PRIORITY[a.h] ?? 5) - (PRIORITY[b.h] ?? 5) : 0,
  )
  .map((x) => x.r)
  .slice(0, LIMIT);
console.log(
  `slice ${FROM}..${Math.min(TO, FROM + recs.length)} | total=${recs.length} done=${done.size} todo=${todo.length} mode=${MODE} model=${MODEL} order=${ORDER}`,
);

let remainTok = Infinity;
let resetMs = 0;

async function call(prompt) {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_completion_tokens: MODE === 'classify' ? 800 : 3000,
    }),
  });
  const txt = await res.text();
  const remainHdr = Number(res.headers.get('x-ratelimit-remaining-tokens'));
  if (Number.isFinite(remainHdr)) remainTok = remainHdr;
  const resetHdr = res.headers.get('x-ratelimit-reset-tokens') || '';
  const m = resetHdr.match(/(?:(\d+)m)?([\d.]+)s/);
  if (m) resetMs = ((Number(m[1] || 0) * 60 + Number(m[2]) + 0.5) * 1000);
  let d;
  try {
    d = JSON.parse(txt);
  } catch {
    throw Object.assign(new Error(`non-json ${res.status}: ${txt.slice(0, 160)}`), { status: res.status });
  }
  if (!res.ok || d.error) {
    throw Object.assign(new Error(`${res.status} ${JSON.stringify(d.error || d).slice(0, 200)}`), {
      status: res.status,
      retryAfter: Number(res.headers.get('retry-after') || 0),
      body: txt.slice(0, 400),
    });
  }
  const content = d.choices?.[0]?.message?.content || '';
  return { parsed: JSON.parse(content), usage: d.usage || {}, elapsed_s: (Date.now() - t0) / 1000 };
}

let n = 0;
let stopReason = null;
const rows = [...done.values()];

for (const r of todo) {
  // Pre-emptively wait if the per-minute budget is nearly gone.
  if (remainTok < 1400 && resetMs > 0) {
    const wait = Math.min(resetMs, 65000);
    console.log(`  ...token budget low (${remainTok}), waiting ${(wait / 1000).toFixed(1)}s`);
    await sleep(wait);
    remainTok = Infinity;
  }
  let attempt = 0;
  let ok = null;
  while (attempt < 4 && !ok) {
    attempt++;
    try {
      ok = await call(PROMPT(r.caption_full, MODE));
    } catch (e) {
      const daily = /per day|tokens per day|TPD/i.test(String(e.body || e.message));
      if (e.status === 429 && daily) {
        stopReason = 'daily token limit reached';
        break;
      }
      if (e.status === 429) {
        const wait = Math.min(Math.max(e.retryAfter || 5, 3), 40);
        console.log(`  429, retry in ${wait}s`);
        await sleep(wait * 1000);
        continue;
      }
      if (e.status === 400 && /json_validate_failed|Failed to (validate|generate) JSON/i.test(String(e.message))) {
        // model rambled: retry once with a nudge, then record as failed
        ok = { parsed: null, usage: {}, elapsed_s: 0, invalid: true };
        break;
      }
      console.log(`  ${r.code} attempt ${attempt} failed: ${e.message}`);
      await sleep(2000 * attempt);
    }
  }
  if (stopReason) break;

  const p = ok?.parsed;
  if (!p) {
    fs.appendFileSync(OUT, JSON.stringify({ code: r.code, error: 'json_validation_failed', at: new Date().toISOString() }) + '\n');
    continue;
  }
  const row = {
    code: r.code,
    id: r.id,
    username: r.username,
    full_name: r.full_name,
    permalink: r.video_url,
    taken_at: r.taken_at,
    duration_s: r.video_duration_s,
    heuristic: audit.get(r.code)?.cat || null,
    source: 'caption',
    engine: MODEL,
    food_post: !!p.food_post,
    completeness: ['full', 'partial', 'none'].includes(p.completeness) ? p.completeness : 'none',
    dish: p.dish || '',
    dish_en: p.dish_en || '',
    language: p.language || '',
    ingredients: Array.isArray(p.ingredients) ? p.ingredients : [],
    steps: Array.isArray(p.steps) ? p.steps : [],
    steps_en: Array.isArray(p.steps_en) ? p.steps_en : [],
    reason: p.reason || '',
    usage: {
      prompt_tokens: ok.usage.prompt_tokens ?? null,
      completion_tokens: ok.usage.completion_tokens ?? null,
      cost_usd: 0, // free tier
    },
    elapsed_s: ok.elapsed_s,
    at: new Date().toISOString(),
  };
  fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
  rows.push(row);
  n++;
  if (n % 10 === 0) writeCost(rows);
  const marks = `${row.food_post ? 'food' : 'NOT '}/${row.completeness}`.padEnd(12);
  console.log(
    `${n}/${todo.length} @${row.username} ${row.code} ${marks} ing=${row.ingredients.length} steps=${row.steps.length} ` +
      `tok=${(row.usage.prompt_tokens || 0) + (row.usage.completion_tokens || 0)} left=${remainTok} ${ok.elapsed_s.toFixed(1)}s`,
  );
}

const summary = writeCost(rows);
console.log(stopReason ? `STOPPED: ${stopReason}` : 'FINISHED');
console.log(JSON.stringify(summary, null, 2));
