// Analyze the saved index: group by collection, score food relevance, summarize.
import fs from 'node:fs';

const lines = fs.readFileSync('index/saved_all.jsonl', 'utf8').trim().split('\n');
const items = [];
for (const l of lines) { try { items.push(JSON.parse(l)); } catch {} }
console.log('total items:', items.length);

const FOOD = /(recipe|recipes|cooking|cook |kitchen|food|dinner|lunch|breakfast|brunch|snack|dessert|bake|baking|cake|bread|pizza|pasta|noodle|curry|rice|biryani|paneer|chicken|meat|fish|prawn|mutton|egg|salad|soup|sauce|chutney|masala|spice|ingredient|marinat|air.?fry|oven|stove|simmer|saut|whisk|simmer|tbsp|tsp|cup[s]? of|minutes|calories|protein|vegan|vegetarian|eat|drink|smoothie|coffee|chai|tea|latte|ice.?cream|chocolate|sweet|spicy|yummy|delicious|tasty|hungry|eatwell|homemade|meal|prep|dough|yeast|frosting|cookie|brownie|muffin|cupcake|pancake|waffle|dosa|idli|sambar|roti|naan|paratha|pav|vada|chaat|halwa|kheer|pudding|jam|butter|cheese|yogurt|curd|ghee|oil|garlic|onion|tomato|potato|vegetable|fruit|banana|apple|mango)/i;
const FOOD_USER = /(cook|kitchen|recipe|food|chef|bake|eat|dine|dish|meal|cafe|restaurant|spice|tasty|hungry|flavor|flavour|nutrition|diet)/i;

function foodScore(r) {
  const hay = ((r.caption || '') + ' @' + (r.username || '') + ' ' + (r.accessibility_caption || ''));
  return FOOD.test(hay) || FOOD_USER.test(r.username || '');
}

// media type breakdown
const types = { 1: 'image', 2: 'video', 8: 'carousel' };
const typeCount = {};
const authors = new Set();
let noCaption = 0;
const ts = [];
for (const r of items) {
  typeCount[types[r.media_type] || r.media_type] = (typeCount[types[r.media_type] || r.media_type] || 0) + 1;
  if (r.username) authors.add(r.username);
  if (!r.caption) noCaption++;
  if (r.taken_at) ts.push(r.taken_at);
}
ts.sort((a, b) => a - b);
console.log('types:', JSON.stringify(typeCount));
console.log('distinct authors:', authors.size, '| no caption:', noCaption);
console.log('post dates:', ts.length ? new Date(ts[0] * 1000).toISOString().slice(0, 10) + ' .. ' + new Date(ts[ts.length - 1] * 1000).toISOString().slice(0, 10) : 'n/a');

// group by collection
const byCol = new Map();
let uncollectionsaved = 0;
for (const r of items) {
  const ids = r.saved_collection_ids || [];
  if (!ids.length) { uncollectionsaved++; continue; }
  for (const id of ids) {
    if (!byCol.has(id)) byCol.set(id, []);
    byCol.get(id).push(r);
  }
}
console.log('saved without any collection:', uncollectionsaved);

const summary = [];
for (const [id, arr] of byCol) {
  const food = arr.filter(foodScore).length;
  const withCap = arr.filter(r => r.caption).length;
  // caption dates
  const t = arr.map(r => r.taken_at).filter(Boolean).sort((a, b) => a - b);
  summary.push({
    id,
    count: arr.length,
    food_ratio: +(food / arr.length).toFixed(2),
    captioned: withCap,
    sample: arr.slice(0, 3).map(r => ({ user: r.username, cap: (r.caption || '').replace(/\s+/g, ' ').slice(0, 90), url: r.url })),
    first_taken: t.length ? new Date(t[0] * 1000).toISOString().slice(0, 10) : null,
    last_taken: t.length ? new Date(t[t.length - 1] * 1000).toISOString().slice(0, 10) : null,
  });
}
summary.sort((a, b) => b.count - a.count);
fs.writeFileSync('index/collections_summary.json', JSON.stringify(summary, null, 2));

console.log('\ncollections (sorted by size), top 16:');
console.log('id                 count  food%  captioned  span');
for (const s of summary.slice(0, 16)) {
  console.log(`${s.id.padEnd(18)} ${String(s.count).padStart(5)}  ${String(Math.round(s.food_ratio * 100)).padStart(4)}%  ${String(s.captioned).padStart(6)}   ${s.first_taken}..${s.last_taken}`);
}
// best cooking candidates: size >= 300, highest food ratio
const cands = summary.filter(s => s.count >= 300).sort((a, b) => (b.food_ratio - a.food_ratio) || (b.count - a.count)).slice(0, 5);
console.log('\ncooking candidates (size>=300, ranked by food ratio):');
for (const c of cands) {
  console.log(`\n* ${c.id}  (${c.count} items, ${Math.round(c.food_ratio * 100)}% food-scored)`);
  for (const s of c.sample) console.log(`   @${s.user}: ${s.cap || '(no caption)'}`);
}
