// Minimaler HTTPS-Static-Server für Tests im lokalen Netz.
// Kamera/Geolocation/Service-Worker benötigen einen sicheren Kontext (HTTPS) –
// reines http://<lan-ip> reicht dafür nicht aus.
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

const ROOT = __dirname;
const PORT = process.env.PORT ? Number(process.env.PORT) : 8443;

const CERT_DIR = path.join(ROOT, 'certs');
const KEY_PATH = path.join(CERT_DIR, 'dev-key.pem');
const CERT_PATH = path.join(CERT_DIR, 'dev-cert.pem');

if (!fs.existsSync(KEY_PATH) || !fs.existsSync(CERT_PATH)) {
  console.error('Zertifikat fehlt. Siehe README.md, Abschnitt "Im lokalen Netz auf dem Smartphone testen".');
  process.exit(1);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

const server = https.createServer(
  {
    key: fs.readFileSync(KEY_PATH),
    cert: fs.readFileSync(CERT_PATH),
  },
  (req, res) => {
    const remote = req.socket.remoteAddress + ':' + req.socket.remotePort;
    console.log(`[req] ${remote} ${req.method} ${req.url}`);

    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        console.log(`[404] ${remote} ${urlPath}`);
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Nicht gefunden: ' + urlPath);
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  }
);

server.on('tlsClientError', (err, socket) => {
  const remote = socket.remoteAddress + ':' + socket.remotePort;
  console.log(`[tlsClientError] ${remote} ${err.message}`);
});
server.on('clientError', (err, socket) => {
  const remote = socket.remoteAddress ? socket.remoteAddress + ':' + socket.remotePort : '?';
  console.log(`[clientError] ${remote} ${err.message}`);
});
server.on('connection', (socket) => {
  console.log(`[tcp connect] ${socket.remoteAddress}:${socket.remotePort}`);
  socket.on('error', (err) => console.log(`[socket error] ${socket.remoteAddress}:${socket.remotePort} ${err.message}`));
  socket.on('close', (hadError) => console.log(`[tcp close] ${socket.remoteAddress}:${socket.remotePort} hadError=${hadError}`));
});

server.listen(PORT, '0.0.0.0', () => {
  const addresses = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }

  console.log(`\nHTTPS-Server läuft auf Port ${PORT}.\n`);
  console.log('Auf diesem Rechner öffnen:');
  console.log(`  https://localhost:${PORT}\n`);
  console.log('Vom Smartphone im selben WLAN öffnen:');
  addresses.forEach((addr) => console.log(`  https://${addr}:${PORT}`));
  console.log('\nDas Zertifikat ist selbstsigniert – der Browser warnt beim ersten');
  console.log('Aufruf ("Risiko akzeptieren" / "Erweitert" → "Trotzdem fortfahren").');
  console.log('Zum Beenden: Strg+C\n');
});
