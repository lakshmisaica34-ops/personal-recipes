// Demo: classify the FIRST 10 posts of the cooking collection
// with the three-check rule. Writes exports/cooking_demo_classified.md.
import fs from 'node:fs';

const COOKING_ID = '18194606119249588';
const lines = fs.readFileSync('index/saved_all.jsonl', 'utf8').trim().split('\n');
const items = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// 1. get the cooking collection
const cooking = items.filter(r => (r.saved_collection_ids || []).includes(COOKING_ID));
console.log('cooking collection size:', cooking.length);

// 2. take first 10
const demo = cooking.slice(0, 10);

// 3. three-check rule
function classify(r) {
  const cap = (r.caption || '').toLowerCase();
  const hasHeader = /(ingredients\b|recipe|what you need|you'll need|method|how to|step)/.test(cap);
  const hasAmount = /(tbsp|tablespoon|tsp|teaspoon|g|gram|kg|ml|cup|cups|oz|ounce|pinch|dash|clove|can|packet|handful|to taste|½|¼|¾|1\/2|1\/4|3\/4|1\/3|2\/3)/.test(cap);
  const hasList = /^\s*[-*•]\s/.test(cap) || /^\s*\d+[-.)]\s/.test(cap);
  const isTeaser = /comment\s+(recipe|recipe below|recipe below|get the recipe|recipe pdf|recipe pdf|full recipe|my recipe|the recipe)/i.test(cap);
  const isAd = /\b(travel cooker|travel essential|product|shop|order|buy|website|link in bio|dm|whatsapp|price|order details|buy now)/.test(cap) && !hasHeader;
  if (!hasHeader && !hasAmount) return { verdict: 'NOT', reason: 'no recipe signals or quantity patterns' };
  if (isTeaser && !hasAmount) return { verdict: 'NOT', reason: 'recipe teaser (comment/DM/bio), no ingredients in post' };
  if (isAd) return { verdict: 'NOT', reason: 'product advert with no recipe content' };
  return { verdict: 'REAL', reason: 'recipe signals + quantity-pattern present' };
}

const out = [];
out.push(`# Cooking collection — demo classification (first 10 of ${cooking.length})`);
out.push('');
out.push('| # | verdict | deciding lines |');
out.push('|---|---|---|');
for (let i = 0; i < demo.length; i++) {
  const r = demo[i];
  const cap = (r.caption || '').replace(/\n+/g, ' | ').slice(0, 160);
  const verdict = classify(r);
  out.push(`| ${i + 1} | **${verdict.verdict}** | ${verdict.reason} — ${cap} |`);
}
out.push('');
fs.writeFileSync('exports/cooking_demo_classified.md', out.join('\n'));
console.log(out.join('\n'));
console.log('wrote exports/cooking_demo_classified.md');
