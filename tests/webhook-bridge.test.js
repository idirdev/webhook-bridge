'use strict';

/**
 * @file Tests for webhook-bridge
 * @author idirdev
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const fs     = require('node:fs');
const path   = require('node:path');
const os     = require('node:os');

const { WebhookBridge, Forwarder, Transformer, WebhookStorage, createWebhookServer, generateId } = require('../src/index');

/**
 * Send an HTTP request and resolve with { statusCode, headers, body }.
 */
function httpRequest(method, url, body, headers) {
  headers = headers || {};
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method, headers };
    if (body) opts.headers['content-length'] = String(Buffer.byteLength(body));
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── WebhookStorage ────────────────────────────────────────────────────────────

describe('WebhookStorage', () => {
  const tmpLog = path.join(os.tmpdir(), '_wb_test_' + Date.now() + '.jsonl');
  after(() => { try { fs.unlinkSync(tmpLog); } catch { /* ignored */ } });

  it('should store and retrieve entries by id', () => {
    const s = new WebhookStorage(null);
    s.store({ id: 'wb_001', method: 'POST', path: '/', headers: {}, body: { a: 1 }, timestamp: new Date().toISOString() });
    assert.equal(s.get('wb_001').id, 'wb_001');
    assert.deepEqual(s.get('wb_001').body, { a: 1 });
  });

  it('should return null for unknown ids', () => {
    assert.equal(new WebhookStorage(null).get('nope'), null);
  });

  it('should list ids newest first', () => {
    const s = new WebhookStorage(null);
    s.store({ id: 'a', timestamp: '1', method: 'POST', path: '/', headers: {}, body: {} });
    s.store({ id: 'b', timestamp: '2', method: 'POST', path: '/', headers: {}, body: {} });
    s.store({ id: 'c', timestamp: '3', method: 'POST', path: '/', headers: {}, body: {} });
    assert.deepEqual(s.listIds(), ['c', 'b', 'a']);
  });

  it('should delete entries', () => {
    const s = new WebhookStorage(null);
    s.store({ id: 'x', timestamp: '', method: 'POST', path: '/', headers: {}, body: {} });
    assert.equal(s.delete('x'), true);
    assert.equal(s.get('x'), null);
    assert.equal(s.count(), 0);
  });

  it('should evict oldest entries when maxEntries is exceeded', () => {
    const s = new WebhookStorage(null, { maxEntries: 2 });
    s.store({ id: 'a', timestamp: '', method: 'POST', path: '/', headers: {}, body: {} });
    s.store({ id: 'b', timestamp: '', method: 'POST', path: '/', headers: {}, body: {} });
    s.store({ id: 'c', timestamp: '', method: 'POST', path: '/', headers: {}, body: {} });
    assert.equal(s.count(), 2);
    assert.equal(s.get('a'), null);
    assert.ok(s.get('c'));
  });

  it('should persist to JSONL and restore on next open', async () => {
    const s1 = new WebhookStorage(tmpLog);
    s1.store({ id: 'p1', method: 'POST', path: '/', headers: {}, body: { msg: 'hello' }, timestamp: 'T1' });
    s1.store({ id: 'p2', method: 'POST', path: '/', headers: {}, body: { msg: 'world' }, timestamp: 'T2' });
    await new Promise(r => { if (s1._stream) s1._stream.end(r); else r(); });
    s1._stream = null;
    const s2 = new WebhookStorage(tmpLog);
    assert.equal(s2.count(), 2);
    assert.equal(s2.get('p1').body.msg, 'hello');
    s2.close();
  });

  it('should throw when storing an entry without id', () => {
    assert.throws(() => new WebhookStorage(null).store({ method: 'POST' }), /id/);
  });

  it('should search entries with a predicate', () => {
    const s = new WebhookStorage(null);
    s.store({ id: '1', method: 'POST', path: '/a', headers: {}, body: {}, timestamp: '' });
    s.store({ id: '2', method: 'POST', path: '/b', headers: {}, body: {}, timestamp: '' });
    s.store({ id: '3', method: 'POST', path: '/a', headers: {}, body: {}, timestamp: '' });
    assert.equal(s.search(e => e.path === '/a').length, 2);
  });
});

// ── Transformer ───────────────────────────────────────────────────────────────

describe('Transformer', () => {
  it('should pass payload through when no function is set', async () => {
    assert.deepEqual(await new Transformer(null).apply({ x: 1 }, {}), { x: 1 });
  });

  it('should report hasTransform correctly', () => {
    assert.equal(new Transformer(null).hasTransform(), false);
    assert.equal(new Transformer(p => p).hasTransform(), true);
  });

  it('should apply a sync transform', async () => {
    const r = await new Transformer(p => ({ ...p, ok: true })).apply({ a: 1 }, {});
    assert.deepEqual(r, { a: 1, ok: true });
  });

  it('should apply an async transform', async () => {
    const r = await new Transformer(async (p, h) => ({ type: p.event, src: h['x-src'] }))
      .apply({ event: 'push' }, { 'x-src': 'gh' });
    assert.deepEqual(r, { type: 'push', src: 'gh' });
  });

  it('should propagate errors from the transform function', async () => {
    await assert.rejects(() => new Transformer(() => { throw new Error('boom'); }).apply({}, {}), /boom/);
  });
});

