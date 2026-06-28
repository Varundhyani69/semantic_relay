'use strict';

// Optional convenience server. The demo also works by opening web/index.html
// directly via file:// — this is only here if you prefer a localhost URL.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'web');
const PORT = process.env.PORT || 4173;

const TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json'
};

http
  .createServer((req, res) => {
    const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'text/plain' });
      res.end(content);
    });
  })
  .listen(PORT, () => {
    console.log(`Demo running at http://localhost:${PORT}`);
  });
