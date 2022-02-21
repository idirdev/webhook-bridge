import axios, { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import {
  WebhookConfig,
  TargetConfig,
  ForwardResult,
  TransformRule,
} from '../types/index';
import { deliveryLogStore } from '../models/DeliveryLog';
import { transformPayload } from './transformer';
import { generateSignature } from './validator';
import { retryWithBackoff } from '../utils/retry';

/**
 * Forward a webhook payload to all configured targets.
 * Applies transform rules, adds forwarding headers, and logs all delivery attempts.
 *
 * @param webhook - The webhook configuration
 * @param payload - The raw incoming payload
 * @param originalHeaders - Headers from the original request
 * @returns Array of results, one per target
 */
export async function forwardWebhook(
  webhook: WebhookConfig,
  payload: Record<string, unknown>,
  originalHeaders: Record<string, string>
): Promise<ForwardResult[]> {
  const results: ForwardResult[] = [];
  const activeTargets = webhook.targets.filter((t) => t.active);

  if (activeTargets.length === 0) {
    return results;
  }

  // Apply transform rules if any
  let transformedPayload = payload;
  if (webhook.transformRules && webhook.transformRules.length > 0) {
    transformedPayload = transformPayload(payload, webhook.transformRules);

    // If transformer returned empty object, it means the payload was filtered out
    if (Object.keys(transformedPayload).length === 0) {
      return results;
    }
  }

  // Forward to each target in parallel
  const forwardPromises = activeTargets.map((target) =>
    forwardToTarget(webhook, target, transformedPayload, originalHeaders)
  );

  const settledResults = await Promise.allSettled(forwardPromises);

  for (const settled of settledResults) {
    if (settled.status === 'fulfilled') {
      results.push(settled.value);
    } else {
      results.push({
        targetUrl: 'unknown',
        success: false,
        statusCode: 0,
        error: settled.reason?.message || 'Unknown error',
        attempts: 0,
        duration: 0,
      });
    }
  }

  return results;
}

/**
 * Forward to a single target with retry logic.
 */
async function forwardToTarget(
  webhook: WebhookConfig,
  target: TargetConfig,
  payload: Record<string, unknown>,
  originalHeaders: Record<string, string>
): Promise<ForwardResult> {
  const deliveryId = uuidv4();
  const serializedPayload = JSON.stringify(payload);
  const startTime = Date.now();

  // Build forwarding headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Bridge-Delivery': deliveryId,
    'X-Webhook-Bridge-Source': webhook.source,
    'X-Webhook-Bridge-Webhook-Id': webhook.id,
    'User-Agent': 'WebhookBridge/1.0',
    ...target.headers,
  };

  // Generate signature for the forwarded payload if webhook has a secret
  if (webhook.secret) {
    headers['X-Webhook-Bridge-Signature'] = generateSignature(
      serializedPayload,
      webhook.secret
    );
  }

  // Forward original relevant headers
  const passthroughHeaders = [
    'x-request-id',
    'x-correlation-id',
    'x-trace-id',
  ];
  for (const headerName of passthroughHeaders) {
    if (originalHeaders[headerName]) {
      headers[headerName] = originalHeaders[headerName];
    }
  }

  const retryResult = await retryWithBackoff(
    async () => {
      const response = await axios({
        method: target.method || 'POST',
        url: target.url,
        data: payload,
        headers,
        timeout: target.timeout || 10000,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      return {
        statusCode: response.status,
        responseBody: truncateResponse(response.data),
      };
    },
    {
      maxRetries: target.maxRetries,
      initialDelay: 1000,
      maxDelay: 30000,
      jitter: true,
      onRetry: (attempt, error, nextDelay) => {
        const axiosError = error as AxiosError;
        const statusCode = axiosError.response?.status || 0;

        // Log each retry attempt
        deliveryLogStore.add({
          webhookId: webhook.id,
          targetUrl: target.url,
          statusCode,
          success: false,
          error: error.message,
          attempt,
          duration: Date.now() - startTime,
          requestPayload: payload,
        });

        console.log(
          `[WebhookBridge] Retry ${attempt}/${target.maxRetries} for ${target.url} ` +
          `(status=${statusCode}, next delay=${nextDelay}ms)`
        );
      },
    }
  );

  const totalDuration = Date.now() - startTime;

  if (retryResult.success && retryResult.result) {
    // Log successful delivery
    deliveryLogStore.add({
      webhookId: webhook.id,
      targetUrl: target.url,
      statusCode: retryResult.result.statusCode,
      success: true,
      responseBody: retryResult.result.responseBody,
      attempt: retryResult.attempts,
      duration: totalDuration,
      requestPayload: payload,
    });

    return {
      targetUrl: target.url,
      success: true,
      statusCode: retryResult.result.statusCode,
      responseBody: retryResult.result.responseBody,
      attempts: retryResult.attempts,
      duration: totalDuration,
    };
  }

  // Log final failure
  deliveryLogStore.add({
    webhookId: webhook.id,
    targetUrl: target.url,
    statusCode: 0,
    success: false,
    error: retryResult.error?.message,
    attempt: retryResult.attempts,
    duration: totalDuration,
    requestPayload: payload,
  });

  return {
    targetUrl: target.url,
    success: false,
    statusCode: 0,
    error: retryResult.error?.message || 'All retry attempts failed',
    attempts: retryResult.attempts,
    duration: totalDuration,
  };
}

/**
 * Truncate response body for logging purposes.
 */
function truncateResponse(data: unknown): string {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  if (str && str.length > 1000) {
    return str.substring(0, 1000) + '... [truncated]';
  }
  return str || '';
}
