// Servidor local opcional (sem dependências):  node server.js   →  http://localhost:3000
// Guarda os dados em ./dados-locais. Palavra-passe local: ADMIN_PASSWORD (por defeito "wells").
const http = require('http'), fs = require('fs'), path = require('path');
process.env.LOCAL_DATA_DIR = process.env.LOCAL_DATA_DIR || path.join(__dirname, 'dados-locais');
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'wells';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };
const handlers = { '/api/data': require('./api/data'), '/api/import': require('./api/import') };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const h = handlers[url.pathname];
  if (h) {
    const chunks = []; for await (const c of req) chunks.push(c);
    try { req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined; } catch { req.body = undefined; }
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    return h(req, res);
  }
  let p = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!p.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end('404'); }
  res.setHeader('Content-Type', MIME[path.extname(p)] || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log('A correr em http://localhost:' + (process.env.PORT || 3000)));
