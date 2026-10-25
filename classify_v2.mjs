// Direct classification v2 — per your spec:
//   RECIPE = caption contains "recipe" or "ingredients" (quantity NOT required)
//   NOT    = caption contains neither, OR the only "recipe"/"ingredients" is a
//            teaser/CTA that hides the recipe behind comments/DM/bio
//   COMMENTS = caption explicitly says to get the recipe from comments/DM/bio
//              (then fetch top comments via ScrapeCreators)
//
// Hashtags excluded.

import { readFileSync, writeFileSync } from 'node:fs';

const RAW = readFileSync('index/saved_all.jsonl', 'utf8');
const all = RAW.split('\n').filter((l) => l.trim());

const COOKING_ID = '18194606119249588';
const cooking = all.filter((l) => l.includes(`"${COOKING_ID}"`));

const COMMENT_WORDS = /(comment|dm|message|in my bio|send|ask|message me|whatsapp)/i;
const RECIPE_WORDS = /(recipe|ingredients|what you need|you'?ll need|method|how to|steps?|directions|cook time|servings|yield|ingredients:|cooking)/i;
const TEASER = /(comment (the )?recipe|full recipe in (bio|dm)|link in bio|dm for the recipe|recipe in my bio|comment below the recipe|follow for more recipes|comment (?:below|for) the recipe|question of the day|comment the word)/i;

function classify(caption) {
  const text = caption || '';
  const noHash = text.replace(/[#＃][a-zA-Z0-9_]+/g, '').trim();
  const stripped = noHash.replace(/\s+/g, ' ').trim();

  // Teaser that explicitly routes the recipe to comments/DM/bio
  if (TEASER.test(stripped)) {
    if (COMMENT_WORDS.test(stripped)) return { verdict: 'COMMENTS', reason: 'caption routes recipe to comments/DM/bio — fetch top comments' };
    // teaser WITHOUT comment-DMA words, e.g. "comment RECIPE below" but not "comment X and I'll DM" — still route to comments
    if (/comment/i.test(stripped)) return { verdict: 'COMMENTS', reason: 'caption routes recipe to comments' };
    if (/link in bio|full recipe in (bio|dm)|recipe in my bio/i.test(stripped)) return { verdict: 'NOT', reason: 'recipe only in bio/DM, no comment wording' };
  }

  // Product/shop CTA (no recipe intent)
  if (/buy|shop|order now|visit (my|the) shop|shopping|order (now|today)|for sale|product|order now|buy our/i.test(stripped)) {
    if (!RECIPE_WORDS.test(stripped)) return { verdict: 'NOT', reason: 'product/shop content, no recipe/ingredients' };
  }

  const hasRecipeWord = RECIPE_WORDS.test(stripped);
  const hasIngredientWord = /ingredients/i.test(stripped);

  if (hasRecipeWord && hasIngredientWord) return { verdict: 'REAL', reason: 'caption contains recipe + ingredients' };
  if (hasRecipeWord) return { verdict: 'REAL', reason: 'caption contains recipe signals' };
  if (hasIngredientWord) return { verdict: 'REAL', reason: 'caption contains ingredients' };
  return { verdict: 'NOT', reason: 'no recipe or ingredients in caption' };
}

const rows = cooking.map((line, i) => {
  const item = JSON.parse(line);
  const res = classify(item.caption);
  return { idx: i + 1, id: item.id, url: item.url, verdict: res.verdict, reason: res.reason };
});

const real = rows.filter((r) => r.verdict === 'REAL').length;
const not = rows.filter((r) => r.verdict === 'NOT').length;
const comments = rows.filter((r) => r.verdict === 'COMMENTS').length;

const out = [];
out.push(`# Cooking collection classification v2 — recipe/ingredients, no quantities required, hashtags excluded\n`);
out.push(`Total: ${rows.length} | REAL: ${real} | NOT: ${not} | COMMENTS: ${comments}\n`);
out.push('| # | Verdict | Reason | Notes |\n');
out.push('|---|---|---|---|\n');
rows.slice(0, 10).forEach((r) => {
  out.push(`| ${r.idx} | ${r.verdict} | ${r.reason} |`);
  const item = JSON.parse(all.find((l) => l.includes(`"id":"${r.id}"`)));
  const cap = item.caption || '';
  const clean = cap.replace(/[#＃][^\s]+/g, '').trim().slice(0, 120);
  out.push(clean || '—');
  out.push(' |\n');
});

writeFileSync('exports/cooking_classified_v2.md', out.join('\n'));
console.log(`Done: ${rows.length} | REAL ${real} | NOT ${not} | COMMENTS ${comments}`);
console.log('written to exports/cooking_classified_v2.md');
