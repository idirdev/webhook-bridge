'use strict';

/**
 * @module webhook-bridge
 * @description Receive, store, transform, and forward webhooks.
 * @author idirdev
 */

const { createWebhookServer, generateId } = require('./server');
const { Forwarder }      = require('./forwarder');
const { Transformer }    = require('./transformer');
const { WebhookStorage } = require('./storage');

/**
 * Full-featured webhook bridge: filter, transform, persist, and forward.
 */
class WebhookBridge {
  /**
   * @param {object}   [config={}]
   * @param {number}   [config.port=9000]
   * @param {string}   [config.forwardUrl]
   * @param {function} [config.transformFn]
   * @param {string}   [config.logFile]
   * @param {object}   [config.filter]
   * @param {string}   [config.filter.header]
   * @param {string}   [config.filter.value]
   * @param {number}   [config.maxEntries=5000]
   * @param {object}   [config.forwarderOptions={}]
   */
  constructor(config) {
    config = config || {};
    this.port        = config.port != null ? config.port : 9000;
    this.forwardUrl  = config.forwardUrl  || null;
    this.transformFn = config.transformFn || null;
    this.logFile     = config.logFile     || null;
    this.filter      = config.filter      || null;
    this.storage     = new WebhookStorage(this.logFile, { maxEntries: config.maxEntries || 5000 });
    this.forwarder   = new Forwarder(config.forwarderOptions || {});
    this.transformer = new Transformer(this.transformFn);
    this._server     = null;
    this._stats      = { received: 0, forwarded: 0, filtered: 0, errors: 0, startedAt: null };
  }

  /**
   * Start the HTTP server.
   * @param {function} [callback]
   */
  start(callback) {
    this._stats.startedAt = new Date().toISOString();
    this._server = createWebhookServer(
      (req, body, webhookId) => this._handleWebhook(req, body, webhookId),
      { statsProvider: () => this.getStats() }
    );
    this._server.listen(this.port, '0.0.0.0', () => { if (callback) callback(); });
    this._server.on('error', (err) => {
      this._stats.errors++;
      console.error('[webhook-bridge] Server error: ' + err.message);
    });
  }

  /**
   * Stop the HTTP server and close storage.
   * @param {function} [callback]
   */
  stop(callback) {
    if (this._server) {
      this.storage.close();
      this._server.close(() => { this._server = null; if (callback) callback(); });
    } else {
      if (callback) callback();
    }
  }

  /** @returns {{ received, forwarded, filtered, errors, stored, startedAt }} */
  getStats() { return { ...this._stats, stored: this.storage.count() }; }

  /** @returns {http.Server|null} */
  getServer() { return this._server; }

  async _handleWebhook(req, body, webhookId) {
    this._stats.received++;
    const headers = req.headers;
    const method  = req.method;
    const urlPath = req.url;

    if (this.filter) {
      const headerVal = headers[this.filter.header];
      if (!headerVal || headerVal !== this.filter.value) {
        this._stats.filtered++;
        return { accepted: false, webhookId, reason: 'filtered' };
      }
    }

    this.storage.store({ id: webhookId, timestamp: new Date().toISOString(), method, path: urlPath, headers, body });

    let payload = body;
    if (this.transformFn) {
      try { payload = await this.transformer.apply(body, headers); }
      catch (err) {
        this._stats.errors++;
        console.error('[webhook-bridge] Transform error [' + webhookId + ']: ' + err.message);
        return { accepted: true, webhookId, forwarded: false, error: 'transform_error' };
      }
    }

    if (this.forwardUrl) {
      try {
        const result = await this.forwarder.send(this.forwardUrl, {
          method,
          headers: {
            'content-type'        : headers['content-type'] || 'application/json',
            'user-agent'          : 'webhook-bridge/1.4.0',
            'x-webhook-bridge-id' : webhookId,
          },
          body: payload,
        });
        if (result.success) this._stats.forwarded++;
        else this._stats.errors++;
        return { accepted: true, webhookId, forwarded: result.success, statusCode: result.statusCode };
      } catch (err) {
        this._stats.errors++;
        console.error('[webhook-bridge] Forward error [' + webhookId + ']: ' + err.message);
        return { accepted: true, webhookId, forwarded: false, error: 'forward_error' };
      }
    }

    return { accepted: true, webhookId, forwarded: false };
  }
}

module.exports = {
  WebhookBridge,
  Forwarder          : require('./forwarder').Forwarder,
  Transformer        : require('./transformer').Transformer,
  WebhookStorage     : require('./storage').WebhookStorage,
  createWebhookServer: require('./server').createWebhookServer,
  generateId         : require('./server').generateId,
};