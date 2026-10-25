// pipeline/fetch_video_urls.mjs
//
// Collect the CDN video URL for every post in the saved collection by paging the
// saved-feed API (~30 posts per request) instead of one media-info call per video.
// This is ~40 polite requests instead of ~900.
//
// Output: work/video_urls.jsonl   {code,id,url,duration,width,height,taken_at}
// State : work/video_urls_state.json  {next_max_id}
//
// Usage: node pipeline/fetch_video_urls.mjs [collectionId] [maxPages]

import fs from 'node:fs';
import path from 'node:path';
import { client } from '../iglib.mjs';

const COLLECTION = process.argv[2] || '18194606119249588';
const MAX_PAGES = Number(process.argv[3] || 400);
const WORK = path.join(process.cwd(), 'work');
const OUT = path.join(WORK, 'video_urls.jsonl');
const STATE = path.join(WORK, 'video_urls_state.json');
fs.mkdirSync(WORK, { recursive: true });

const START = `https://www.instagram.com/api/v1/feed/collection/${COLLECTION}/posts/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seen = new Set();
if (fs.existsSync(OUT)) {
  for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try {
      const r = JSON.parse(l);
      if (r.code) seen.add(r.code);
    } catch {}
  }
}
let nextMax = null;
if (fs.existsSync(STATE)) {
  try {
    nextMax = JSON.parse(fs.readFileSync(STATE, 'utf8')).next_max_id || null;
  } catch {}
}
console.log(`resume: ${seen.size} urls, cursor=${nextMax ? 'yes' : 'start'}`);

const c = client();
let pages = 0;
let added = 0;
let backoff = 0;

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
      continue; // retry the same page
    }
    break;
  }
  backoff = 0;
  const items = res.json.items || [];
  let newOnPage = 0;
  for (const it of items) {
    const m = it.media || it;
    if (!m || !m.code || seen.has(m.code)) continue;
    const v = (m.video_versions || [])[0];
    if (!v) continue;
    seen.add(m.code);
    fs.appendFileSync(
      OUT,
      JSON.stringify({
        code: m.code,
        id: m.id,
        url: v.url,
        duration: m.video_duration ?? null,
        width: v.width ?? null,
        height: v.height ?? null,
        taken_at: m.taken_at ?? null,
      }) + '\n',
    );
    newOnPage++;
    added++;
  }
  pages++;
  console.log(`page ${pages}: ${items.length} items (${newOnPage} new), total ${seen.size}`);
  if (res.json.more_available && res.json.next_max_id) {
    nextMax = res.json.next_max_id;
    fs.writeFileSync(STATE, JSON.stringify({ next_max_id: nextMax, updated: Date.now() }));
    await sleep(2200 + Math.random() * 1800);
  } else {
    console.log('no more pages');
    fs.writeFileSync(STATE, JSON.stringify({ next_max_id: null, done: true, updated: Date.now() }));
    break;
  }
}
console.log(`DONE urls=${seen.size} added=${added} pages=${pages}`);
