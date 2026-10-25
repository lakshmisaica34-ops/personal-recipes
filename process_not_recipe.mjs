import fs from 'node:fs';
import path from 'node:path';
import { fetchVideo, classifyVideo } from './gemini_classifier.mjs';

// Load original results
const RESULTS_FILE = 'exports/recipe_scrape_results.json';
const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
const notRecipe = results.filter(r => r.verdict === 'NOT_RECIPE');

console.log(`Found ${notRecipe.length} NOT_RECIPE videos to reprocess`);

// Load full index to get original data
const RAW = fs.readFileSync('index/saved_all.jsonl', 'utf8');
const all = RAW.split('\n').filter((l) => l.trim());
const indexMap = new Map();
for (const line of all) {
  try {
    const it = JSON.parse(line);
    indexMap.set(it.id, it);
  } catch {}
}

// Cookie setup for comments
const cookie = process.env.Instagram_cookie || '';
if (!cookie.includes('sessionid=')) throw new Error('Instagram_cookie missing');
const csrf = (cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1];
if (!csrf) throw new Error('csrftoken not found');

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

const RECIPE_WORDS = /(recipe|ingredients|what you need|you'?ll need|method|how to|steps?|directions|cook time|servings|yield|ingredients:|cooking|make|prepare)/i;

function hasRecipeInText(text) {
  if (!text) return false;
  const cleaned = text.replace(/[#＃][a-zA-Z0-9_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (RECIPE_WORDS.test(cleaned)) {
    // Also check for ingredient-like patterns
    if (/ingredients/i.test(cleaned) || /\d+\s*(cup|tbsp|tsp|gram|g|oz|ml|lbs)/i.test(cleaned)) {
      return true;
    }
    if (RECIPE_WORDS.test(cleaned)) return true;
  }
  return false;
}

async function fetchCommentsAlt(videoPk) {
  try {
    const params = new URLSearchParams({ can_support_threading: 'true', permalink_enabled: 'false' });
    const url = `https://www.instagram.com/api/v1/media/${videoPk}/comments/?${params.toString()}`;
    const res = await fetch(url, { headers, redirect: 'manual' });
    const text = await res.text();
    if (res.status !== 200) {
      // Try alternative endpoint
      const altUrl = `https://www.instagram.com/api/v1/media/${videoPk}/comments/?count=50`;
      const altRes = await fetch(altUrl, { headers, redirect: 'manual' });
      const altText = await altRes.text();
      try {
        const json = JSON.parse(altText);
        if (Array.isArray(json.comments)) return json.comments;
        if (Array.isArray(json)) return json;
      } catch {}
      return [];
    }
    try {
      const json = JSON.parse(text);
      if (Array.isArray(json.comments)) return json.comments;
      if (Array.isArray(json)) return json;
    } catch {}
    return [];
  } catch (e) {
    console.error('Comment fetch error:', e.message);
    return [];
  }
}

const updatedResults = [...results];
let processed = 0;
let foundInComments = 0;
let sentToGemini = 0;
let foundByGemini = 0;

for (let i = 0; i < notRecipe.length; i++) {
  const r = notRecipe[i];
  const idx = results.findIndex(x => x.id === r.id);
  const origData = indexMap.get(r.id);
  if (!origData) {
    console.log(`  Skipping ${r.id} - not found in index`);
    continue;
  }
  
  processed++;
  console.log(`\n[${processed}/${notRecipe.length}] Processing ${r.username} (${r.code}) - ${r.id}`);
  
  // Try different comment endpoint
  const videoPk = r.id.split('_')[0];
  let comments = await fetchCommentsAlt(videoPk);
  console.log(`  Fetched ${comments.length} comments with alt endpoint`);
  
  // Check comments for recipe
  let recipeInComments = false;
  for (const c of comments) {
    const ctext = c.text || c.comment || '';
    if (hasRecipeInText(ctext)) {
      recipeInComments = true;
      break;
    }
  }
  
  if (recipeInComments) {
    console.log(`  FOUND recipe in comments!`);
    foundInComments++;
    updatedResults[idx] = {
      ...updatedResults[idx],
      verdict: 'REAL_COMMENTS_ALT',
      source: 'comments_alt',
      is_recipe: true,
      comments_loaded_alt: comments.length,
    };
    await new Promise(r => setTimeout(r, 1000));
    continue;
  }
  
  // If not found in comments, send to Gemini
  console.log(`  No recipe in comments, sending to Gemini...`);
  sentToGemini++;
  
  try {
    if (origData.media_type !== 2) {
      console.log(`  Skipping - not a video`);
      updatedResults[idx] = {
        ...updatedResults[idx],
        verdict: 'NOT_RECIPE_NO_VIDEO',
        gemini_checked: false,
      };
      continue;
    }
    
    const { buf } = await fetchVideo(r.id);
    const caption = (origData.caption || '').replace(/[#＃][^\s]+/g, '').trim();
    const geminiResult = await classifyVideo(buf, r.id, caption);
    
    if (geminiResult.is_recipe === true) {
      console.log(`  GEMINI: FOUND recipe! ${geminiResult.reason}`);
      foundByGemini++;
      updatedResults[idx] = {
        ...updatedResults[idx],
        verdict: 'REAL_GEMINI',
        source: 'gemini',
        is_recipe: true,
        gemini_reason: geminiResult.reason,
        gemini_ingredients: geminiResult.ingredients || [],
        gemini_steps: geminiResult.steps || [],
      };
    } else if (geminiResult.is_recipe === false) {
      console.log(`  GEMINI: Not a recipe - ${geminiResult.reason}`);
      updatedResults[idx] = {
        ...updatedResults[idx],
        verdict: 'NOT_RECIPE_GEMINI',
        source: 'gemini',
        is_recipe: false,
        gemini_reason: geminiResult.reason,
      };
    } else {
      console.log(`  GEMINI: Error/unknown`);
      updatedResults[idx] = {
        ...updatedResults[idx],
        verdict: 'ERROR_GEMINI',
        gemini_error: geminiResult.reason,
      };
    }
  } catch (e) {
    console.error(`  Error processing with Gemini: ${e.message}`);
    updatedResults[idx] = {
      ...updatedResults[idx],
      verdict: 'ERROR_PROCESSING',
      error: e.message,
    };
  }
  
  await new Promise(r => setTimeout(r, 2000)); // Rate limiting
}

fs.writeFileSync('exports/recipe_scrape_results_reprocessed.json', JSON.stringify(updatedResults, null, 2));

const real = updatedResults.filter(r => r.is_recipe === true).length;
const not = updatedResults.filter(r => r.verdict.includes('NOT_RECIPE')).length;

console.log('\n=== SUMMARY ===');
console.log(`Processed: ${processed}`);
console.log(`Found in comments (alt endpoint): ${foundInComments}`);
console.log(`Sent to Gemini: ${sentToGemini}`);
console.log(`Found by Gemini: ${foundByGemini}`);
console.log(`Total REAL now: ${real}`);
console.log(`Total NOT_RECIPE now: ${not}`);
console.log(`Saved to exports/recipe_scrape_results_reprocessed.json`);
