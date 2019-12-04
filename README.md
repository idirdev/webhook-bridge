# @idirdev/webhook-bridge

**Receive, transform, and forward webhooks.** Debug locally, replay events, filter payloads, and log everything.

**Recevez, transformez et transfelez des webhooks.** Debogage local, rejeu d'evenements, filtrage et journalisation integres.

---

## Features / Fonctionnalites

- **Receive** webhooks on a local HTTP server / **Recoit** les webhooks sur un serveur HTTP local
- **Forward** payloads to any URL with automatic retry / **Transfere** les payloads vers n'importe quelle URL avec retry automatique
- **Transform** payloads with custom JS functions / **Transforme** les payloads avec des fonctions JS personnalisees
- **Filter** by header to process only specific events / **Filtre** par header pour ne traiter que certains evenements
- **Replay** stored webhooks for debugging / **Rejoue** des webhooks stockes pour le debogage
- **Log** every payload to disk (JSONL) / **Journalise** chaque payload sur disque (JSONL)
- **Health check** and **stats** endpoints / Points de **sante** et de **statistiques**
- Exponential backoff with jitter on retries / Backoff exponentiel avec jitter sur les retries
- 5 MB body limit with 413 rejection / Limite de 5 Mo avec rejet 413

## Installation

```bash
npm install @idirdev/webhook-bridge
```

Or globally / Ou globalement :

```bash
npm install -g @idirdev/webhook-bridge
```

## Quick Start / Demarrage rapide

### CLI

```bash
# Start a webhook receiver on port 9000
# Demarrer un recepteur de webhooks sur le port 9000
webhook-bridge

# Forward webhooks to another server
# Transferer les webhooks vers un autre serveur
webhook-bridge start --port 8080 --forward https://api.example.com/hooks

# Log payloads and filter by header
# Journaliser les payloads et filtrer par header
webhook-bridge start --log ./webhooks.log --filter x-github-event=push

# Transform payloads before forwarding
# Transformer les payloads avant transfert
webhook-bridge start --forward https://slack.com/hook --transform ./transform.js

# Replay a stored webhook
# Rejouer un webhook stocke
webhook-bridge replay wb_a3f8c1d2e4b7 --log ./webhooks.log --forward https://api.example.com/hooks

# List stored webhooks
# Lister les webhooks stockes
webhook-bridge list --log ./webhooks.log
```

### Programmatic API / API programmatique

```js
const { WebhookBridge } = require('@idirdev/webhook-bridge');

const bridge = new WebhookBridge({
  port: 9000,
  forwardUrl: 'https://api.example.com/hooks',
  transformFn: (payload, headers) => ({
    ...payload,
    processed_at: new Date().toISOString()
  }),
  logFile: './webhooks.log',
  filter: { header: 'x-github-event', value: 'push' }
});

bridge.start(() => console.log('Webhook bridge is running'));

// Graceful shutdown / Arret propre
process.on('SIGINT', () => bridge.stop(() => process.exit(0)));
```

## CLI Reference / Reference CLI

```
webhook-bridge [command] [options]

Commands:
  start [options]     Start the webhook bridge server (default)
  replay <id>         Replay a previously stored webhook by ID
  list                List stored webhooks

Start options:
  -p, --port <n>           Port to listen on (default: 9000)
  -f, --forward <url>      Forward webhooks to this URL
  -t, --transform <file>   Path to a JS transform script
  -l, --log <file>         Log payloads to this JSONL file
  --filter <header=value>  Only process matching webhooks

Replay options:
  -f, --forward <url>      Forward the replayed webhook
  -l, --log <file>         JSONL log file to read from
  -t, --transform <file>   Apply transform before forwarding

General:
  -v, --version            Show version
  -h, --help               Show help
```

## HTTP Endpoints / Points d'acces HTTP

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/*` | Receive a webhook / Recevoir un webhook |
| `GET` | `/health` | Health check / Verification de sante |
| `GET` | `/stats` | Bridge statistics / Statistiques du bridge |

Webhooks receive a `202 Accepted` response immediately with a unique `X-Webhook-Id` header.

Les webhooks recoivent une reponse `202 Accepted` immediatement avec un header `X-Webhook-Id` unique.

## Transform Scripts / Scripts de transformation

A transform script must export a function that receives `(payload, headers)` and returns the transformed payload. Async functions are supported.

Un script de transformation doit exporter une fonction qui recoit `(payload, headers)` et retourne le payload transforme. Les fonctions async sont supportees.

```js
// transform.js
module.exports = function (payload, headers) {
  return {
    text: `New ${payload.action} event on ${payload.repository.full_name}`,
    source: 'github'
  };
};
```

### Field Mapping / Mapping de champs

```js
const { Transformer } = require('@idirdev/webhook-bridge');

const result = Transformer.mapFields(sourcePayload, [
  { from: 'user.name', to: 'author' },
  { from: 'action', to: 'event.type' },
  { from: 'missing.field', to: 'fallback', default: 'N/A' }
]);
```

### Template Interpolation

```js
const text = Transformer.interpolate(
  'New {{action}} by {{user.name}} on {{repo}}',
  { action: 'push', user: { name: 'idir' }, repo: 'webhook-bridge' }
);
// => "New push by idir on webhook-bridge"
```

## Forwarder Options / Options du Forwarder

```js
new WebhookBridge({
  port: 9000,
  forwardUrl: 'https://api.example.com/hooks',
  forwarderOptions: {
    maxRetries: 5,        // Default: 3
    initialDelay: 1000,   // Default: 500ms
    maxDelay: 60000,      // Default: 30000ms
    backoffFactor: 2,     // Default: 2
    timeout: 20000        // Default: 15000ms
  }
});
```

Retry logic / Logique de retry :
- **2xx** : Success, no retry / Succes, pas de retry
- **4xx** (except 429) : Client error, no retry / Erreur client, pas de retry
- **5xx / 429** : Retried with exponential backoff / Retry avec backoff exponentiel
- **Network errors** : Retried / Retries

## Storage / Stockage

Webhooks are stored in memory and optionally persisted to a JSONL file.

Les webhooks sont stockes en memoire et optionnellement persistes dans un fichier JSONL.

```js
const { WebhookStorage } = require('@idirdev/webhook-bridge');

const storage = new WebhookStorage('./webhooks.log', { maxEntries: 10000 });
storage.store({ id: 'wb_abc', method: 'POST', path: '/', headers: {}, body: {}, timestamp: new Date().toISOString() });

const entry = storage.get('wb_abc');
const ids = storage.listIds();
const results = storage.search((e) => e.path === '/github');
storage.close();
```

## Testing / Tests

```bash
npm test
```

Uses Node.js built-in test runner (`node:test`). No external test framework required.

Utilise le test runner integre de Node.js (`node:test`). Aucun framework externe requis.

## Requirements / Prerequis

- Node.js >= 16.0.0

## License / Licence

MIT - Copyright (c) 2022 idirdev

See [LICENSE](./LICENSE) for details / Voir [LICENSE](./LICENSE) pour les details.
