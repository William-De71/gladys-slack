// -----------------------------------------------------------------------------
// Entry point of the Slack external integration (unofficial, not affiliated
// with Slack Technologies).
//
// A Slack app the user creates in their own workspace (slack-app-manifest.json)
// and two tokens: the bot token (xoxb-, the Web API) and the app-level token
// (xapp-, Socket Mode: the events reach the integration over a WebSocket it
// opens itself, so Gladys needs no public URL):
//   - communication channel: link a Slack member with a code, then talk to
//     Gladys in a direct message to the bot; Gladys' notifications and camera
//     images arrive there too;
//   - scene triggers: message, mention, /gladys, message not sent;
//   - scene action: send a Slack message; a dashboard widget.
//
// This file only wires the SDK client: the handlers are in src/app.js,
// registered before connect() (the SDK requires it).
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
// The SDK reads them: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
const app = createApp(gladys, { logger });

gladys.handleShutdown(() => app.stop());

logger.info(`Starting the Slack integration ${version}...`);
try {
  await gladys.connect();
  await app.start();
} catch (error) {
  logger.error('Slack: startup failed', error);
  process.exit(1);
}
