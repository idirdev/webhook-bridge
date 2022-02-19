import { v4 as uuidv4 } from 'uuid';
import { DeliveryLogEntry } from '../types/index';

/**
 * In-memory delivery log store.
 * Tracks all webhook delivery attempts for debugging and monitoring.
 * In production, this would be backed by a database with retention policies.
 */
class DeliveryLogStore {
  private logs: DeliveryLogEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries: number = 10000) {
    this.maxEntries = maxEntries;
  }

  /**
   * Record a delivery attempt.
   */
  add(entry: Omit<DeliveryLogEntry, 'id' | 'timestamp'>): DeliveryLogEntry {
    const logEntry: DeliveryLogEntry = {
      ...entry,
      id: uuidv4(),
      timestamp: new Date(),
    };

    this.logs.push(logEntry);

    // Trim old entries if over capacity
    if (this.logs.length > this.maxEntries) {
      this.logs = this.logs.slice(-this.maxEntries);
    }

    return logEntry;
  }

  /**
   * Get all logs for a specific webhook.
   */
  getByWebhookId(webhookId: string): DeliveryLogEntry[] {
    return this.logs.filter((log) => log.webhookId === webhookId);
  }

  /**
   * Get the most recent N logs.
   */
  getRecent(limit: number = 50): DeliveryLogEntry[] {
    return this.logs.slice(-limit).reverse();
  }

  /**
   * Get all failed deliveries for a webhook.
   */
  getFailures(webhookId?: string): DeliveryLogEntry[] {
    let filtered = this.logs.filter((log) => !log.success);
    if (webhookId) {
      filtered = filtered.filter((log) => log.webhookId === webhookId);
    }
    return filtered;
  }

  /**
   * Get delivery statistics for a webhook.
   */
  getStats(webhookId?: string): DeliveryStats {
    let entries = this.logs;
    if (webhookId) {
      entries = entries.filter((log) => log.webhookId === webhookId);
    }

    const total = entries.length;
    const successful = entries.filter((e) => e.success).length;
    const failed = total - successful;
    const avgDuration =
      total > 0
        ? entries.reduce((sum, e) => sum + e.duration, 0) / total
        : 0;

    const statusCodes: Record<number, number> = {};
    for (const entry of entries) {
      statusCodes[entry.statusCode] = (statusCodes[entry.statusCode] || 0) + 1;
    }

    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? successful / total : 0,
      averageDuration: Math.round(avgDuration),
      statusCodeDistribution: statusCodes,
    };
  }

  /**
   * Clear all logs or logs for a specific webhook.
   */
  clear(webhookId?: string): number {
    if (webhookId) {
      const before = this.logs.length;
      this.logs = this.logs.filter((log) => log.webhookId !== webhookId);
      return before - this.logs.length;
    }
    const count = this.logs.length;
    this.logs = [];
    return count;
  }

  /**
   * Get total number of log entries.
   */
  count(): number {
    return this.logs.length;
  }
}

/**
 * Delivery statistics summary.
 */
export interface DeliveryStats {
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  averageDuration: number;
  statusCodeDistribution: Record<number, number>;
}

/** Singleton delivery log store instance. */
export const deliveryLogStore = new DeliveryLogStore();
