import fs from 'node:fs';

const RAW = fs.readFileSync('index/saved_all.jsonl', 'utf8');
const all = RAW.split('\n').filter((l) => l.trim());
const cooking = all.filter((l) => l.includes('18194606119249588'));

// NO + borderline posts (not categorized as REAL in v2)
const nonReal = cooking.filter((l) => {
  const it = JSON.parse(l);
  const cap = (it.caption || '').replace(/[#＃][a-zA-Z0-9_]+/g, '').replace(/\s+/g, ' ').trim();
  const isRecipe = /(ingredients|recipe|what you need|method|how to|steps?|directions|cook time|servings|yield)/i.test(cap);
  const hasIngredient = /ingredients/i.test(cap);
  const verdict = isRecipe && hasIngredient ? 'REAL' : (isRecipe ? 'BORDERLINE' : 'NOT');
  return verdict !== 'REAL';
});

console.log('non-REAL posts:', nonReal.length);

// Filter to videos with audio AND non-real
const vids = nonReal.filter((l) => {
  const it = JSON.parse(l);
  return it.media_type === 2 && it.has_audio === true;
});

console.log('video posts with audio (non-REAL):', vids.length);
const sample = vids.slice(0, 10);
sample.forEach((v, i) => {
  const it = JSON.parse(v);
  console.log(
    i + 1,
    '| has_audio:', it.has_audio,
    '| media_type:', it.media_type,
    '| duration:', it.video_duration,
    '| username:', it.username,
    '| id:', it.id,
    '| cap:', (it.caption || '').replace(/\n/g, ' ').slice(0, 70)
  );
});
