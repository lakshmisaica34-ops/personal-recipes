// video_shrink.mjs
//
// Re-encode a video buffer down to fit a target base64 payload size.
// Used before sending a video to Gemini: full-quality Instagram reels are
// 10-40 MB, base64 inflates that by 33%, and OpenRouter rejects >8 MB.
//
// Strategy: scale down + raise CRF until the base64 fits, and if the clip is
// still too long, trim from the end. Recipe clips reveal ingredients and steps
// in the first few seconds, so the head of the clip is the part worth keeping.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);

const b64Len = (bytes) => Math.ceil(bytes / 3) * 4;

async function encode(inputPath, outputPath, { width, crf, maxSeconds }) {
  const args = [
    '-y',
    '-i', inputPath,
    '-t', String(maxSeconds),
    '-vf', `scale=${width}:-2:force_original_aspect_ratio=decrease`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-an',
    '-movflags', '+faststart',
    outputPath,
  ];
  await run(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 32 });
  return fs.statSync(outputPath).size;
}

// Returns a Buffer guaranteed (best effort) to base64-encode under targetBytes.
export async function shrinkVideo(buf, targetBytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidshrink-'));
  const inputPath = path.join(dir, 'in.mp4');
  const outputPath = path.join(dir, 'out.mp4');
  fs.writeFileSync(inputPath, buf);

  // Ladder of increasingly aggressive settings. First one that fits wins.
  const ladder = [
    { width: 480, crf: 28, maxSeconds: 60 },
    { width: 360, crf: 30, maxSeconds: 45 },
    { width: 320, crf: 32, maxSeconds: 30 },
    { width: 256, crf: 34, maxSeconds: 20 },
    { width: 192, crf: 36, maxSeconds: 15 },
    { width: 144, crf: 38, maxSeconds: 10 },
  ];

  let best = null;
  try {
    for (const step of ladder) {
      let size;
      try {
        size = await encode(inputPath, outputPath, step);
      } catch (e) {
        // ffmpeg can fail on a malformed or truncated clip; skip this rung.
        continue;
      }
      best = fs.readFileSync(outputPath);
      if (b64Len(size) <= targetBytes) return best;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // Nothing fit; return the smallest attempt we produced rather than failing.
  return best && b64Len(best.length) <= targetBytes ? best : buf;
}

export { b64Len };
