'use strict';

/**
 * @module server
 * @description HTTP server factory for webhook-bridge.
 * @author idirdev
 */

const http   = require('http');
const crypto = require('crypto');

const MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * Create an HTTP server that accepts webhook payloads.
 *
 * Built-in routes:
 *   GET /health → 200 {status:'ok'}
 *   GET /stats  → 200 stats object
 *   POST *      → 202 {accepted:true, webhookId}
 *   Other       → 405
 *
 * @param {function(req, body, webhookId): Promise<*>} handler
 * @param {object}   [opts={}]
 * @param {function} [opts.statsProvider]
 * @returns {http.Server}
 */
function createWebhookServer(handler, opts) {
  opts = opts || {};

  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: Math.round(process.uptime()), version: '1.4.0' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/stats') {
      const data = typeof opts.statsProvider === 'function'
        ? opts.statsProvider()
        : { message: 'No stats provider configured.' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
      return;
    }

    const chunks = [];
    let bodySize = 0;

    req.on('data', (chunk) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_BYTES) {
        if (!res.writableEnded) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large. Maximum is 5 MB.' }));
        }
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (res.writableEnded) return;
      const rawBody   = Buffer.concat(chunks);
      const webhookId = generateId();
      const ct        = (req.headers['content-type'] || '').toLowerCase();
      let body;

      if (ct.includes('application/json')) {
        try { body = JSON.parse(rawBody.toString('utf-8')); }
        catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body.' }));
          return;
        }
      } else if (ct.includes('application/x-www-form-urlencoded')) {
        body = Object.fromEntries(new URLSearchParams(rawBody.toString('utf-8')));
      } else {
        try { body = JSON.parse(rawBody.toString('utf-8')); } catch { body = rawBody.toString('utf-8'); }
      }

      res.writeHead(202, { 'Content-Type': 'application/json', 'X-Webhook-Id': webhookId });
      res.end(JSON.stringify({ accepted: true, webhookId }));

      Promise.resolve()
        .then(() => handler(req, body, webhookId))
        .catch(err => console.error('[webhook-bridge] Handler error (' + webhookId + '): ' + err.message));
    });

    req.on('error', (err) => {
      console.error('[webhook-bridge] Request error: ' + err.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error.' }));
      }
    });
  });
}

/**
 * Generate a unique webhook ID: wb_ + 12 hex characters.
 * @returns {string}
 */
function generateId() {
  return 'wb_' + crypto.randomBytes(6).toString('hex');
}

module.exports = { createWebhookServer, generateId };