// pipeline/video_extract.mjs
// Resumable Gemini-video extraction for Instagram reels.
//
// Input : work/video_queue.jsonl  (one {code,id,username,caption_full} per line)
// Output: work/video_results.jsonl (append-only, resumable)
//         work/video_errors.jsonl  (failures, retry on next run)
//         work/video_cost.json     (running cost/time summary)
//
// Per video: media-info -> download -> compress (ffmpeg, target <5.6MB) ->
//            Gemini via OpenRouter (video_url, static) -> validated JSON.
// Logs download/encode/API seconds, bytes, tokens and USD cost per video.
//
// Usage: node pipeline/video_extract.mjs [workers]
// Env  : Openrouter_api, Instagram_cookie, IG_USER_AGENT

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ROOT = process.cwd();
const WORK = path.join(ROOT, 'work');
const QUEUE = process.env.VIDEO_QUEUE || path.join(WORK, 'video_queue.jsonl');
const LIMIT = Number(process.env.VIDEO_LIMIT || 0);
const OUT = process.env.VIDEO_OUT || path.join(WORK, 'video_results.jsonl');
const ERR = path.join(WORK, 'video_errors.jsonl');
const COST = path.join(WORK, 'video_cost.json');
const LOG = process.env.VIDEO_LOG || path.join(WORK, 'video_log.jsonl');
const LOG_CSV = process.env.VIDEO_LOG_CSV || path.join(WORK, 'video_log.csv');
const TMP = path.join(WORK, 'tmp');

const MODEL = process.env.VIDEO_MODEL || 'google/gemini-2.5-flash-lite';
const WORKERS = Math.max(1, Number(process.argv[2] || 3));
const MAX_RAW_BYTES = 5_600_000; // base64 stays under OpenRouter's 8MB text cap
const KEY = process.env.Openrouter_api;
const COOKIE = process.env.Instagram_cookie;
const UA = process.env.IG_USER_AGENT;
if (!KEY || !COOKIE || !UA) throw new Error('missing Openrouter_api / Instagram_cookie / IG_USER_AGENT');

// Pre-fetched CDN urls (pipeline/fetch_video_urls.mjs). Media-info is only used
// as a fallback and is serialised + rate limited: the account gets spam-flagged
// quickly when that endpoint is hit in parallel.
const URLS = new Map();
const URLS_FILE = path.join(WORK, 'video_urls.jsonl');
if (fs.existsSync(URLS_FILE)) {
  for (const l of fs.readFileSync(URLS_FILE, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try {
      const r = JSON.parse(l);
      if (r.code && r.url) URLS.set(r.code, r);
    } catch {}
  }
}
console.log(`video urls cached: ${URLS.size}`);

fs.mkdirSync(TMP, { recursive: true });

const PROMPT = (caption) => `Extract the recipe from this Instagram video (visuals, on-screen text AND speech), combined with the caption.

Return STRICT JSON only, no markdown:
{
 "is_recipe": true|false,
 "dish": "name in original language",
 "dish_en": "English name",
 "language": "en|te|hi|mr|...",
 "ingredients": [{"item":"original","quantity":"as shown/spoken, '' if absent","item_en":"English"}],
 "steps": ["original-language ordered instruction"],
 "steps_en": ["English translation of the same instruction"],
 "serves": null,
 "time": null,
 "confidence": 0.0-1.0,
 "notes": "anything uncertain"
}
Rules:
- Only include what you actually see or hear. Never invent ingredients, quantities, times or steps.
- If a quantity is not visible or spoken, use "".
- "dish" and "steps" use the dominant language of the recipe (the spoken language if there is speech, otherwise the on-screen text). Put the English rendering only in "dish_en" and "steps_en".
- "steps": exactly one instruction per array entry, in ONE language, never the same step twice. "steps_en": the same instructions in English, identical length and order.
- is_recipe=false only if no food/drink is being prepared (ad, meme, someone eating, restaurant tour).
- A silent visual cook-through IS a recipe even with no text or speech.
- If only a finished dish is shown, list visible ingredients and leave steps [].
Caption: ${caption || '(none)'}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function loadDone() {
  const done = new Set();
  if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { const j = JSON.parse(l); if (!j.error) done.add(j.code); } catch {}
  }
  return done;
}

async function igJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: { 'user-agent': UA, cookie: COOKIE, 'x-ig-app-id': '936619743392459', accept: '*/*' }, redirect: 'manual' });
    const txt = await r.text();
    if (r.status === 200 && txt.trim().startsWith('{')) return JSON.parse(txt);
    if (r.status === 429 || r.status >= 500) { await sleep(4000 * (i + 1)); continue; }
    throw new Error(`ig ${r.status}: ${txt.slice(0, 120)}`);
  }
  throw new Error('ig json retries exhausted');
}

// one media-info call at a time, >=8s apart, long cooldown if Instagram complains
let igChain = Promise.resolve();
let igNextAt = 0;
function igJsonThrottled(id) {
  const run = async () => {
    const wait = igNextAt - Date.now();
    if (wait > 0) await sleep(wait);
    igNextAt = Date.now() + 8000;
    try {
      return await igJson(`https://www.instagram.com/api/v1/media/${id}/info/`, 1);
    } catch (e) {
      if (/spam|429|ig 400/i.test(String(e.message))) {
        console.log('  instagram throttled — cooling down 10 min');
        igNextAt = Date.now() + 10 * 60 * 1000;
      }
      throw e;
    }
  };
  const p = igChain.then(run, run);
  igChain = p.catch(() => {});
  return p;
}

