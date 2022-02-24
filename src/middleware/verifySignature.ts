import { Request, Response, NextFunction } from 'express';
import { webhookStore } from '../models/Webhook';
import { verifySignature, isValidSignatureFormat } from '../services/validator';

/**
 * Express middleware to verify webhook signatures.
 *
 * This middleware checks the HMAC signature of incoming webhook requests
 * against the configured secret for the webhook endpoint. If the webhook
 * has no secret configured, the request is allowed through without verification.
 *
 * The raw request body must be available on req.body as a string or Buffer
 * for signature verification. Use express.raw() or a custom body parser
 * that preserves the raw body.
 */
export function createSignatureVerifier() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const webhookId = req.params.id;

    if (!webhookId) {
      res.status(400).json({
        error: 'Missing webhook ID',
        message: 'Webhook ID is required in the URL path',
      });
      return;
    }

    // Look up the webhook configuration
    const webhook = webhookStore.getById(webhookId);
    if (!webhook) {
      res.status(404).json({
        error: 'Webhook not found',
        message: `No webhook registered with ID: ${webhookId}`,
      });
      return;
    }

    // Check if the webhook is active
    if (!webhook.active) {
      res.status(403).json({
        error: 'Webhook inactive',
        message: 'This webhook endpoint is currently disabled',
      });
      return;
    }

    // If no secret is configured, skip signature verification
    if (!webhook.secret) {
      // Attach webhook config to request for downstream use
      (req as any).webhook = webhook;
      next();
      return;
    }

    // Get the signature from the configured header
    const signatureHeader = webhook.signatureHeader || 'X-Webhook-Signature';
    const signature = req.headers[signatureHeader.toLowerCase()] as string;

    if (!signature) {
      res.status(401).json({
        error: 'Missing signature',
        message: `Expected signature in header: ${signatureHeader}`,
      });
      return;
    }

    // Validate signature format
    if (!isValidSignatureFormat(signature)) {
      res.status(401).json({
        error: 'Invalid signature format',
        message: 'The signature does not match the expected format',
      });
      return;
    }

    // Get the raw request body for signature verification
    const rawBody = getRawBody(req);
    if (!rawBody) {
      res.status(400).json({
        error: 'Missing request body',
        message: 'Request body is required for signature verification',
      });
      return;
    }

    // Verify the signature
    const isValid = verifySignature(rawBody, signature, webhook.secret);

    if (!isValid) {
      console.warn(
        `[WebhookBridge] Signature verification failed for webhook ${webhookId} ` +
        `from ${req.ip}`
      );
      res.status(401).json({
        error: 'Invalid signature',
        message: 'The request signature does not match. Check your webhook secret.',
      });
      return;
    }

    // Signature verified -- attach webhook config and continue
    (req as any).webhook = webhook;
    next();
  };
}

/**
 * Extract the raw body from the request.
 * Supports both string and Buffer bodies.
 */
function getRawBody(req: Request): string | undefined {
  // Check for raw body stored by body-parser
  if ((req as any).rawBody) {
    return (req as any).rawBody.toString();
  }

  // If body is a string, use it directly
  if (typeof req.body === 'string') {
    return req.body;
  }

  // If body is an object (parsed JSON), stringify it
  if (req.body && typeof req.body === 'object') {
    return JSON.stringify(req.body);
  }

  return undefined;
}
