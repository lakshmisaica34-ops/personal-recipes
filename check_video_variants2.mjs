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

const videoId = '3922708839609562394_16915342129';
const apiUrl = `https://www.instagram.com/api/v1/media/${videoId.split('_')[0]}/info/`;
const res = await fetch(apiUrl, { headers, redirect: 'manual' });
const text = await res.text();
const media = JSON.parse(text);
console.log('keys:', Object.keys(media).join(', '));
console.log('items keys:', Object.keys(media.items[0]).join(', '));
console.log('video_versions:', JSON.stringify(media.items[0].video_versions));
console.log('video_versions length:', media.items[0].video_versions?.length);
if (media.items[0].video_versions?.[0]) {
  console.log('version 0 url:', media.items[0].video_versions[0].url.substring(0, 150));
}