async function resolveVideo(rec, force = false) {
  if (!force && URLS.has(rec.code)) {
    const cached = URLS.get(rec.code);
    return { url: cached.url, duration: cached.duration || 0 };
  }
  const info = await igJsonThrottled(id);
  const item = info.items?.[0];
  if (!item) throw new Error('no media item');
  const url = (item.video_versions || [])[0]?.url;
  if (!url) throw new Error('no video_versions');
  return { url, duration: Number(item.video_duration) || 0 };
}

async function download(url, dest) {
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: { 'user-agent': UA, cookie: COOKIE, referer: 'https://www.instagram.com/' }, redirect: 'follow' });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 20_000) throw new Error(`download too small ${buf.length}`);
      fs.writeFileSync(dest, buf);
      return buf.length;
    }
    last = `download ${r.status}`;
    if (r.status === 429 || r.status >= 500) { await sleep(5000 * (attempt + 1)); continue; }
    throw new Error(last);
  }
  throw new Error(last);
}

async function probeDuration(file) {
  try {
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    return Number(stdout.trim()) || 0;
  } catch { return 0; }
}

async function compress(src, dest) {
  const dur = Math.max(await probeDuration(src), 1);
  // one pass, sized from duration: aim ~4.6 MB so base64 stays under the 8 MB cap
  const budgetBytes = 4.6 * 1024 * 1024;
  let kbps = Math.floor((budgetBytes * 8) / dur / 1000) - 48;
  kbps = Math.max(150, Math.min(1400, kbps));
  const vf = dur <= 90 ? 'fps=3,scale=540:-2' : 'fps=2,scale=480:-2';
  for (let attempt = 0; attempt < 2; attempt++) {
    await exec('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', src,
      '-vf', vf,
      '-c:v', 'libx264', '-preset', 'ultrafast',
      '-b:v', `${Math.round(kbps)}k`, '-maxrate', `${Math.round(kbps)}k`, '-bufsize', `${Math.round(kbps * 2)}k`,
      '-c:a', 'aac', '-b:a', '48k', '-ac', '1',
      '-movflags', '+faststart', dest,
    ], { maxBuffer: 1024 * 1024 * 8 });
    const size = fs.statSync(dest).size;
    if (size <= MAX_RAW_BYTES) return size;
    kbps = Math.floor(kbps * 0.7);
  }
  return fs.statSync(dest).size;
}

async function gemini(buf, caption) {
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: [
      { type: 'text', text: PROMPT(caption) },
      { type: 'video_url', video_url: { url: 'data:video/mp4;base64,' + buf.toString('base64') }, processing: 'static' },
    ]}],
    max_tokens: 3500,
    temperature: 0.1,
  };
  let lastErr = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    let r;
    try {
      r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, 'X-Title': 'recipe-video-extract' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = `network ${e.message}`;
      await sleep(8000 * (attempt + 1));
      continue;
    }
    const d = await r.json().catch(() => ({}));
    if (r.status === 429 || r.status >= 500) {
      lastErr = `${r.status} ${JSON.stringify(d.error || d).slice(0, 160)}`;
      const ra = Number(r.headers.get('retry-after') || 0);
      await sleep(Math.max(ra * 1000, 6000 * (attempt + 1)) + Math.random() * 3000);
      continue;
    }
    if (!r.ok || d.error) throw new Error(`openrouter ${r.status}: ${JSON.stringify(d.error || d).slice(0, 200)}`);
    const txt = d.choices?.[0]?.message?.content || '';
    const clean = txt.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
    const m = clean.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no JSON in response');
    return { data: JSON.parse(m[0]), usage: d.usage || {} };
  }
  throw new Error(`openrouter retries exhausted: ${lastErr}`);
}

