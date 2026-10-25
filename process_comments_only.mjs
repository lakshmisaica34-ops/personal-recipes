import fs from 'node:fs';
import { fetchVideo, classifyVideo } from './gemini_classifier.mjs';

// Load original results
const RESULTS_FILE = 'exports/recipe_scrape_results.json';
const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));

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
  const cleaned = text.replace(/[#＃][a-zA-Z0-9_]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (RECIPE_WORDS.test(cleaned)) {
    if (/ingredients/i.test(cleaned) || /\d+\s*(cup|tbsp|tsp|gram|g|oz|ml|lbs|pounds|tablespoon|teaspoon)/i.test(cleaned)) {
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
    return [];
  }
}

// Load progress
const PROGRESS_FILE = 'exports/recipe_scrape_results_comments_only.json';
let updatedResults = [...results];
if (fs.existsSync(PROGRESS_FILE)) {
  try {
    updatedResults = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    console.log('Loaded partial progress');
  } catch {}
}

const notRecipe = updatedResults.filter(r => r.verdict === 'NOT_RECIPE' || (r.verdict && r.verdict.includes('NOT_RECIPE') && !r.is_recipe && !r.verdict.includes('ALT')));
console.log(`Still need to process: ${notRecipe.length}`);

let processed = 0;
let foundInComments = 0;

for (let i = 0; i < notRecipe.length; i++) {
  const r = notRecipe[i];
  const idx = updatedResults.findIndex(x => x.id === r.id);
  if (idx === -1) continue;
  
  processed++;
  console.log(`\n[${processed}/${notRecipe.length}] ${r.username} (${r.code})`);
  
  const videoPk = r.id.split('_')[0];
  let comments = await fetchCommentsAlt(videoPk);
  console.log(`  Fetched ${comments.length} comments`);
  
  let recipeInComments = false;
  for (const c of comments) {
    const ctext = c.text || c.comment || c.content || '';
    if (hasRecipeInText(ctext)) {
      recipeInComments = true;
      console.log(`    Found recipe in comment: ${ctext.substring(0, 60)}...`);
      break;
    }
  }
  
  if (recipeInComments) {
    foundInComments++;
    updatedResults[idx] = {
      ...updatedResults[idx],
      verdict: 'REAL_COMMENTS_ALT',
      source: 'comments_alt',
      is_recipe: true,
      comments_loaded_alt: comments.length,
    };
  } else {
    updatedResults[idx] = {
      ...updatedResults[idx],
      comments_checked_alt: true,
      comments_loaded_alt: comments.length,
    };
  }
  
  if (processed % 5 === 0) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(updatedResults, null, 2));
    console.log(`  [Saved progress]`);
  }
  
  await new Promise(r => setTimeout(r, 800));
}

fs.writeFileSync(PROGRESS_FILE, JSON.stringify(updatedResults, null, 2));
console.log(`\nDone. Found ${foundInComments} recipes in comments. Saved to ${PROGRESS_FILE}`);
