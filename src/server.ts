import express, { Request, Response, NextFunction } from 'express';
import webhookRoutes from './routes/webhooks';
import { deliveryLogStore } from './models/DeliveryLog';
import { webhookStore } from './models/Webhook';

const app = express();
const PORT = process.env.PORT || 3100;

// ─── Body Parsing ───────────────────────────────────────────────────────────
// Parse JSON bodies and preserve the raw body for signature verification
app.use(
  express.json({
    limit: '10mb',
    verify: (req: any, _res, buf) => {
      // Store raw body for HMAC signature verification
      req.rawBody = buf;
    },
  })
);

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// ─── Request Logging ────────────────────────────────────────────────────────
app.use((req: Request, _res: Response, next: NextFunction) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// ─── CORS Headers ───────────────────────────────────────────────────────────
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Webhook-Signature');
  next();
});

// ─── Health Check ───────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'webhook-bridge',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    stats: {
      registeredWebhooks: webhookStore.count(),
      deliveryLogs: deliveryLogStore.count(),
      deliveryStats: deliveryLogStore.getStats(),
    },
  });
});

// ─── API Info ───────────────────────────────────────────────────────────────
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Webhook Bridge',
    version: '1.0.0',
    description: 'Webhook forwarding and transformation service',
    endpoints: {
      health: 'GET /health',
      register: 'POST /webhooks/register',
      list: 'GET /webhooks',
      receive: 'POST /webhooks/:id',
      details: 'GET /webhooks/:id',
      logs: 'GET /webhooks/:id/logs',
      toggle: 'PATCH /webhooks/:id/toggle',
      delete: 'DELETE /webhooks/:id',
    },
  });
});

// ─── Webhook Routes ─────────────────────────────────────────────────────────
app.use('/webhooks', webhookRoutes);

// ─── 404 Handler ────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
    message: 'The requested endpoint does not exist',
  });
});

// ─── Error Handler ──────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[WebhookBridge] Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
  });
});

// ─── Start Server ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Webhook Bridge is running on http://localhost:${PORT}`);
  console.log(`  Health check:    http://localhost:${PORT}/health`);
  console.log(`  Register hook:   POST http://localhost:${PORT}/webhooks/register`);
  console.log(`  List hooks:      GET  http://localhost:${PORT}/webhooks\n`);
});

export default app;