describe('Transformer.mapFields', () => {
  it('should map and nest fields', () => {
    const r = Transformer.mapFields(
      { user: { name: 'idir' }, action: 'push' },
      [{ from: 'user.name', to: 'author' }, { from: 'action', to: 'event.type' }]
    );
    assert.equal(r.author, 'idir');
    assert.equal(r.event.type, 'push');
  });

  it('should use default values for missing fields', () => {
    const r = Transformer.mapFields({}, [{ from: 'x', to: 'y', default: 'fallback' }]);
    assert.equal(r.y, 'fallback');
  });
});

describe('Transformer.interpolate', () => {
  it('should replace {{name}} placeholders', () => {
    assert.equal(Transformer.interpolate('Hi {{name}}!', { name: 'idir' }), 'Hi idir!');
  });

  it('should resolve nested dot paths', () => {
    assert.equal(Transformer.interpolate('{{u.n}}', { u: { n: 'idir' } }), 'idir');
  });

  it('should leave unresolved placeholders intact', () => {
    assert.equal(Transformer.interpolate('{{x}}', {}), '{{x}}');
  });
});

describe('Transformer.interpolateDeep', () => {
  it('should recursively interpolate strings inside objects and arrays', () => {
    const r = Transformer.interpolateDeep({ t: '{{e}}', a: ['{{e}}'] }, { e: 'push' });
    assert.equal(r.t, 'push');
    assert.deepEqual(r.a, ['push']);
  });
});

describe('Transformer.chain', () => {
  it('should apply transforms in sequence', async () => {
    const t = Transformer.chain([p => ({ ...p, s1: true }), async p => ({ ...p, s2: true })]);
    assert.deepEqual(await t.apply({ o: true }, {}), { o: true, s1: true, s2: true });
  });
});

// ── Forwarder ─────────────────────────────────────────────────────────────────

describe('Forwarder', () => {
  let targetServer, targetPort, requestLog;

  before(() => new Promise(resolve => {
    requestLog = [];
    targetServer = http.createServer((req, res) => {
      let buf = '';
      req.on('data', c => { buf += c; });
      req.on('end', () => {
        requestLog.push({ method: req.method, url: req.url, headers: req.headers, body: buf });
        if (req.url === '/fail') { res.writeHead(500); res.end('Error'); }
        else if (req.url === '/bad') { res.writeHead(400); res.end('Bad'); }
        else { res.writeHead(200); res.end('OK'); }
      });
    });
    targetServer.listen(0, '127.0.0.1', () => { targetPort = targetServer.address().port; resolve(); });
  }));

  after(() => new Promise(r => targetServer.close(r)));
  beforeEach(() => { requestLog = []; });

  it('should forward a request and return success', async () => {
    const r = await new Forwarder({ maxRetries: 0 }).send('http://127.0.0.1:' + targetPort + '/hook', { body: { event: 'test' } });
    assert.equal(r.success, true);
    assert.equal(r.statusCode, 200);
    assert.equal(r.attempts, 1);
    assert.equal(requestLog.length, 1);
  });

  it('should not retry 4xx responses', async () => {
    const r = await new Forwarder({ maxRetries: 3, initialDelay: 10 }).send('http://127.0.0.1:' + targetPort + '/bad', { body: {} });
    assert.equal(r.success, false);
    assert.equal(r.statusCode, 400);
    assert.equal(r.attempts, 1);
  });

  it('should retry 5xx up to maxRetries times', async () => {
    const r = await new Forwarder({ maxRetries: 2, initialDelay: 10, maxDelay: 50 }).send('http://127.0.0.1:' + targetPort + '/fail', { body: {} });
    assert.equal(r.success, false);
    assert.equal(r.attempts, 3);
    assert.equal(requestLog.length, 3);
  });

  it('should return failure on connection error', async () => {
    const r = await new Forwarder({ maxRetries: 0, timeout: 200 }).send('http://127.0.0.1:1/', { body: {} });
    assert.equal(r.success, false);
    assert.ok(r.error);
  });

  it('should set application/json as default content-type', async () => {
    await new Forwarder({ maxRetries: 0 }).send('http://127.0.0.1:' + targetPort + '/', { body: {} });
    assert.equal(requestLog[0].headers['content-type'], 'application/json');
  });

  it('should pass through custom headers', async () => {
    await new Forwarder({ maxRetries: 0 }).send('http://127.0.0.1:' + targetPort + '/', { headers: { 'x-custom': 'val' }, body: {} });
    assert.equal(requestLog[0].headers['x-custom'], 'val');
  });
});

// ── createWebhookServer ───────────────────────────────────────────────────────

