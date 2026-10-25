// Compare video vs sampled-stills vs stills+audio for ingredient extraction.
// Uses reels already processed end-to-end, so the baseline answer is known.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const WORK = path.join(process.cwd(), 'work');
const TMP = path.join(WORK, 'tmp');
const KEY = process.env.Openrouter_api;
const COOKIE = process.env.Instagram_cookie;
const UA = process.env.IG_USER_AGENT;
const MODEL = process.env.VIDEO_MODEL || 'google/gemini-2.5-flash-lite';
const codes = process.argv.slice(2);

const urls = new Map();
for (const l of fs.readFileSync(path.join(WORK, 'video_urls.jsonl'), 'utf8').split('\n')) {
  if (!l.trim()) continue;
  try { const r = JSON.parse(l); if (r.code && r.url) urls.set(r.code, r); } catch {}
}
const baseline = new Map();
for (const l of fs.readFileSync(path.join(WORK, 'video_results.jsonl'), 'utf8').split('\n')) {
  if (!l.trim()) continue;
  try { const r = JSON.parse(l); baseline.set(r.code, r); } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(TMP, { recursive: true });

const PROMPT = `This is an Instagram recipe reel (sampled frames, and the audio track when present).
Extract the dish and every ingredient — from on-screen text, the visuals, and speech.
Strict JSON only: {"dish":"","ingredients":[{"item":"","quantity":"","item_en":""}],"notes":""}
Use "" for a quantity that is never stated. Do not invent ingredients.`;

async function grab(code) {
  const rec = urls.get(code);
  if (!rec) throw new Error('no url ' + code);
  const r = await fetch(rec.url, { headers: { Cookie: COOKIE, 'User-Agent': UA, Referer: 'https://www.instagram.com/' } });
  if (!r.ok) throw new Error('download ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

async function frames(src, everySec, prefix) {
  const dir = path.join(TMP, prefix);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-i', src,
    '-vf', `fps=1/${everySec},scale=512:-2`, '-q:v', '4', path.join(dir, 'f%03d.jpg')], { maxBuffer: 1e8 });
  return fs.readdirSync(dir).sort().map((f) => fs.readFileSync(path.join(dir, f)));
}

async function audio(src, out) {
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', out], { maxBuffer: 1e8 });
  return fs.readFileSync(out);
}

async function send(parts) {
  const body = { model: MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, ...parts] }], max_tokens: 1500, temperature: 0.1 };
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, 'X-Title': 'recipe-probe' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok || d.error) return { error: `${r.status} ${JSON.stringify(d.error || d).slice(0, 200)}` };
  const u = d.usage || {};
  let data = {};
  try { data = JSON.parse((d.choices?.[0]?.message?.content || '').match(/\{[\s\S]*\}/)[0]); } catch {}
  return {
    provider: d.provider,
    cost: u.cost,
    ptok: u.prompt_tokens,
    ctok: u.completion_tokens,
    vt: u.prompt_tokens_details?.video_tokens,
    at: u.prompt_tokens_details?.audio_tokens,
    dish: data.dish || '',
    ing: (data.ingredients || []).map((i) => `${i.item_en || i.item}`),
  };
}

for (const code of codes) {
  const base = baseline.get(code) || {};
  const baseIng = (base.ingredients || []).map((i) => i.item_en || i.item);
  const raw = path.join(TMP, `${code}.cmp.mp4`);
  if (!fs.existsSync(raw)) fs.writeFileSync(raw, await grab(code));
  const dur = Number((await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', raw])).stdout.trim());
  console.log(`\n=== ${code} @${base.username} ${dur.toFixed(0)}s  baseline: ${baseIng.length} ing, $${(base.usage?.cost_usd || 0).toFixed(4)}`);
  console.log('  base:', baseIng.join(', ').slice(0, 220));

  const variants = [];
  const f10 = await frames(raw, 10, `${code}.f10`);   // ~1 frame / 10s
  const f5 = await frames(raw, 5, `${code}.f5`);      // ~1 frame / 5s
  const f25 = await frames(raw, 2.5, `${code}.f25`);  // ~1 frame / 2.5s
  const aud = await audio(raw, path.join(TMP, `${code}.m4a`));
  const img = (b) => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b.toString('base64') } });
  const audPart = { type: 'input_audio', input_audio: { data: aud.toString('base64'), format: 'mp3' } };

  variants.push([`stills${f10.length}`, f10.map(img)]);
  variants.push([`stills${f5.length}`, f5.map(img)]);
  variants.push([`stills${f25.length}`, f25.map(img)]);
  variants.push([`stills${f10.length}+audio`, [...f10.map(img), audPart]]);

  for (const [name, parts] of variants) {
    const res = await send(parts);
    console.log(`  ${name.padEnd(18)} $${(res.cost || 0).toFixed(5)} ptok=${res.ptok} vt=${res.vt} at=${res.at} ing=${res.ing?.length}${res.error ? ' ERR ' + res.error : ''}`);
    if (res.ing) {
      const missing = baseIng.filter((b) => !res.ing.some((x) => x.toLowerCase().includes(b.toLowerCase().slice(0, 6))));
      console.log('    got:', res.ing.join(', ').slice(0, 200));
      console.log('    missing vs baseline:', missing.join(', ').slice(0, 160));
    }
    await sleep(1200);
  }
}
