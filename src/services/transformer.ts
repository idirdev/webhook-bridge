import { TransformRule, FilterCondition } from '../types/index';

/**
 * Webhook payload transformer.
 * Applies JSONPath-like transformation rules to modify webhook payloads
 * before forwarding them to target endpoints.
 */

/**
 * Apply a list of transform rules to a payload object.
 * Rules are applied sequentially in order.
 *
 * @param payload - The original webhook payload
 * @param rules - Array of transformation rules to apply
 * @returns The transformed payload (new object, original is not modified)
 */
export function transformPayload(
  payload: Record<string, unknown>,
  rules: TransformRule[]
): Record<string, unknown> {
  // Deep clone the payload to avoid mutation
  let result = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;

  for (const rule of rules) {
    switch (rule.type) {
      case 'rename':
        result = applyRename(result, rule);
        break;
      case 'remove':
        result = applyRemove(result, rule);
        break;
      case 'add':
        result = applyAdd(result, rule);
        break;
      case 'map':
        result = applyMap(result, rule);
        break;
      case 'filter':
        // Filter returns null if the payload should be dropped
        if (!applyFilter(result, rule)) {
          return {}; // Return empty object to signal "do not forward"
        }
        break;
    }
  }

  return result;
}

/**
 * Rename a field from sourcePath to destPath.
 */
function applyRename(
  obj: Record<string, unknown>,
  rule: TransformRule
): Record<string, unknown> {
  if (!rule.sourcePath || !rule.destPath) return obj;

  const value = getNestedValue(obj, rule.sourcePath);
  if (value !== undefined) {
    deleteNestedValue(obj, rule.sourcePath);
    setNestedValue(obj, rule.destPath, value);
  }

  return obj;
}

/**
 * Remove a field at sourcePath.
 */
function applyRemove(
  obj: Record<string, unknown>,
  rule: TransformRule
): Record<string, unknown> {
  if (!rule.sourcePath) return obj;
  deleteNestedValue(obj, rule.sourcePath);
  return obj;
}

/**
 * Add a static value at destPath.
 */
function applyAdd(
  obj: Record<string, unknown>,
  rule: TransformRule
): Record<string, unknown> {
  if (!rule.destPath) return obj;
  setNestedValue(obj, rule.destPath, rule.value);
  return obj;
}

/**
 * Map (copy) a value from sourcePath to destPath.
 */
function applyMap(
  obj: Record<string, unknown>,
  rule: TransformRule
): Record<string, unknown> {
  if (!rule.sourcePath || !rule.destPath) return obj;

  const value = getNestedValue(obj, rule.sourcePath);
  if (value !== undefined) {
    setNestedValue(obj, rule.destPath, value);
  }

  return obj;
}

/**
 * Filter: evaluate a condition against the payload.
 * Returns true if the payload should be forwarded, false if it should be dropped.
 */
function applyFilter(
  obj: Record<string, unknown>,
  rule: TransformRule
): boolean {
  if (!rule.condition) return true;
  return evaluateCondition(obj, rule.condition);
}

/**
 * Evaluate a filter condition against an object.
 */
function evaluateCondition(
  obj: Record<string, unknown>,
  condition: FilterCondition
): boolean {
  const fieldValue = getNestedValue(obj, condition.field);

  switch (condition.operator) {
    case 'eq':
      return fieldValue === condition.value;
    case 'neq':
      return fieldValue !== condition.value;
    case 'contains':
      if (typeof fieldValue === 'string' && typeof condition.value === 'string') {
        return fieldValue.includes(condition.value);
      }
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(condition.value);
      }
      return false;
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null;
    case 'gt':
      return typeof fieldValue === 'number' &&
        typeof condition.value === 'number' &&
        fieldValue > condition.value;
    case 'lt':
      return typeof fieldValue === 'number' &&
        typeof condition.value === 'number' &&
        fieldValue < condition.value;
    default:
      return true;
  }
}

/**
 * Get a nested value from an object using dot notation.
 * e.g., getNestedValue({a: {b: {c: 42}}}, 'a.b.c') => 42
 */
export function getNestedValue(
  obj: Record<string, unknown>,
  path: string
): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Set a nested value in an object using dot notation.
 * Creates intermediate objects as needed.
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (
      current[part] === undefined ||
      current[part] === null ||
      typeof current[part] !== 'object'
    ) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Delete a nested value from an object using dot notation.
 */
export function deleteNestedValue(
  obj: Record<string, unknown>,
  path: string
): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof current[part] !== 'object' || current[part] === null) {
      return;
    }
    current = current[part] as Record<string, unknown>;
  }

  delete current[parts[parts.length - 1]];
}
