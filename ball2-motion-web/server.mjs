import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {WebSocketServer, WebSocket} from 'ws';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/motion.js', ['motion.js', 'text/javascript; charset=utf-8']]
]);
const token = () => randomBytes(24).toString('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createApp() {
  const rooms = new Map();
  const attempts = new Map();
  const send = (ws, data) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 2 * 1024 * 1024) {
      ws.close(1013, 'Connection too slow; reconnect before recording again');
      return;
    }
    ws.send(JSON.stringify(data));
  };
  const notify = (room, data) => { for (const ws of room.viewers) send(ws, data); };
  const baseHeaders = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  };
  const server = http.createServer(async (req, res) => {
    const host = String(req.headers.host || 'localhost');
    if (!/^[a-z0-9.:[\]-]+$/i.test(host)) {res.writeHead(400).end(); return;}
    // Safari versions differ on whether connect-src 'self' covers WebSockets.
    const headers = {...baseHeaders, 'Content-Security-Policy':
      baseHeaders['Content-Security-Policy'].replace("connect-src 'self'",
        `connect-src 'self' wss://${host} ws://${host}`)};
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/health') {
        res.writeHead(200, {...headers, 'Content-Type': 'text/plain'}).end('ok'); return;
      }
      if (path === '/api/session' && req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) {
          res.writeHead(403, headers).end(); return;
        }
        const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0];
        const now = Date.now();
        const previous = attempts.get(ip) || {time: now, count: 0};
        if (now-previous.time > 3600000) {previous.time = now; previous.count = 0;}
        attempts.set(ip, previous);
        if (++previous.count > 30 || rooms.size >= 100) {
          res.writeHead(429, headers).end('Please try again later.'); return;
        }
        const id = token(), viewKey = token(), ingestKey = token();
        rooms.set(id, {viewKey, ingestKey, viewers: new Set(), producer: null, touched: now, lastSample: 0});
        res.writeHead(201, {...headers, 'Content-Type': 'application/json'});
        res.end(JSON.stringify({id, viewKey, ingestKey})); return;
      }
      const asset = assets.get(path);
      if (req.method !== 'GET' || !asset) {res.writeHead(404, headers).end('Not found'); return;}
      const body = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
      res.writeHead(200, {...headers, 'Content-Type': asset[1]}); res.end(body);
    } catch {
      if (!res.headersSent) res.writeHead(500, headers);
      res.end('Request failed');
    }
  });
  const wss = new WebSocketServer({noServer: true, maxPayload: 512 * 1024, perMessageDeflate: false});
  server.on('upgrade', (req, socket, head) => {
    let match;
    try {match = new URL(req.url, 'http://localhost').pathname.match(/^\/(ingest|viewer)\/([\w-]+)\/([\w-]+)$/);} catch {}
    const room = match && rooms.get(match[2]);
    const role = match?.[1];
    if (!room || !equal(match[3], role === 'ingest' ? room.ingestKey : room.viewKey)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    if ((role === 'ingest' && room.producer) || (role === 'viewer' && room.viewers.size >= 5)) {
      socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n'); return;
    }
    if (role === 'viewer' && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) throw Error();
      } catch {socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return;}
    }
    wss.handleUpgrade(req, socket, head, ws => {
      room.touched = Date.now();
      ws.alive = true;
      ws.on('pong', () => {ws.alive = true; room.touched = Date.now();});
      ws.on('error', () => {});
      if (role === 'viewer') {
        room.viewers.add(ws);
        send(ws, {type: 'status', connected: Boolean(room.producer), lastSample: room.lastSample});
        ws.on('close', () => room.viewers.delete(ws));
      } else {
        room.producer = ws;
        notify(room, {type: 'status', connected: true, lastSample: 0});
        ws.on('message', (message, binary) => {
          if (binary) return;
          let data;
          try {data = JSON.parse(message.toString());} catch {return;}
          if (!data || data.eventType !== 'stream' || !Array.isArray(data.samples) || !Array.isArray(data.velocities) || data.samples.length > 4000) return;
          room.lastSample = room.touched = Date.now();
          notify(room, {type: 'stream', event: {
            eventType: 'stream', ballId: String(data.ballId || ''),
            samples: data.samples, velocities: data.velocities
          }});
        });
        ws.on('close', () => {
          if (room.producer === ws) {
            room.producer = null;
            notify(room, {type: 'status', connected: false, lastSample: room.lastSample});
          }
        });
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {ws.terminate(); continue;}
      ws.alive = false; ws.ping();
    }
    const now = Date.now();
    for (const [id, room] of rooms) {
      if (!room.producer && !room.viewers.size && now-room.touched > 30*60000) rooms.delete(id);
    }
    for (const [ip, rate] of attempts) if (now-rate.time > 3600000) attempts.delete(ip);
  }, 25000);
  heartbeat.unref();
  async function close() {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
  return {server, close};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, '0.0.0.0', () => console.log(`Ball 2 Motion · http://localhost:${app.server.address().port}`));
  process.once('SIGTERM', () => app.close().then(() => process.exit(0)));
  process.once('SIGINT', () => app.close().then(() => process.exit(0)));
}
