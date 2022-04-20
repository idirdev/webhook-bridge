# 🌉 Webhook Bridge

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-4.18-green.svg)](https://expressjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A webhook forwarding and transformation service built with Express. Receive webhooks from any source, transform payloads, verify signatures, and forward to multiple targets with automatic retries.

## Features

- **Webhook Forwarding** — Receive and forward webhooks to multiple target URLs
- **Payload Transformation** — Rename, remove, add, map, and filter fields using JSONPath-like rules
- **HMAC Signature Verification** — Validate incoming webhooks with HMAC-SHA256 signatures
- **Exponential Backoff Retry** — Automatic retries with configurable backoff and jitter
- **Delivery Logging** — Complete audit trail of all delivery attempts with statistics
- **Multi-Target** — Forward a single webhook to multiple destinations simultaneously
- **Active/Inactive Toggle** — Enable or disable webhooks without deleting them

## Quick Start

```bash
npm install
npm run dev
```

Server starts on `http://localhost:3100`.

## API Documentation

### Register a Webhook

```bash
POST /webhooks/register
Content-Type: application/json

{
  "name": "GitHub Push Events",
  "source": "github",
  "secret": "my-webhook-secret",
  "signatureHeader": "X-Hub-Signature-256",
  "targets": [
    {
      "url": "https://my-app.com/api/github-events",
      "method": "POST",
      "maxRetries": 3,
      "timeout": 10000
    }
  ],
  "transformRules": [
    { "type": "rename", "sourcePath": "head_commit", "destPath": "commit" },
    { "type": "add", "destPath": "source", "value": "github" },
    { "type": "remove", "sourcePath": "sender.avatar_url" }
  ]
}
```

### Receive a Webhook

```bash
POST /webhooks/:id
X-Hub-Signature-256: sha256=<signature>
Content-Type: application/json

{ "action": "push", "ref": "refs/heads/main", ... }
```

### List All Webhooks

```bash
GET /webhooks
GET /webhooks?source=github
```

### Get Webhook Details & Stats

```bash
GET /webhooks/:id
```

### View Delivery Logs

```bash
GET /webhooks/:id/logs
```

### Toggle Active Status

```bash
PATCH /webhooks/:id/toggle
```

### Delete a Webhook

```bash
DELETE /webhooks/:id
```

### Health Check

```bash
GET /health
```

## Transform Rules

| Type | Description | Fields |
|------|-------------|--------|
| `rename` | Rename a field | `sourcePath`, `destPath` |
| `remove` | Remove a field | `sourcePath` |
| `add` | Add a static value | `destPath`, `value` |
| `map` | Copy a field | `sourcePath`, `destPath` |
| `filter` | Drop payload if condition fails | `condition: { field, operator, value }` |

### Filter Operators

`eq`, `neq`, `contains`, `exists`, `gt`, `lt`

## Signature Verification

Webhook Bridge supports HMAC-SHA256 signature verification. When a webhook is registered with a `secret`, incoming requests must include a valid signature in the configured header.

The signature format is: `sha256=<hex-digest>`

## License

MIT

---

## 🇫🇷 Documentation en français

### Description
Webhook Bridge est un service de transfert et de transformation de webhooks construit avec Express. Il permet de recevoir des webhooks depuis n'importe quelle source, de transformer les données, de vérifier les signatures HMAC, et de les retransmettre vers plusieurs destinations avec des tentatives automatiques en cas d'échec.

### Installation
```bash
npm install
npm run dev
```

Le serveur démarre sur `http://localhost:3100`.

### Utilisation
Enregistrez un webhook via `POST /webhooks/register`, puis envoyez vos événements vers `POST /webhooks/:id`. Consultez la documentation anglaise ci-dessus pour la liste complète des routes, des règles de transformation et des options de configuration.
