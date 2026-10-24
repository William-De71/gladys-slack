// The pure parts: text in and out of Slack, envelopes, configuration, the
// state file, the Web API client (429, errors, where the token goes) and
// Socket Mode against a scripted WebSocket (hello timeout, ping timeout).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  escapeText,
  escapeMrkdwn,
  plainText,
  splitText,
  decodeImage,
  shorten,
} from '../src/text.js';
import { classify, instantOf } from '../src/receiver.js';
import { normalizeConfig, readTarget, tokenProblem, flag, readLanguage } from '../src/config.js';
import { createStore } from '../src/store.js';
import { createSlackApi, SlackError, isAllowedBase, formOf } from '../src/slack-api.js';
import { createSocketMode } from '../src/socket-mode.js';
import { linkCodeOf } from '../src/app.js';
import { messageLink, notSentEvent, MAX_EVENT_STRING, messageEvent } from '../src/events.js';
import { t, all } from '../src/i18n.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- text ---------------------------------------------------------------------------

test('plainText: entities, mentions, channels, links, special mentions', () => {
  assert.equal(
    plainText('<@UBOT> turn on the &lt;kitchen&gt; light &amp; <#C123|home>', {
      botUserId: 'UBOT',
    }),
    'turn on the <kitchen> light & #home',
  );
  assert.equal(
    plainText('see <https://example.com|the site> or <https://x.org>'),
    'see the site or https://x.org',
  );
  assert.equal(plainText('<!here> <!subteam^S1|@team> <mailto:a@b.c|a@b.c>'), '@here @team a@b.c');
  assert.equal(plainText('hi <@U1>', { nameOf: () => 'Bob' }), 'hi @Bob');
  assert.equal(plainText('hi <@U1>'), 'hi @U1');
  assert.equal(plainText('  multi\n\nline  '), 'multi line');
  assert.equal(plainText(undefined), '');
});

test('escapeText escapes the three control characters only', () => {
  assert.equal(escapeText('a < b & c > d *bold*'), 'a &lt; b &amp; c &gt; d *bold*');
  assert.equal(escapeText(null), '');
});

test('escapeMrkdwn keeps the Slack references a scene author writes', () => {
  assert.equal(
    escapeMrkdwn('<@U123> <#C123|home> <!here> <https://a.b|x>'),
    '<@U123> <#C123|home> <!here> <https://a.b|x>',
  );
  assert.equal(
    escapeMrkdwn('3 < 5 > 2 & 1 &amp; <script>'),
    '3 &lt; 5 &gt; 2 &amp; 1 &amp; &lt;script&gt;',
  );
  assert.equal(escapeMrkdwn('<javascript:alert(1)|x>'), '&lt;javascript:alert(1)|x&gt;');
  assert.equal(escapeMrkdwn('unclosed <@U1'), 'unclosed &lt;@U1');
});

test('splitText: parts of 3,900 characters at most, cut at a line or a space', () => {
  assert.deepEqual(splitText('short'), ['short']);
  assert.deepEqual(splitText('   '), []);
  const long = `${'a'.repeat(3000)}\n${'b'.repeat(3000)}`;
  assert.deepEqual(splitText(long), ['a'.repeat(3000), 'b'.repeat(3000)]);
  const words = 'word '.repeat(2000);
  const parts = splitText(words);
  assert.ok(parts.every((part) => part.length <= 3900));
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), words.trim());
  assert.equal(splitText('x'.repeat(8000)).length, 3);
});

test('decodeImage: the camera format of Gladys, PNG and JPEG, nothing else', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  assert.equal(
    decodeImage(
      `image/jpg;base64,${Buffer.from([0xff, 0xd8, 1, 2, 3, 4, 5, 6, 7]).toString('base64')}`,
    ).mime,
    'image/jpeg',
  );
  assert.equal(decodeImage(`data:image/png;base64,${png.toString('base64')}`).extension, 'png');
  assert.equal(decodeImage(png.toString('base64')).mime, 'image/png');
  assert.equal(decodeImage(Buffer.from('hello world!').toString('base64')), null);
  assert.equal(decodeImage('not base64 at all !!!'), null);
  assert.equal(decodeImage(null), null);
  assert.equal(shorten('abcdef', 4), 'abc…');
});

