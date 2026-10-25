// ua_probe.mjs — find which User-Agent string the session accepts.
// Prints status + error only; never cookie values.

const names = Object.keys(process.env).filter((k) => /insta|cookie/i.test(k));
let cookie = null;
for (const n of names) {
  const v = process.env[n];
  if (v && v.includes('sessionid=')) { cookie = v.trim(); console.log('cookie source:', n); break; }
}
if (!cookie) { console.log('NO COOKIE'); process.exit(2); }

const UAS = [
  'Mozilla/5.0 (Android 15; Mobile; rv:154.0) Gecko/154.0 Firefox/154.0',
  'Mozilla/5.0 (Android 14; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0',
  'Mozilla/5.0 (Android 13; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
];

const URL = 'https://www.instagram.com/api/v1/feed/saved/?max_id=';
let claim = '0';

async function call(ua) {
  const mk = () => ({
    cookie,
    'user-agent': ua,
    accept: 'application/json, text/plain, */*',
    'x-ig-app-id': '936619743392459',
    'x-asbd-id': '129477',
    'x-requested-with': 'XMLHttpRequest',
    'x-ig-www-claim': claim,
    referer: 'https://www.instagram.com/saved/',
  });
  let r = await fetch(URL, { headers: mk() });
  const set = r.headers.get('x-ig-set-x-www-claim');
  if (set && set !== claim) { claim = set; r = await fetch(URL, { headers: mk() }); }
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { r, j, t };
}

for (const ua of UAS) {
  const { r, j, t } = await call(ua);
  const label = ua.replace(/^Mozilla\/5\.0 /, '').slice(0, 55);
  if (!j) { console.log(`${r.status} | ${label} | non-JSON ${t.slice(0, 60)}`); continue; }
  const info = j.message ?? j.status ?? (j.items ? `items=${j.items.length}` : Object.keys(j).slice(0, 6).join(','));
  console.log(`${r.status} | ${label} | ${info}`);
  if (j.items || j.collections) { console.log('WORKS_UA=' + ua); process.exit(0); }
}
console.log('NO_UA_MATCH');
