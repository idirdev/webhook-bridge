/**
 * Configuration for a registered webhook endpoint.
 */
export interface WebhookConfig {
  /** Unique identifier for this webhook. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Source identifier (e.g., 'github', 'stripe', 'custom'). */
  source: string;
  /** Target URLs to forward the webhook payload to. */
  targets: TargetConfig[];
  /** Secret key for HMAC signature verification. */
  secret?: string;
  /** Signature header name (e.g., 'X-Hub-Signature-256'). */
  signatureHeader?: string;
  /** Transform rules to apply before forwarding. */
  transformRules?: TransformRule[];
  /** Whether this webhook is active. */
  active: boolean;
  /** Creation timestamp. */
  createdAt: Date;
  /** Last modified timestamp. */
  updatedAt: Date;
}

/**
 * Configuration for a forwarding target.
 */
export interface TargetConfig {
  /** Target URL to forward to. */
  url: string;
  /** HTTP method to use (default: POST). */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  /** Additional headers to send with the forwarded request. */
  headers?: Record<string, string>;
  /** Maximum number of retry attempts. */
  maxRetries: number;
  /** Timeout in milliseconds. */
  timeout: number;
  /** Whether this target is active. */
  active: boolean;
}

/**
 * A rule for transforming webhook payloads.
 */
export interface TransformRule {
  /** Type of transformation. */
  type: 'rename' | 'remove' | 'add' | 'map' | 'filter';
  /** Source field path (dot notation). */
  sourcePath?: string;
  /** Destination field path (dot notation). */
  destPath?: string;
  /** Static value to add. */
  value?: unknown;
  /** Condition for filter operations. */
  condition?: FilterCondition;
}

/**
 * Condition for filtering webhook payloads.
 */
export interface FilterCondition {
  /** Field path to evaluate. */
  field: string;
  /** Comparison operator. */
  operator: 'eq' | 'neq' | 'contains' | 'exists' | 'gt' | 'lt';
  /** Value to compare against. */
  value?: unknown;
}

/**
 * Log entry for a webhook delivery attempt.
 */
export interface DeliveryLogEntry {
  /** Unique delivery ID. */
  id: string;
  /** Webhook config ID. */
  webhookId: string;
  /** Target URL that was called. */
  targetUrl: string;
  /** HTTP status code of the response (0 if failed to connect). */
  statusCode: number;
  /** Whether the delivery was successful. */
  success: boolean;
  /** Response body (truncated). */
  responseBody?: string;
  /** Error message if delivery failed. */
  error?: string;
  /** Attempt number (1-based). */
  attempt: number;
  /** Duration of the request in milliseconds. */
  duration: number;
  /** Timestamp of the delivery attempt. */
  timestamp: Date;
  /** Request payload that was sent. */
  requestPayload?: unknown;
}

/**
 * Request to register a new webhook.
 */
export interface RegisterWebhookRequest {
  name: string;
  source: string;
  targets: Omit<TargetConfig, 'active'>[];
  secret?: string;
  signatureHeader?: string;
  transformRules?: TransformRule[];
}

/**
 * Forwarding result for a single target.
 */
export interface ForwardResult {
  targetUrl: string;
  success: boolean;
  statusCode: number;
  responseBody?: string;
  error?: string;
  attempts: number;
  duration: number;
}