const VALID_COMPLETENESS = new Set(['full', 'partial', 'none']);

async function processOne(rec) {
  const tag = `${rec.code}`;
  const t0 = Date.now();
  const src = path.join(TMP, `${tag}.mp4`);
  const small = path.join(TMP, `${tag}.small.mp4`);
  try {
    let { url: vurl, duration } = await resolveVideo(rec);
    const tDl0 = Date.now();
    let rawBytes;
    try {
      rawBytes = await download(vurl, src);
    } catch (e) {
      // cached CDN link expired or was rejected -> refresh once via media-info
      if (/download (403|404|410)/.test(String(e.message))) {
        ({ url: vurl, duration } = await resolveVideo(rec, true));
        rawBytes = await download(vurl, src);
      } else throw e;
    }
    const download_s = (Date.now() - tDl0) / 1000;
    const tEnc0 = Date.now();
    const encBytes = await compress(src, small);
    const encode_s = (Date.now() - tEnc0) / 1000;
    const tApi0 = Date.now();
    const { data, usage } = await gemini(fs.readFileSync(small), rec.caption_full || '');
    const api_s = (Date.now() - tApi0) / 1000;
    const out = {
      ...rec,
      source: 'video',
      model: MODEL,
      is_recipe: !!data.is_recipe,
      dish: data.dish || '',
      dish_en: data.dish_en || '',
      language: data.language || '',
      ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
      steps: Array.isArray(data.steps) ? data.steps : [],
      steps_en: Array.isArray(data.steps_en) ? data.steps_en : [],
      serves: data.serves ?? null,
      time: data.time ?? null,
      confidence: Number(data.confidence) || null,
      notes: data.notes || '',
      duration_s: duration,
      video_bytes: rawBytes,
      encoded_bytes: encBytes,
      timings: { download_s, encode_s, api_s, total_s: (Date.now() - t0) / 1000 },
      usage: {
        prompt_tokens: usage.prompt_tokens ?? null,
        completion_tokens: usage.completion_tokens ?? null,
        cost_usd: usage.cost ?? null,
        video_tokens: usage.prompt_tokens_details?.video_tokens ?? null,
        audio_tokens: usage.prompt_tokens_details?.audio_tokens ?? null,
      },
      at: new Date().toISOString(),
    };
    return out;
  } finally {
    for (const f of [src, small]) { try { fs.unlinkSync(f); } catch {} }
  }
}

// ---- per-video cost + time log ----
const LOG_COLS = ['n', 'at', 'code', 'username', 'dish', 'duration_s', 'video_mb', 'encoded_mb',
  'download_s', 'encode_s', 'api_s', 'total_s', 'video_tokens', 'audio_tokens',
  'cost_usd', 'cost_total_usd', 'time_total_s'];

function readOut() {
  return fs.existsSync(OUT)
    ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error)
    : [];
}

function logRow(r, n, costTotal, timeTotal) {
  const t = r.timings || {}, u = r.usage || {};
  return {
    n,
    at: r.at,
    code: r.code,
    username: r.username,
    dish: r.dish || r.dish_hint || '',
    duration_s: +(r.duration_s || 0).toFixed(1),
    video_mb: +(r.video_bytes / 1e6).toFixed(2),
    encoded_mb: +(r.encoded_bytes / 1e6).toFixed(2),
    download_s: +((t.download_s || 0).toFixed(1)),
    encode_s: +((t.encode_s || 0).toFixed(1)),
    api_s: +((t.api_s || 0).toFixed(1)),
    total_s: +((t.total_s || 0).toFixed(1)),
    video_tokens: u.video_tokens ?? null,
    audio_tokens: u.audio_tokens ?? null,
    cost_usd: +(u.cost_usd || 0),
    cost_total_usd: +costTotal.toFixed(6),
    time_total_s: +timeTotal.toFixed(1),
  };
}

