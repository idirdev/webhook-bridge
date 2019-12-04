'use strict';

/**
 * @module transformer
 * @description Payload transformation utilities for webhook-bridge.
 * @author idirdev
 */

/**
 * Wraps a user-supplied transform function and provides static helpers
 * for common transformation patterns.
 */
class Transformer {
  /**
   * @param {function|null} fn - (payload, headers) => newPayload. May be async.
   */
  constructor(fn) {
    this._fn = typeof fn === 'function' ? fn : null;
  }

  /**
   * Apply the transform to a payload.
   * @param {*} payload
   * @param {object} headers
   * @returns {Promise<*>}
   */
  async apply(payload, headers) {
    if (!this._fn) return payload;
    return this._fn(payload, headers);
  }

  /** @returns {boolean} */
  hasTransform() { return this._fn !== null; }

  // ── Static helpers ──────────────────────────────────────────────────────

  /**
   * Build a new object by mapping fields from source.
   * @param {object} source
   * @param {Array<{ from: string, to: string, default?: * }>} mappings
   * @returns {object}
   */
  static mapFields(source, mappings) {
    if (!Array.isArray(mappings)) return { ...source };
    const result = {};
    for (const m of mappings) {
      const value = Transformer._resolve(source, m.from);
      const final = value !== undefined ? value : m.default;
      if (final !== undefined) Transformer._setNested(result, m.to, final);
    }
    return result;
  }

  /**
   * Replace {{dot.path}} placeholders in a string.
   * @param {string} template
   * @param {object} data
   * @returns {string}
   */
  static interpolate(template, data) {
    if (typeof template !== 'string') return template;
    return template.replace(/\{\{([\w.]+)\}\}/g, (match, dotPath) => {
      const value = Transformer._resolve(data, dotPath);
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Recursively interpolate all string values inside an object or array.
   * @param {*} obj
   * @param {object} data
   * @returns {*}
   */
  static interpolateDeep(obj, data) {
    if (typeof obj === 'string') return Transformer.interpolate(obj, data);
    if (Array.isArray(obj)) return obj.map(item => Transformer.interpolateDeep(item, data));
    if (obj !== null && typeof obj === 'object') {
      const result = {};
      for (const [key, val] of Object.entries(obj)) result[key] = Transformer.interpolateDeep(val, data);
      return result;
    }
    return obj;
  }

  /**
   * Create a Transformer that pipes payload through a series of functions.
   * @param {Array<function>} fns
   * @returns {Transformer}
   */
  static chain(fns) {
    const combined = async (payload, headers) => {
      let result = payload;
      for (const fn of fns) result = await fn(result, headers);
      return result;
    };
    return new Transformer(combined);
  }

  static _resolve(obj, dotPath) {
    if (!obj || typeof dotPath !== 'string') return undefined;
    let current = obj;
    for (const part of dotPath.split('.')) {
      if (current == null || typeof current !== 'object') return undefined;
      current = current[part];
    }
    return current;
  }

  static _setNested(obj, dotPath, value) {
    const parts = dotPath.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) current[key] = {};
      current = current[key];
    }
    current[parts[parts.length - 1]] = value;
  }
}

module.exports = { Transformer };