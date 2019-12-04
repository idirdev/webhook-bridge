'use strict';

/**
 * @module storage
 * @description In-memory + JSONL-file webhook storage.
 * @author idirdev
 */

const fs   = require('fs');
const path = require('path');

/**
 * Stores webhook entries in memory with optional JSONL file persistence.
 * Oldest entries are evicted when maxEntries is reached.
 */
class WebhookStorage {
  /**
   * @param {string|null} logFile  - Path to a JSONL file for persistence (null = memory only).
   * @param {object}      [opts={}]
   * @param {number}      [opts.maxEntries=5000] - Maximum entries to keep in memory.
   */
  constructor(logFile, opts) {
    opts = opts || {};
    this.logFile    = logFile || null;
    this.maxEntries = opts.maxEntries || 5000;
    this._entries   = new Map();
    this._order     = [];
    this._stream    = null;
    if (this.logFile) { this._restore(); this._openStream(); }
  }

  /**
   * Store a webhook entry.
   * @param {object} entry
   * @param {string} entry.id - Unique webhook ID (required).
   * @throws {Error} If entry.id is missing.
   */
  store(entry) {
    if (!entry || !entry.id) throw new Error('Entry must have an "id" field.');
    if (this._entries.size >= this.maxEntries && !this._entries.has(entry.id)) {
      const oldest = this._order.shift();
      if (oldest) this._entries.delete(oldest);
    }
    this._entries.set(entry.id, entry);
    this._order.push(entry.id);
    if (this._stream) this._stream.write(JSON.stringify(entry) + '\n');
  }

  /** @returns {object|null} */
  get(id) { return this._entries.get(id) || null; }

  /** List IDs newest first. @returns {string[]} */
  listIds() { return [...this._order].reverse(); }

  /** List all entries, newest first. @returns {object[]} */
  listAll() { return this.listIds().map(id => this._entries.get(id)).filter(Boolean); }

  /**
   * Delete an entry by ID.
   * @returns {boolean}
   */
  delete(id) {
    const existed = this._entries.delete(id);
    if (existed) {
      const idx = this._order.indexOf(id);
      if (idx !== -1) this._order.splice(idx, 1);
    }
    return existed;
  }

  clear() { this._entries.clear(); this._order = []; }

  /** @returns {number} */
  count() { return this._entries.size; }

  /**
   * Search entries with a predicate.
   * @param {function(object): boolean} predicate
   * @returns {object[]}
   */
  search(predicate) {
    const results = [];
    for (const entry of this._entries.values()) {
      if (predicate(entry)) results.push(entry);
    }
    return results;
  }

  /** Close the JSONL write stream. */
  close() {
    if (this._stream) { this._stream.end(); this._stream = null; }
  }

  _restore() {
    if (!this.logFile) return;
    try {
      if (!fs.existsSync(this.logFile)) return;
      const content = fs.readFileSync(this.logFile, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry && entry.id) { this._entries.set(entry.id, entry); this._order.push(entry.id); }
        } catch { /* skip malformed lines */ }
      }
      while (this._entries.size > this.maxEntries) {
        const oldest = this._order.shift();
        if (oldest) this._entries.delete(oldest);
      }
    } catch { /* ignore unreadable file */ }
  }

  _openStream() {
    if (!this.logFile) return;
    const dir = path.dirname(this.logFile);
    if (dir && dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this._stream = fs.createWriteStream(this.logFile, { flags: 'a' });
  }
}

module.exports = { WebhookStorage };