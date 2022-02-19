import { v4 as uuidv4 } from 'uuid';
import {
  WebhookConfig,
  TargetConfig,
  TransformRule,
  RegisterWebhookRequest,
} from '../types/index';

/**
 * In-memory store for webhook configurations.
 * In production, this would be backed by a database.
 */
class WebhookStore {
  private webhooks: Map<string, WebhookConfig> = new Map();

  /**
   * Register a new webhook configuration.
   */
  create(request: RegisterWebhookRequest): WebhookConfig {
    const id = uuidv4();
    const now = new Date();

    const targets: TargetConfig[] = request.targets.map((t) => ({
      ...t,
      method: t.method || 'POST',
      maxRetries: t.maxRetries ?? 3,
      timeout: t.timeout ?? 10000,
      active: true,
    }));

    const webhook: WebhookConfig = {
      id,
      name: request.name,
      source: request.source,
      targets,
      secret: request.secret,
      signatureHeader: request.signatureHeader || 'X-Webhook-Signature',
      transformRules: request.transformRules || [],
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    this.webhooks.set(id, webhook);
    return webhook;
  }

  /**
   * Get a webhook by ID.
   */
  getById(id: string): WebhookConfig | undefined {
    return this.webhooks.get(id);
  }

  /**
   * List all webhooks, optionally filtered by source.
   */
  list(source?: string): WebhookConfig[] {
    const all = Array.from(this.webhooks.values());
    if (source) {
      return all.filter((w) => w.source === source);
    }
    return all;
  }

  /**
   * Update a webhook configuration.
   */
  update(id: string, updates: Partial<RegisterWebhookRequest>): WebhookConfig | undefined {
    const existing = this.webhooks.get(id);
    if (!existing) return undefined;

    const updated: WebhookConfig = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };

    if (updates.targets) {
      updated.targets = updates.targets.map((t) => ({
        ...t,
        method: t.method || 'POST',
        maxRetries: t.maxRetries ?? 3,
        timeout: t.timeout ?? 10000,
        active: true,
      }));
    }

    this.webhooks.set(id, updated);
    return updated;
  }

  /**
   * Delete a webhook by ID.
   */
  delete(id: string): boolean {
    return this.webhooks.delete(id);
  }

  /**
   * Toggle a webhook's active status.
   */
  toggleActive(id: string): WebhookConfig | undefined {
    const existing = this.webhooks.get(id);
    if (!existing) return undefined;

    existing.active = !existing.active;
    existing.updatedAt = new Date();
    this.webhooks.set(id, existing);
    return existing;
  }

  /**
   * Get the total count of registered webhooks.
   */
  count(): number {
    return this.webhooks.size;
  }
}

/** Singleton webhook store instance. */
export const webhookStore = new WebhookStore();
