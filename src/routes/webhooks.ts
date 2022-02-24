import { Router, Request, Response } from 'express';
import { webhookStore } from '../models/Webhook';
import { deliveryLogStore } from '../models/DeliveryLog';
import { forwardWebhook } from '../services/forwarder';
import { createSignatureVerifier } from '../middleware/verifySignature';
import { RegisterWebhookRequest, WebhookConfig } from '../types/index';

const router = Router();

/**
 * POST /webhooks/register
 * Register a new webhook endpoint.
 */
router.post('/register', (req: Request, res: Response): void => {
  try {
    const body = req.body as RegisterWebhookRequest;

    // Validate required fields
    if (!body.name || !body.source || !body.targets || body.targets.length === 0) {
      res.status(400).json({
        error: 'Validation error',
        message: 'name, source, and at least one target are required',
      });
      return;
    }

    // Validate each target has a URL
    for (const target of body.targets) {
      if (!target.url) {
        res.status(400).json({
          error: 'Validation error',
          message: 'Each target must have a url',
        });
        return;
      }
    }

    const webhook = webhookStore.create(body);

    console.log(
      `[WebhookBridge] Registered webhook "${webhook.name}" (${webhook.id}) ` +
      `with ${webhook.targets.length} target(s)`
    );

    res.status(201).json({
      message: 'Webhook registered successfully',
      webhook: sanitizeWebhook(webhook),
      endpoint: `/webhooks/${webhook.id}`,
    });
  } catch (error) {
    console.error('[WebhookBridge] Error registering webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /webhooks
 * List all registered webhooks.
 */
router.get('/', (req: Request, res: Response): void => {
  try {
    const source = req.query.source as string | undefined;
    const webhooks = webhookStore.list(source);

    res.json({
      count: webhooks.length,
      webhooks: webhooks.map(sanitizeWebhook),
    });
  } catch (error) {
    console.error('[WebhookBridge] Error listing webhooks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /webhooks/:id
 * Get a specific webhook's configuration and delivery stats.
 */
router.get('/:id', (req: Request, res: Response): void => {
  try {
    const webhook = webhookStore.getById(req.params.id);
    if (!webhook) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }

    const stats = deliveryLogStore.getStats(webhook.id);
    const recentLogs = deliveryLogStore.getByWebhookId(webhook.id).slice(-20);

    res.json({
      webhook: sanitizeWebhook(webhook),
      stats,
      recentDeliveries: recentLogs,
    });
  } catch (error) {
    console.error('[WebhookBridge] Error getting webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /webhooks/:id
 * Receive an incoming webhook and forward it to all configured targets.
 * Signature verification is applied if the webhook has a secret.
 */
router.post('/:id', createSignatureVerifier(), async (req: Request, res: Response): Promise<void> => {
  try {
    const webhook = (req as any).webhook as WebhookConfig;
    const payload = req.body as Record<string, unknown>;

    // Extract original headers for passthrough
    const originalHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        originalHeaders[key] = value;
      }
    }

    console.log(
      `[WebhookBridge] Received webhook "${webhook.name}" (${webhook.id}) ` +
      `from ${req.ip}, forwarding to ${webhook.targets.length} target(s)`
    );

    // Forward to all targets
    const results = await forwardWebhook(webhook, payload, originalHeaders);

    const allSuccessful = results.every((r) => r.success);
    const statusCode = allSuccessful ? 200 : 207; // 207 = Multi-Status

    res.status(statusCode).json({
      webhookId: webhook.id,
      received: true,
      results,
      summary: {
        total: results.length,
        successful: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      },
    });
  } catch (error) {
    console.error('[WebhookBridge] Error processing webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /webhooks/:id
 * Delete a registered webhook.
 */
router.delete('/:id', (req: Request, res: Response): void => {
  try {
    const deleted = webhookStore.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }

    // Clean up delivery logs for this webhook
    deliveryLogStore.clear(req.params.id);

    res.json({ message: 'Webhook deleted successfully' });
  } catch (error) {
    console.error('[WebhookBridge] Error deleting webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /webhooks/:id/toggle
 * Toggle a webhook's active status.
 */
router.patch('/:id/toggle', (req: Request, res: Response): void => {
  try {
    const webhook = webhookStore.toggleActive(req.params.id);
    if (!webhook) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }

    res.json({
      message: `Webhook ${webhook.active ? 'activated' : 'deactivated'}`,
      webhook: sanitizeWebhook(webhook),
    });
  } catch (error) {
    console.error('[WebhookBridge] Error toggling webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /webhooks/:id/logs
 * Get delivery logs for a specific webhook.
 */
router.get('/:id/logs', (req: Request, res: Response): void => {
  try {
    const webhook = webhookStore.getById(req.params.id);
    if (!webhook) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }

    const logs = deliveryLogStore.getByWebhookId(req.params.id);
    const stats = deliveryLogStore.getStats(req.params.id);

    res.json({ logs, stats });
  } catch (error) {
    console.error('[WebhookBridge] Error getting logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Remove the secret from a webhook config before sending to the client.
 */
function sanitizeWebhook(webhook: WebhookConfig): Omit<WebhookConfig, 'secret'> & { hasSecret: boolean } {
  const { secret, ...rest } = webhook;
  return { ...rest, hasSecret: !!secret };
}

export default router;
