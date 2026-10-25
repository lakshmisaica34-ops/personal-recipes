// Probe: does Gemini/OpenRouter honour media_resolution for video, and how much
// does it cut video tokens? Downloads one reel, encodes it once, then sends the
// same clip with different settings and compares billed tokens + cost.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ROOT = process.cwd();
const WORK = path.join(ROOT, 'work');
const KEY = process.env.Openrouter_api;
const COOKIE = process.env.Instagram_cookie;
const UA = process.env.IG_USER_AGENT;
const MODEL = process.env.VIDEO_MODEL || 'google/gemini-2.5-flash-lite';
const code = process.argv[2];

const urls = new Map();
for (const l of fs.readFileSync(path.join(WORK, 'video_urls.jsonl'), 'utf8').split('\n')) {
  if (!l.trim()) continue;
  try { const r = JSON.parse(l); if (r.code && r.url) urls.set(r.code, r); } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function grab() {
  const rec = urls.get(code);
  if (!rec) throw new Error('no cached url for ' + code);
  const r = await fetch(rec.url, {
    headers: { Cookie: COOKIE, 'User-Agent': UA, Referer: 'https://www.instagram.com/' },
  });
  if (!r.ok) throw new Error('download ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

async function encode(src, out, vf) {
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', vf,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
    '-c:a', 'aac', '-b:a', '48k', '-ac', '1', out], { maxBuffer: 1e8 });
  return fs.statSync(out).size;
}

const PROMPT = 'List the dish name and every ingredient visible on screen or spoken in this Instagram reel. Strict JSON: {"dish":"","ingredients":[{"item":"","quantity":""}]} No markdown.';

async function send(buf, extra) {
  const part = { type: 'video_url', video_url: { url: 'data:video/mp4;base64,' + buf.toString('base64') }, processing: 'static', ...extra };
  const body = { model: MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, part] }], max_tokens: 1200, temperature: 0.1 };
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, 'X-Title': 'recipe-probe' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok || d.error) return { error: `${r.status} ${JSON.stringify(d.error || d).slice(0, 200)}` };
  const u = d.usage || {};
  return {
    video_tokens: u.prompt_tokens_details?.video_tokens,
    prompt_tokens: u.prompt_tokens,
    completion_tokens: u.completion_tokens,
    cost: u.cost,
    text: (d.choices?.[0]?.message?.content || '').replace(/\s+/g, ' ').slice(0, 180),
  };
}

const raw = path.join(WORK, 'tmp', `${code}.probe.mp4`);
fs.mkdirSync(path.dirname(raw), { recursive: true });
if (!fs.existsSync(raw)) fs.writeFileSync(raw, await grab());

const cases = [
  ['fps1_540', 'fps=1,scale=540:-2', {}],
  ['fps1_540_reslow', 'fps=1,scale=540:-2', { media_resolution: 'low' }],
  ['fps1_360_reslow', 'fps=1,scale=360:-2', { media_resolution: 'low' }],
];

for (const [name, vf, extra] of cases) {
  const out = path.join(WORK, 'tmp', `${code}.${name}.out.mp4`);
  const bytes = await encode(raw, out, vf);
  const res = await send(fs.readFileSync(out), extra);
  console.log(name, JSON.stringify({ mb: +(bytes / 1e6).toFixed(2), ...res }));
  await sleep(1500);
}
