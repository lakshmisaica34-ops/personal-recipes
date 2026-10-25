// Re-run the posts previously judged NOT a recipe with the extraction prompt.
//
// The old prompt asked "is this a recipe?" against a rubric that demanded
// written/spoken ingredients, so silent cook-throughs got rejected. The new
// prompt just asks for the recipe and ingredients; is_recipe falls out of
// whether Gemini can actually see food being made.
//
// Video endpoint is probed once at startup; if Instagram still redirects it,
// every record goes through the poster-frame path instead.
//
// Run: node recheck_not_recipe.mjs
import fs from 'node:fs';
import { fetchVideo, classifyVideo, fetchFrame, classifyFrame } from './gemini_classifier.mjs';
import { shrinkVideo } from './video_shrink.mjs';

const SRC = 'exports/recipe_scrape_results_final.json';
const OUT = 'exports/gemini_recheck_results.json';

const all = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const targets = all.filter((r) => r.is_recipe === false);
console.log(`${targets.length} posts to recheck`);

// Already-done records let the run resume after an interruption.
const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
const doneIds = new Set(done.map((r) => r.id));
console.log(`${done.length} already done`);

async function videoApiWorks() {
  try {
    await fetchVideo(targets[0].id);
    return true;
  } catch {
    return false;
  }
}

const useVideo = await videoApiWorks();
console.log(useVideo
  ? 'video endpoint available - classifying from full video'
  : 'video endpoint blocked - falling back to poster frames');

let flipped = 0, confirmedNot = 0, errors = 0;

for (const rec of targets) {
  if (doneIds.has(rec.id)) continue;
  const started = Date.now();
  let result = null;
  let input = null;

  // Video first when the endpoint is healthy; shrink anything over ~5 MB so we
  // stay under OpenRouter's 8 MB base64-inflated cap.
  if (useVideo) {
    try {
      const { buf } = await fetchVideo(rec.id);
      const small = buf.length > 4_500_000 ? await shrinkVideo(buf) : buf;
      result = await classifyVideo(small, rec.id, rec.caption_full);
      input = 'video';
    } catch (e) {
      console.log(`  video path failed (${e.message.slice(0, 80)}), using frame`);
    }
  }

  if (!result || result.is_recipe === undefined || result.is_recipe === null) {
    try {
      const buf = await fetchFrame(rec.code);
      result = await classifyFrame(buf, rec.id, rec.caption_full);
      input = 'frame';
    } catch (e) {
      result = { is_recipe: null, reason: 'ERROR: ' + e.message };
      input = 'none';
    }
  }

  const row = {
    id: rec.id,
    code: rec.code,
    video_url: rec.video_url,
    username: rec.username,
    full_name: rec.full_name,
    video_duration_s: rec.video_duration_s,
    like_count: rec.like_count,
    taken_at: rec.taken_at,
    was_recipe: false,
    is_recipe: result.is_recipe,
    flipped: result.is_recipe === true,
    dish: result.dish || '',
    ingredients: result.ingredients || [],
    steps: result.steps || [],
    reason: result.reason || '',
    gemini_input: input,
    caption_full: rec.caption_full || '',
    elapsed_s: Math.round((Date.now() - started) / 100) / 10,
  };

  if (result.is_recipe === true) flipped++;
  else if (result.is_recipe === false) confirmedNot++;
  else errors++;

  done.push(row);
  doneIds.add(rec.id);
  fs.writeFileSync(OUT, JSON.stringify(done, null, 2));

  console.log(
    `${done.length}/${targets.length} ${rec.id} -> ${result.is_recipe === true ? 'RECIPE' : result.is_recipe === false ? 'not' : 'ERR'} ` +
    `[${input}] ${row.dish || (result.reason || '').slice(0, 70)}`
  );
  await new Promise((r) => setTimeout(r, 600));
}

console.log(`\nrecheck done: ${flipped} now recipes, ${confirmedNot} still not, ${errors} errors`);
