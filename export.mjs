// Export the cooking-candidate collection (and a collections overview) as readable files.
import fs from 'node:fs';

const COOKING_ID = '18194606119249588';
const items = fs.readFileSync('index/saved_all.jsonl', 'utf8').trim().split('\n')
  .map(l => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);
const overview = JSON.parse(fs.readFileSync('index/collections_summary.json', 'utf8'));

const TYPE = { 1: 'image', 2: 'video', 8: 'carousel' };
fs.mkdirSync('exports', { recursive: true });

// --- cooking collection export ---
const cooking = items.filter(r => (r.saved_collection_ids || []).includes(COOKING_ID))
  .sort((a, b) => (b.taken_at || 0) - (a.taken_at || 0));
console.log('cooking items:', cooking.length);

const fmtDate = t => t ? new Date(t * 1000).toISOString().slice(0, 10) : '';

// Markdown
let md = `# Instagram Saved — Cooking Collection\n\n`;
md += `- **Collection id:** ${COOKING_ID} (pending your name confirmation)\n`;
md += `- **Recipes:** ${cooking.length}\n`;
md += `- **Post dates:** ${fmtDate(Math.min(...cooking.map(r => r.taken_at || 1e12)))} .. ${fmtDate(Math.max(...cooking.map(r => r.taken_at || 0)))}\n`;
md += `- **With caption text:** ${cooking.filter(r => r.caption).length} / ${cooking.length}\n`;
md += `- **Media:** ${cooking.filter(r => r.media_type === 2).length} videos (reels), ${cooking.filter(r => r.media_type === 1).length} images, ${cooking.filter(r => r.media_type === 8).length} carousels\n`;
md += `- Generated from your Saved feed — link + caption only, no media downloaded.\n\n---\n\n`;
for (const [i, r] of cooking.entries()) {
  md += `## ${i + 1}. ${r.caption ? r.caption.split('\n')[0].slice(0, 120) : '(no caption)'}\n`;
  md += `**@${r.username || '?'}** · ${fmtDate(r.taken_at)} · ${TYPE[r.media_type] || r.media_type}`;
  if (r.like_count != null) md += ` · ❤ ${r.like_count}`;
  md += ` · ${r.url}\n\n`;
  if (r.caption) {
    const cap = r.caption.length > 1400 ? r.caption.slice(0, 1400) + ' …' : r.caption;
    md += cap.replace(/\n{3,}/g, '\n\n') + '\n\n';
  }
  md += `---\n\n`;
}
fs.writeFileSync('exports/cooking_recipes.md', md);

// CSV (full captions)
const esc = v => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const rows = [['n', 'date', 'username', 'type', 'likes', 'comments', 'link', 'caption']];
for (const [i, r] of cooking.entries()) {
  rows.push([i + 1, fmtDate(r.taken_at), r.username || '', TYPE[r.media_type] || '', r.like_count ?? '', r.comment_count ?? '', r.url || '', r.caption || '']);
}
fs.writeFileSync('exports/cooking_recipes.csv', rows.map(r => r.map(esc).join(',')).join('\n') + '\n');

// JSON (compact, for later one-by-one lookups)
fs.writeFileSync('exports/cooking_recipes.json', JSON.stringify(cooking, null, 1));

// --- collections overview ---
let ov = `# Your Saved Collections — Overview\n\nAll ${overview.length} collections from your Saved feed (by size). Cooking candidate: **${COOKING_ID}**.\n\n`;
ov += `| # | collection id | items | food-score | date span | sample posts |\n|---|---|---|---|---|---|\n`;
for (const [i, s] of overview.entries()) {
  const samp = s.sample.map(x => '@' + x.user).join(', ');
  ov += `| ${i + 1} | \`${s.id}\` | ${s.count} | ${Math.round(s.food_ratio * 100)}% | ${s.first_taken || '?'} → ${s.last_taken || '?'} | ${samp} |\n`;
}
fs.writeFileSync('exports/collections_overview.md', ov);

console.log('wrote exports/cooking_recipes.{md,csv,json} and exports/collections_overview.md');
console.log('md size:', fs.statSync('exports/cooking_recipes.md').size, 'bytes');
