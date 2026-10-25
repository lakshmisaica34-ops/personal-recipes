// Extract Saved-page lazy chunks from the Instagram HTML
// and grep those chunks for Relay query artifacts (doc_id + name).
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const html = execSync('cat /tmp/savedpage.html', { maxBuffer: 1 << 26 }).toString('utf8');

// 1. All compMap entries, plain-quote form: "Name":{"r":["id1","id2"
const comps = [];
let m;
const plainComp = /"([A-Za-z0-9._]{3,60})":\{"r":\[([^\]]{0,200})\]/g;
while ((m = plainComp.exec(html))) {
  const ids = [...m[2].matchAll(/"([A-Za-z0-9+/]{4,40})"/g)].map(x => x[1]);
  comps.push([m[1], ids]);
}
console.log('compMap components found:', comps.length);
const savedComps = comps.filter(([n]) => /Saved|Bookmark/i.test(n));
console.log('saved-ish components:', JSON.stringify(savedComps));
console.log('all component names:', comps.map(c => c[0]).join(', ').slice(0, 800));

// 2. chunk id -> src: "chunkId":{"u":"/rsrc.php/....js"
const srcById = new Map();
const plainSrc = /"([A-Za-z0-9+/]{4,40})":\{"u":"([^"]+?\.js)"/g;
while ((m = plainSrc.exec(html))) {
  srcById.set(m[1], m[2].replace(/\\\//g, '/'));
}
console.log('chunk src map size:', srcById.size);

// 3. resolve + download saved chunks
const wanted = new Set();
for (const [, ids] of savedComps) for (const id of ids) wanted.add(id);
const urls = [];
for (const id of wanted) {
  const u = srcById.get(id);
  if (u) urls.push([id, u.startsWith('http') ? u : 'https://www.instagram.com' + u]);
  else console.log('no src for chunk', id);
}
console.log('resolving', urls.length, 'chunks');
writeFileSync('/tmp/chunk_urls.txt', urls.map(([i, u]) => i + '\t' + u).join('\n'));

for (const [id, u] of urls) {
  const out = '/tmp/chunk_' + id + '.js';
  execSync('curl -s -o ' + out + ' -H "User-Agent: ' + (process.env.UA || '') + '" "' + u + '"');
  const js = execSync('cat ' + out).toString('utf8');
  console.log('\n== chunk ' + id + ': ' + js.length + ' bytes, url ...' + u.slice(-45));
  // Relay artifacts: params:{id:"<docid>",metadata:{},name:"<QueryName>"}
  const artRe = /params:\{id:"(\d{8,})",metadata:\{\},name:"([^"]+)"/g;
  const hits = [];
  let a;
  while ((a = artRe.exec(js))) {
    if (/Saved|Bookmark|Collection/i.test(a[2])) hits.push(a[1] + '  ' + a[2]);
  }
  if (hits.length) console.log(hits.join('\n'));
  else {
    const anyNames = [...js.matchAll(/name:"([^"]*(?:Saved|Bookmark|Collection)[^"]*)"/g)].slice(0, 12).map(x => x[1]);
    const anyDoc = [...js.matchAll(/params:\{id:"(\d{8,})"/g)].slice(0, 8).map(x => x[1]);
    console.log('name strings:', anyNames.join(', ') || 'none', '| doc_ids present:', anyDoc.join(', ') || 'none');
  }
}
