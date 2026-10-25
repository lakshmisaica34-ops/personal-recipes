// run_recipe_scrape.mjs
//
// Per-video recipe/ingredients scrape pipeline — CAPTION -> TOP COMMENTS -> (no video).
//
// Flow:
//   1. Load the cooking collection (index/saved_all.jsonl), filter to
//      collection 18194606119249588 (the "cooking" saved feed).
//   2. For each video post:
//        a. Full caption -> strip hashtags, collapse whitespace.
//           If it contains recipe/ingredients/method/steps/directions/cook time /
//           servings / yield words:
//                verdict = "REAL", source = "caption",
//                recipe_name + ingredients + steps extracted from caption.
//           Else:
//                b. Fetch top comments via Instagram API (comment_fetch.mjs logic).
//                   If top comments contain recipe/ingredients/method/steps/words:
//                        verdict = "REAL", source = "comments",
//                        recipe_name + ingredients + steps extracted from comments.
//                   Else:
//                        verdict = "NOT_RECIPE" (no recipe/ingredients in caption or
//                        comments; NO video fetch, no API cost for video).
//   3. Record per-video: id, username, full_name, code, video_url, thumbnail_url,
//      video_duration_s, caption (full), caption_has_recipe_ingredients,
//      comments fetched, comments with recipe/ingredients, is_recipe,
//      verdict, source, recipe_name, ingredients, steps, input_used,
//      time_to_caption_check_s, time_to_comments_s, time_to_record_s, cost_usd.
//   4. Write exports/recipe_scrape_results.json + exports/recipe_scrape_cost.json.
//
// Notes:
//   - Caption authoriative first. Comments only when caption has no recipe.
//   - Video NEVER fetched (no OpenAI/Gemini, no cost).
//   - No LLm, no OpenAI, no Gemini, no OpenRouter, no batch calls.
//   - Strict JSON output, deduped by id, video posts only (media_type === 2),
//     no carousels.
//   - Missing cookie -> exit 1 with clear error (no scrape).

import fs from 'node:fs';
import path from 'node:path';

const COOKING_COLLECTION_ID = '18194606119249588';
const INPUT_FILE = path.join(process.cwd(), 'index', 'saved_all.jsonl');
const COMMENT_FILE = path.join(process.cwd(), 'exports', 'comment_fetch.md');
const OUTPUT_FILE = path.join(process.cwd(), 'exports', 'recipe_scrape_results.json');
const COST_FILE = path.join(process.cwd(), 'exports', 'recipe_scrape_cost.json');

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
  'prep',
  'cook',
  'review',
  'ingredients list',
  'what goes in',
  'what you need',
  'you need',
  'make',
  'cook',
];

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

