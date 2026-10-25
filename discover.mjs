// Broad discovery: find the Saved route's lazy chunk and its Relay doc_ids.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const html = execSync('cat /tmp/savedpage.html', { maxBuffer: 1 << 26 }).toString('utf8');
const main = execSync('cat /tmp/igjs_5.js', { maxBuffer: 1 << 26 }).toString('utf8');

// 1. All quoted strings in HTML containing Saved/Bookmark
const strs = new Set();
for (const m of html.matchAll(/"([^"\\]{0,60}(?:Saved|Bookmark)[^"\\]{0,60})"/g)) strs.add(m[1]);
console.log('HTML strings with Saved/Bookmark:');
console.log([...strs].slice(0, 50).join('\n') || '  none');

// 2. Main-bundle identifiers containing Saved/Bookmark
const idents = new Set();
for (const m of main.matchAll(/[A-Za-z][A-Za-z0-9_.]{0,60}(?:Saved|Bookmark)[A-Za-z0-9_.]{0,40}/g)) idents.add(m[0]);
const identList = [...idents].filter(x => x.length > 8);
console.log('\nMain-bundle identifiers with Saved/Bookmark (' + identList.length + '):');
console.log(identList.slice(0, 60).join(', '));

// 3. Full chunk src map from HTML: "key":{"src":"/rsrc.php/....js",...}
const srcById = new Map();
for (const m of html.matchAll(/"([^"\\]{2,80})":\{"src":"([^"]+?\.js)"/g)) {
  srcById.set(m[1], m[2].replace(/\\\//g, '/'));
}
console.log('\nchunk src map size:', srcById.size);
const savedKeys = [...srcById.keys()].filter(k => /Saved|Bookmark|Collection/i.test(k));
console.log('saved-ish map keys:', savedKeys.join(', ') || 'none');

// 4. download saved-ish chunks, grep Relay artifacts
const urls = savedKeys.map(k => [k, srcById.get(k).startsWith('http') ? srcById.get(k) : 'https://www.instagram.com' + srcById.get(k)]);
console.log('downloading', urls.length, 'chunks');
for (const [key, u] of urls) {
  const out = '/tmp/schunk_' + key.replace(/[^A-Za-z0-9]/g, '_') + '.js';
  try {
    execSync('curl -s -o "' + out + '" -H "User-Agent: ' + (process.env.UA || '') + '" "' + u + '"');
    const js = execSync('cat "' + out + '"').toString('utf8');
    console.log('\n== ' + key + ': ' + js.length + ' bytes  ...' + u.slice(-42));
    const hits = [];
    for (const m of js.matchAll(/params:\{id:"(\d{8,})",metadata:\{\},name:"([^"]+)"/g)) {
      if (/Saved|Bookmark|Collection/i.test(m[2])) hits.push(m[1] + '  ' + m[2]);
    }
    if (hits.length) console.log(hits.join('\n'));
    else {
      const names = [...js.matchAll(/name:"([^"]{0,80})"/g)].map(x => x[1]).filter(n => /Saved|Bookmark|Collection/i.test(n)).slice(0, 10);
      const docs = [...js.matchAll(/params:\{id:"(\d{8,})"/g)].slice(0, 6).map(x => x[1]);
      console.log('names:', names.join(', ') || 'none', '| doc_ids:', docs.join(', ') || 'none');
    }
  } catch (e) { console.log('failed:', key); }
}
writeFileSync('/tmp/srcmap.json', JSON.stringify([...srcById], null, 0));