// --- envelopes -------------------------------------------------------------------------

const event = (fields, extra = {}) => ({
  type: 'events_api',
  envelope_id: 'e1',
  payload: {
    event_id: 'Ev1',
    event_time: 1700000000,
    team_id: 'T1',
    event: { ts: '1700000000.000100', channel: 'D1', user: 'U1', text: 'hi', ...fields },
  },
  ...extra,
});

test('classify: direct messages, channels, mentions, commands', () => {
  const dm = classify(event({ type: 'message', channel_type: 'im' }), { userId: 'UB' });
  assert.equal(dm.kind, 'message');
  assert.equal(dm.channelType, 'im');
  assert.equal(dm.eventId, 'Ev1');
  assert.equal(dm.at, 1700000000000);
  assert.equal(
    classify(event({ type: 'message', channel_type: 'group', channel: 'G1' })).channelType,
    'group',
  );
  assert.equal(classify(event({ type: 'app_mention', channel: 'C1' })).kind, 'mention');
  assert.equal(classify(event({ type: 'app_mention', channel: 'D1' })).reason, 'mention_in_dm');
  assert.equal(
    classify(event({ type: 'message', channel_type: 'im', subtype: 'file_share', files: [{}] }))
      .files,
    1,
  );
  assert.equal(classify(event({ type: 'message', channel_type: 'im' }, {}), {}).retry, 0);
  assert.equal(
    classify({ ...event({ type: 'message', channel_type: 'im' }), retry_attempt: 2 }).retry,
    2,
  );
  const command = classify({
    type: 'slash_commands',
    payload: {
      command: '/gladys',
      text: 'hi',
      user_id: 'U1',
      channel_id: 'C1',
      channel_name: 'home',
    },
  });
  assert.deepEqual([command.kind, command.rawText, command.channelName], ['command', 'hi', 'home']);
});

test('classify: bots, the bot itself, edits, hidden events, group DMs, other events are dropped', () => {
  const reasons = [
    [event({ type: 'message', channel_type: 'im', bot_id: 'B1' }), 'bot'],
    [event({ type: 'message', channel_type: 'im', bot_profile: {} }), 'bot'],
    [event({ type: 'message', channel_type: 'im', user: 'UB' }), 'self'],
    [
      event({ type: 'message', channel_type: 'im', subtype: 'message_changed' }),
      'subtype:message_changed',
    ],
    [
      event({ type: 'message', channel_type: 'im', subtype: 'message_deleted', hidden: true }),
      'hidden',
    ],
    [event({ type: 'message', channel_type: 'mpim' }), 'channel_type:mpim'],
    [event({ type: 'message', channel_type: 'im', user: undefined }), 'no_user'],
    [event({ type: 'reaction_added' }), 'event:reaction_added'],
    [{ type: 'interactive', payload: {} }, 'interactive'],
    [{ type: 'events_api', payload: {} }, 'no_event'],
    [{ type: 'slash_commands', payload: {} }, 'invalid_command'],
  ];
  for (const [envelope, reason] of reasons) {
    assert.deepEqual(
      [classify(envelope, { userId: 'UB' }).kind, classify(envelope, { userId: 'UB' }).reason],
      ['ignore', reason],
    );
  }
  assert.equal(instantOf('x'), null);
});

// --- configuration -------------------------------------------------------------------

