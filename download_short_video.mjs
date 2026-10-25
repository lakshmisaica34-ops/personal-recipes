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

// Post 1: 6s video, "rollercoasterofmotherhood" - "Since when are you following me?? Type 1 or 2 or 3"
const videoId = '3148276455058928970_3998154030';
const outFile = 'exports/video_short_test.mp4';

async function downloadVideo() {
  const apiUrl = `https://www.instagram.com/api/v1/media/${videoId.split('_')[0]}/info/`;
  const res = await fetch(apiUrl, { headers, redirect: 'manual' });
  const text = await res.text();
  const media = JSON.parse(text);
  const item = media.items[0];
  // Get one of the video versions
  const videoVersion = item.video_versions[0];
  const videoUrl = videoVersion.url;
  console.log('Video URL:', videoUrl.substring(0, 120) + '...');
  const vres = await fetch(videoUrl, { headers, redirect: 'manual' });
  const buf = Buffer.from(await vres.arrayBuffer());
  fs.writeFileSync(outFile, buf);
  console.log('Saved', outFile, 'bytes:', buf.length, '| duration:', item.video_duration);
}

downloadVideo().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
