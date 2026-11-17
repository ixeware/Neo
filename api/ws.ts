/// <reference types="node" />
// GET /api/ws (WebSocket): the shared war's live channel. Vercel runs this Node server and hands it
// the upgrade; a connection ends at the function's max duration (vercel.json: 300 s) and the client
// reconnects with backoff, resuming from its last log id. Protocol: api/README.md.
import { createServer } from 'node:http';
import { hub } from './_lib/hub.js';

const server = createServer((_req, res) => {
  res.statusCode = 426;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end('WebSocket only');
});
hub().attach(server);

export default server;
