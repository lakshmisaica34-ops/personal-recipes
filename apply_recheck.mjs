// Apply the extraction-prompt recheck to the final results and regenerate CSVs.
//
// 1. The two records whose poster frames 404 get a caption-only Gemini call so
//    nothing is left unclassified.
// 2. Every rechecked verdict overwrites the old NOT_RECIPE_GEMINI verdict in
//    exports/recipe_scrape_results_final.json (original backed up first).
// 3. Writes exports/recipe_recheck_results.csv (all 74, old vs new verdict)
//    and regenerates exports/not_recipe_list.csv from the updated results.
//
// Run: node apply_recheck.mjs
import fs from 'node:fs';

const RESULTS = 'exports/recipe_scrape_results_final.json';
const RECHECK = 'exports/gemini_recheck_results.json';
const KEY = process.env.Openrouter_api || '';
if (!KEY) throw new Error('Openrouter_api missing');

const all = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
const byId = new Map(all.map((r) => [r.id, r]));
const recheck = JSON.parse(fs.readFileSync(RECHECK, 'utf8'));

// --- 1. caption-only fallback for records we could not fetch media for ---
const shape =
  'Answer in strict JSON with fields: is_recipe (true/false), dish (or null), ' +
  'ingredients (list), steps (list), reason (1-2 sentences). No text outside the JSON.';

async function classifyCaption(rec) {
  const prompt =
    'From this Instagram post caption, extract the recipe and ingredients if one is being shared.\n' +
    'A recipe shared silently or without quantities still counts; judge only whether the post is ' +
    'about making a food or drink. It is not a recipe if it is an ad, a product promo, a health tip, ' +
    'a gym/lifestyle post or someone only eating.\n\n' +
    'Caption: ' + (rec.caption_full || 'none') + '\n\n' + shape;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-lite',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
      temperature: 0.1,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 200) return { is_recipe: null, reason: 'API error ' + res.status };
  const text = (data.choices?.[0]?.message?.content || '').trim()
    .replace(/^```json\s*/, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch { return { is_recipe: null, reason: 'parse failed: ' + text.slice(0, 120) }; }
}

for (const row of recheck) {
  if (row.is_recipe !== null) continue;
  const rec = byId.get(row.id);
  console.log(`caption-only fallback for ${row.code} (media 404)`);
  const r = await classifyCaption(rec);
  row.is_recipe = r.is_recipe;
  row.dish = r.dish || '';
  row.ingredients = r.ingredients || [];
  row.steps = r.steps || [];
  row.reason = r.reason || '';
  row.gemini_input = 'caption';
  row.flipped = r.is_recipe === true;
  console.log(`  -> ${r.is_recipe} ${row.dish || row.reason}`);
}
fs.writeFileSync(RECHECK, JSON.stringify(recheck, null, 2));

// --- 2. apply to the final results (backup once) ---
const backup = RESULTS.replace('.json', '.pre_recheck.json');
if (!fs.existsSync(backup)) fs.copyFileSync(RESULTS, backup);

let updated = 0;
for (const row of recheck) {
  const rec = byId.get(row.id);
  if (!rec) { console.log('missing record for', row.id); continue; }
  const nowRecipe = row.is_recipe === true;
  rec.is_recipe = nowRecipe;
  rec.verdict = nowRecipe ? 'RECIPE_GEMINI_RECHECK' : 'NOT_RECIPE_GEMINI';
  rec.source = 'gemini';
  rec.gemini_input = row.gemini_input;
  rec.gemini_reason = row.reason;
  rec.recipe_name = row.dish || '';
  rec.ingredients = row.ingredients || [];
  rec.steps = row.steps || [];
  if (nowRecipe && !rec.caption_has_recipe_ingredients && (row.ingredients || []).length) {
    rec.caption_has_recipe_ingredients = true;
  }
  updated++;
}
fs.writeFileSync(RESULTS, JSON.stringify(all, null, 2));
console.log(`applied ${updated} rechecked verdicts to ${RESULTS}`);

// --- 3a. full recheck view: old vs new verdict with the extracted recipe ---
const esc = (v) => {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('; ') : String(v);
  const t = s.replace(/\s+/g, ' ').trim();
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const COLS = [
  'id', 'code', 'video_url', 'username', 'full_name', 'video_duration_s',
  'like_count', 'taken_at', 'old_verdict', 'new_verdict', 'flipped',
  'dish', 'ingredients', 'steps', 'gemini_input', 'gemini_reason', 'caption_full',
];
const lines = [COLS.join(',')];
for (const row of recheck) {
  const rec = byId.get(row.id) || {};
  const vals = {
    id: row.id,
    code: row.code,
    video_url: row.video_url,
    username: row.username,
    full_name: row.full_name,
    video_duration_s: row.video_duration_s,
    like_count: row.like_count,
    taken_at: row.taken_at,
    old_verdict: 'NOT_RECIPE_GEMINI',
    new_verdict: row.is_recipe === true ? 'RECIPE_GEMINI_RECHECK' : row.is_recipe === false ? 'NOT_RECIPE_GEMINI' : 'ERROR',
    flipped: row.is_recipe === true ? 'yes' : 'no',
    dish: row.dish,
    ingredients: row.ingredients,
    steps: row.steps,
    gemini_input: row.gemini_input,
    gemini_reason: row.reason,
    caption_full: row.caption_full || rec.caption_full || '',
  };
  lines.push(COLS.map((c) => esc(vals[c])).join(','));
}
fs.writeFileSync('exports/recipe_recheck_results.csv', lines.join('\n') + '\n');
console.log(`wrote exports/recipe_recheck_results.csv (${recheck.length} rows)`);

// --- 3b. regenerate the reject list from the updated results ---
const COLS2 = [
  'id', 'code', 'video_url', 'username', 'full_name', 'video_duration_s',
  'like_count', 'comment_count', 'taken_at', 'verdict', 'source',
  'gemini_input', 'gemini_reason', 'caption_full',
];
const stillNot = all.filter((r) => r.is_recipe === false);
const out = [COLS2.join(',')];
for (const r of stillNot) out.push(COLS2.map((c) => esc(r[c])).join(','));
fs.writeFileSync('exports/not_recipe_list.csv', out.join('\n') + '\n');
console.log(`wrote exports/not_recipe_list.csv (${stillNot.length} rows)`);

const total = all.length;
const recipes = all.filter((r) => r.is_recipe === true).length;
console.log(`\nfinal: ${recipes} recipes / ${total - recipes} not / ${total} total`);
