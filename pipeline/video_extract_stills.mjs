// pipeline/video_extract_stills.mjs
// Cheap variant of video_extract.mjs: instead of sending the whole reel as video
// (Gemini bills ~258 tokens for every second), send N sampled frames + the audio
// track. Measured ~4-8x cheaper for comparable ingredient recall.
//
// Input : work/video_queue_title.jsonl  ({code,id,username,caption_full,dish_hint})
// Output: appends to work/video_results.jsonl (same shape as the video pass, so
//         build_site.py and resume logic work unchanged)
//         work/video_log.jsonl / .csv  (per-video cost + timing)
//
// Usage: node pipeline/video_extract_stills.mjs [workers]
// Env  : Openrouter_api, Instagram_cookie, IG_USER_AGENT
//        STILLS_EVERY=4      seconds between frames
//        STILLS_MAX=30       hard cap on frames per reel
//        STILLS_AUDIO=1      include the audio track
//        VIDEO_QUEUE, VIDEO_LIMIT

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ROOT = process.cwd();
const WORK = path.join(ROOT, 'work');
const TMP = path.join(WORK, 'tmp');

const QUEUE = process.env.VIDEO_QUEUE || path.join(WORK, 'video_queue_title.jsonl');
const OUT = process.env.VIDEO_OUT || path.join(WORK, 'video_results.jsonl');
const ERR = path.join(WORK, 'video_errors.jsonl');
const LOG = process.env.VIDEO_LOG || path.join(WORK, 'video_log.jsonl');
const LOG_CSV = process.env.VIDEO_LOG_CSV || path.join(WORK, 'video_log.csv');
const LIMIT = Number(process.env.VIDEO_LIMIT || 0);
const MODEL = process.env.STILLS_MODEL || 'google/gemini-2.5-flash-lite';
const WORKERS = Math.max(1, Number(process.argv[2] || 3));
const EVERY = Number(process.env.STILLS_EVERY || 4);
const MAX_FRAMES = Number(process.env.STILLS_MAX || 30);
const WITH_AUDIO = process.env.STILLS_AUDIO !== '0';
const PREFETCH = process.env.STILLS_PREFETCH !== '0';
const MAX_RAW_BYTES = 5_600_000;

const KEY = process.env.Openrouter_api;
const COOKIE = process.env.Instagram_cookie;
const UA = process.env.IG_USER_AGENT;
if (!KEY || !COOKIE || !UA) throw new Error('missing Openrouter_api / Instagram_cookie / IG_USER_AGENT');

