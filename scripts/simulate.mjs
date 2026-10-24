// The real integration (src/app.js, its real Web API client over fetch and
// its real Socket Mode client over ws) against the fake Slack served by
// scripts/fake-slack.mjs in another process, with the fake Gladys of the SDK.
// Run by scripts/check-simulator.sh:
//   SLACK_API_URL=http://127.0.0.1:18790/api/ node scripts/simulate.mjs http://127.0.0.1:18790
// Exits 1 at the first difference from what is expected.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createApp } from '../src/app.js';
import { BOT_TOKEN, APP_TOKEN } from '../test/helpers/fake-slack.js';

const base = process.argv[2] ?? 'http://127.0.0.1:18790';
const ALICE = 'U0ALICE001';
const EVE = 'U0EVE00001';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const step = (text) => console.log(`ok - ${text}`);
const control = async (name, order = {}) => {
  const response = await fetch(`${base}/_control/${name}`, {
    method: 'POST',
    body: JSON.stringify(order),
  });
  return response.json();
};
const until = async (condition, what) => {
  const end = Date.now() + 5000;
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`Timed out: ${what}`);
    await sleep(20);
  }
};

const dir = await mkdtemp(join(tmpdir(), 'gladys-slack-sim-'));
const gladys = createFakeGladys({
  config: {
    bot_token: BOT_TOKEN,
    app_token: APP_TOKEN,
    language: 'fr',
    default_channel: 'C0HOME0001',
  },
  contacts: [
    {
      contact_id: ALICE,
      contact_name: 'Alice',
      linked_at: null,
      user: { selector: 'alice', first_name: 'Alice', language: 'fr' },
    },
  ],
});
const app = createApp(gladys, { statePath: join(dir, 'state.json') });
await gladys.connect();
await app.start();
try {
  await until(() => app.connection() === 'connected', 'hello');
  let state = await control('state');
  assert.deepEqual(
    state.requests.slice(0, 3).map((request) => request.method),
    ['auth.test', 'conversations.info', 'apps.connections.open'],
  );
  step(`Socket Mode connected over ws:// after hello (${state.connections} connection)`);

  const dm = await control('envelope', {
    builder: 'dm',
    args: [ALICE, 'allume la lumière de la cuisine'],
  });
  assert.deepEqual(dm.ack, { envelope_id: dm.envelope_id });
  await until(() => gladys.fake.messages.length === 1, 'publishMessage');
  assert.equal(gladys.fake.messages[0].text, 'allume la lumière de la cuisine');
  step('direct message of a linked member acknowledged and sent to the brain of Gladys');

  const answer = await gladys.fake.sendMessage(
    { id: ALICE },
    { text: 'La lumière de la cuisine est allumée.', file: null },
  );
  assert.equal(answer.success, true, answer.error);
  state = await control('state');
  assert.equal(state.posted.at(-1).channel, state.dms[ALICE]);
  step('the answer of Gladys posted in the same direct message');

  await control('envelope', { builder: 'dm', args: [EVE, 'ouvre le garage'] });
  await app.idle();
  state = await control('state');
  assert.match(state.posted.at(-1).text, /link your Slack account|liez votre compte Slack/);
  assert.equal(gladys.fake.messages.length, 1);
  step('a member who is not linked gets an invitation, never the brain');

  await control('envelope', { builder: 'botMessage', args: ['D0ALICE001', 'echo'] });
  await control('envelope', { builder: 'dm', args: [ALICE, 'encore', { eventId: 'Ev0SIM00001' }] });
  await control('envelope', {
    builder: 'dm',
    args: [ALICE, 'encore', { eventId: 'Ev0SIM00001', retry: 1 }],
  });
  await app.idle();
  assert.equal(gladys.fake.messages.length, 2);
  step('bot message ignored, re-delivered event handled once');

  await control('disconnect', { reason: 'refresh_requested' });
  await until(
    async () => (await control('state')).connections === 2 && app.connection() === 'connected',
    'refresh',
  );
  step('disconnect (refresh_requested) -> a new URL and a new connection');

  await control('set', { rateLimit: { 'chat.postMessage': 1 } });
  const started = Date.now();
  const limited = await gladys.fake.sendMessage(
    { id: ALICE },
    { text: 'après une pause', file: null },
  );
  assert.equal(limited.success, true, limited.error);
  assert.ok(Date.now() - started >= 900);
  step(`HTTP 429 -> waited Retry-After (${Date.now() - started} ms) and delivered`);

  const action = await gladys.fake.sceneAction('send_message', {
    text: 'Porte ouverte *depuis 5 min*',
  });
  assert.equal(action.success, true, action.error);
  assert.equal(action.data.outputs.channel_id, 'C0HOME0001');
  step(`scene action send_message -> ${action.data.outputs.link}`);

  const { data } = await gladys.fake.widgetGet('status', { settings: {}, language: 'fr' });
  assert.deepEqual(validateWidgetContent(data.content), []);
  step('widget valid');
  console.log('the integration works against the fake Slack');
} finally {
  await app.stop();
  await gladys.disconnect();
  await rm(dir, { recursive: true, force: true });
}
