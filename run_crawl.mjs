// Crawl the full Instagram saved feed into a local text index (JSONL).
// Usage:
//   node run_crawl.mjs all                  -> page /api/v1/feed/saved/posts/
//   node run_crawl.mjs collection <id>      -> page /api/v1/feed/collection/<id>/posts/
import fs from 'node:fs';
import { client, crawlFeed } from './iglib.mjs';

const mode = process.argv[2] || 'all';
const arg = process.argv[3];
const c = client();
const maxPages = parseInt(process.env.MAXPAGES || '300', 10);

fs.mkdirSync('index', { recursive: true });

if (mode === 'all') {
  console.log('Crawling ALL saved posts -> index/saved_all.jsonl');
  const r = await crawlFeed(c, 'https://www.instagram.com/api/v1/feed/saved/posts/',
    { statePath: 'index/state_all.json', outPath: 'index/saved_all.jsonl', maxPages });
  console.log('DONE', r);
} else if (mode === 'collection' && arg) {
  console.log(`Crawling collection ${arg} -> index/saved_collection_${arg}.jsonl`);
  const r = await crawlFeed(c, `https://www.instagram.com/api/v1/feed/collection/${arg}/posts/`,
    { statePath: `index/state_col_${arg}.json`, outPath: `index/saved_collection_${arg}.jsonl`, maxPages });
  console.log('DONE', r);
} else {
  console.log('unknown mode');
  process.exit(1);
}
