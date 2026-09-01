#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION } from './version.js';
import { SimplePracticeClient } from './client.js';
import { registerAuthTools } from './tools/auth.js';
import { registerAccountTools } from './tools/account.js';
import { registerAppointmentTools } from './tools/appointments.js';
import { registerBillingTools } from './tools/billing.js';
import { registerDocumentTools } from './tools/documents.js';
import { registerHealthcheckTools } from './tools/health.js';

// Built in the caller so the deferred-config-error pattern holds: the server
// still boots, and answers the host's install-time tools/list probe, with no
// SIMPLEPRACTICE_PRACTICE set. The error surfaces on the first tool call.
const client = new SimplePracticeClient();

await runMcp({
  name: 'simplepractice-mcp',
  version: VERSION,
  banner:
    '[simplepractice-mcp] This project was developed and is maintained by AI. Use at your own discretion.',
  deps: client,
  tools: [
    registerAuthTools,
    registerAccountTools,
    registerAppointmentTools,
    registerBillingTools,
    registerDocumentTools,
    registerHealthcheckTools,
  ],
});
