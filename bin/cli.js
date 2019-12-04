#!/usr/bin/env node
'use strict';

/**
 * @file webhook-bridge CLI
 * @author idirdev
 */

const { WebhookBridge } = require('../src/index');

function getArg(args, flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const args = process.argv.slice(2);

if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log([
    '',
    '  Usage: webhook-bridge [options]',
    '',
    '  Options:',
    '    --port <n>             Port to listen on (default: 9000)',
    '    --forward-url <url>    Forward webhooks to this URL',
    '    --log-file <path>      Persist webhooks to JSONL file',
    '    --filter <hdr:value>   Only process webhooks with matching header',
    '    -h, --help             Show this help',
    '',
    '  Examples:',
    '    webhook-bridge --port 9000',
    '    webhook-bridge --port 8080 --forward-url http://localhost:3000/hook',
    '    webhook-bridge --log-file webhooks.jsonl --filter x-type:push',
    '',
  ].join('\n'));
  process.exit(0);
}

const portStr    = getArg(args, '--port', '9000');
const forwardUrl = getArg(args, '--forward-url', null);
const logFile    = getArg(args, '--log-file', null);
const filterStr  = getArg(args, '--filter', null);

const port = parseInt(portStr, 10);
if (isNaN(port) || port < 1 || port > 65535) {
  console.error('Error: invalid port "' + portStr + '"');
  process.exit(1);
}

let filter = null;
if (filterStr) {
  const sep = filterStr.indexOf(':');
  if (sep === -1) { console.error('Error: --filter must be in header:value format.'); process.exit(1); }
  filter = { header: filterStr.slice(0, sep).toLowerCase(), value: filterStr.slice(sep + 1) };
}

const bridge = new WebhookBridge({ port, forwardUrl, logFile, filter });

const shutdown = () => {
  console.log('\nShutting down...');
  bridge.stop(() => { console.log('Stopped.'); process.exit(0); });
};
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

bridge.start(() => {
  console.log('webhook-bridge listening on http://0.0.0.0:' + port);
  if (forwardUrl) console.log('Forwarding to: ' + forwardUrl);
  if (logFile)    console.log('Log file: '  + logFile);
  if (filter)     console.log('Filter: '    + filter.header + '=' + filter.value);
});