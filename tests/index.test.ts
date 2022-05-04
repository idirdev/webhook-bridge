import { describe, it, expect } from 'vitest';
import {
  transformPayload,
  getNestedValue,
  setNestedValue,
  deleteNestedValue,
} from '../src/services/transformer';
import {
  verifySignature,
  generateSignature,
  isValidSignatureFormat,
  parseSignatureHeader,
} from '../src/services/validator';
import { calculateDelay, getBackoffSchedule } from '../src/utils/retry';
import type { TransformRule } from '../src/types/index';

describe('getNestedValue', () => {
  it('gets a top-level value', () => {
    expect(getNestedValue({ name: 'Alice' }, 'name')).toBe('Alice');
  });

  it('gets a nested value', () => {
    const obj = { a: { b: { c: 42 } } };
    expect(getNestedValue(obj, 'a.b.c')).toBe(42);
  });

  it('returns undefined for missing path', () => {
    expect(getNestedValue({ a: 1 }, 'b')).toBeUndefined();
  });

  it('returns undefined for deep missing path', () => {
    expect(getNestedValue({ a: { b: 1 } }, 'a.c.d')).toBeUndefined();
  });
});

describe('setNestedValue', () => {
  it('sets a top-level value', () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, 'name', 'Alice');
    expect(obj.name).toBe('Alice');
  });

  it('sets a nested value, creating intermediate objects', () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, 'a.b.c', 42);
    expect(getNestedValue(obj, 'a.b.c')).toBe(42);
  });
});

describe('deleteNestedValue', () => {
  it('deletes a top-level value', () => {
    const obj: Record<string, unknown> = { name: 'Alice', age: 30 };
    deleteNestedValue(obj, 'age');
    expect(obj.age).toBeUndefined();
    expect(obj.name).toBe('Alice');
  });

  it('deletes a nested value', () => {
    const obj: Record<string, unknown> = { a: { b: { c: 1, d: 2 } } };
    deleteNestedValue(obj, 'a.b.c');
    expect(getNestedValue(obj, 'a.b.c')).toBeUndefined();
    expect(getNestedValue(obj, 'a.b.d')).toBe(2);
  });
});

describe('transformPayload', () => {
  it('renames a field', () => {
    const rules: TransformRule[] = [
      { type: 'rename', sourcePath: 'old_name', destPath: 'new_name' },
    ];
    const result = transformPayload({ old_name: 'value' }, rules);
    expect(result.new_name).toBe('value');
    expect(result.old_name).toBeUndefined();
  });

  it('removes a field', () => {
    const rules: TransformRule[] = [
      { type: 'remove', sourcePath: 'secret' },
    ];
    const result = transformPayload({ secret: '123', keep: 'yes' }, rules);
    expect(result.secret).toBeUndefined();
    expect(result.keep).toBe('yes');
  });

  it('adds a static field', () => {
    const rules: TransformRule[] = [
      { type: 'add', destPath: 'version', value: '2.0' },
    ];
    const result = transformPayload({ data: 'test' }, rules);
    expect(result.version).toBe('2.0');
    expect(result.data).toBe('test');
  });

  it('maps a field from source to destination', () => {
    const rules: TransformRule[] = [
      { type: 'map', sourcePath: 'user.name', destPath: 'author' },
    ];
    const result = transformPayload({ user: { name: 'Alice' } }, rules);
    expect(result.author).toBe('Alice');
    expect(getNestedValue(result, 'user.name')).toBe('Alice');
  });

  it('filters payload (passes)', () => {
    const rules: TransformRule[] = [
      { type: 'filter', condition: { field: 'type', operator: 'eq', value: 'push' } },
    ];
    const result = transformPayload({ type: 'push', data: 'abc' }, rules);
    expect(result.data).toBe('abc');
  });

  it('filters payload (drops)', () => {
    const rules: TransformRule[] = [
      { type: 'filter', condition: { field: 'type', operator: 'eq', value: 'push' } },
    ];
    const result = transformPayload({ type: 'pull', data: 'abc' }, rules);
    expect(Object.keys(result).length).toBe(0);
  });

  it('does not mutate the original payload', () => {
    const original = { name: 'test', secret: '123' };
    const rules: TransformRule[] = [{ type: 'remove', sourcePath: 'secret' }];
    transformPayload(original, rules);
    expect(original.secret).toBe('123');
  });

  it('applies multiple rules sequentially', () => {
    const rules: TransformRule[] = [
      { type: 'rename', sourcePath: 'a', destPath: 'b' },
      { type: 'add', destPath: 'c', value: 'new' },
    ];
    const result = transformPayload({ a: 1 }, rules);
    expect(result.b).toBe(1);
    expect(result.c).toBe('new');
    expect(result.a).toBeUndefined();
  });
});

