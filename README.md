# My Recipe Collection

Every recipe from the 1,284 videos saved in my Instagram cooking collection, pulled out of
the captions and — where the caption only had half the story — off the video itself.

**Collection:** open `docs/index.html` (or the published GitHub Pages URL).

It is one self-contained page: search by dish, ingredient or creator, filter by language,
and switch any recipe between the original language and English.

## What is in here

| | |
|---|---|
| Videos in the saved collection | 1,284 |
| Food posts | ~1,190 |
| Recipes complete in the caption already | 644 (free, no video analysis needed) |
| Recipes read off the video | 403 (Gemini 2.5 Flash-Lite, ~$0.0009-0.002/reel) |
| Extraction spend | $0.58 for 474 passes over 432 reels |
| Duplicate dishes | merged into one card, all source videos kept |

Every recipe keeps the creator's original wording (Telugu, Hindi, English, …) plus an
English rendering of the name, each ingredient and each step.

## Data

- `docs/recipes.json` — full structured collection
- `docs/recipes.csv` — flat export for Sheets/Excel
- `docs/costs.json` — per-video cost and timing (download / encode / API seconds, tokens, USD)
- `docs/summary.json` — counts and totals

Recipe shape:

```json
{
  "code": "instagram shortcode",
  "dish": "original-language name",
  "dish_en": "English name",
  "language": "te",
  "creator": "username",
  "permalink": "https://www.instagram.com/p/...",
  "ingredients": [{"item": "original", "quantity": "as written", "item_en": "English"}],
  "steps": ["original-language step"],
  "steps_en": ["English step"],
  "source": "caption | video",
  "variants": [ ...same dish from other videos... ]
}
```

## Using this as an app backend

See [ARCHITECTURE.md](ARCHITECTURE.md) for how app users' public reels get ingested without
them sharing cookies or exporting data: share-sheet URL ingestion, a managed resolver for the
download step, the official-API limits (including that no saved-posts API exists), and the
creator self-publish path.

## Rebuilding

```bash
node pipeline/fetch_video_urls.mjs 18194606119249588   # CDN urls, ~40 polite requests
node pipeline/caption_extract.mjs --from 0 --to 1284   # caption pass (Groq free tier)
python3 pipeline/build_dataset.py                      # merge + build video queue
node pipeline/video_extract.mjs 4                      # Gemini video pass (resumable)
python3 pipeline/build_site.py                         # regenerate docs/
```

Both extraction passes are resumable and append-only, so they can be stopped and restarted
without losing work. Costs are logged per item.

## Speed and cost, measured

Reels are read as **sampled frames + the audio track** instead of as video. Gemini bills
~258 tokens for every second of video regardless of resolution or fps, so a 50 s reel costs
$0.002 as video but $0.001 as 10-12 stills, with the same ingredient recall.

| pipeline | cost / reel | ffmpeg / reel | total / reel |
|---|---|---|---|
| whole video, 540p, fps=3 | $0.00195 | 16.6 s | 36 s |
| frames every 5 s, decode all | $0.00092 | 20.3 s | 34 s |
| keyframes only + audio (current) | $0.00092 | 6.9 s | ~26 s |

Decoding only keyframes (`-skip_frame nokey`) is the single biggest speed win: Instagram
GOPs are ~5 s, so it yields the same spacing as `fps=1/5` for a sixth of the CPU.
What is left is network download (~6-18 s, depends on how many workers run in parallel)
and Gemini latency (~7-11 s); further gains would need smaller source renditions.
Prefetching the next download was measured and did **not** help - the link saturates first.

### Quality of the keyframe pass

Measured on 18 reels that also have a full-video extraction: keyframes recover **84% of
the full-video ingredient list** (149 of 177). Re-running 6 of the worst at 720px instead of
512px changed nothing - the same 258 tokens per frame and the same recall - so the gap is
temporal (an item shown only in the seconds between two keyframes), not resolution.

Resolution does not change price either, so there is no cheap way to buy the missing 16%
except more frames, which is what the full-video pass does. 42 of 324 frame-pass results came
back thin (<4 ingredients) vs 6 of 108 video-pass ones, so a targeted re-read of just those is
the economical fix. Done: the 42 thin reels were re-read as full video for **$0.0703**, taking
them from 102 to 199 ingredients (mean 2.4 -> 4.7 per reel; 31 improved, 10 unchanged, 1 worse,
14 still under 4 - those genuinely show no list).

### Download time

Instagram serves one 720p file per reel (the feed lists three renditions but they are the same
11.7 MB file for three CDN mirrors), and the media-info endpoint that lists smaller renditions
returns 302 for this account, so download size cannot be lowered. Byte cost is ~12-28 MB per
reel, ~5 MB/s aggregate on this link, i.e. ~40 min for the whole collection.

What we do instead: the CDN files are faststart (`moov` before `mdat`), so the download is
piped straight into ffmpeg and the keyframe decode overlaps the network transfer. On a single
reel that takes the download+extract step from ~14 s to ~9 s. `STILLS_STREAM=0` reverts to
download-then-extract.

Per-video cost and timing: `work/video_log.csv` (also `docs/costs.csv` on the site).