describe('createWebhookServer', () => {
  let server, port, received;

  before(() => new Promise(resolve => {
    received = [];
    server = createWebhookServer(async (req, body, id) => {
      received.push({ body, id, method: req.method, url: req.url });
      return { accepted: true, id };
    });
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  }));

  after(() => new Promise(r => server.close(r)));
  beforeEach(() => { received = []; });

  it('should respond 200 to GET /health with status ok', async () => {
    const r = await httpRequest('GET', 'http://127.0.0.1:' + port + '/health');
    assert.equal(r.statusCode, 200);
    assert.equal(JSON.parse(r.body).status, 'ok');
  });

  it('should reject non-POST requests with 405', async () => {
    const r = await httpRequest('GET', 'http://127.0.0.1:' + port + '/webhook');
    assert.equal(r.statusCode, 405);
  });

  it('should accept a JSON POST and return 202 with webhookId', async () => {
    const r = await httpRequest('POST', 'http://127.0.0.1:' + port + '/', '{"event":"push"}', { 'content-type': 'application/json' });
    assert.equal(r.statusCode, 202);
    const b = JSON.parse(r.body);
    assert.equal(b.accepted, true);
    assert.ok(b.webhookId.startsWith('wb_'));
    await new Promise(r => setTimeout(r, 50));
    assert.equal(received.length, 1);
    assert.deepEqual(received[0].body, { event: 'push' });
  });

  it('should parse application/x-www-form-urlencoded bodies', async () => {
    await httpRequest('POST', 'http://127.0.0.1:' + port + '/', 'name=idir&action=test', { 'content-type': 'application/x-www-form-urlencoded' });
    await new Promise(r => setTimeout(r, 50));
    assert.equal(received[0].body.name, 'idir');
  });

  it('should reject malformed JSON with 400', async () => {
    const r = await httpRequest('POST', 'http://127.0.0.1:' + port + '/', '{ bad }', { 'content-type': 'application/json' });
    assert.equal(r.statusCode, 400);
  });

  it('should include X-Webhook-Id response header', async () => {
    const r = await httpRequest('POST', 'http://127.0.0.1:' + port + '/', '{}', { 'content-type': 'application/json' });
    assert.ok(r.headers['x-webhook-id'].startsWith('wb_'));
  });
});

// ── generateId ────────────────────────────────────────────────────────────────

describe('generateId', () => {
  it('should produce wb_ followed by 12 hex characters', () => {
    assert.ok(/^wb_[0-9a-f]{12}$/.test(generateId()));
  });

  it('should produce unique IDs across 1000 calls', () => {
    const s = new Set();
    for (let i = 0; i < 1000; i++) s.add(generateId());
    assert.equal(s.size, 1000);
  });
});

// ── WebhookBridge ─────────────────────────────────────────────────────────────

describe('WebhookBridge', () => {
  it('should construct with default port 9000', () => {
    const b = new WebhookBridge();
    assert.equal(b.port, 9000);
    assert.equal(b.getStats().received, 0);
  });

  it('should accept port 0 and start on a random OS-assigned port', async () => {
    const b = new WebhookBridge({ port: 0 });
    await new Promise(r => b.start(r));
    assert.ok(b.getServer().address().port > 0);
    await new Promise(r => b.stop(r));
    assert.equal(b.getServer(), null);
  });

  it('should receive a webhook and increment received and stored counts', async () => {
    const b = new WebhookBridge({ port: 0 });
    await new Promise(r => b.start(r));
    const p = b.getServer().address().port;
    await httpRequest('POST', 'http://127.0.0.1:' + p + '/', '{"event":"test"}', { 'content-type': 'application/json' });
    await new Promise(r => setTimeout(r, 100));
    assert.equal(b.getStats().received, 1);
    assert.equal(b.getStats().stored, 1);
    await new Promise(r => b.stop(r));
  });

  it('should filter webhooks that do not match the header filter', async () => {
    const b = new WebhookBridge({ port: 0, filter: { header: 'x-type', value: 'push' } });
    await new Promise(r => b.start(r));
    const p = b.getServer().address().port;
    await httpRequest('POST', 'http://127.0.0.1:' + p + '/', '{"data":1}', { 'content-type': 'application/json' });
    await new Promise(r => setTimeout(r, 100));
    assert.equal(b.getStats().filtered, 1);
    assert.equal(b.getStats().stored, 0);
    await new Promise(r => b.stop(r));
  });

  it('should pass webhooks that match the header filter', async () => {
    const b = new WebhookBridge({ port: 0, filter: { header: 'x-type', value: 'push' } });
    await new Promise(r => b.start(r));
    const p = b.getServer().address().port;
    await httpRequest('POST', 'http://127.0.0.1:' + p + '/', '{"data":1}', { 'content-type': 'application/json', 'x-type': 'push' });
    await new Promise(r => setTimeout(r, 100));
    assert.equal(b.getStats().filtered, 0);
    assert.equal(b.getStats().stored, 1);
    await new Promise(r => b.stop(r));
  });
});