test('configuration: tokens, default channel, flags, language', () => {
  const config = normalizeConfig({
    bot_token: ' xoxb-123-456-abcdef ',
    app_token: 'xapp-1-A1-2-abcdef',
    default_channel: '<#C0123ABCD|general>',
    forward_direct_messages: 'false',
    language: 'de',
  });
  assert.equal(tokenProblem(config), null);
  assert.deepEqual(config.defaultChannel, { kind: 'channel', id: 'C0123ABCD' });
  assert.equal(config.forwardDirect, false);
  assert.equal(config.language, 'de');
  assert.equal(normalizeConfig({}).language, 'auto');
  assert.equal(normalizeConfig({}).forwardDirect, true);
  assert.equal(tokenProblem(normalizeConfig({ bot_token: 'xoxb-123-456-abcdef' })), 'missing');
  assert.equal(
    tokenProblem(
      normalizeConfig({ bot_token: 'xoxp-123-456-abcdef', app_token: 'xapp-1-A1-2-abcdef' }),
    ),
    'bot_token_format',
  );
  assert.equal(
    tokenProblem(normalizeConfig({ bot_token: 'xoxb-123-456-abcdef', app_token: 'xoxe.xapp-1' })),
    'app_token_format',
  );
  assert.deepEqual(readTarget('<@U0ABC123>'), { kind: 'member', id: 'U0ABC123' });
  assert.deepEqual(readTarget('https://home.slack.com/archives/C0ABC123/p1'), {
    kind: 'channel',
    id: 'C0ABC123',
  });
  assert.deepEqual(readTarget('#C0ABC123'), { kind: 'channel', id: 'C0ABC123' });
  assert.equal(readTarget('#general'), null, 'names are not resolved');
  assert.equal(readTarget(''), null);
  assert.equal(flag('true', false), true);
  assert.equal(flag(undefined, true), true);
  assert.equal(readLanguage({ last_dashboard_language: 'es' }, 'en'), 'es');
  assert.equal(readLanguage({ last_dashboard_language: 'it' }, 'en'), 'en');
});

test('link codes: the alphabet of Gladys, 8 characters', () => {
  assert.equal(linkCodeOf(' abcd2345 '), 'ABCD2345');
  assert.equal(linkCodeOf('ABCD2340'), null, 'no 0');
  assert.equal(linkCodeOf('ABCDI234'), null, 'no I');
  assert.equal(linkCodeOf('ABCD23456'), null);
  assert.equal(linkCodeOf('hello'), null);
});

// --- events --------------------------------------------------------------------------

test('event data: flat, scalars, strings of 1,000 characters at most', () => {
  assert.equal(
    messageLink('https://a.slack.com', 'C1', '1700000000.000100'),
    'https://a.slack.com/archives/C1/p1700000000000100',
  );
  assert.equal(
    messageLink('https://a.slack.com/', 'C1', '1.2', '1.1'),
    'https://a.slack.com/archives/C1/p12?thread_ts=1.1&cid=C1',
  );
  assert.equal(messageLink(null, 'C1', '1.2'), '');
  const data = messageEvent(
    {
      text: 'x'.repeat(5000),
      user: 'U1',
      userName: 'A',
      channel: 'C1',
      channelType: 'mpim',
      ts: '1.2',
      threadTs: null,
      gladysUser: null,
    },
    null,
  );
  assert.equal(data.text.length, MAX_EVENT_STRING);
  assert.equal(data.channel_type, 'channel');
  assert.ok(Object.keys(data).length <= 30);
  for (const value of Object.values({
    ...data,
    ...notSentEvent({ target: 'U1', user: null, reason: 'auth', error: 'invalid_auth' }),
  })) {
    assert.ok(['string', 'number', 'boolean'].includes(typeof value) || value === null);
  }
});

test('i18n: placeholders filled, English fallback', () => {
  assert.equal(
    t('statusConnected', 'fr', { team: 'Maison', bot: 'gladys' }),
    'Connecté à l’espace de travail Slack Maison en tant que @gladys.',
  );
  assert.equal(t('unknown_key', 'fr'), 'unknown_key');
  assert.equal(t('socketUp', 'it'), 'connected');
  assert.deepEqual(Object.keys(all('socketUp')), ['en', 'fr', 'de', 'es']);
  assert.equal(all('linkedMembers', (l) => ({ count: l.length })).fr, '2 membre(s) lié(s)');
});