const URLS = new Map();
for (const l of fs.readFileSync(path.join(WORK, 'video_urls.jsonl'), 'utf8').split('\n')) {
  if (!l.trim()) continue;
  try { const r = JSON.parse(l); if (r.code && r.url) URLS.set(r.code, r); } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMPT = (caption) => `You are reading an Instagram recipe reel, given as a set of frames sampled from the
video (in order) plus the audio track.

Caption text from the post (may be empty):
"""
${(caption || '').slice(0, 1200)}
"""

Report the dish and every ingredient that is actually present — from on-screen text,
what is visibly being used, or what the speaker says. Prefer an ingredient list that
appears on screen if there is one.

Return STRICT JSON only, no markdown:
{
  "is_recipe": true,
  "dish": "dish name in the creator's language",
  "dish_en": "English dish name",
  "language": "en|te|hi|mr|ta|kn|ml|bn|gu|pa|ur|unknown",
  "ingredients": [{"item": "original language", "quantity": "exact as stated, else empty", "item_en": "English"}],
  "serves": null,
  "time": null,
  "confidence": 0.0,
  "notes": "one short line"
}
Rules: never invent an ingredient or amount; merge duplicates; keep the dish name short.
If the reel shows no recipe at all, set is_recipe false and leave the other fields empty.`;

async function download(url, dest) {
  const r = await fetch(url, { headers: { Cookie: COOKIE, 'User-Agent': UA, Referer: 'https://www.instagram.com/' } });
  if (!r.ok) throw new Error(`download ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function duration(file) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  return Number(stdout.trim()) || 0;
}

async function frames(file, dir, every, maxFrames) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // Instagram GOPs are ~2-5 s, so decoding only keyframes gives roughly the
  // requested spacing for a fraction of the CPU (no full-stream decode).
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-skip_frame', 'nokey', '-i', file,
    '-vf', 'scale=512:-2', '-vsync', 'vfr', '-q:v', '4', path.join(dir, 'f%03d.jpg')], { maxBuffer: 1e8 });
  let files = fs.readdirSync(dir).sort();
  if (files.length > maxFrames) {
    // uniform subsample: keep maxFrames spread across the reel
    const step = files.length / maxFrames;
    const keep = new Set(Array.from({ length: maxFrames }, (_, i) => files[Math.floor(i * step)]));
    for (const f of files) if (!keep.has(f)) fs.unlinkSync(path.join(dir, f));
    files = [...keep].sort();
  }
  return files.map((f) => fs.readFileSync(path.join(dir, f)));
}

async function audio(file, out) {
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', out], { maxBuffer: 1e8 });
  return fs.readFileSync(out);
}

async function ask(parts, caption) {
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT(caption) }, ...parts] }],
    max_tokens: 2000,
    temperature: 0.1,
  };
  let lastErr = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    let r;
    try {
      r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, 'X-Title': 'recipe-stills-extract' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = `network ${e.message}`;
      await sleep(6000 * (attempt + 1));
      continue;
    }
    const d = await r.json().catch(() => ({}));
    if (r.status === 429 || r.status >= 500) {
      lastErr = `${r.status} rate-limited`;
      const ra = Number(r.headers.get('retry-after') || 0);
      await sleep(Math.max(ra * 1000, 8000 * (attempt + 1)) + Math.random() * 4000);
      continue;
    }
    if (!r.ok || d.error) throw new Error(`openrouter ${r.status}: ${JSON.stringify(d.error || d).slice(0, 200)}`);
    const txt = d.choices?.[0]?.message?.content || '';
    const clean = txt.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
    const m = clean.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no json in response');
    return { data: JSON.parse(m[0]), usage: d.usage || {}, provider: d.provider || '' };
  }
  throw new Error(`openrouter retries exhausted: ${lastErr}`);
}

function normIng(list) {
  const seen = new Map();
  for (const i of Array.isArray(list) ? list : []) {
    const item = String(i.item || i.item_en || '').trim();
    const en = String(i.item_en || i.item || '').trim();
    if (!item && !en) continue;
    const k = (en || item).toLowerCase();
    const q = String(i.quantity || '').trim();
    if (!seen.has(k)) seen.set(k, { item, quantity: q, item_en: en });
    else if (!seen.get(k).quantity && q) seen.get(k).quantity = q;
  }
  return [...seen.values()];
}

// ---- download-ahead: fetch the next reels while earlier ones are in the API ----
// Cuts ~4 s of dead time per reel by overlapping network with ffmpeg + Gemini.
const AHEAD = new Map();          // code -> promise<{file, bytes, download_s}>
let aheadIdx = 0;
let aheadQueue = [];

function prefetch(rec) {
  if (AHEAD.has(rec.code)) return AHEAD.get(rec.code);
  const file = path.join(TMP, `${rec.code}.raw.mp4`);
  const p = (async () => {
    const t = Date.now();
    const cached = URLS.get(rec.code);
    if (!cached) throw new Error('no cached video url');
    const bytes = await download(cached.url, file);
    return { file, bytes, download_s: (Date.now() - t) / 1000 };
  })();
  p.catch(() => {});              // surfaced when the worker awaits it
  AHEAD.set(rec.code, p);
  return p;
}

function fillAhead() {
  if (!PREFETCH) return;
  while (aheadIdx < aheadQueue.length && AHEAD.size < WORKERS + 1) prefetch(aheadQueue[aheadIdx++]);
}

async function processOne(rec) {
  const t0 = Date.now();
  const raw = path.join(TMP, `${rec.code}.raw.mp4`);
  const dir = path.join(TMP, `${rec.code}.frames`);
  const audFile = path.join(TMP, `${rec.code}.m4a`);
  try {
    const dl = await (AHEAD.get(rec.code) || prefetch(rec));
    AHEAD.delete(rec.code);
    fillAhead();
    if (dl.file !== raw) fs.renameSync(dl.file, raw);
    const rawBytes = dl.bytes;
    const download_s = dl.download_s;

    const tEnc0 = Date.now();
    const dur = await duration(raw);
    const stills = await frames(raw, dir, EVERY, MAX_FRAMES);
    const aud = WITH_AUDIO ? await audio(raw, audFile) : null;
    const encode_s = (Date.now() - tEnc0) / 1000;

    const parts = stills.map((b) => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b.toString('base64') } }));
    if (aud) parts.push({ type: 'input_audio', input_audio: { data: aud.toString('base64'), format: 'mp3' } });

    const tApi0 = Date.now();
    const { data, usage, provider } = await ask(parts, rec.caption_full || '');
    const api_s = (Date.now() - tApi0) / 1000;

    const out = {
      ...rec,
      source: 'stills',
      model: MODEL,
      provider,
      frames: stills.length,
      frame_every_s: EVERY,
      is_recipe: !!data.is_recipe,
      dish: data.dish || '',
      dish_en: data.dish_en || '',
      language: data.language || '',
      ingredients: normIng(data.ingredients),
      steps: [],
      steps_en: [],
      serves: data.serves ?? null,
      time: data.time ?? null,
      confidence: Number(data.confidence) || null,
      notes: data.notes || '',
      duration_s: dur,
      video_bytes: rawBytes,
      encoded_bytes: stills.reduce((s, b) => s + b.length, 0) + (aud ? aud.length : 0),
      timings: { download_s, encode_s, api_s, total_s: (Date.now() - t0) / 1000 },
      usage: {
        prompt_tokens: usage.prompt_tokens ?? null,
        completion_tokens: usage.completion_tokens ?? null,
        cost_usd: usage.cost ?? null,
        video_tokens: usage.prompt_tokens_details?.video_tokens ?? 0,
        audio_tokens: usage.prompt_tokens_details?.audio_tokens ?? null,
      },
      at: new Date().toISOString(),
    };
    return out;
  } finally {
    for (const f of [raw, audFile]) { try { fs.unlinkSync(f); } catch {} }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// ---- per-video log (same schema as video_extract.mjs) ----
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
    n, at: r.at, code: r.code, username: r.username, dish: r.dish || r.dish_hint || '',
    duration_s: +(r.duration_s || 0).toFixed(1),
    video_mb: +(r.video_bytes / 1e6).toFixed(2),
    encoded_mb: +(r.encoded_bytes / 1e6).toFixed(2),
    download_s: +(t.download_s || 0).toFixed(1),
    encode_s: +(t.encode_s || 0).toFixed(1),
    api_s: +(t.api_s || 0).toFixed(1),
    total_s: +(t.total_s || 0).toFixed(1),
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

async function main() {
  if (!fs.existsSync(QUEUE)) throw new Error(`missing ${QUEUE}`);
  const queue = fs.readFileSync(QUEUE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const done = new Set(readOut().map((r) => r.code));
  const todo = queue.filter((r) => !done.has(r.code)).slice(0, LIMIT || undefined);
  console.log(`queue=${queue.length} done=${done.size} todo=${todo.length} workers=${WORKERS} frames=1/${EVERY}s audio=${WITH_AUDIO}`);
  fs.mkdirSync(TMP, { recursive: true });

  const ledger = rebuildLog();
  console.log(`per-video log: ${LOG} (+ ${LOG_CSV}) — ${ledger.n} videos so far, $${ledger.cost.toFixed(4)}, ${(ledger.time / 60).toFixed(1)} min`);

  aheadQueue = todo;
  aheadIdx = 0;
  fillAhead();

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
        fs.appendFileSync(LOG, JSON.stringify(logRow(res, ledger.n, ledger.cost, ledger.time)) + '\n');
        fs.appendFileSync(LOG_CSV, csvLine(logRow(res, ledger.n, ledger.cost, ledger.time)) + '\n');
        console.log(`[w${w}] ${res.code} @${res.username} recipe=${res.is_recipe} frames=${res.frames} ing=${res.ingredients.length} cost=$${(res.usage.cost_usd || 0).toFixed(5)} ${res.timings.total_s.toFixed(1)}s | running $${ledger.cost.toFixed(4)} / ${ledger.n} videos / ${(ledger.time / 60).toFixed(1)} min (${ok}/${todo.length})`);
      } catch (e) {
        fail++;
        fs.appendFileSync(ERR, JSON.stringify({ ...rec, error: String(e.message || e), at: new Date().toISOString() }) + '\n');
        console.log(`[w${w}] FAIL ${rec.code}: ${e.message}`);
      }
      await sleep(1200 + Math.random() * 1800);
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(w)));

  const rows = readOut();
  const cost = rows.reduce((s, r) => s + (r.usage?.cost_usd || 0), 0);
  const mins = rows.reduce((s, r) => s + (r.timings?.total_s || 0), 0) / 60;
  console.log(`DONE ok=${ok} fail=${fail} | ${rows.length} videos total, $${cost.toFixed(4)}, ${mins.toFixed(1)} min`);
}

main().catch((e) => { console.error(e); process.exit(1); });
