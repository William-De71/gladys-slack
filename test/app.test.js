// The integration end to end: the real app, its real Web API client and
// Socket Mode client, the fake Gladys of the SDK and the fake Slack of
// test/helpers/fake-slack.js on 127.0.0.1. No other network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createApp, MAX_MESSAGE_AGE_MS } from '../src/app.js';
import { createSlackApi } from '../src/slack-api.js';
import { createFakeSlack, BOT_TOKEN, APP_TOKEN, CHANNELS } from './helpers/fake-slack.js';

const ALICE = 'U0ALICE001';
const BOB = 'U0BOB00001';
const EVE = 'U0EVE00001';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const linked = (id, selector, firstName, language) => ({
  contact_id: id,
  contact_name: firstName,
  linked_at: '2026-10-20T10:00:00.000Z',
  user: { selector, first_name: firstName, language },
});

/**
 * @description Wait until a condition holds.
 * @param {() => boolean} condition - The condition.
 * @param {string} what - For the failure message.
 * @param {number} [timeoutMs] - The longest wait.
 */
async function until(condition, what, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > end) throw new Error(`Timed out: ${what}`);
    await sleep(10);
  }
}

async function setup(t, options = {}) {
  const slack = createFakeSlack();
  await slack.start();
  const dir = await mkdtemp(join(tmpdir(), 'gladys-slack-'));
  const gladys = createFakeGladys({
    config: {
      bot_token: BOT_TOKEN,
      app_token: APP_TOKEN,
      language: 'en',
      ...(options.config ?? {}),
    },
    contacts: options.contacts ?? [linked(ALICE, 'alice', 'Alice', 'fr')],
    linkedUser: options.linkedUser ?? { selector: 'bob', first_name: 'Bob', language: 'de' },
  });
  const logs = [];
  const logger = Object.fromEntries(
    ['info', 'warn', 'error', 'debug'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.join(' ')}`),
    ]),
  );
  const app = createApp(gladys, {
    api: createSlackApi({ baseUrl: slack.apiUrl(), logger }),
    statePath: join(dir, 'state.json'),
    logger,
    socketDelays: { minBackoff: 30, maxBackoff: 120, ping: 300, pong: 200, hello: 500 },
    ...(options.app ?? {}),
  });
  await gladys.connect();
  await app.start();
  t.after(async () => {
    await app.stop();
    await gladys.disconnect();
    await slack.stop();
    await rm(dir, { recursive: true, force: true });
  });
  if (options.connected !== false) {
    await until(() => app.connection() === 'connected', 'Socket Mode hello');
  }
  return { slack, gladys, app, logs, dir };
}

const events = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);
const postedTo = (slack, channel) => slack.posted.filter((message) => message.channel === channel);

test('connects with Socket Mode: auth.test, apps.connections.open, hello, status reported', async (t) => {
  const { slack, gladys } = await setup(t);
  assert.deepEqual(
    slack.requests.map((request) => request.method),
    ['auth.test', 'apps.connections.open'],
  );
  assert.equal(slack.connections, 1);
  await until(() => gladys.fake.connectionStatus?.connected === true, 'status');
  assert.match(gladys.fake.connectionStatus.message.en, /workspace Home as @gladys/);
  assert.match(gladys.fake.connectionStatus.message.fr, /espace de travail Slack Home/);
  // The tokens travel in the Authorization header only.
  for (const request of slack.requests) {
    assert.ok(!('token' in request.args), request.method);
  }
  const appTokenUses = slack.requests.filter((request) => request.token?.startsWith('xapp-'));
  assert.deepEqual(
    appTokenUses.map((request) => request.method),
    ['apps.connections.open'],
  );
});

test('a direct message of a linked member: acknowledged, to the brain, a scene event, the answer in the DM', async (t) => {
  const { slack, gladys } = await setup(t);
  const envelope = slack.dm(ALICE, 'Turn on the &lt;kitchen&gt; light &amp; the <@U0BOB00001> fan');
  const ack = await slack.envelope(envelope);
  assert.deepEqual(ack, { envelope_id: envelope.envelope_id });
  await until(() => gladys.fake.messages.length === 1, 'publishMessage');
  assert.equal(gladys.fake.messages[0].contact_id, ALICE);
  assert.equal(gladys.fake.messages[0].text, 'Turn on the <kitchen> light & the @Bob Durand fan');
  await until(() => events(gladys, 'message_received').length === 1, 'event');
  const data = events(gladys, 'message_received')[0].data;
  assert.equal(data.channel_type, 'im');
  assert.equal(data.user_id, ALICE);
  assert.equal(data.gladys_user, 'alice');
  assert.equal(data.first_name, 'Alice');
  assert.match(data.link, /^https:\/\/home-fake\.slack\.com\/archives\/D0\w+\/p\d{16}$/);

  // Gladys answers: the DM of the bot with the member, escaped text.
  const sent = await gladys.fake.sendMessage(
    { id: ALICE },
    { text: 'Done: light <on> & fan', file: null },
  );
  assert.equal(sent.success, true, sent.error);
  const dm = slack.dms[ALICE];
  assert.equal(postedTo(slack, dm).at(-1).text, 'Done: light &lt;on&gt; &amp; fan');
});

test('a member who is not linked: one invitation a day, never the brain nor a scene', async (t) => {
  const { slack, gladys, app } = await setup(t);
  await slack.envelope(slack.dm(EVE, 'open the garage'));
  await app.idle();
  await slack.envelope(slack.dm(EVE, 'please'));
  await app.idle();
  assert.equal(gladys.fake.messages.length, 0);
  assert.equal(gladys.fake.sceneEvents.length, 0);
  const replies = slack.posted.filter((message) => message.channel.startsWith('D0EVE'));
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /Generate a link code/);
  // Not linked in a channel either: nothing at all.
  await slack.envelope(slack.channelMessage(EVE, 'C0HOME0001', 'hello'));
  await slack.envelope(slack.mention(EVE, 'C0HOME0001', 'lights off'));
  await app.idle();
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('a link code in a direct message links the member, answered in their Gladys language', async (t) => {
  const { slack, gladys, app } = await setup(t);
  await slack.envelope(slack.dm(BOB, ' abcd2345 '));
  await app.idle();
  assert.ok(gladys.fake.contacts.some((contact) => contact.contact_id === BOB));
  const link = gladys.fake.requests.find((request) => request.path === '/contact/link');
  assert.equal(link.body.code, 'ABCD2345');
  assert.equal(link.body.contact_name, 'Bob Durand');
  const reply = slack.posted.at(-1);
  assert.match(reply.text, /^Hallo Bob! Dein Slack-Konto ist jetzt mit Gladys verknüpft/);
  assert.equal(gladys.fake.messages.length, 0, 'the code is not a message for the brain');
});

test('bots, the bot itself and edits are ignored; a re-delivered event is handled once', async (t) => {
  const { slack, gladys, app } = await setup(t);
  for (const envelope of [
    slack.botMessage('D0ALICE001', 'echo'),
    slack.edit(ALICE, 'D0ALICE001', 'edited'),
  ]) {
    const ack = await slack.envelope(envelope);
    assert.equal(ack.envelope_id, envelope.envelope_id, 'acknowledged anyway');
  }
  const first = slack.dm(ALICE, 'hello', { eventId: 'Ev0SAME0001' });
  await slack.envelope(first);
  await slack.envelope(slack.dm(ALICE, 'hello', { eventId: 'Ev0SAME0001', retry: 1 }));
  await app.idle();
  assert.equal(gladys.fake.messages.length, 1);
  assert.equal(events(gladys, 'message_received').length, 1);
});

test('the state file holds ids and counters, never a text nor a token', async (t) => {
  const context = await setup(t);
  const { slack, app, dir } = context;
  await slack.envelope(slack.dm(ALICE, 'secret plans for the party', { eventId: 'Ev0KEEP0001' }));
  await app.idle();
  await app.stop();
  const raw = await readFile(join(dir, 'state.json'), 'utf8');
  assert.match(raw, /Ev0KEEP0001/);
  assert.doesNotMatch(raw, /secret plans|xoxb-|xapp-/);
  assert.equal(JSON.parse(raw).received, 1);
});

test('an old message (re-delivered after an outage) reaches neither the brain nor the scenes', async (t) => {
  const { slack, gladys, app } = await setup(t);
  const ts = `${Math.floor((Date.now() - MAX_MESSAGE_AGE_MS - 60_000) / 1000)}.000100`;
  await slack.envelope(slack.dm(ALICE, 'open the garage', { ts }));
  await app.idle();
  assert.equal(gladys.fake.messages.length, 0);
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('channels: messages and mentions of linked members fire scene events', async (t) => {
  const { slack, gladys, app } = await setup(t);
  await slack.envelope(slack.channelMessage(ALICE, 'G0FAMILY01', 'dinner is ready'));
  await slack.envelope(slack.mention(ALICE, 'C0HOME0001', 'lights off'));
  await app.idle();
  const message = events(gladys, 'message_received')[0].data;
  assert.equal(message.channel_type, 'group');
  assert.equal(message.text, 'dinner is ready');
  const mention = events(gladys, 'mention_received')[0].data;
  assert.equal(mention.text, 'lights off', 'without the mention of the bot');
  assert.equal(mention.channel_id, 'C0HOME0001');
  assert.equal(gladys.fake.messages.length, 0, 'channels never talk to the brain');
});

test('/gladys: answered privately in the acknowledgement, to the brain and the scenes', async (t) => {
  const { slack, gladys, app } = await setup(t);
  const ack = await slack.envelope(slack.slash(ALICE, 'goodnight'));
  assert.equal(ack.payload.response_type, 'ephemeral');
  assert.match(ack.payload.text, /^Envoyé à Gladys/, 'the Gladys language of Alice');
  await app.idle();
  assert.equal(gladys.fake.messages[0].text, 'goodnight');
  const data = events(gladys, 'slash_command')[0].data;
  assert.deepEqual([data.text, data.command, data.channel_name], ['goodnight', '/gladys', 'home']);

  const stranger = await slack.envelope(slack.slash(EVE, 'open the garage'));
  assert.match(stranger.payload.text, /link your Slack account/);
  const code = await slack.envelope(slack.slash(BOB, 'ABCD2345'));
  assert.match(code.payload.text, /^Hallo Bob!/);
  const help = await slack.envelope(slack.slash(ALICE, '   '));
  assert.match(help.payload.text, /\/gladys/);
});

test('Slack refreshes the connection: a new URL, a new socket, messages still flow', async (t) => {
  const { slack, gladys, app } = await setup(t);
  slack.disconnect('warning');
  await sleep(100);
  assert.equal(slack.connections, 1, 'a warning alone changes nothing');
  slack.disconnect('refresh_requested');
  await until(() => slack.connections === 2 && app.connection() === 'connected', 'reconnected');
  slack.kill();
  await until(
    () => slack.connections === 3 && app.connection() === 'connected',
    'reconnected after a cut',
  );
  assert.equal(slack.openSockets(), 1);
  await slack.envelope(slack.dm(ALICE, 'still there?'));
  await until(() => gladys.fake.messages.length === 1, 'message after reconnection');
  const opens = slack.requests.filter((request) => request.method === 'apps.connections.open');
  assert.equal(opens.length, 3, 'a fresh URL every time');
});

test('Socket Mode turned off in the app: reported, retried later', async (t) => {
  const { slack, gladys, app } = await setup(t);
  slack.disconnect('link_disabled');
  await until(() => app.connection() === 'disabled', 'disabled');
  await until(() => /Socket Mode/.test(gladys.fake.connectionStatus?.message?.en ?? ''), 'status');
  assert.equal(gladys.fake.connectionStatus.connected, false);
});

test('HTTP 429: the call waits Retry-After and goes through', async (t) => {
  const { slack, gladys } = await setup(t);
  slack.rateLimit['chat.postMessage'] = 1;
  const started = Date.now();
  const sent = await gladys.fake.sendMessage({ id: ALICE }, { text: 'after a pause', file: null });
  assert.equal(sent.success, true, sent.error);
  assert.ok(Date.now() - started >= 900, 'waited about Retry-After (1 s)');
  assert.equal(slack.posted.at(-1).text, 'after a pause');
  assert.equal(slack.requests.filter((request) => request.method === 'chat.postMessage').length, 2);
});

test('an image of Gladys (camera): uploaded in three steps, with the text as comment', async (t) => {
  const { slack, gladys } = await setup(t);
  const sent = await gladys.fake.sendMessage(
    { id: ALICE },
    { text: 'Front door', file: `image/png;base64,${PNG.toString('base64')}` },
  );
  assert.equal(sent.success, true, sent.error);
  await until(() => slack.completed.length === 1, 'upload completed');
  assert.deepEqual(slack.uploads[0].bytes, PNG);
  assert.equal(slack.uploads[0].filename, 'gladys.png');
  assert.equal(slack.completed[0].channel_id, slack.dms[ALICE]);
  assert.equal(slack.completed[0].initial_comment, 'Front door');
});

test('message_not_sent: once per member until a message goes through again', async (t) => {
  const { slack, gladys } = await setup(t);
  slack.errors['chat.postMessage'] = 'messages_tab_disabled';
  for (let i = 0; i < 2; i += 1) {
    const sent = await gladys.fake.sendMessage({ id: ALICE }, { text: `try ${i}`, file: null });
    assert.equal(sent.success, false);
  }
  const failed = events(gladys, 'message_not_sent');
  assert.equal(failed.length, 1);
  assert.deepEqual(failed[0].data, {
    target: ALICE,
    gladys_user: 'alice',
    first_name: 'Alice',
    reason: 'target',
    error: 'messages_tab_disabled',
  });
  delete slack.errors['chat.postMessage'];
  assert.equal(
    (await gladys.fake.sendMessage({ id: ALICE }, { text: 'ok', file: null })).success,
    true,
  );
  slack.errors['chat.postMessage'] = 'messages_tab_disabled';
  await gladys.fake.sendMessage({ id: ALICE }, { text: 'again', file: null });
  assert.equal(events(gladys, 'message_not_sent').length, 2, 're-armed after a success');
});

test('scene action send_message: default channel, member, thread, outputs, never an event', async (t) => {
  const { slack, gladys } = await setup(t, { config: { default_channel: '<#C0HOME0001|home>' } });
  const result = await gladys.fake.sceneAction('send_message', {
    text: 'Door open since *5 min* <@U0ALICE001>, 3 < 5 & <https://gladysassistant.com|Gladys>',
  });
  assert.equal(result.success, true, result.error);
  const posted = slack.posted.at(-1);
  assert.equal(posted.channel, 'C0HOME0001');
  assert.equal(
    posted.text,
    'Door open since *5 min* <@U0ALICE001>, 3 &lt; 5 &amp; <https://gladysassistant.com|Gladys>',
  );
  assert.deepEqual(Object.keys(result.data.outputs).sort(), ['channel_id', 'link', 'ts']);
  assert.equal(result.data.outputs.channel_id, 'C0HOME0001');
  assert.match(result.data.outputs.link, /archives\/C0HOME0001\/p\d+/);

  const toMember = await gladys.fake.sceneAction('send_message', {
    target: BOB,
    text: 'hi',
    thread_ts: '',
  });
  assert.equal(toMember.success, true, toMember.error);
  assert.equal(slack.posted.at(-1).channel, slack.dms[BOB]);
  const thread = await gladys.fake.sceneAction('send_message', {
    target: 'C0HOME0001',
    text: 'reply',
    thread_ts: posted.ts,
  });
  assert.equal(slack.posted.at(-1).thread_ts, posted.ts);
  assert.match(thread.data.outputs.link, /\?thread_ts=/);

  const refused = await gladys.fake.sceneAction('send_message', {
    target: 'C0RANDOM01',
    text: 'x',
  });
  assert.equal(refused.success, false);
  assert.match(refused.error, /not_in_channel/);
  const invalid = await gladys.fake.sceneAction('send_message', { target: '#random', text: 'x' });
  assert.equal(invalid.success, false);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'no event caused by a scene action');
});

test('the widget: valid content, texts hidden unless asked, the test button', async (t) => {
  const { slack, gladys, app } = await setup(t, { config: { default_channel: 'C0HOME0001' } });
  await slack.envelope(slack.dm(ALICE, 'private words'));
  await app.idle();
  for (const showText of [false, true]) {
    for (const language of ['en', 'fr', 'de', 'es']) {
      const { data } = await gladys.fake.widgetGet('status', {
        settings: { show_text: showText },
        language,
      });
      assert.deepEqual(validateWidgetContent(data.content), [], `${language} ${showText}`);
      const text = JSON.stringify(data.content);
      assert.equal(text.includes('private words'), showText, `${language} ${showText}`);
    }
  }
  const { data } = await gladys.fake.widgetGet('status', { settings: {}, language: 'fr' });
  const status = data.content.components.find((component) => component.type === 'status');
  assert.deepEqual(
    status.items.map((item) => item.value),
    ['Connecté', 'Home', '@gladys', '#home'],
  );
  const toast = await gladys.fake.widgetAction('status', 'send_test', {});
  assert.equal(toast.success, true, toast.error);
  assert.match(toast.data.message.en, /Test message sent to #home/);
  assert.equal(slack.posted.at(-1).channel, 'C0HOME0001');
});

test('the "Test the connection" button reports the workspace, the socket and the channel', async (t) => {
  const { gladys } = await setup(t, { config: { default_channel: 'C0RANDOM01' } });
  const result = await gladys.fake.action('test_connection');
  assert.equal(result.success, true, result.error);
  assert.match(
    result.data.message.en,
    /Workspace Home, bot @gladys\. Socket Mode: connected\. Default channel: #random, bot not a member/,
  );
  assert.match(result.data.message.en, /Linked members: 1\./);
  for (const text of Object.values(result.data.message)) assert.ok(text.length <= 200);
});

test('tokens missing, malformed or refused: a clear status, no connection', async (t) => {
  const missing = await setup(t, { config: { app_token: '' }, connected: false });
  assert.match(missing.gladys.fake.connectionStatus.message.en, /Enter the bot token/);
  assert.equal(missing.slack.requests.length, 0);
  await missing.gladys.fake.configUpdated({
    bot_token: 'xoxp-user-token-123456',
    app_token: APP_TOKEN,
  });
  assert.match(missing.gladys.fake.connectionStatus.message.en, /must start with xoxb-/);
  await missing.gladys.fake.configUpdated({
    bot_token: 'xoxb-revoked-0000000000',
    app_token: APP_TOKEN,
  });
  assert.match(
    missing.gladys.fake.connectionStatus.message.en,
    /Slack refuses the bot token \(invalid_auth\)/,
  );
  await missing.gladys.fake.configUpdated({
    bot_token: BOT_TOKEN,
    app_token: 'xapp-1-wrong-0000000000',
  });
  await until(() => missing.app.connection() === 'refused', 'app token refused');
  assert.match(missing.gladys.fake.connectionStatus.message.en, /app-level token \(invalid_auth\)/);
  const sent = await missing.gladys.fake.sendMessage({ id: ALICE }, { text: 'x', file: null });
  assert.equal(sent.success, true, 'auth.test passed: the Web API still works');
  await missing.gladys.fake.configUpdated({ bot_token: BOT_TOKEN, app_token: APP_TOKEN });
  await until(() => missing.app.connection() === 'connected', 'connected again');
  assert.equal(Object.keys(CHANNELS).length, 3);
});

test('past the 5 s Gladys waits, the delivery goes on in the background', async (t) => {
  const { slack, gladys, app } = await setup(t);
  slack.rateLimit['chat.postMessage'] = 1;
  slack.retryAfter = 5;
  const started = Date.now();
  const sent = await gladys.fake.sendMessage({ id: ALICE }, { text: 'slow but sure', file: null });
  assert.equal(sent.success, true, 'acknowledged before the 5 s of Gladys');
  assert.ok(Date.now() - started < 4800);
  assert.equal(slack.posted.length, 0);
  await app.idle();
  assert.equal(slack.posted.at(-1).text, 'slow but sure');
  assert.equal(events(gladys, 'message_not_sent').length, 0);
});
