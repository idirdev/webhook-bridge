'use strict';

/**
 * @module forwarder
 * @description HTTP forwarder with exponential-backoff retry logic.
 * @author idirdev
 */

const http  = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Sends webhook payloads to a target URL with configurable retry behaviour.
 * 4xx responses (except 429) are not retried. 5xx and network errors are.
 */
class Forwarder {
  /**
   * @param {object} [opts={}]
   * @param {number} [opts.maxRetries=3]
   * @param {number} [opts.initialDelay=500]
   * @param {number} [opts.maxDelay=30000]
   * @param {number} [opts.backoffFactor=2]
   * @param {number} [opts.timeout=15000]
   */
  constructor(opts) {
    opts = opts || {};
    this.maxRetries    = opts.maxRetries    != null ? opts.maxRetries    : 3;
    this.initialDelay  = opts.initialDelay  != null ? opts.initialDelay  : 500;
    this.maxDelay      = opts.maxDelay      != null ? opts.maxDelay      : 30000;
    this.backoffFactor = opts.backoffFactor != null ? opts.backoffFactor : 2;
    this.timeout       = opts.timeout       != null ? opts.timeout       : 15000;
  }

  /**
   * Send a payload to a URL, retrying on transient failures.
   * @param {string} url
   * @param {object} [opts={}]
   * @param {string} [opts.method='POST']
   * @param {object} [opts.headers={}]
   * @param {*}      [opts.body]
   * @returns {Promise<{ success: boolean, statusCode: number|null, attempts: number, error: string|null, responseBody: string }>}
   */
  async send(url, opts) {
    opts = opts || {};
    const method  = (opts.method || 'POST').toUpperCase();
    const headers = Object.assign({}, opts.headers);
    const body    = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body != null ? opts.body : '');
    if (!headers['content-type']) headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(body, 'utf-8'));

    let lastError      = null;
    let lastStatusCode = null;
    const totalAttempts = 1 + this.maxRetries;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      try {
        const result = await this._request(url, method, headers, body);
        lastStatusCode = result.statusCode;
        if (result.statusCode >= 200 && result.statusCode < 300) {
          return { success: true, statusCode: result.statusCode, attempts: attempt, error: null, responseBody: result.body };
        }
        if (result.statusCode >= 400 && result.statusCode < 500 && result.statusCode !== 429) {
          return { success: false, statusCode: result.statusCode, attempts: attempt, error: 'HTTP ' + result.statusCode, responseBody: result.body };
        }
        lastError = 'HTTP ' + result.statusCode;
      } catch (err) {
        lastError = err.message;
      }
      if (attempt < totalAttempts) await new Promise(r => setTimeout(r, this._delay(attempt)));
    }
    return { success: false, statusCode: lastStatusCode, attempts: totalAttempts, error: lastError };
  }

  _request(url, method, headers, body) {
    return new Promise((resolve, reject) => {
      const parsed    = new URL(url);
      const transport = parsed.protocol === 'https:' ? https : http;
      const reqOpts   = {
        hostname: parsed.hostname,
        port    : parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path    : parsed.pathname + parsed.search,
        method, headers, timeout: this.timeout,
      };
      const req = transport.request(reqOpts, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
      });
      req.on('timeout', () => req.destroy(new Error('Request timed out after ' + this.timeout + 'ms')));
      req.on('error', err => reject(err));
      req.write(body);
      req.end();
    });
  }

  _delay(attempt) {
    const base   = this.initialDelay * Math.pow(this.backoffFactor, attempt - 1);
    const capped = Math.min(base, this.maxDelay);
    return Math.round(capped * (0.75 + Math.random() * 0.5));
  }
}

module.exports = { Forwarder };