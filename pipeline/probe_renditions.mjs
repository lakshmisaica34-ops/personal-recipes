// Probe: what video renditions does the saved-feed payload expose, and how big
// is the smallest usable one? One page request, no media-info calls.
import { client } from '../iglib.mjs';

const COLLECTION = '18194606119249588';
const ig = client();
const r = await ig.get(`https://www.instagram.com/api/v1/feed/collection/${COLLECTION}/posts/`);
if (!r.json) throw new Error('no json ' + r.status);
const items = r.json.items || [];
console.log('items:', items.length);

let shown = 0;
for (const it of items) {
  const vv = it.video_versions || [];
  if (!vv.length) continue;
  const sorted = [...vv].sort((a, b) => (a.width * a.height) - (b.width * b.height));
  console.log(`\n${it.code}  type=${it.media_type}  renditions=${vv.length}`);
  for (const v of sorted) {
    console.log(`   ${String(v.width).padStart(5)}x${String(v.height).padEnd(5)} ${String(v.type ?? '').padEnd(10)} ${(v.bandwidth / 1024 || 0).toFixed(0).padStart(6)} kbps  ${(v.estimated_bytes / 1e6 || 0).toFixed(1)} MB`);
  }
  if (++shown >= 3) break;
}
