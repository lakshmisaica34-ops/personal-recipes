import fs from 'node:fs';
import { fetchVideo, classifyVideo } from './gemini_classifier.mjs';

// Load cooking collection, filter to non-REAL posts
const RAW = fs.readFileSync('index/saved_all.jsonl', 'utf8');
const all = RAW.split('\n').filter((l) => l.trim());
const cooking = all.filter((l) => l.includes('18194606119249588'));

const nonReal = cooking.filter((l) => {
  const it = JSON.parse(l);
  const cap = (it.caption || '').replace(/[#＃][a-zA-Z0-9_]+/g, '').replace(/\s+/g, ' ').trim();
  const isRecipe = /(ingredients|recipe|what you need|method|how to|steps?|directions|cook time|servings|yield)/i.test(cap);
  const hasIngredient = /ingredients/i.test(cap);
  const verdict = isRecipe && hasIngredient ? 'REAL' : (isRecipe ? 'BORDERLINE' : 'NOT');
  return verdict !== 'REAL';
});

const vids = nonReal.filter((l) => {
  const it = JSON.parse(l);
  return it.media_type === 2 && it.has_audio === true;
});

// Sort by duration ascending, skip first 10 (already tested)
vids.sort((a, b) => {
  const da = JSON.parse(a).video_duration || 0;
  const db = JSON.parse(b).video_duration || 0;
  return da - db;
});

const SAMPLE = vids.slice(10, 20);
console.log(`Total non-REAL videos with audio: ${vids.length}`);
console.log(`Running next ${SAMPLE.length} videos (skipping first 10 already tested):\n`);

const results = [];
const start = Date.now();

for (const line of SAMPLE) {
  const it = JSON.parse(line);
  const caption = (it.caption || '').replace(/[#＃][^\s]+/g, '').trim();
  const batchStart = Date.now();
  console.log(`\n=== Video ${SAMPLE.indexOf(line) + 11} of 20 ===`);
  console.log(`ID: ${it.id} | ${it.username} | ${Math.round((it.video_duration || 0) * 10) / 10}s`);

  try {
    const { buf } = await fetchVideo(it.id);
    const videoStart = Date.now();
    const result = await classifyVideo(buf, it.id, caption);
    const videoEnd = Date.now();
    const totalEnd = Date.now();
    const videoTime = (videoEnd - batchStart) / 1000;
    const totalTime = (totalEnd - start) / 1000;

    console.log(`  Video download: ${videoTime}s`);
    console.log(`  Gemini classification: ${totalTime}s (started ${new Date(start).toISOString()})`);
    console.log(`  Verdict: ${result.is_recipe ?? 'error'} | ${result.reason || ''}`);

    results.push({
      id: it.id,
      username: it.username,
      duration: it.video_duration,
      caption: caption,
      is_recipe: result.is_recipe ?? null,
      reason: result.reason,
      error: result.error || false,
      api_status: result.api_status || 200,
    });
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    results.push({
      id: it.id,
      username: it.username,
      duration: it.video_duration,
      caption: caption,
      is_recipe: null,
      reason: 'ERROR: ' + e.message,
      error: true,
      api_status: 0,
    });
  }
}

const real = results.filter(r => r.is_recipe === true).length;
const not = results.filter(r => r.is_recipe === false).length;
const err = results.filter(r => r.is_recipe === null || r.error).length;

console.log('\n\n=== SUMMARY ===');
console.log(`REAL: ${real}, NOT: ${not}, ERROR: ${err} (out of ${results.length})`);
const totalTime = ((Date.now() - start) / 1000).toFixed(1);
console.log(`Total wall time: ${totalTime}s for ${results.length} videos`);
console.log(`Average: ${(totalTime / results.length).toFixed(1)}s per video`);

fs.writeFileSync('exports/gemini_batch2_results.json', JSON.stringify(results, null, 2));
console.log('\nSaved to exports/gemini_batch2_results.json');