describe('generateSignature', () => {
  it('generates an HMAC SHA256 signature', () => {
    const sig = generateSignature('test payload', 'secret');
    expect(sig).toMatch(/^sha256=[0-9a-f]+$/);
  });

  it('generates consistent signatures for the same input', () => {
    const sig1 = generateSignature('test', 'key');
    const sig2 = generateSignature('test', 'key');
    expect(sig1).toBe(sig2);
  });

  it('generates different signatures for different inputs', () => {
    const sig1 = generateSignature('payload1', 'key');
    const sig2 = generateSignature('payload2', 'key');
    expect(sig1).not.toBe(sig2);
  });
});

describe('verifySignature', () => {
  it('verifies a valid signature', () => {
    const payload = '{"event":"push"}';
    const secret = 'my-secret';
    const sig = generateSignature(payload, secret);
    expect(verifySignature(payload, sig, secret)).toBe(true);
  });

  it('rejects an invalid signature', () => {
    expect(verifySignature('payload', 'sha256=invalid', 'secret')).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(verifySignature('', 'sig', 'secret')).toBe(false);
    expect(verifySignature('payload', '', 'secret')).toBe(false);
    expect(verifySignature('payload', 'sig', '')).toBe(false);
  });
});

describe('isValidSignatureFormat', () => {
  it('validates hex signature', () => {
    expect(isValidSignatureFormat('abc123def456')).toBe(true);
  });

  it('validates prefixed signature', () => {
    expect(isValidSignatureFormat('sha256=abc123')).toBe(true);
    expect(isValidSignatureFormat('sha1=abc123')).toBe(true);
  });

  it('rejects invalid format', () => {
    expect(isValidSignatureFormat('not a valid sig!')).toBe(false);
  });
});

describe('parseSignatureHeader', () => {
  it('parses standard sha256 header', () => {
    const result = parseSignatureHeader('sha256=abc123');
    expect(result.algorithm).toBe('sha256');
    expect(result.signature).toBe('abc123');
  });

  it('parses Stripe-style header', () => {
    const result = parseSignatureHeader('t=12345,v1=abc123');
    expect(result.timestamp).toBe('12345');
    expect(result.signature).toBe('abc123');
  });

  it('parses plain hex digest', () => {
    const result = parseSignatureHeader('abc123def');
    expect(result.signature).toBe('abc123def');
    expect(result.algorithm).toBeUndefined();
  });
});

describe('calculateDelay', () => {
  it('calculates exponential delay', () => {
    const d1 = calculateDelay(1, { initialDelay: 1000, backoffFactor: 2 });
    const d2 = calculateDelay(2, { initialDelay: 1000, backoffFactor: 2 });
    expect(d1).toBe(1000);
    expect(d2).toBe(2000);
  });

  it('caps at maxDelay', () => {
    const delay = calculateDelay(10, { initialDelay: 1000, backoffFactor: 2, maxDelay: 5000 });
    expect(delay).toBe(5000);
  });
});

describe('getBackoffSchedule', () => {
  it('returns schedule with correct number of entries', () => {
    const schedule = getBackoffSchedule({ maxRetries: 5 });
    expect(schedule.length).toBe(5);
  });

  it('returns increasing delays', () => {
    const schedule = getBackoffSchedule({ maxRetries: 4, initialDelay: 100, backoffFactor: 2, maxDelay: 100000 });
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i]).toBeGreaterThanOrEqual(schedule[i - 1]);
    }
  });
});
