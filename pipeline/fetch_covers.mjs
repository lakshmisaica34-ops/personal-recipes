// pipeline/fetch_covers.mjs
//
// Page the saved-collection feed and record the cover image candidates for every
// post (image_versions2). Same ~40 polite requests as fetch_video_urls.mjs.
//
// Output: work/covers.jsonl   {code, media_type, w, h, url, candidates:[...]}
//
// Usage: node pipeline/fetch_covers.mjs [collectionId] [maxPages]

import fs from 'node:fs';
import path from 'node:path';
import { client } from '../iglib.mjs';

const COLLECTION = process.argv[2] || '18194606119249588';
const MAX_PAGES = Number(process.argv[3] || 400);
const WORK = path.join(process.cwd(), 'work');
const OUT = path.join(WORK, 'covers.jsonl');
fs.mkdirSync(WORK, { recursive: true });

const START = `https://www.instagram.com/api/v1/feed/collection/${COLLECTION}/posts/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seen = new Set();
if (fs.existsSync(OUT)) {
  for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { const r = JSON.parse(l); if (r.code) seen.add(r.code); } catch {}
  }
}
console.log(`resume: ${seen.size} covers`);

const c = client();
let nextMax = null;
let pages = 0;
let added = 0;
let backoff = 0;

function cover(media) {
  // carousels: the first child is what the grid shows
  if (media.media_type === 8 && Array.isArray(media.carousel_media) && media.carousel_media.length) {
    return media.carousel_media[0].image_versions2 || null;
  }
  return media.image_versions2 || null;
}

while (pages < MAX_PAGES) {
  const url = START + (nextMax ? `?max_id=${encodeURIComponent(nextMax)}` : '');
  let res;
  try {
    res = await c.get(url);
  } catch (e) {
    res = { status: 0, text: String(e.message) };
  }
  if (res.status !== 200 || !res.json) {
    const body = String(res.text || '').slice(0, 160);
    console.log(`page failed http=${res.status} ${body}`);
    if (res.status === 429 || res.status === 400 || res.status === 0) {
      backoff = Math.min(backoff ? backoff * 2 : 120, 1800);
      console.log(`  cooling down ${backoff}s`);
      await sleep(backoff * 1000);
      continue;
    }
    break;
  }
  backoff = 0;
  const items = res.json.items || [];
  let newOnPage = 0;
  for (const it of items) {
    const m = it.media || it;
    if (!m || !m.code || seen.has(m.code)) continue;
    const iv = cover(m);
    if (!iv || !iv.candidates || !iv.candidates.length) continue;
    const cands = iv.candidates
      .filter((v) => v && v.url && v.width)
      .map((v) => ({ w: v.width, h: v.height, url: v.url }))
      .sort((a, b) => a.w - b.w);
    if (!cands.length) continue;
    // 320 px wide is the sweet spot: sharp on a 2x phone grid, ~15-25 kB each
    const pick = cands.find((v) => v.w >= 320) || cands[cands.length - 1];
    seen.add(m.code);
    newOnPage++;
    added++;
    fs.appendFileSync(OUT, JSON.stringify({
      code: m.code,
      media_type: m.media_type,
      w: pick.w,
      h: pick.h,
      url: pick.url,
      candidates: cands.map((v) => v.w),
    }) + '\n');
  }
  pages++;
  nextMax = res.json.next_max_id || null;
  console.log(`page ${pages}: items=${items.length} new=${newOnPage} total=${seen.size} next=${nextMax ? 'yes' : 'END'}`);
  if (!nextMax) break;
  if (items.length && !newOnPage) {
    // the feed repeats the last page at the end; stop rather than loop
    if (pages > 2) break;
  }
  await sleep(900 + Math.random() * 700);
}

console.log(`done: ${added} covers written, ${seen.size} total`);
