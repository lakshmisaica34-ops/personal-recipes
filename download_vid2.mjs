import fs from 'node:fs';

const cookie = process.env.Instagram_cookie || '';
if (!cookie.includes('sessionid=')) throw new Error('Instagram_cookie missing');
const csrf = (cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1];
if (!csrf) throw new Error('csrftoken not found');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const headers = {
  'user-agent': UA,
  'cookie': cookie,
  'x-csrftoken': csrf,
  'x-asbd-id': '359341',
  'x-ig-app-id': '936619743392459',
};

// Post 12: "munching_meals" - "What went in ⬇️ 2 tbsp ragi flour 1 cup water"
const videoId = '3909730427920273431_3398018280';
const outFile = 'exports/video_short2_test.mp4';

const apiUrl = `https://www.instagram.com/api/v1/media/${videoId.split('_')[0]}/info/`;
const res = await fetch(apiUrl, { headers, redirect: 'manual' });
const text = await res.text();
const media = JSON.parse(text);
const item = media.items[0];
const vres = await fetch(item.video_versions[0].url, { headers, redirect: 'manual' });
const buf = Buffer.from(await vres.arrayBuffer());
fs.writeFileSync(outFile, buf);
console.log('Saved', outFile, buf.length, 'bytes, duration:', item.video_duration);
