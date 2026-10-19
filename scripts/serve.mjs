import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

export function createSiteServer(root = resolve('dist')) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
  return createServer(async (request, response) => {
    const path = resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
    if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    try {
      const file = path === root ? resolve(root, 'index.html') : path;
      const data = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(data);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500).end('Unable to serve file');
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/serve.mjs')) {
  const server = createSiteServer();
  server.listen(4173, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4173'));
}
