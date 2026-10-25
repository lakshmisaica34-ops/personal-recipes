import fs from 'node:fs';
import { fetchVideo, classifyVideo, fetchFrame, classifyFrame } from './gemini_classifier.mjs';
import { shrinkVideo } from './video_shrink.mjs';

// Retries the posts that never got a Gemini verdict.
//
// Three failure modes handled here:
//   1. Payload too large   -> shrinkVideo() re-encodes under the 8 MB cap.
//   2. Instagram throttle  -> /api/v1/media/{id}/info/ answers 302 to the
//      homepage instead of JSON, so JSON.parse throws "Unexpected end of JSON
//      input". Transient, so back off rather than recording a permanent error.
//   3. Persistent block    -> when the API stays blocked (challenge_required),
//      fall back to the poster frame at /p/{code}/media/, which Instagram
//      rate-limits separately and which still works. Verdicts from a still are
//      recorded with gemini_input: "frame" so they can be told apart from the
//      ones judged from full video.
//
// Resumable: progress is written every couple of videos, and the next run picks
// up whatever is still ERROR_PROCESSING.

const SRC = 'exports/recipe_scrape_results_final.json';
const OUT = 'exports/recipe_scrape_results_final.json';
const PROGRESS = 'exports/gemini_retry_progress.json';
const MAX_BYTES = 6 * 1048576; // headroom under OpenRouter's 8 MB base64 cap

const THROTTLE_RE = /Unexpected end of JSON input|Unexpected token|JSON\.parse/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = fs.existsSync(PROGRESS)
  ? JSON.parse(fs.readFileSync(PROGRESS, 'utf8'))
  : JSON.parse(fs.readFileSync(SRC, 'utf8'));

const queue = results.filter((r) => r.verdict === 'ERROR_PROCESSING');
console.log(`[${new Date().toISOString()}] queued ${queue.length} videos`);

if (!process.env.Openrouter_api) throw new Error('Openrouter_api not set');

// Short backoff on the video endpoint: we only wait here for the block to
// clear, and any sustained failure hands off to the poster-frame path.
async function fetchVideoPatiently(id) {
  let delay = 20_000;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetchVideo(id);
    } catch (e) {
      if (!THROTTLE_RE.test(e.message)) throw e;
      if (attempt === 3) return null; // caller falls back to the frame
      console.log(`    video throttled (attempt ${attempt}), sleeping ${Math.round(delay / 1000)}s`);
      await sleep(delay);
      delay = Math.min(delay * 1.7, 120_000);
    }
  }
  return null;
}

// Once the video API is confirmed blocked, stop re-testing it per video --
// otherwise every one of the 172 pays ~80s of waiting before falling back.
let videoDisabled = false;
let consecutiveVideoMisses = 0;

let processed = 0;
let viaVideo = 0;
let viaFrame = 0;
let failed = 0;

for (let i = 0; i < queue.length; i++) {
  const r = queue[i];
  const idx = results.findIndex((x) => x.id === r.id);
  if (idx === -1) continue;

  processed++;
  const t = Date.now();
  const caption = (r.caption_full || '').replace(/[#＃][^\s]+/g, '').trim();

  try {
    const vbuf = videoDisabled ? null : await fetchVideoPatiently(r.id);
    let res, input, bytesOrig, bytesSent;

    if (vbuf) {
      consecutiveVideoMisses = 0;
      const shrunk = await shrinkVideo(vbuf.buf, MAX_BYTES);
      res = await classifyVideo(shrunk, r.id, caption);
      input = 'video';
      bytesOrig = vbuf.buf.length;
      bytesSent = shrunk.length;
      viaVideo++;
    } else {
      if (!videoDisabled) {
        consecutiveVideoMisses++;
        if (consecutiveVideoMisses >= 2) {
          videoDisabled = true;
          console.log('    video API confirmed blocked -- switching to poster frames for the rest of this run');
        }
      }
      const frame = await fetchFrame(r.code);
      res = await classifyFrame(frame, r.id, caption);
      input = 'frame';
      bytesOrig = frame.length;
      bytesSent = frame.length;
      viaFrame++;
    }

    if (res.is_recipe === true) {
      results[idx] = {
        ...results[idx],
        verdict: 'REAL_GEMINI',
        source: 'gemini',
        is_recipe: true,
        gemini_reason: res.reason,
        gemini_ingredients: res.ingredients || [],
        gemini_steps: res.steps || [],
        gemini_input: input,
        video_bytes_orig: bytesOrig,
        video_bytes_sent: bytesSent,
        error: undefined,
      };
    } else if (res.is_recipe === false) {
      results[idx] = {
        ...results[idx],
        verdict: 'NOT_RECIPE_GEMINI',
        source: 'gemini',
        is_recipe: false,
        gemini_reason: res.reason,
        gemini_input: input,
        video_bytes_orig: bytesOrig,
        video_bytes_sent: bytesSent,
        error: undefined,
      };
    } else {
      failed++;
      results[idx] = {
        ...results[idx],
        verdict: 'ERROR_PROCESSING',
        error: res.reason || 'gemini returned null',
        gemini_input: input,
        video_bytes_orig: bytesOrig,
        video_bytes_sent: bytesSent,
      };
    }
    console.log(
      `[${processed}/${queue.length}] ${r.username} ${r.code} -> ${results[idx].verdict}` +
        ` [${input}] (${((Date.now() - t) / 1000).toFixed(1)}s)`
    );
  } catch (e) {
    failed++;
    results[idx] = { ...results[idx], verdict: 'ERROR_PROCESSING', error: e.message };
    console.log(`[${processed}/${queue.length}] ${r.username} ${r.code} -> ERROR: ${e.message}`);
  }

  if (processed % 2 === 0) fs.writeFileSync(PROGRESS, JSON.stringify(results, null, 2));
  await sleep(800);
}

fs.writeFileSync(PROGRESS, JSON.stringify(results, null, 2));
fs.writeFileSync(OUT, JSON.stringify(results, null, 2));

const real = results.filter((x) => x.is_recipe === true).length;
const not = results.filter((x) => x.is_recipe === false).length;
const err = results.filter((x) => x.verdict === 'ERROR_PROCESSING').length;
console.log(`=== RETRY SUMMARY ${new Date().toISOString()} ===`);
console.log(`retried ${processed}: ${viaVideo} via video, ${viaFrame} via frame, ${failed} failed`);
console.log(`REAL ${real} | NOT ${not} | ERROR ${err}`);
