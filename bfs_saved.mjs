// Parse the page's rsrcMap, find the SavedCollectionPage chunk, download it,
// and extract Relay query artifacts (doc_id + name). BFS one level deeper if needed.
import { execSync } from 'node:child_process';

const html = execSync('cat /tmp/savedpage.html', { maxBuffer: 1 << 26 }).toString('utf8');
const blocks = [...html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);

const rsrcMap = {};
let blocksWithMap = 0;
function collect(o, path) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) {
    o.forEach((v, i) => collect(v, path + '[' + i + ']'));
    return;
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === 'rsrcMap' && v && typeof v === 'object' && !Array.isArray(v)) {
      blocksWithMap++;
      Object.assign(rsrcMap, v);
    } else collect(v, path + '.' + k);
  }
}
for (const b of blocks) { try { collect(JSON.parse(b), ''); } catch {} }
const entries = Object.entries(rsrcMap);
console.log('rsrcMap blocks:', blocksWithMap, '| merged entries:', entries.length);
const sample = entries[0];
if (sample) console.log('entry shape:', JSON.stringify(sample[1]).slice(0, 200));

// Find entries related to Saved/Bookmark
const savedEntries = entries.filter(([k, v]) => /Saved|Bookmark/i.test(JSON.stringify(v)));
console.log('saved-ish entries:', savedEntries.map(([k, v]) => k + ' :: ' + JSON.stringify(v).slice(0, 160)).join('\n') || 'none');

async function grepChunk(label, url) {
  const out = '/tmp/bchunk_' + label.replace(/[^A-Za-z0-9]/g, '_') + '.js';
  execSync('curl -s -o "' + out + '" -H "User-Agent: ' + (process.env.UA || '') + '" "' + url + '"');
  const js = execSync('cat "' + out + '"').toString('utf8');
  console.log('\n== ' + label + ': ' + js.length + ' bytes');
  const hits = [];
  for (const m of js.matchAll(/params:\{id:"(\d{8,})",metadata:\{\},name:"([^"]+)"/g)) hits.push(m[1] + '  ' + m[2]);
  const savedHits = hits.filter(h => /Saved|Bookmark|Collection/i.test(h));
  if (savedHits.length) console.log('SAVED ARTIFACTS:\n' + savedHits.join('\n'));
  else console.log('all artifacts (' + hits.length + '):', hits.slice(0, 15).join(' | ') || 'none');
  // any further module/chunk references
  const more = [...js.matchAll(/[A-Za-z0-9._]{0,40}(?:Saved|Bookmark)[A-Za-z0-9._]{0,40}/g)].map(m => m[0]);
  console.log('saved-ish strings in chunk:', [...new Set(more)].slice(0, 20).join(', ') || 'none');
  return js;
}

for (const [k, v] of savedEntries) {
  const url = v.src || (typeof v === 'string' ? v : null);
  if (url) await grepChunk(k, url.startsWith('http') ? url : 'https://www.instagram.com' + url);
}

// Also: search whole rsrcMap keys for page-module names
const pageKeys = entries.filter(([k]) => /polaris|Saved/i.test(k));
console.log('\npage-ish rsrcMap KEYS:', pageKeys.map(([k]) => k).slice(0, 40).join(', ') || 'none');