function csvLine(row) {
  return LOG_COLS.map((c) => {
    const v = row[c] ?? '';
    return /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  }).join(',');
}

// Rebuilt from video_results.jsonl on every start, so the log always matches
// the results (append-only, no double counting).
function rebuildLog() {
  let cost = 0, time = 0;
  const rows = readOut().map((r, i) => {
    cost += r.usage?.cost_usd || 0;
    time += r.timings?.total_s || 0;
    return logRow(r, i + 1, cost, time);
  });
  fs.writeFileSync(LOG, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  fs.writeFileSync(LOG_CSV, LOG_COLS.join(',') + '\n' + rows.map(csvLine).join('\n') + (rows.length ? '\n' : ''));
  return { cost, time, n: rows.length };
}

function appendLog(row) {
  fs.appendFileSync(LOG, JSON.stringify(row) + '\n');
  fs.appendFileSync(LOG_CSV, csvLine(row) + '\n');
}

// ---- summary ----
function writeCost() {
  const rows = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const ok = rows.filter((r) => !r.error);
  const sum = (f) => ok.reduce((s, r) => s + (f(r) || 0), 0);
  const summary = {
    model: MODEL,
    videos_done: ok.length,
    recipes: ok.filter((r) => r.is_recipe).length,
    not_recipes: ok.filter((r) => !r.is_recipe).length,
    total_cost_usd: +sum((r) => r.usage?.cost_usd).toFixed(4),
    avg_cost_usd: +(sum((r) => r.usage?.cost_usd) / Math.max(ok.length, 1)).toFixed(6),
    total_video_tokens: sum((r) => r.usage?.video_tokens),
    total_audio_tokens: sum((r) => r.usage?.audio_tokens),
    total_download_s: +sum((r) => r.timings?.download_s).toFixed(1),
    total_encode_s: +sum((r) => r.timings?.encode_s).toFixed(1),
    total_api_s: +sum((r) => r.timings?.api_s).toFixed(1),
    avg_total_s: +(sum((r) => r.timings?.total_s) / Math.max(ok.length, 1)).toFixed(1),
    total_mb_downloaded: +(sum((r) => r.video_bytes) / 1e6).toFixed(1),
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(COST, JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  if (!fs.existsSync(QUEUE)) throw new Error('missing work/video_queue.jsonl');
  const queue = fs.readFileSync(QUEUE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const done = loadDone();
  const todo = queue.filter((r) => !done.has(r.code)).slice(0, LIMIT || undefined);
  console.log(`queue=${queue.length} done=${done.size} todo=${todo.length} workers=${WORKERS}`);
  const ledger = rebuildLog();
  console.log(`per-video log: ${LOG} (+ ${LOG_CSV}) — ${ledger.n} videos so far, $${ledger.cost.toFixed(4)}, ${(ledger.time / 60).toFixed(1)} min`);
  let next = 0, ok = 0, fail = 0;

  async function worker(w) {
    while (true) {
      const i = next++;
      if (i >= todo.length) return;
      const rec = todo[i];
      try {
        const res = await processOne(rec);
        fs.appendFileSync(OUT, JSON.stringify(res) + '\n');
        ok++;
        ledger.cost += res.usage?.cost_usd || 0;
        ledger.time += res.timings?.total_s || 0;
        ledger.n += 1;
        appendLog(logRow(res, ledger.n, ledger.cost, ledger.time));
        console.log(`[w${w}] ${res.code} @${res.username} recipe=${res.is_recipe} src=video cost=$${res.usage.cost_usd} ${res.timings.total_s.toFixed(1)}s | running total $${ledger.cost.toFixed(4)} / ${ledger.n} videos / ${(ledger.time / 60).toFixed(1)} min (${ok}/${todo.length})`);
      } catch (e) {
        fail++;
        fs.appendFileSync(ERR, JSON.stringify({ ...rec, error: String(e.message || e), at: new Date().toISOString() }) + '\n');
        console.log(`[w${w}] FAIL ${rec.code}: ${e.message}`);
      }
      if (ok % 10 === 0) writeCost();
      await sleep(1200 + Math.random() * 2200);
    }
  }

  await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(w)));
  const summary = writeCost();
  console.log('DONE', JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
