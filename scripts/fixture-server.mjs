// Serves test/fixtures over HTTP so the extractor can be exercised end-to-end
// without depending on any external site.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../test/fixtures/', import.meta.url).pathname;
const PORT = Number(process.env.FIXTURE_PORT ?? 4321);
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
                '.svg': 'image/svg+xml', '.txt': 'text/plain', '.json': 'application/json' };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const rel = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    const path = join(ROOT, rel === '/' ? 'marketing.html' : rel);
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(PORT, () => console.log(`fixtures on http://127.0.0.1:${PORT}`));
