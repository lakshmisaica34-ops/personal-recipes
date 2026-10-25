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
  'cookie': cookie,
  'x-csrftoken': csrf,
  'x-asbd-id': '359341',
  'x-ig-app-id': '936619743392459',
};

const MODEL = 'google/gemini-2.5-flash-lite';
const OUT_DIR = 'exports';


// Fetch video buffer from Instagram
async function fetchVideo(videoId) {
  const apiUrl = `https://www.instagram.com/api/v1/media/${videoId.split('_')[0]}/info/`;
  const res = await fetch(apiUrl, { headers, redirect: 'manual' });
  const text = await res.text();
  const media = JSON.parse(text);
  const item = media.items[0];
  const videoUrl = item.video_versions[0]?.url || item.video_url;
  const vres = await fetch(videoUrl, { headers, redirect: 'manual' });
  const buf = Buffer.from(await vres.arrayBuffer());
  return { buf, duration: item.video_duration, id: videoId };
}

// Fetch the poster frame for a post. This hits /p/{code}/media/ instead of the
// /api/v1/media/{id}/info/ endpoint, which Instagram rate-limits independently,
// so it keeps working when video fetches are blocked.
async function fetchFrame(code) {
  const res = await fetch(`https://www.instagram.com/p/${code}/media/?size=l`, {
    headers: { 'user-agent': UA, cookie },
    redirect: 'follow',
  });
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.status !== 200 || buf.slice(0, 3).toString('hex') !== 'ffd8ff') {
    throw new Error(`poster frame fetch failed: HTTP ${res.status}`);
  }
  return buf;
}

// Shared JSON contract for both inputs: extract the recipe rather than asking
// the model to gatekeep a definition of "recipe".
const ANSWER_SHAPE =
  'Answer in strict JSON with fields:\n' +
  '- is_recipe (true/false)\n' +
  '- dish (short name of what is being made, or null)\n' +
  '- ingredients (list of strings - only ones you actually have evidence for)\n' +
  '- steps (list of strings, in order)\n' +
  '- reason (1-2 sentences, say what you saw)\n' +
  'If is_recipe is false, dish is null and ingredients/steps are empty arrays. Do not add text outside the JSON.';

// Classify from a single poster frame: infer what the underlying video shows
// and pull the recipe out of it. We only have one still, so it must not demand
// motion, but it also must not reject a silent visual cook-through.
async function classifyFrame(buf, id, caption) {
  const b64 = buf.toString('base64');

  const PROMPT =
    'You are given the cover image of an Instagram video from a cooking account. Extract the recipe from the video it belongs to.\n\n' +
    'The video may be completely silent with no text on screen - many of these just show ingredients being added, mixed, cooked and plated. Visually showing how a food or drink is made IS a recipe, even when nothing is written or spoken.\n\n' +
    'From the image and the caption, fill in what the video is making:\n' +
    '- is_recipe = true when the video shows food or drink being prepared.\n' +
    '- ingredients = everything you can identify that goes into it.\n' +
    '- steps = the preparation steps, in the order they would happen.\n\n' +
    'Set is_recipe = false only when it is clearly not food/drink preparation at all - an ad, a meme, a restaurant tour, someone just eating, or something that is not food. A frame showing a finished dish or prep in progress still counts as a recipe.\n\n' +
    'Caption: ' + (caption || 'none') + '\n\n' + ANSWER_SHAPE;

  return callOpenRouter(id, PROMPT, { type: 'image_url', image_url: 'data:image/jpeg;base64,' + b64 });
}

// Extract the recipe straight from the footage. No gatekeeping rubric: if the
// model can see what is being made and how, it is a recipe.
async function classifyVideo(buf, id, caption) {
  const b64 = buf.toString('base64');

  const PROMPT =
    'Get me the recipe and ingredients from this video.\n\n' +
    'Watch what happens in the footage. The video may have no narration and no on-screen text - silently showing ingredients being measured, combined, cooked and plated is a recipe.\n\n' +
    'Fill in:\n' +
    '- is_recipe = true whenever food or drink is actually being prepared.\n' +
    '- ingredients = every ingredient you can identify from the footage.\n' +
    '- steps = the steps in the order they happen.\n' +
    '- dish = what is being made.\n\n' +
    'Set is_recipe = false only if it is not food/drink preparation at all (an ad, meme, restaurant tour, someone only eating, non-food). In that case leave ingredients and steps empty.\n\n' +
    'The caption is context only and must not decide the answer on its own.\n\n' +
    'Caption: ' + (caption || 'none') + '\n\n' + ANSWER_SHAPE;

  return callOpenRouter(id, PROMPT, { type: 'video_url', url: 'data:video/mp4;base64,' + b64 });
}

// One OpenRouter call shared by the video and poster-frame paths, so both get
// the same model settings and response parsing.
async function callOpenRouter(id, prompt, mediaPart) {
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
            mediaPart,
          ],
        },
      ],
      max_tokens: 3000,
      temperature: 0.1,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (res.status !== 200) {
    console.log(`  ${id}: HTTP ${res.status} ${JSON.stringify(data.error)}`);
    return { is_recipe: null, reason: 'API error ' + res.status, error: true };
  }

  const text = data.choices?.[0]?.message?.content || 'NO CONTENT';
  let result;
  try {
    // Try to parse JSON from the response (may be wrapped in markdown fences)
    const cleaned = text.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
    result = JSON.parse(cleaned);
  } catch (e) {
    result = { is_recipe: null, reason: 'Could not parse response', raw: text };
  }

  console.log(`  ${id}: is_recipe=${result.is_recipe} ${result.reason || ''}`);
  return result;
}

export { fetchVideo, classifyVideo, fetchFrame, classifyFrame };
