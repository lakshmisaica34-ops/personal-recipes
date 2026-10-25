import fs from 'node:fs';

const OPENROUTER_API_KEY = process.env.Openrouter_api || '';
if (!OPENROUTER_API_KEY) throw new Error('Openrouter_api secret not found in env');

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

const MODEL = 'google/gemini-2.5-flash-lite';
const OUT_FILE = 'exports/video_short_test.mp4';

// Download the video
async function downloadVideo(videoId) {
  const apiUrl = `https://www.instagram.com/api/v1/media/${videoId.split('_')[0]}/info/`;
  const res = await fetch(apiUrl, { headers, redirect: 'manual' });
  const text = await res.text();
  const media = JSON.parse(text);
  const item = media.items[0];
  const videoUrl = item.video_versions[0]?.url || item.video_url;
  const vres = await fetch(videoUrl, { headers, redirect: 'manual' });
  const buf = Buffer.from(await vres.arrayBuffer());
  fs.writeFileSync(OUT_FILE, buf);
  console.log('Saved', OUT_FILE, buf.length, 'bytes, duration:', item.video_duration);
  return buf; // return the buffer
}

// Prompt for Gemini
const PROMPT =
  'You are classifying Instagram videos. A video is a RECIPE if it shows how to cook or prepare a food item, and includes ingredients, steps, or measurements. A video is NOT a recipe if it is just a food photo, product ad, meme, life tip, or vlog scene.\n\n' +
  'Answer in strict JSON with fields: is_recipe (true/false), reason (short text), ingredients (list), steps (list). If not a recipe, ingredients and steps should be empty arrays. Do not add any text outside the JSON.';

// Classify using Gemini via OpenRouter
async function classifyVideoFile(buf, prompt) {
  const b64 = buf.toString('base64');
  const dataUrl = 'data:video/mp4;base64,' + b64;
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://freebuff.com',
      'X-Title': 'gemini-video-test',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'file',
              media_type: 'video/mp4',
              filename: 'test.mp4',
              url: dataUrl,
            },
          ],
        },
      ],
      max_tokens: 1024,
      temperature: 0.2,
    }),
  });
  const data = await res.json();
  console.log('status:', res.status);
  console.log('error:', JSON.stringify(data.error));
  const text = data.choices?.[0]?.message?.content || 'NO CONTENT';
  console.log('response:', text);
  return text;
}

// Main
async function main() {
  const buf = await downloadVideo('3148276455058928970_3998154030');
  const result = await classifyVideoFile(buf, PROMPT);
  console.log('done');
}

main().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
