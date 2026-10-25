// run_gemini_recipe_scrape.mjs
//
// Per-video recipe extraction pipeline — CAPTION AUTHORITY ONLY.
//
// Flow:
//   1. Load the cooking collection (index/saved_all.jsonl), filter to
//      collection 18194606119249588 (the "cooking" saved feed).
//   2. For each video post, take the FULL caption text (no hashtag stripping).
//   3. Caption-authority verdict:
//        - caption empty        -> verdict: "EMPTY"  (nothing to classify)
//        - caption has ingredients / recipe / method / steps / directions
//          or anything that reads as a recipe + ingredients list -> verdict: "REAL"
//          and all fields populated (recipe name, ingredients, steps) straight
//          from the caption.  Gemini and comments are NOT invoked.
//        - otherwise           -> verdict: "NOT" (no recipe / ingredients in caption)
//   4. Write one output record per post with: video link URL, thumbnail URL,
//      creator name, recipe name, video duration, ingredients, steps,
//      is_recipe, verdict, input_used (caption|empty), time_s, cost_usd.
//
// Notes:
//   - No OpenRouter calls, no comment scraping.
//   - Video URL and thumbnail URL come from the feed record where present.
//   - This is the corrected pipeline after the ghee misunderstanding: the
//     caption is the authority, not the video content.

import fs from 'node:fs';
import path from 'node:path';

const COOKING_COLLECTION_ID = '18194606119249588';
const INPUT_FILE = path.join(process.cwd(), 'index', 'saved_all.jsonl');
const OUTPUT_FILE = path.join(process.cwd(), 'exports', 'gemini_recipe_scrape_results.json');
const COST_FILE = path.join(process.cwd(), 'exports', 'gemini_recipe_scrape_cost.json');

const RECIPE_KEYWORDS = [
  'ingredients',
  'recipe',
  'what you need',
  'method',
  'how to',
  'steps',
  'directions',
  'cook time',
  'servings',
  'yield',
  'recipe name',
  'prep',
  'cook',
];

// A recipe normally also lists what goes into it.
const INGREDIENT_HINTS = [
  'ingredients',
  'what you need',
  'ingredients list',
  'ingredient list',
  'to make',
  'to cook',
  'for',
  'and',
  'with',
];

