import fs from 'node:fs';
import { fetchVideo, classifyVideo } from './gemini_classifier.mjs';

// Load results from comments check
const RESULTS_FILE = 'exports/recipe_scrape_results_comments_only.json';
const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));

// Load full index
const RAW = fs.readFileSync('index/saved_all.jsonl', 'utf8');
const all = RAW.split('\n').filter((l) => l.trim());
const indexMap = new Map();
for (const line of all) {
  try {
    const it = JSON.parse(line);
    indexMap.set(it.id, it);
  } catch {}
}

// Get those still marked as NOT_RECIPE (no recipe found in caption or comments_alt)
const toProcess = results.filter(r => r.verdict === 'NOT_RECIPE' || (r.verdict && r.verdict.includes('NOT_RECIPE') && !r.is_recipe));
console.log(`Need to process with Gemini: ${toProcess.length}`);

let updatedResults = [...results];
let processed = 0;
let foundByGemini = 0;

for (let i = 0; i < toProcess.length; i++) {
  const r = toProcess[i];
  const idx = updatedResults.findIndex(x => x.id === r.id);
  if (idx === -1) continue;
  
  const origData = indexMap.get(r.id);
  if (!origData) continue;
  
  processed++;
  console.log(`\n[${processed}/${toProcess.length}] ${r.username} (${r.code})`);
  
  try {
    if (origData.media_type !== 2) {
      console.log(`  Not a video, skipping`);
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
    console.error(`  Error: ${e.message}`);
    updatedResults[idx] = {
      ...updatedResults[idx],
      verdict: 'ERROR_PROCESSING',
      error: e.message,
    };
  }
  
  if (processed % 2 === 0) {
    fs.writeFileSync('exports/recipe_scrape_results_gemini_partial.json', JSON.stringify(updatedResults, null, 2));
    console.log(`  [Progress saved]`);
  }
  
  await new Promise(r => setTimeout(r, 1000));
}

fs.writeFileSync('exports/recipe_scrape_results_final.json', JSON.stringify(updatedResults, null, 2));
fs.writeFileSync('exports/recipe_scrape_results_gemini_partial.json', JSON.stringify(updatedResults, null, 2));

const real = updatedResults.filter(r => r.is_recipe === true).length;
const not = updatedResults.filter(r => r.is_recipe === false && (r.verdict.includes('NOT_RECIPE') || r.verdict === 'NOT_RECIPE_GEMINI')).length;

console.log('\n=== SUMMARY ===');
console.log(`Processed with Gemini: ${processed}`);
console.log(`Found by Gemini: ${foundByGemini}`);
console.log(`Total REAL now: ${real}`);
console.log(`Total marked NOT (final): ${not}`);
console.log(`Saved to exports/recipe_scrape_results_final.json`);
