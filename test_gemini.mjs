import fs from 'node:fs';
import { execSync } from 'node:child_process';

const OPENROUTER_API_KEY = process.env.Openrouter_api || '';
if (!OPENROUTER_API_KEY) throw new Error('Openrouter_api secret not found');

// Reuse the header stack from iglib.mjs to fetch videos
const cookie = process.env.Instagram_cookie || '';
if (!cookie.includes('sessionid=')) throw new Error('Instagram_cookie missing');

const csrf = (cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1];
if (!csrf) throw new Error('csrftoken not found');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const headers = {
  'user-agent': UA,
  'accept': '*/*',
  'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
  'sec-ch-ua-full-version-list': '"Chromium";v="148.0.7778.56", "Google Chrome";v="148.0.7778.56", "Not/A)Brand";v="99.0.0.0"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-model': '""',
  'sec-ch-ua-platform': '"Linux"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'sec-gpc': '1',
  'cookie': cookie,
  'x-csrftoken': csrf,
  'x-asbd-id': '359341',
  'x-ig-app-id': '936619743392459',
};

// Test video: Jowar rotti food video (3922708839609562394_16915342129)
const videoId = '3922708839609562394_16915342129';
// Save it to exports/video_test.mp4
const outFile = 'exports/video_test.mp4';

async function downloadVideo() {
  const url = `https://www.instagram.com/api/v1/media/${videoId.split('_')[0]}/info/`;
  const res = await fetch(url, { headers, redirect: 'manual' });
  const text = await res.text();
  const media = JSON.parse(text);
  const item = media.items[0];
  const videoUrl = item.video_versions[0].url || item.video_url;
  console.log('Video URL:', videoUrl);
  const vres = await fetch(videoUrl, { headers, redirect: 'manual' });
  const buf = Buffer.from(await vres.arrayBuffer());
  fs.writeFileSync(outFile, buf);
  console.log('Saved to', outFile, 'bytes:', buf.length);
}

downloadVideo().then(() => {
  console.log('done');
}).catch((e) => {
  console.error('download failed:', e.message);
  process.exit(1);
});