// --- state file ----------------------------------------------------------------------

test('store: ids remembered across restarts, invitations once a day, daily counters', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'gladys-slack-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json');
  let clock = Date.UTC(2026, 9, 24, 10);
  const store = createStore({ path, now: () => clock, logger: silent });
  await store.load();
  assert.equal(store.remember('Ev1'), true);
  assert.equal(store.remember('Ev1'), false);
  assert.equal(store.remember(null), true);
  assert.equal(store.invite('U0EVE'), true);
  assert.equal(store.invite('U0EVE'), false);
  store.count('received');
  await store.save();
  const again = createStore({ path, now: () => clock, logger: silent });
  await again.load();
  assert.equal(again.remember('Ev1'), false, 'survives a restart');
  assert.equal(again.invite('U0EVE'), false);
  assert.equal(again.counters().received, 1);
  clock += 25 * 3600 * 1000;
  assert.equal(again.invite('U0EVE'), true, 'a day later');
  assert.deepEqual(again.counters(), { received: 0, sent: 0, failed: 0 }, 'a new day');
  again.forgetInvitation('U0EVE');
  for (let i = 0; i < 600; i += 1) again.remember(`Ev-${i}`);
  await again.save();
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.seen.length, 500);
  assert.deepEqual(saved.invited, {});
  await writeFile(path, '{broken');
  const broken = createStore({ path, now: () => clock, logger: silent });
  await broken.load();
  assert.equal(broken.remember('Ev1'), true, 'a broken file starts empty');
});

// --- Web API client ------------------------------------------------------------------

/**
 * @description A scripted fetch.
 * @param {Array<Function|object>} answers - Answers, in order.
 * @returns {Function} fetch, with `.calls`.
 */
function scriptedFetch(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    const { status = 200, body = { ok: true }, headers = {} } = next ?? {};
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers,
    });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('Web API: bearer header, form body, errors with HTTP 200, typed reasons', async () => {
  const fetchImpl = scriptedFetch([
    { body: { ok: true, team: 'Home', user: 'gladys' } },
    { body: { ok: false, error: 'invalid_auth' } },
    { body: { ok: false, error: 'not_in_channel' } },
    new TypeError('fetch failed: https://slack.com/api/x?token=leak'),
    { status: 502, body: 'bad gateway' },
    { status: 502, body: 'bad gateway' },
  ]);
  const api = createSlackApi({
    baseUrl: 'https://slack.com/api/',
    fetchImpl,
    sleep: async () => {},
  });
  assert.equal((await api.authTest('xoxb-secret')).team, 'Home');
  const [{ url, init }] = fetchImpl.calls;
  assert.equal(url, 'https://slack.com/api/auth.test');
  assert.equal(init.headers.Authorization, 'Bearer xoxb-secret');
  assert.doesNotMatch(String(init.body), /xoxb/);
  await assert.rejects(
    api.authTest('xoxb-secret'),
    (err) => err instanceof SlackError && err.reason === 'auth',
  );
  await assert.rejects(
    api.call('chat.postMessage', { channel: 'C1' }, 'xoxb-secret'),
    (err) => err.reason === 'target',
  );
  await assert.rejects(
    api.authTest('xoxb-secret'),
    (err) => err.code === 'network' && !/leak/.test(err.message),
  );
  await assert.rejects(
    api.authTest('xoxb-secret'),
    (err) => err.code === 'http_502' && err.reason === 'network',
  );
  await assert.rejects(api.call('auth.test', {}, ''), (err) => err.code === 'not_authed');
  assert.equal(
    formOf({ a: 1, b: [{ id: 'F1' }], c: null, d: '' }).toString(),
    'a=1&b=%5B%7B%22id%22%3A%22F1%22%7D%5D',
  );
});