function cleanCaption(raw) {
  if (!raw) return '';
  // Strip hashtags and collapse whitespace for classification,
  // but keep the FULL caption stored for display.
  return raw
    .replace(/[#＃][a-zA-Z0-9_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRecipeCaption(cap) {
  const c = cleanCaption(cap);
  if (!c) return { verdict: 'EMPTY', found: false };
  if (RECIPE_KEYWORDS.some((k) => c.toLowerCase().includes(k.toLowerCase()))) {
    return { verdict: 'REAL', found: true };
  }
  return { verdict: 'NOT', found: false };
}

function extractRecipeName(cap) {
  const c = cleanCaption(cap);
  if (!c) return '';
  // Common recipe-name patterns: "Title - subtitle", "Title -", "Title ·",
  // "Title (tagline)", "Title - Ingredients", "Title: recipe".
  const m = c.match(/^([A-Z][A-Za-z0-9 &'.\-–—]+?(?:recipe|recipe!|recipe \||recipe–|recipe—|recipe:)?)/);
  if (m) return m[1].trim();
  // Try "Name - description" / "Name – description" / "Name · description"
  const m2 = c.match(/^(.+?)\s+[-–—·•]\s/);
  if (m2) return m2[1].trim();
  return c.split(/[.#\n]/)[0].trim().slice(0, 90);
}

function extractIngredientsAndSteps(cap) {
  const c = cleanCaption(cap);
  if (!c) return { ingredients: [], steps: [] };
  const ingredients = [];
  const steps = [];
  // Lines that look like a list item with a colon (e.g. "1. Rinse quinoa ...")
  const numbered = c.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of numbered) {
    if (/^\d+[.)]\s*/.test(line)) {
      const text = line.replace(/^\d+[.)]\s*/, '');
      if (/[,.]/.test(text) || text.length > 40) {
        steps.push(text);
      }
    } else if (/[,;:]/.test(line) && line.length < 120) {
      steps.push(line);
    }
  }
  // Fallback: split on a colon that introduces a list.
  if (steps.length < 2) {
    const parts = c.split(/:|\n/).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      const header = parts[0].toLowerCase();
      steps.push(...parts.slice(1));
    }
  }
  // Any remaining lines that clearly describe adding/processing food go to ingredients.
  for (const line of numbered) {
    const t = line.replace(/^\d+[.)]\s*/, '');
    if (!t) continue;
    if (/^\d+[.)]\s*/.test(line)) continue;
    if (/^\d+\s*$/.test(t)) continue;
    if (/ingredients|what you need|method|steps|directions|cook time|servings|yield/.test(t.toLowerCase())) continue;
    if (t.length > 10 && (t.includes(',') || t.length > 25)) {
      ingredients.push(t);
    }
  }
  // Deduplicate while preserving order.
  const uniq = (arr) => Array.from(new Set(arr));
  return { ingredients: uniq(ingredients), steps: uniq(steps) };
}

function buildThumbnailUrl(url, code) {
  // Instagram media thumbnail: https://instagram.com/p/{code}/media/?size=l
  // where {code} is the shortcode. We do not fetch the image; we return the URL.
  const m = url ? url.match(/instagram\.com\/p\/([a-zA-Z0-9_\-]+)/) : null;
  if (m) {
    return `https://instagram.com/p/${m[1]}/media/?size=l`;
  }
  return null;
}

function buildOutputRecord(rec, cap, verdictInfo) {
  const isReal = verdictInfo.verdict === 'REAL';
  let recipeName = '';
  let ingredients = [];
  let steps = [];
  let timeS = 0;
  let costUsd = 0;

  if (isReal) {
    recipeName = extractRecipeName(cap);
    const extracted = extractIngredientsAndSteps(cap);
    ingredients = extracted.ingredients;
    steps = extracted.steps;
  }

  return {
    id: rec.id,
    username: rec.username,
    full_name: rec.full_name || null,
    code: rec.code,
    video_url: rec.url,
    thumbnail_url: buildThumbnailUrl(rec.url, rec.code),
    video_duration_s: rec.video_duration ?? null,
    caption: cap,
    caption_verdict: verdictInfo.verdict,
    caption_has_recipe_ingredients: verdictInfo.found,
    recipe_name: recipeName,
    ingredients,
    steps,
    is_recipe: isReal,
    verdict: verdictInfo.verdict,
    input_used: verdictInfo.verdict === 'EMPTY' ? 'empty caption' : 'caption only',
    time_s: timeS,
    cost_usd: costUsd,
    like_count: rec.like_count ?? null,
    comment_count: rec.comment_count ?? null,
    has_audio: rec.has_audio ?? null,
    taken_at: rec.taken_at ?? null,
  };
}

function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Missing input file: ${INPUT_FILE}`);
  }

  const raw = fs.readFileSync(INPUT_FILE, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim());
  const cooking = lines.filter((l) => l.includes(COOKING_COLLECTION_ID));

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < cooking.length; i++) {
    const line = cooking[i];
    const rec = JSON.parse(line);
    const caption = rec.caption || '';
    const isVideo = rec.media_type === 2;

    if (!isVideo) continue;

    const verdictInfo = isRecipeCaption(caption);
    const record = buildOutputRecord(rec, caption, verdictInfo);

    // Cost / wall clock: this path makes zero LLM calls. Only the
    // caption-authority classification runs here, which is O(caption size).
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(3);
    record.cost_usd = 0;       // no API calls -> zero per-video API cost
    record.time_s = parseFloat(elapsed);

    results.push(record);

    if ((i + 1) % 200 === 0) {
      console.log(`[${i + 1}/${cooking.length}] processed ${record.username} ${record.code} -> ${record.verdict}`);
    }
  }

  const real = results.filter((r) => r.is_recipe).length;
  const not = results.filter((r) => r.verdict === 'NOT').length;
  const empty = results.filter((r) => r.verdict === 'EMPTY').length;
  const elapsedTotal = ((Date.now() - startTime) / 1000).toFixed(3);

  // Cost summary: every record cost 0 because there were no LLM calls.
  const costSummary = {
    model: 'N/A (no API calls)',
    model_used: null,
    rate_input_per_m: null,
    rate_output_per_m: null,
    per_video_cost_usd: 0,
    input_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    videos_processed: results.length,
    real: real,
    not: not,
    empty: empty,
    total_time_s: parseFloat(elapsedTotal),
    avg_time_s_per_video: results.length ? parseFloat((elapsedTotal / results.length).toFixed(3)) : 0,
    total_cost_usd: 0,
    notes:
      'Caption-authority only. No LLM/API calls, so per-video API cost is 0.',
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  fs.writeFileSync(COST_FILE, JSON.stringify(costSummary, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(`Videos processed: ${results.length}`);
  console.log(`REAL (caption-authority): ${real}`);
  console.log(`NOT (no recipe in caption): ${not}`);
  console.log(`EMPTY (no caption): ${empty}`);
  console.log(`Total wall time: ${elapsedTotal}s`);
  console.log(`Average: ${(elapsedTotal / results.length).toFixed(3)}s per video`);
  console.log(`Per-video API cost: $0 (caption-authority only, no API calls)`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log(`Cost:   ${COST_FILE}`);
}

main();
