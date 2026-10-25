// pipeline/download_covers.mjs
//
// Download the cover image for every post that is used on the site into
// docs/thumbs/<code>.jpg, so the grid does not depend on expiring CDN links.
//
// Usage: node pipeline/download_covers.mjs [workers]

import fs from 'node:fs';
import path from 'node:path';

const WORK = path.join(process.cwd(), 'work');
const SITE = path.join(process.cwd(), 'docs');
const OUT = path.join(SITE, 'thumbs');
const COVERS = path.join(WORK, 'covers.jsonl');
const RECIPES = path.join(SITE, 'recipes.json');
const WORKERS = Math.max(1, Number(process.argv[2] || 5));

const COOKIE = process.env.Instagram_cookie;
const UA = process.env.IG_USER_AGENT;
if (!COOKIE || !UA) throw new Error('missing Instagram_cookie / IG_USER_AGENT');

fs.mkdirSync(OUT, { recursive: true });

const covers = new Map();
for (const l of fs.readFileSync(COVERS, 'utf8').split('\n')) {
  if (!l.trim()) continue;
  try { const r = JSON.parse(l); covers.set(r.code, r); } catch {}
}

// only the posts the site actually shows (primary + variant sources)
const recipes = JSON.parse(fs.readFileSync(RECIPES, 'utf8'));
const wanted = new Set();
for (const r of recipes) {
  if (r.code) wanted.add(r.code);
  for (const v of r.variants || []) if (v.code) wanted.add(v.code);
}

const queue = [...wanted].filter((c) => covers.has(c));
const missing = [...wanted].filter((c) => !covers.has(c));
console.log(`${wanted.size} posts on the site · ${queue.length} have a cover · ${missing.length} without`);

const todo = queue.filter((c) => {
  const f = path.join(OUT, `${c}.jpg`);
  return !(fs.existsSync(f) && fs.statSync(f).size > 1200);
});
console.log(`downloading ${todo.length} (${queue.length - todo.length} already cached)`);

let next = 0, ok = 0, fail = 0, bytes = 0;
const failures = [];

async function one(code) {
  const f = path.join(OUT, `${code}.jpg`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(covers.get(code).url, {
        headers: { Cookie: COOKIE, 'User-Agent': UA, Referer: 'https://www.instagram.com/' },
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1200) throw new Error(`too small ${buf.length}`);
      fs.writeFileSync(f, buf);
      bytes += buf.length;
      ok++;
      return true;
    } catch (e) {
      if (attempt) { fail++; failures.push(`${code} ${e.message}`); return false; }
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

async function worker(id) {
  while (next < todo.length) {
    const i = next++;
    await one(todo[i]);
    if ((ok + fail) % 50 === 0) {
      console.log(`  ${ok + fail}/${todo.length} · ${(bytes / 1e6).toFixed(1)} MB · ${fail} failed`);
    }
  }
}

await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));
console.log(`done: ${ok} downloaded, ${fail} failed, ${(bytes / 1e6).toFixed(1)} MB`);
if (failures.length) {
  fs.writeFileSync(path.join(WORK, 'covers_failed.txt'), failures.join('\n') + '\n');
  console.log('failures -> work/covers_failed.txt');
}
const total = fs.readdirSync(OUT).filter((f) => f.endsWith('.jpg'));
const totalBytes = total.reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`thumbs on disk: ${total.length}, ${(totalBytes / 1e6).toFixed(1)} MB`);
