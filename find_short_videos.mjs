import fs from 'node:fs';

const RAW = fs.readFileSync('index/saved_all.jsonl', 'utf8');
const all = RAW.split('\n').filter((l) => l.trim());
const cooking = all.filter((l) => l.includes('18194606119249588'));

// Non-REAL posts (NOT or BORDERLINE)
const nonReal = cooking.filter((l) => {
  const it = JSON.parse(l);
  const cap = (it.caption || '').replace(/[#＃][a-zA-Z0-9_]+/g, '').replace(/\s+/g, ' ').trim();
  const isRecipe = /(ingredients|recipe|what you need|method|how to|steps?|directions|cook time|servings|yield)/i.test(cap);
  const hasIngredient = /ingredients/i.test(cap);
  const verdict = isRecipe && hasIngredient ? 'REAL' : (isRecipe ? 'BORDERLINE' : 'NOT');
  return verdict !== 'REAL';
});

// Filter to videos with audio, sort by duration ascending (shortest first)
const vids = nonReal.filter((l) => {
  const it = JSON.parse(l);
  return it.media_type === 2 && it.has_audio === true;
});

vids.sort((a, b) => {
  const da = JSON.parse(a).video_duration || 0;
  const db = JSON.parse(b).video_duration || 0;
  return da - db;
});

console.log('short video posts with audio (non-REAL):', vids.length);
vids.slice(0, 15).forEach((v, i) => {
  const it = JSON.parse(v);
  console.log(
    i + 1,
    '| duration:', Math.round((it.video_duration || 0) * 10) / 10,
    '| username:', it.username,
    '| id:', it.id,
    '| cap:', (it.caption || '').replace(/\n/g, ' ').slice(0, 60)
  );
});