test('Web API: HTTP 429 pauses the method for Retry-After, then gives up past the deadline', async () => {
  let clock = 0;
  const waits = [];
  const fetchImpl = scriptedFetch([
    { status: 429, headers: { 'Retry-After': '2' } },
    { body: { ok: true, channel: 'C1', ts: '1.1' } },
    { status: 429, headers: { 'Retry-After': '120' } },
  ]);
  const api = createSlackApi({
    baseUrl: 'https://slack.com/api/',
    fetchImpl,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    logger: silent,
  });
  assert.deepEqual(await api.postMessage('xoxb-t', { channel: 'C1', text: 'x' }), {
    channel: 'C1',
    ts: '1.1',
  });
  assert.deepEqual(waits, [2000]);
  await assert.rejects(
    api.postMessage('xoxb-t', { channel: 'C1', text: 'y' }, { maxWaitMs: 10_000 }),
    (err) => err.reason === 'rate_limited' && err.retryAfter === 120,
  );
  // The method stays paused: the next call fails at once instead of hammering.
  await assert.rejects(
    api.call('chat.postMessage', { channel: 'C2' }, 'xoxb-t', { maxWaitMs: 1000 }),
    (err) => err.code === 'ratelimited',
  );
  assert.equal(fetchImpl.calls.length, 3);
});

test('Web API: one message per second and per channel, other channels not held', async () => {
  const fetchImpl = async (url, init) =>
    new Response(
      JSON.stringify({
        ok: true,
        channel: new URLSearchParams(init.body).get('channel'),
        ts: String(Date.now()),
      }),
    );
  const api = createSlackApi({ baseUrl: 'http://127.0.0.1:9/api/', fetchImpl });
  const started = Date.now();
  const stamps = [];
  await Promise.all([
    api
      .postMessage('xoxb-t', { channel: 'C1', text: '1' })
      .then(() => stamps.push(['C1', Date.now() - started])),
    api
      .postMessage('xoxb-t', { channel: 'C1', text: '2' })
      .then(() => stamps.push(['C1', Date.now() - started])),
    api
      .postMessage('xoxb-t', { channel: 'C2', text: '3' })
      .then(() => stamps.push(['C2', Date.now() - started])),
  ]);
  const c1 = stamps.filter(([channel]) => channel === 'C1').map(([, at]) => at);
  assert.ok(c1[1] - c1[0] >= 1000, `${c1}`);
  assert.ok(stamps.find(([channel]) => channel === 'C2')[1] < 500);
});

test('Web API: a token only goes to slack.com or a local server', () => {
  assert.equal(isAllowedBase('https://slack.com/api/'), true);
  assert.equal(isAllowedBase('https://files.slack.com/upload/v1/abc'), true);
  assert.equal(isAllowedBase('http://127.0.0.1:8000/api/'), true);
  assert.equal(isAllowedBase('https://evil.example/api/'), false);
  assert.equal(isAllowedBase('https://slack.com.evil.example/'), false);
  assert.equal(isAllowedBase('not a url'), false);
  assert.throws(() => createSlackApi({ baseUrl: 'https://evil.example/api/' }));
});

test('Web API: an upload URL outside Slack is refused', async () => {
  const fetchImpl = scriptedFetch([
    { body: { ok: true, upload_url: 'https://evil.example/up', file_id: 'F1' } },
  ]);
  const api = createSlackApi({ baseUrl: 'https://slack.com/api/', fetchImpl });
  await assert.rejects(
    api.uploadImage('xoxb-t', {
      channel: 'D1',
      bytes: Buffer.from('abc'),
      filename: 'a.png',
      title: 'a',
    }),
    (err) => err.code === 'invalid_upload_url',
  );
  assert.equal(fetchImpl.calls.length, 1);
});

// --- Socket Mode against a scripted WebSocket ------------------------------------------

/** A WebSocket the test drives. */
class ScriptedSocket extends EventEmitter {
  static OPEN = 1;
  static instances = [];
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.pings = 0;
    ScriptedSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.emit('open');
    }, 1);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  ping() {
    this.pings += 1;
  }
  terminate() {
    this.readyState = 3;
  }
  close() {
    this.readyState = 3;
  }
  message(object) {
    this.emit('message', Buffer.from(JSON.stringify(object)), false);
  }
}

