// Shared Instagram saved-feed client (working header stack, verified live).
// The "useragent mismatch" gate is a UA <-> sec-ch-ua consistency check;
// Chrome-UA + matching client hints + x-asbd-id 359341 routes to the JSON API.
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

function headers(cookie, csrf) {
  return {
    'user-agent': UA,
    'accept': '*/*',
    'cache-control': 'no-cache',
    'dnt': '1',
    'pragma': 'no-cache',
    'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    'sec-ch-ua-full-version-list': '"Chromium";v="148.0.7778.56", "Google Chrome";v="148.0.7778.56", "Not/A)Brand";v="99.0.0.0"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-model': '""',
    'sec-ch-ua-platform': '"Linux"',
    'sec-ch-ua-platform-version': '""',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'sec-gpc': '1',
    'cookie': cookie,
    'x-csrftoken': csrf,
    'x-asbd-id': '359341',
    'x-ig-app-id': '936619743392459',
  };
}

export function client() {
  const cookie = process.env.Instagram_cookie || '';
  if (!cookie.includes('sessionid=')) throw new Error('Instagram_cookie missing sessionid');
  const csrf = (cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1];
  if (!csrf) throw new Error('csrftoken not found in cookie');
  const h = headers(cookie, csrf);
  return {
    async get(url) {
      const res = await fetch(url, { headers: h, redirect: 'manual' });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: res.status, json, text };
    },
  };
}

export function compact(media) {
  return {
    id: media.id,
    code: media.code,
    url: media.code ? 'https://www.instagram.com/p/' + media.code + '/' : null,
    username: media.user && media.user.username,
    full_name: media.user && media.user.full_name,
    caption: media.caption && media.caption.text ? media.caption.text : null,
    media_type: media.media_type, // 1=image 8=carousel 2=video
    product_type: media.product_type, // clips=reel, feed, etc.
    like_count: media.like_count ?? null,
    comment_count: media.comment_count ?? null,
    taken_at: media.taken_at ?? null,
    video_duration: media.video_duration ?? null,
    accessibility_caption: media.accessibility_caption ?? null,
    location: media.location && media.location.name ? media.location.name : null,
    saved_collection_ids: media.saved_collection_ids || [],
    has_audio: media.has_audio ?? undefined,
  };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function crawlFeed(c, startUrl, { statePath, outPath, maxPages = 300, onPage } = {}) {
  // resume state
  let nextMax = null;
  let pageCount = 0;
  const seen = new Set();
  let out = null;
  if (fs.existsSync(outPath)) {
    for (const line of fs.readFileSync(outPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); if (r.id) seen.add(r.id); } catch {}
    }
    console.log(`  resuming: ${seen.size} items already indexed`);
  }
  if (fs.existsSync(statePath)) {
    try { nextMax = JSON.parse(fs.readFileSync(statePath, 'utf8')).next_max_id ?? null; } catch {}
    console.log(`  resume cursor: ${nextMax ? 'yes' : 'start over (no cursor)'}`);
  }
  out = fs.createWriteStream(outPath, { flags: 'a' });

  let url = startUrl;
  let added = 0;
  while (pageCount < maxPages) {
    if (nextMax) url = startUrl + (startUrl.includes('?') ? '&' : '?') + 'max_id=' + encodeURIComponent(nextMax);
    const { status, json } = await c.get(url);
    if (status !== 200 || !json) {
      console.log(`  page FAILED http=${status} — stopping (state saved, resumable)`);
      break;
    }
    const items = json.items || [];
    let newOnPage = 0;
    for (const it of items) {
      const m = it.media || it;
      if (!m || !m.id || seen.has(m.id)) continue;
      seen.add(m.id);
      out.write(JSON.stringify(compact(m)) + '\n');
      newOnPage++;
      added++;
    }
    pageCount++;
    const last = items.length ? (items[items.length - 1].media || items[items.length - 1]) : null;
    console.log(`  page ${pageCount}: ${items.length} items (${newOnPage} new), total indexed ${seen.size}${last && last.user ? ', last @' + last.user.username : ''}`);
    if (json.more_available && json.next_max_id) {
      nextMax = json.next_max_id;
      fs.writeFileSync(statePath, JSON.stringify({ next_max_id: nextMax, updated: Date.now() }));
      await sleep(1300 + Math.random() * 1400);
    } else {
      nextMax = null;
      fs.writeFileSync(statePath, JSON.stringify({ next_max_id: null, done: true }));
      console.log('  feed complete (more_available=false)');
      break;
    }
    if (onPage) onPage(pageCount, seen.size);
  }
  out.end();
  return { added, total: seen.size, pages: pageCount };
}
