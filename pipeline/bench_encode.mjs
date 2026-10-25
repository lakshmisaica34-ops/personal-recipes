// Bench: where does the 34 s per reel go, and what actually makes it faster?
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const WORK = path.join(process.cwd(), 'work');
const TMP = path.join(WORK, 'tmp');
fs.mkdirSync(TMP, { recursive: true });

const code = process.argv[2];
const urls = new Map();
for (const l of fs.readFileSync(path.join(WORK, 'video_urls.jsonl'), 'utf8').split('\n')) {
  if (!l.trim()) continue;
  try { const r = JSON.parse(l); if (r.code && r.url) urls.set(r.code, r); } catch {}
}
const COOKIE = process.env.Instagram_cookie, UA = process.env.IG_USER_AGENT;

const time = async (label, fn) => {
  const t0 = Date.now();
  const extra = await fn();
  console.log(`${label.padEnd(34)} ${((Date.now() - t0) / 1000).toFixed(1)}s ${extra ?? ''}`);
};

const raw = path.join(TMP, `${code}.bench.mp4`);
if (!fs.existsSync(raw)) {
  await time('download', async () => {
    const r = await fetch(urls.get(code).url, { headers: { Cookie: COOKIE, 'User-Agent': UA, Referer: 'https://www.instagram.com/' } });
    const b = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(raw, b);
    return `${(b.length / 1e6).toFixed(1)} MB`;
  });
}
const dur = Number((await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', raw])).stdout.trim());
console.log(`reel: ${dur.toFixed(1)}s, ${(fs.statSync(raw).size / 1e6).toFixed(1)} MB\n`);

const dir = (n) => { const d = path.join(TMP, `bench_${n}`); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); return d; };

await time('frames fps=1/5 (current)', async () => {
  const d = dir('fps5');
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', 'fps=1/5,scale=512:-2', '-q:v', '4', path.join(d, 'f%03d.jpg')], { maxBuffer: 1e8 });
  return `${fs.readdirSync(d).length} frames`;
});

await time('audio only (current)', async () => {
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', path.join(TMP, 'bench.m4a')], { maxBuffer: 1e8 });
  return `${(fs.statSync(path.join(TMP, 'bench.m4a')).size / 1e3).toFixed(0)} kB`;
});

await time('frames+audio, one pass', async () => {
  const d = dir('combo');
  const a = path.join(TMP, 'bench_combo.m4a');
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw,
    '-vf', 'fps=1/5,scale=512:-2', '-q:v', '4', path.join(d, 'f%03d.jpg'),
    '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', a], { maxBuffer: 1e8 });
  return `${fs.readdirSync(d).length} frames + ${(fs.statSync(a).size / 1e3).toFixed(0)} kB`;
});

await time('keyframes only (skip_frame)', async () => {
  const d = dir('key');
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-skip_frame', 'nokey', '-i', raw,
    '-vf', 'scale=512:-2', '-vsync', 'vfr', '-q:v', '4', path.join(d, 'f%03d.jpg')], { maxBuffer: 1e8 });
  return `${fs.readdirSync(d).length} keyframes`;
});

await time('keyframes + audio, one pass', async () => {
  const d = dir('keya');
  const a = path.join(TMP, 'bench_keya.m4a');
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-skip_frame', 'nokey', '-i', raw,
    '-vf', 'scale=512:-2', '-vsync', 'vfr', '-q:v', '4', path.join(d, 'f%03d.jpg'),
    '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', a], { maxBuffer: 1e8 });
  return `${fs.readdirSync(d).length} keyframes`;
});

await time('seek 8 stills (-ss per frame)', async () => {
  const d = dir('seek');
  const n = 8;
  for (let i = 0; i < n; i++) {
    const t = (dur * (i + 0.5)) / n;
    await exec('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t), '-i', raw, '-frames:v', '1', '-vf', 'scale=512:-2', '-q:v', '4', path.join(d, `s${String(i).padStart(2, '0')}.jpg`)], { maxBuffer: 1e8 });
  }
  return `${fs.readdirSync(d).length} seek frames`;
});

await time('combo with -threads 8', async () => {
  const d = dir('combo8');
  const a = path.join(TMP, 'bench_combo8.m4a');
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-threads', '8', '-i', raw,
    '-vf', 'fps=1/5,scale=512:-2', '-q:v', '4', path.join(d, 'f%03d.jpg'),
    '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', a], { maxBuffer: 1e8 });
  return `${fs.readdirSync(d).length} frames`;
});

const sizes = fs.readdirSync(path.join(TMP, 'bench_combo')).sort();
const kbs = sizes.map((f) => fs.statSync(path.join(TMP, 'bench_combo', f)).size);
console.log(`\ncombo frames: ${kbs.length}, avg ${(kbs.reduce((a, b) => a + b, 0) / kbs.length / 1024).toFixed(0)} kB each`);
