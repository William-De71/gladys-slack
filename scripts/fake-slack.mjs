// The fake Slack of the tests (test/helpers/fake-slack.js) as a server on
// 127.0.0.1, driven over HTTP by scripts/simulate.mjs (/_control/*):
//   node scripts/fake-slack.mjs 18790
//   SLACK_API_URL=http://127.0.0.1:18790/api/   (the integration)
// Tokens: see BOT_TOKEN / APP_TOKEN in test/helpers/fake-slack.js.

import { createFakeSlack } from '../test/helpers/fake-slack.js';

const port = Number(process.argv[2] ?? 18790);
const slack = createFakeSlack({ control: true });
const base = await slack.start(port);
console.log(
  `Fake Slack on ${base} (Web API ${slack.apiUrl()}, Socket Mode ws://127.0.0.1:${port}/link)`,
);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await slack.stop();
    process.exit(0);
  });
}