const socketMode = (overrides = {}) => {
  ScriptedSocket.instances = [];
  const states = [];
  let opens = 0;
  const client = createSocketMode({
    openUrl: async () => {
      opens += 1;
      return `wss://fake/link?ticket=${opens}`;
    },
    onEnvelope: async () => undefined,
    onState: (state, detail) => states.push([state, detail?.error ?? null]),
    logger: silent,
    WebSocketImpl: ScriptedSocket,
    delays: { minBackoff: 10, maxBackoff: 40, ping: 30, pong: 10, hello: 60, ack: 50, refused: 80 },
    ...overrides,
  });
  return { client, states, opens: () => opens };
};

test('Socket Mode: no hello in time -> a new URL and a new socket', async (t) => {
  const { client, states, opens } = socketMode();
  t.after(() => client.stop());
  client.start();
  await sleep(120);
  assert.ok(opens() >= 2, `${opens()}`);
  assert.ok(states.some(([state, error]) => state === 'reconnecting' && error === 'no_hello'));
  ScriptedSocket.instances.at(-1).message({ type: 'hello', num_connections: 1 });
  assert.equal(client.state(), 'connected');
});

test('Socket Mode: an unanswered ping drops the connection', async (t) => {
  const { client, states } = socketMode();
  t.after(() => client.stop());
  client.start();
  await sleep(5);
  const first = ScriptedSocket.instances[0];
  first.message({ type: 'hello' });
  await sleep(80);
  assert.ok(first.pings >= 1);
  assert.ok(
    states.some(([, error]) => error === 'ping_timeout'),
    JSON.stringify(states),
  );
  assert.ok(ScriptedSocket.instances.length >= 2);
});

test('Socket Mode: pongs keep the connection; envelopes acknowledged with their payload', async (t) => {
  const payloads = [];
  const { client } = socketMode({
    onEnvelope: async (envelope) => {
      payloads.push(envelope.type);
      if (envelope.type === 'slash_commands') return { text: 'hi' };
      if (envelope.type === 'interactive') return new Promise(() => {}); // never resolves
      return undefined;
    },
  });
  t.after(() => client.stop());
  client.start();
  await sleep(5);
  const socket = ScriptedSocket.instances[0];
  socket.message({ type: 'hello' });
  const timer = setInterval(() => socket.emit('pong'), 5);
  t.after(() => clearInterval(timer));
  socket.message({
    envelope_id: 'a',
    type: 'slash_commands',
    accepts_response_payload: true,
    payload: {},
  });
  socket.message({
    envelope_id: 'b',
    type: 'events_api',
    accepts_response_payload: false,
    payload: {},
  });
  socket.message({
    envelope_id: 'c',
    type: 'interactive',
    accepts_response_payload: true,
    payload: {},
  });
  socket.emit('message', Buffer.from('not json'), false);
  await sleep(100);
  assert.equal(ScriptedSocket.instances.length, 1, 'still the same connection');
  assert.deepEqual(socket.sent, [
    { envelope_id: 'a', payload: { text: 'hi' } },
    { envelope_id: 'b' },
    { envelope_id: 'c' },
  ]);
  assert.equal(client.stats().envelopes, 3);
});

test('Socket Mode: a refused app token waits, a rate limit waits Retry-After', async (t) => {
  let calls = 0;
  const { client, states } = socketMode({
    openUrl: async () => {
      calls += 1;
      throw calls === 1
        ? new SlackError('invalid_auth')
        : new SlackError('ratelimited', { retryAfter: 0 });
    },
  });
  t.after(() => client.stop());
  client.start();
  await sleep(40);
  assert.equal(calls, 1, 'no hammering with a refused token');
  assert.deepEqual(states.at(-1), ['refused', 'invalid_auth']);
  await sleep(80);
  assert.ok(calls >= 2);
  client.stop();
  assert.equal(client.state(), 'stopped');
});