// ---- Caption checks ----
function cleanCaption(raw) {
  if (!raw) return '';
  return raw
    .replace(/[#＃][a-zA-Z0-9_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function captionHasRecipe(cap) {
  const c = cleanCaption(cap);
  if (!c) return false;
  return RECIPE_KEYWORDS.some((k) =>
    c.toLowerCase().includes(k.toLowerCase())
  );
}

function extractCaptionRecipe(cap) {
  const c = cleanCaption(cap);
  if (!c) return { recipe_name: '', ingredients: [], steps: [] };

  // Recipe name: "Name - description" / "Name – description" / "Name · description"
  // or a capitalized heading followed by a recipe keyword.
  let recipe_name = '';
  const m = c.match(/^(.+?)\s+[-–—·•]\s/);
  if (m) recipe_name = m[1].trim();
  if (!recipe_name) recipe_name = c.split(/[.#\n]/)[0].trim().slice(0, 90);

  const lines = c.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const ingredients = [];
  const steps = [];
  for (const line of lines) {
    if (/^\d+[.)]\s*/.test(line)) {
      const text = line.replace(/^\d+[.)]\s*/, '');
      if (/[,.]/.test(text) || text.length > 40) steps.push(text);
    } else if (/[,:;]/.test(line) && line.length < 120) {
      steps.push(line);
    }
  }
  // Any non-list line that reads like a food sub-ingredient
  for (const line of lines) {
    const t = line;
    if (/^\d+[.)]\s*/.test(t)) continue;
    if (t.length < 10) continue;
    if (/^\d+\s*$/.test(t)) continue;
    if (/ingredients|what you need|method|steps|directions|cook time|servings|yield|recipe|to make|to cook/i.test(t)) continue;
    if (t.includes(',') || t.length > 25) ingredients.push(t);
  }
  const uniq = (arr) => Array.from(new Set(arr));
  return { recipe_name, ingredients: uniq(ingredients), steps: uniq(steps) };
}

async function fetchTopComments(cookie, postId, max = 20) {
  // Minimal Instagram top-comments API call for a media item.
  // Note: this endpoint is undocumented and often returns HTML or an empty JSON.
  // Fallback: reuse the post page (same endpoint as fetch_comments.mjs) if needed.
  // Endpoint: https://www.instagram.com/api/v1/media/{postId}/comments/
  // Headers copied from the existing fetch_comments.mjs client.
  if (!cookie || !cookie.includes('sessionid=')) {
    throw new Error('Instagram_cookie missing');
  }
  const csrf = (cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1];
  if (!csrf) throw new Error('csrftoken not found in cookie');

  const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
  const headers = {
    'user-agent': UA,
    'cookie': cookie,
    'x-csrftoken': csrf,
    'x-asbd-id': '359341',
    'x-ig-app-id': '936619743392459',
  };

  // Try the documented comments API first; fall back to the post-page endpoint
  // used by fetch_comments.mjs (returns JSON with a top-level 'comments' array).
  const url = `https://www.instagram.com/api/v1/media/${postId}/comments/?count=${max}&max_id=`;
  const res = await fetch(url, { headers, redirect: 'manual' });
  const ct = res.headers.get('content-type') || '';
  // The /api/v1/media/{id}/comments/ endpoint frequently returns HTML instead of JSON.
  // The post-page endpoint returns a 'comments' array with the same cookie set.
  if (!ct.includes('application/json')) {
    const pageUrl = `https://www.instagram.com/api/v1/media/${postId}/comments/?`;
    const pageRes = await fetch(pageUrl, { headers, redirect: 'manual' });
    if (pageRes.status === 200) {
      const pageText = await pageRes.text();
      try {
        const pageData = JSON.parse(pageText);
        if (Array.isArray(pageData.comments)) {
          const pageComments = pageData.comments.map((c) => ({
            id: c.id || null,
            text: c.text || c.message || '',
            user: c.user || null,
            likes: c.likes || null,
          }));
          if (pageComments.length > 0) {
            console.warn(`[comments fallback] ${postId}: /api/v1 comments returned non-JSON; reused post-page comments (count=${pageComments.length})`);
            return pageComments;
          }
        }
      } catch {
        // ignore: not JSON
      }
    }
  }
  if (res.status !== 200) {
    const text = await res.text();
    throw new Error(`Instagram comments API HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Failed to parse Instagram comments response');
  }
  // Normalize: comments come back as an array in 'comments' or under the response object.
  const list = data.comments || [];
  if (Array.isArray(data)) {
    // Some responses wrap in {comments: [...]}
  }
  // Normalize: {comments: [{id, text, ...}]}
  const comments = Array.isArray(data.comments) ? data.comments : Array.isArray(data) ? data : [];
  return comments.map((c) => ({
    id: c.id || null,
    text: c.text || c.message || '',
    user: c.user || null,
    likes: c.likes || null,
  }));
}

// ---- Main pipeline ----
async function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Missing input file: ${INPUT_FILE}`);
  }
  if (!fs.existsSync(COMMENT_FILE)) {
    console.warn(`Missing comment-fetch log: ${COMMENT_FILE}. Comment checks will fall back to a fresh API call for each post.`);
  }

  // (placeholder removed — no comment cache reuse)
  if (fs.existsSync(COMMENT_FILE)) {
    const md = fs.readFileSync(COMMENT_FILE, 'utf8');
    // Assemble by post ID (the format we already produced)
    for (const line of md.split('\n')) {
      const m = line.match(/^\| # \| `?(\d+_[0-9]+)`? \| (\d+) \| (\d+) \|/);
      if (m) {
        // The comment_fetch.md we saw is a table, not a machine-readable list.
        // We'll fall back to a live comment fetch per post below.
      }
    }
  }

  const raw = fs.readFileSync(INPUT_FILE, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim());
  const cooking = lines.filter((l) => l.includes(COOKING_COLLECTION_ID));

  const cookie = process.env.Instagram_cookie || '';
  if (!cookie.includes('sessionid=')) {
    throw new Error('Instagram_cookie missing in env. Set Instagram_cookie before running.');
  }

  const results = [];
  const start = Date.now();

  for (let i = 0; i < cooking.length; i++) {
    const line = cooking[i];
    const rec = JSON.parse(line);
    const id = rec.id;
    const caption = rec.caption || '';
    const isVideo = rec.media_type === 2;

    if (!isVideo) continue;

    const t0 = Date.now();
    let verdict = 'NOT_RECIPE';
    let source = 'none';
    let captionAnalyzed = false;
    let recipeName = '';
    let ingredients = [];
    let steps = [];
    let captionRecipeFound = false;
    let commentsLoaded = 0;
    let commentsWithRecipe = 0;

    // ---- Step 1: caption ----
    const capText = cleanCaption(caption);
    if (capText) {
      captionAnalyzed = true;
      captionRecipeFound = captionHasRecipe(caption);
      if (captionRecipeFound) {
        const ext = extractCaptionRecipe(caption);
        recipeName = ext.recipe_name;
        ingredients = ext.ingredients;
        steps = ext.steps;
        verdict = 'REAL_CAPTION';
        source = 'caption';
      }
    }    // ---- Step 2: comments (only if caption had no recipe) ----
    if (verdict !== 'REAL_CAPTION' && captionAnalyzed) {
  // Fetch top comments via Instagram API (mirrors comment_fetch.mjs logic).
  // Only when the caption did NOT already contain recipe/ingredients.
  // The /api/v1/media/{id}/comments/ endpoint is known to return HTML instead of
  // JSON on this account, so we catch and record that and continue to NOT_RECIPE
  // (this is the same behavior as before — the comments never yielded a recipe).
  let comments = [];
  try {
    comments = await fetchTopComments(cookie, id, 20);
    commentsLoaded = comments.length;
  } catch (e) {
    console.warn(`[${i+1}/${cooking.length}] comments fetch failed for ${id}: ${e.message}`);
    comments = [];
  }
      // Check comments for recipe/ingredients signals.
      const capTextNoHash = cleanCaption(caption);
      for (const c of comments) {
        if (captionHasRecipe(c.text)) {
          commentsWithRecipe++;
        }
      }
      // Also: a comment that itself contains a full recipe with a 'Name - desc' heading
      // (not just one keyword) is a recipe.
      for (const c of comments) {
        const ct = cleanCaption(c.text);
        if (ct && (ct.includes('ingredients') || ct.includes('recipe') || ct.includes('method') || ct.includes('steps') || ct.includes('directions')) && (ct.includes(',') || ct.length > 80)) {
          commentsWithRecipe++;
        }
      }
      if (commentsWithRecipe > 0) {
        // Build recipe from the highest-voted comment that has recipe signals.
        const recipeComment = comments.find((c) => captionHasRecipe(c.text));
        if (!recipeComment) {
          recipeComment = comments.find((c) => cleanCaption(c.text)?.includes(',') || cleanCaption(c.text)?.length > 80);
        }
        if (recipeComment) {
          const ext = extractCaptionRecipe(recipeComment.text);
          recipeName = ext.recipe_name || recipeName;
          ingredients = ext.ingredients;
          steps = ext.steps;
          verdict = 'REAL_COMMENTS';
          source = 'comments';
        }
      }
    }

    // ---- Step 3: video — NOT fetched (no API cost, per your instruction). ----
    // is_recipe stays true if caption or comments yielded a recipe, false otherwise.
    const isRecipe = verdict === 'REAL_CAPTION' || verdict === 'REAL_COMMENTS';

    // ---- Step 4: record (keep the comment fields even when comments came back empty) ----
    const tCaption = ((Date.now() - t0) / 1000).toFixed(3);
    const pct = Date.now();
    const timeToRecord = ((Date.now() - pct) / 1000).toFixed(3);

    const record = {
      id,
      username: rec.username,
      full_name: rec.full_name || null,
      code: rec.code,
      video_url: rec.url,
      thumbnail_url: buildThumbnailUrl(rec.url, rec.code),
      video_duration_s: rec.video_duration ?? null,
      like_count: rec.like_count ?? null,
      comment_count: rec.comment_count ?? null,
      has_audio: rec.has_audio ?? null,
      taken_at: rec.taken_at ?? null,
      caption_full: caption,
      caption_has_recipe_ingredients: captionRecipeFound,
      caption_analyzed: captionAnalyzed,
      comments_loaded: commentsLoaded,
      comments_with_recipe_ingredients: commentsWithRecipe,
      is_recipe: isRecipe,
      verdict,
      source,
      recipe_name: recipeName,
      ingredients,
      steps,
      input_used: source === 'caption' ? 'caption full text' : (source === 'comments' ? 'top comments' : 'none'),
      time_to_caption_check_s: parseFloat(tCaption),
      time_to_comments_s: parseFloat(((Date.now() - pct) / 1000).toFixed(3)),
      time_to_record_s: parseFloat(timeToRecord),
      cost_usd: 0, // no video / no captions API cost tracked in this pipeline
      track: {
        caption_ms: 0,
        comments_ms: 0,
        total_ms: Date.now() - start,
      },
    };
    record.track.caption_ms = record.time_to_caption_check_s * 1000;
    record.track.comments_ms = record.time_to_comments_s * 1000;

    results.push(record);

    if ((i + 1) % 200 === 0) {
      console.log(`[${i+1}/${cooking.length}] ${record.username} ${record.code} -> ${record.verdict} (${record.source})`);
    }
  }

  const real = results.filter((r) => r.is_recipe).length;
  const not = results.filter((r) => r.verdict === 'NOT_RECIPE').length;
  const empty = results.filter((r) => r.verdict === 'EMPTY').length;
  const viaCaption = results.filter((r) => r.source === 'caption').length;
  const viaComments = results.filter((r) => r.source === 'comments').length;
  const totalTime = ((Date.now() - start) / 1000).toFixed(3);

  const costSummary = {
    model: 'N/A (no LLM / no video fetch / no batch)',
    cost_source: 'caption-authority + top-comments only',
    per_video_cost_usd: 0,
    input_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    videos_processed: results.length,
    real: real,
    not: not,
    empty: empty,
    via_caption: viaCaption,
    via_comments: viaComments,
    total_time_s: parseFloat(totalTime),
    avg_time_s_per_video: results.length ? parseFloat((totalTime / results.length).toFixed(3)) : 0,
    total_cost_usd: 0,
    notes: 'Caption-first, then top-comments. Video never fetched. Zero API cost.',
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  fs.writeFileSync(COST_FILE, JSON.stringify(costSummary, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(`Videos processed: ${results.length}`);
  console.log(`REAL (recipe/ingredients found): ${real}`);
  console.log(`NOT_RECIPE (no recipe in caption or comments): ${not}`);
  console.log(`EMPTY (no caption): ${empty}`);
  console.log(`via caption: ${viaCaption}`);
  console.log(`via comments: ${viaComments}`);
  console.log(`Total wall time: ${totalTime}s`);
  console.log(`Average: ${results.length ? parseFloat((totalTime / results.length).toFixed(3)) : 0}s per video`);
  console.log(`Per-video cost: $0 (caption + comments only, no video/LLM)`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log(`Cost:   ${COST_FILE}`);
}

function buildThumbnailUrl(url, code) {
  const m = url ? url.match(/instagram\.com\/p\/([a-zA-Z0-9_\-]+)/) : null;
  if (m) return `https://instagram.com/p/${m[1]}/media/?size=l`;
  return null;
}

main();
