// saved.mjs — check access to the logged-in Instagram account's Saved feed.
// Reads session cookies from a project secret (env var). Never prints cookie values.

import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'data';
mkdirSync(OUT, { recursive: true });

function findCookie() {
  if (process.env.INSTAGRAM_COOKIES?.trim()) {
    return { name: 'INSTAGRAM_COOKIES', value: process.env.INSTAGRAM_COOKIES.trim() };
  }
  const names = Object.keys(process.env).filter((k) => /insta|cookie/i.test(k));
  for (const n of names) {
    const v = process.env[n];
    if (v && v.includes('=')) return { name: n, value: v.trim() };
  }
  return null;
}

const cookie = findCookie();
if (!cookie) {
  console.log('RESULT: NO_COOKIE_SECRET');
  console.log('Matching env names:', Object.keys(process.env).filter((k) => /insta|cookie/i.test(k)).join(', ') || '(none)');
  process.exit(2);
}
console.log(`cookie source: ${cookie.name} (length ${cookie.value.length})`);
if (!/sessionid=/i.test(cookie.value)) {
  console.log('WARNING: no sessionid= found in the cookie string — export may be from the wrong site.');
}
const csrf = (cookie.value.match(/csrftoken=([^;]+)/) || [])[1] || '';

const UA = process.env.IG_UA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
let claim = '0';

function headers(extra = {}) {
  return {
    cookie: cookie.value,
    'user-agent': UA,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    'x-ig-app-id': '936619743392459',
    'x-asbd-id': '129477',
    'x-requested-with': 'XMLHttpRequest',
    'x-csrftoken': csrf,
    'x-ig-www-claim': claim,
    referer: 'https://www.instagram.com/saved/',
    origin: 'https://www.instagram.com',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    ...extra,
  };
}

async function ig(url) {
  let r = await fetch(url, { headers: headers() });
  const set = r.headers.get('x-ig-set-x-www-claim');
  if (set && set !== claim) {
    claim = set;
    r = await fetch(url, { headers: headers() });
  }
  return r;
}

async function getJson(url, label) {
  const r = await ig(url);
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  if (!j) {
    console.log(`${label}: HTTP ${r.status}, non-JSON (${text.length}b): ${text.slice(0, 180).replace(/\s+/g, ' ')}`);
    return { http: r.status, json: null, text };
  }
  writeFileSync(`${OUT}/${label}.json`, text);
  return { http: r.status, json: j, text };
}

function collectionList(j) {
  const c = j.collections;
  if (Array.isArray(c)) return c;
  if (c && Array.isArray(c.items)) return c.items;
  if (c && Array.isArray(c.edges)) return c.edges.map((e) => e.node || e);
  return [];
}

function firstItems(j) {
  return j.items || j.saved_feed?.items || j.media?.items || [];
}

function describeItems(label, j) {
  const it = firstItems(j);
  console.log(
    `${label}: http-ok items=${it.length} more=${j.more_available ?? j.next_max_id ? 'yes' : 'no'} ` +
    `err=${j.error ?? j.message ?? j.status ?? '-'} keys=[${Object.keys(j).slice(0, 14).join(',')}]`
  );
  if (it.length) {
    const f = it[0];
    const cap = String(f.caption?.text || f.caption || '').replace(/\s+/g, ' ').slice(0, 110);
    console.log(`   first: code=${f.code ?? f.shortcode ?? '?'} owner=${f.user?.username ?? f.owner?.username ?? '?'} cap="${cap}"`);
  }
  return it.length;
}

// Seed the x-ig-www-claim from the site like a real browser would.
try {
  const home = await fetch('https://www.instagram.com/saved/', {
    headers: { cookie: cookie.value, 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
  });
  const hc = home.headers.get('x-ig-set-x-www-claim');
  if (hc) claim = hc;
  await home.body?.cancel?.();
  console.log('seed claim:', claim);
} catch (e) {
  console.log('seed failed:', e.message);
}

// Stage 1: base Saved feed ("All" tab)
const BASE = 'https://www.instagram.com/api/v1/feed/saved/?max_id=';
const base = await getJson(BASE, 'saved_page1');
if (!base.json) { console.log('RESULT: NO_JSON'); process.exit(1); }
const j = base.json;
const err = j.error ?? j.message ?? j.status ?? null;
console.log(`base: http ${base.http} success=${j.success ?? '-'} err=${err ?? '-'}`);
if (j.login_required || err === 'login_required' || err === 'checkpoint_required' || err === 'challenge_required') {
  console.log('RESULT:', String(err).toUpperCase(), '— session cookie not accepted (wrong-site export, logged out, expired, or challenge).');
  process.exit(3);
}

const items = firstItems(j);
console.log(`page1 items=${items.length} more_available=${j.more_available ?? '?'} max_id=${j.max_id ?? j.next_max_id ?? '(none)'}`);
console.log('top keys:', Object.keys(j).join(', '));

const cols = collectionList(j);
const colCount = j.collections?.count ?? cols.length;
console.log(`COLLECTIONS (${colCount}):`);
for (const c of cols.slice(0, 60)) {
  console.log(`  - "${c.name}" id=${c.id} media_count=${c.media_count ?? '?'}`);
}

const cooking = cols.find((c) => /^cooking$/i.test(String(c.name || '').trim()))
  || cols.find((c) => /cook/i.test(String(c.name || '')));
if (!cooking) {
  console.log('RESULT: ACCESS_OK_NO_COOKING_COLLECTION');
  process.exit(0);
}
console.log(`COOKING: id=${cooking.id} media_count=${cooking.media_count ?? '?'}`);

// Stage 2: find the endpoint that pages through a single collection
const probes = [
  ['probe_collection_id', `https://www.instagram.com/api/v1/feed/saved/?collection_id=${encodeURIComponent(cooking.id)}&max_id=`],
  ['probe_collection_path', `https://www.instagram.com/api/v1/feed/collection/${encodeURIComponent(cooking.id)}/`],
  ['probe_maxid', `https://www.instagram.com/api/v1/feed/saved/?max_id=${encodeURIComponent(cooking.id)}`],
];
let worked = null;
for (const [label, url] of probes) {
  const res = await getJson(url, label);
  if (!res.json) continue;
  const n = describeItems(label, res.json);
  if (res.json.collection) console.log('   echo collection:', JSON.stringify(res.json.collection).slice(0, 200));
  if (n > 0 && !worked) worked = { label, res };
}
if (!worked) {
  console.log('RESULT: ACCESS_OK_COLLECTION_ENDPOINT_NOT_FOUND');
  process.exit(0);
}
console.log('RESULT: COOKING_ACCESS_OK via', worked.label);
