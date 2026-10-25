// Direct classification: read each post's FULL caption text, no hashtag scoring.
// RECIPE   = explicit recipe/food structure with quantities in the full caption
// NOT      = no such structure, or pure teaser/ad/product content
// Borderline = straight call, no weighted score.

import { readFileSync, writeFileSync } from 'node:fs';

const RAW = readFileSync('index/saved_all.jsonl', 'utf8');
const all = RAW.split('\n').filter((l) => l.trim());

const COOKING_ID = '18194606119249588';
const cooking = all.filter((l) => l.includes(`"${COOKING_ID}"`));

// Regex: amount + unit + ingredient (with or without * bullets)
const QTY = /(?:\d+(?:\.\d+)?|[\d/]+)\s*(?:tbsp|tsp|gm|gram|g|kg|ml|l|cup|cups|pinch|dash|oz|ounce|piece|pieces|clove|cloves|handful|slice|slices)\b/gi;
// Explicit recipe/food markers in full text
const MARKERS = /(ingredients|recipe|what you need|you'?ll need|method|how to|steps?|directions|dish|prep|cook time|servings|yield|ingredients:|cooking)/i;
// Teasers / CTA
const TEASER = /(comment (the )?recipe|full recipe in (bio|dm)|link in bio|dm for the recipe|recipe in my bio|save this recipe and follow|comment (?:below|for) the recipe|follow for more recipes)/i;

const REAL_RE = /ingredients[s]?\s*(:|-|…)/i; // has Ingredients: header
const LIST_RE = /^[\s-*•]\s*\w[\s\S]{0,120}(?=\d+\s*(?:tbsp|tsp|gm|gram|g|ml|l|cups?))/im;

function classify(caption) {
  const text = caption || '';
  const noHash = text.replace(/[#＃][a-zA-Z0-9_]+/g, '').trim();
  const stripped = noHash.replace(/\s+/g, ' ').trim();

  // Not a recipe: teaser that offers recipe only via DM/comment/bio, or product ad
  if (TEASER.test(stripped)) {
    // but still okay if it ALSO contains real ingredient quantities in the body
    if (!QTY.test(stripped)) return { verdict: 'NOT', reason: 'teaser only — recipe only via DM/comment/bio, no quantities' };
  }
  if (/buy|shop|order now|visit (my|the) shop|shopping|order (now|today)|product|for sale|link in bio/i.test(stripped)) {
    if (!QTY.test(stripped)) return { verdict: 'NOT', reason: 'product/shop CTA, no quantities' };
  }

  const hasQty = QTY.test(stripped);
  const hasExplicit = MARKERS.test(stripped);
  const hasList = LIST_RE.test(stripped);
  // Fallback: ingredient word present in any line that is followed by quantity lines
  const hasQtyAnywhere = QTY.test(text);
  const hasIngredientWord = /(ingredients|recipe|what you need|you'?ll need|method|how to|steps?|directions|cook time|servings|yield)/i.test(text);
  const hasListAnywhere = /^[ \s-*•]\s*\w[\s\S]{0,120}(?=\d+\s*(?:tbsp|tsp|gm|gram|g|ml|l|cups?))/im.test(text);

  const structure = (hasQty || hasExplicit || hasList || hasQtyAnywhere || hasIngredientWord || hasListAnywhere);

  if (structure && hasQty) return { verdict: 'REAL', reason: 'full caption has ingredient structure with quantities' };
  if (structure && !hasQty) return { verdict: 'BORDERLINE', reason: 'recipe structure present but no measured quantities' };
  return { verdict: 'NOT', reason: 'no recipe structure or ingredient quantities in caption' };
}

const rows = cooking.map((line, i) => {
  const item = JSON.parse(line);
  const res = classify(item.caption);
  return { idx: i + 1, id: item.id, url: item.url, verdict: res.verdict, reason: res.reason };
});

const real = rows.filter((r) => r.verdict === 'REAL').length;
const borderline = rows.filter((r) => r.verdict === 'BORDERLINE').length;
const not = rows.filter((r) => r.verdict === 'NOT').length;

const out = [];
out.push(`# Cooking collection classification — direct, caption-only, hashtags excluded\n`);
out.push(`Total: ${rows.length} | REAL: ${real} | BORDERLINE: ${borderline} | NOT: ${not}\n`);
out.push('| # | Verdict | Reason | Notes |\n');
out.push('|---|---|---|---|\n');
rows.forEach((r) => {
  out.push(`| ${r.idx} | ${r.verdict} | ${r.reason} |`);

  // find matching saved_all line for caption preview
  const item = JSON.parse(all.find((l) => l.includes(`"id":"${r.id}"`)));
  const cap = item.caption || '';
  const clean = cap.replace(/[#＃][^\s]+/g, '').trim().slice(0, 120);
  out.push(clean || '—');
  out.push(' |\n');
});

writeFileSync('exports/cooking_classified_full.md', out.join('\n'));
console.log(`Done: ${rows.length} | REAL ${real} | BORDERLINE ${borderline} | NOT ${not}`);
console.log('written to exports/cooking_classified_full.md');
