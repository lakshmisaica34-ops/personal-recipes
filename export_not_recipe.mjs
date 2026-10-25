// Export every record finally judged NOT a recipe to a spreadsheet-friendly CSV.
// Run: node export_not_recipe.mjs
import fs from 'node:fs';

const SRC = 'exports/recipe_scrape_results_final.json';
const OUT = 'exports/not_recipe_list.csv';

const rows = JSON.parse(fs.readFileSync(SRC, 'utf8')).filter((r) => r.is_recipe === false);

const COLS = [
  'id',
  'code',
  'video_url',
  'username',
  'full_name',
  'video_duration_s',
  'like_count',
  'comment_count',
  'taken_at',
  'verdict',
  'source',
  'gemini_input',
  'gemini_reason',
  'caption_full',
];

// The first batch was judged from full video before Instagram blocked that
// endpoint, and predates the gemini_input field. Derive it from payload size so
// the column is never blank: frames are well under 1 MB, videos are not.
const inputOf = (r) =>
  r.gemini_input || ((r.video_bytes_orig || 0) > 1_000_000 ? 'video' : 'frame');

const esc = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/\s+/g, ' ').trim();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const lines = [COLS.join(',')];
for (const r of rows) lines.push(COLS.map((c) => esc(c === 'gemini_input' ? inputOf(r) : r[c])).join(','));

fs.writeFileSync(OUT, lines.join('\n') + '\n');

console.log(`wrote ${rows.length} rows to ${OUT}`);
console.log(`reasons captured: ${rows.filter((r) => r.gemini_reason).length}/${rows.length}`);
const counts = {};
for (const r of rows) counts[inputOf(r)] = (counts[inputOf(r)] || 0) + 1;
console.log('judged from:', counts);
