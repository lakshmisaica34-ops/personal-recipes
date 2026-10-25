// Fetch top-level comments for every post classified as COMMENTS in classify_v2.mjs,
// then re-classify each post based on what its top comments actually say.
// Uses the shared header stack from iglib.mjs.

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// ---- Reuse the verified header stack from iglib.mjs ----
const cookie = process.env.Instagram_cookie || '';
if (!cookie.includes('sessionid=')) throw new Error('Instagram_cookie missing sessionid');

const csrf = (cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1];
if (!csrf) throw new Error('csrftoken not found in cookie');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const headers = {
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

async function fetchComments(videoPk, shortcode) {
  const params = new URLSearchParams({ can_support_threading: 'true', permalink_enabled: 'false' });
  const url = `https://www.instagram.com/api/v1/media/${videoPk}/comments/?${params.toString()}`;
  const res = await fetch(url, {
    headers,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

// ---- Load the index ----
const RAW = readFileSync('index/saved_all.jsonl', 'utf8');
const all = RAW.split('\n').filter((l) => l.trim());
const COOKING_ID = '18194606119249588';
const cooking = all.filter((l) => l.includes(`"${COOKING_ID}"`));

// Replicate the v2 classifier to find COMMENTS posts
const COMMENT_WORDS = /(comment|dm|message|in my bio|send|ask|message me|whatsapp)/i;
const RECIPE_WORDS = /(recipe|ingredients|what you need|you'?ll need|method|how to|steps?|directions|cook time|servings|yield|ingredients:|cooking)/i;
const TEASER = /(comment (the )?recipe|full recipe in (bio|dm)|link in bio|dm for the recipe|recipe in my bio|comment below the recipe|follow for more recipes|comment (?:below|for) the recipe|question of the day|comment the word)/i;

const commentsPosts = cooking.map((line, i) => {
  const item = JSON.parse(line);
  const text = item.caption || '';
  const stripped = text.replace(/[#＃][a-zA-Z0-9_]+/g, '').replace(/\s+/g, ' ').trim();

  if (TEASER.test(stripped)) {
    if (COMMENT_WORDS.test(stripped)) return { idx: i + 1, id: item.id, shortcode: item.code || item.id, video_pk: item.id.split('_')[0], verdict: 'COMMENTS', reason: 'caption routes recipe to comments/DM/bio' };
    if (/comment/i.test(stripped)) return { idx: i + 1, id: item.id, shortcode: item.code || item.id, video_pk: item.id.split('_')[0], verdict: 'COMMENTS', reason: 'caption routes recipe to comments' };
    if (/link in bio|full recipe in (bio|dm)|recipe in my bio/i.test(stripped)) return { idx: i + 1, id: item.id, verdict: 'NOT', reason: 'recipe only in bio/DM, no comment wording' };
  }
  if (/buy|shop|order now|visit (my|the) shop|shopping|order (now|today)|for sale|product|link in bio/i.test(stripped)) {
    if (!RECIPE_WORDS.test(stripped)) return { idx: i + 1, id: item.id, verdict: 'NOT', reason: 'product/shop CTA' };
  }
  const hasRecipeWord = RECIPE_WORDS.test(stripped);
  const hasIngredientWord = /ingredients/i.test(stripped);
  if (hasRecipeWord && hasIngredientWord) return { idx: i + 1, id: item.id, verdict: 'REAL' };
  if (hasRecipeWord) return { idx: i + 1, id: item.id, verdict: 'REAL' };
  if (hasIngredientWord) return { idx: i + 1, id: item.id, verdict: 'REAL' };
  return { idx: i + 1, id: item.id, verdict: 'NOT' };
});

const commentRows = commentsPosts.filter((p) => p.verdict === 'COMMENTS');
console.log(`COMMENTS posts: ${commentRows.length}`);

// ---- Fetch comments for each, then re-classify ----
const results = [];
for (const p of commentRows) {
  const { status, json, text } = await fetchComments(p.video_pk, p.shortcode);
  const topComments = json && Array.isArray(json.comments) ? json.comments : [];
  const commentTexts = topComments.map((c) => (c && c.text ? c.text : ''));
  const commentBody = commentTexts.join(' ');
  // Re-classify with comments: look for recipe/ingredients signals in top comments
  const hasRecipeWord = RECIPE_WORDS.test(commentBody);
  const hasIngredientWord = /ingredients/i.test(commentBody);
  let finalVerdict, finalReason;
  if (hasRecipeWord && hasIngredientWord) {
    finalVerdict = 'REAL (via comments)';
    finalReason = 'caption routes to comments; top comments contain recipe + ingredients';
  } else if (hasRecipeWord) {
    finalVerdict = 'REAL (via comments)';
    finalReason = 'caption routes to comments; top comments contain recipe signals';
  } else if (hasIngredientWord) {
    finalVerdict = 'REAL (via comments)';
    finalReason = 'caption routes to comments; top comments contain ingredients';
  } else {
    finalVerdict = 'NOT (via comments)';
    finalReason = 'caption routes to comments but top comments contain no recipe/ingredients signals';
  }
  results.push({ idx: p.idx, id: p.id, status, text: text.slice(0, 500), json, topComments, commentTexts, finalVerdict, finalReason });
  console.log(`post ${p.idx} (${p.id}): http=${status} comments=${topComments.length} -> ${finalVerdict}`);
  await new Promise((r) => setTimeout(r, 800)); // polite, avoid rate limit
}

// ---- Write output ----
const out = [];
out.push(`# Comment-fetched and re-classified posts — cooking collection, v2 COMMENTS\n`);
out.push(`Total: ${results.length} posts had top comments fetched via Instagram API\n`);
out.push('| # | Post ID | HTTP | Top comments | Final verdict | Reason |\n');
out.push('|---|---|---|---|---|\n');
results.forEach((r) => {
  out.push(`| ${r.idx} | ${r.id} | ${r.status} | ${r.topComments.length} | ${r.finalVerdict} | ${r.finalReason} |\n`);
});

writeFileSync('exports/comment_fetch.md', out.join('\n'));
console.log('written to exports/comment_fetch.md');
