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

// Filter to videos with audio
const vids = nonReal.filter((l) => {
  const it = JSON.parse(l);
  return it.media_type === 2 && it.has_audio === true;
});

// Sort by duration ascending (shortest first = fastest)
vids.sort((a, b) => {
  const da = JSON.parse(a).video_duration || 0;
  const db = JSON.parse(b).video_duration || 0;
  return da - db;
});

console.log(`Total non-REAL videos with audio: ${vids.length}`);
console.log(`\nSampling first 10 (shortest) for Gemini test:\n`);

const SAMPLE = vids.slice(0, 10);
const results = [];

for (const line of SAMPLE) {
  const it = JSON.parse(line);
  const caption = (it.caption || '').replace(/[#＃][^\s]+/g, '').trim();
  console.log(`\nProcessing ${it.id} (${it.username}, ${Math.round((it.video_duration || 0) * 10) / 10}s):`);
  console.log(`  Caption: ${caption.slice(0, 80)}`);

  try {
    const { buf } = await fetchVideo(it.id);
    const result = await classifyVideo(buf, it.id, caption);
    results.push({ id: it.id, verdict: result.is_recipe ?? 'error', reason: result.reason, caption, duration: it.video_duration });
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    results.push({ id: it.id, verdict: 'error', error: true, caption, duration: it.video_duration });
  }
}

console.log('\n\n=== SUMMARY ===');
const real = results.filter(r => r.verdict === true).length;
const not = results.filter(r => r.verdict === false).length;
const error = results.filter(r => r.verdict === 'error' || r.verdict === null).length;
console.log(`REAL: ${real}, NOT: ${not}, ERROR: ${error}`);
console.log('\nResults:');
results.forEach((r) => {
  console.log(`  ${r.id}: ${r.verdict} | ${r.reason || ''}`);
});
fs.writeFileSync('exports/gemini_sample_results.json', JSON.stringify(results, null, 2));
console.log('\nSaved to exports/gemini_sample_results.json');
