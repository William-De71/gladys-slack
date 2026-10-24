// -----------------------------------------------------------------------------
// A fake Slack on 127.0.0.1, for the tests and the simulator: the Web API
// methods the integration calls and a Socket Mode WebSocket, built from the
// documentation (docs.slack.dev). Nothing leaves the machine.
//
//   POST /api/<method>     form-encoded, `Authorization: Bearer <token>`;
//                          `{ ok: false, error }` with HTTP 200 for errors,
//                          HTTP 429 + Retry-After when `rateLimit` says so
//   POST /upload/<file id> the upload URL of files.getUploadURLExternal
//   GET  /link?ticket=…    the Socket Mode WebSocket (a ticket is single use)
//
// The test drives Slack: `envelope()` sends an envelope and resolves with its
// acknowledgement, `disconnect(reason)` sends a disconnect message, `kill()`
// closes every socket. The builders (`dm`, `channelMessage`, `mention`,
// `slash`, `botMessage`, `edit`) shape the payloads of the Events API.
//
// No timer at import and nothing listens until `start()`: `node --test` also
// loads this file.
// -----------------------------------------------------------------------------

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

// Obviously fake tokens, kept out of the real Slack token shapes so that
// secret scanners do not take them for leaked credentials.
const BOT_TOKEN = 'xoxb-not-a-real-bot-token';
const APP_TOKEN = 'xapp-not-a-real-app-token';
const TEAM = { id: 'T0HOME0001', name: 'Home', url: 'https://home-fake.slack.com/' };
const BOT = { user_id: 'U0BOT00001', user: 'gladys', bot_id: 'B0BOT00001' };

const USERS = {
  U0ALICE001: {
    id: 'U0ALICE001',
    name: 'alice',
    profile: { display_name: 'Alice', real_name: 'Alice Martin' },
  },
  U0BOB00001: {
    id: 'U0BOB00001',
    name: 'bob',
    profile: { display_name: '', real_name: 'Bob Durand' },
  },
  U0EVE00001: { id: 'U0EVE00001', name: 'eve', profile: { display_name: 'Eve', real_name: 'Eve' } },
  [BOT.user_id]: {
    id: BOT.user_id,
    name: 'gladys',
    is_bot: true,
    profile: { display_name: 'gladys' },
  },
};

const CHANNELS = {
  C0HOME0001: { id: 'C0HOME0001', name: 'home', is_member: true },
  C0RANDOM01: { id: 'C0RANDOM01', name: 'random', is_member: false },
  G0FAMILY01: { id: 'G0FAMILY01', name: 'family', is_member: true, is_private: true },
};

/**
 * @description Create the fake Slack.
 * @param {object} [options] - Options.
 * @param {() => number} [options.now] - Clock (event times).
 * @returns {object} The fake.
 */
function createFakeSlack({ now = () => Date.now(), control = false } = {}) {
  let server = null;
  let wss = null;
  let base = null;
  let seq = 0;
  let tsSeq = 0;
  const tickets = new Set();
  const sockets = new Set();
  const acks = new Map();
  const fake = {
    requests: [],
    posted: [],
    uploads: [],
    completed: [],
    // method -> number of 429 to answer before succeeding
    rateLimit: {},
    retryAfter: 1,
    // method -> error code to answer
    errors: {},
    // the Socket Mode connections opened so far
    connections: 0,
    hello: true,
    acks: [],
    dms: {},
  };

  const nextTs = () => {
    tsSeq += 1;
    return `${Math.floor(now() / 1000)}.${String(100000 + tsSeq).padStart(6, '0')}`;
  };

  /**
   * @param {string} method - The method.
   * @param {URLSearchParams} args - The arguments.
   * @param {string|null} token - The bearer token.
   * @returns {object} The answer.
   */
  function answer(method, args, token) {
    if (fake.errors[method]) {
      return { ok: false, error: fake.errors[method] };
    }
    if (method === 'apps.connections.open') {
      if (token !== APP_TOKEN) {
        return {
          ok: false,
          error: token?.startsWith('xoxb-') ? 'not_allowed_token_type' : 'invalid_auth',
        };
      }
      seq += 1;
      const ticket = `ticket-${seq}`;
      tickets.add(ticket);
      return {
        ok: true,
        url: `${base.replace('http', 'ws')}/link?ticket=${ticket}&app_id=A0FAKE0001`,
      };
    }
    if (token !== BOT_TOKEN) {
      return { ok: false, error: 'invalid_auth' };
    }
    switch (method) {
      case 'auth.test':
        return {
          ok: true,
          url: TEAM.url,
          team: TEAM.name,
          user: BOT.user,
          team_id: TEAM.id,
          user_id: BOT.user_id,
          bot_id: BOT.bot_id,
        };
      case 'users.info': {
        const user = USERS[args.get('user')];
        return user
          ? { ok: true, user: { team_id: TEAM.id, deleted: false, is_bot: false, ...user } }
          : { ok: false, error: 'user_not_found' };
      }
      case 'conversations.info': {
        const id = args.get('channel');
        const channel =
          CHANNELS[id] ?? (Object.values(fake.dms).includes(id) ? { id, is_im: true } : null);
        return channel ? { ok: true, channel } : { ok: false, error: 'channel_not_found' };
      }
      case 'conversations.open': {
        const user = args.get('users');
        if (!USERS[user]) return { ok: false, error: 'user_not_found' };
        fake.dms[user] = fake.dms[user] ?? `D0${user.slice(2, 10)}`;
        return { ok: true, channel: { id: fake.dms[user] } };
      }
      case 'chat.postMessage': {
        const channel = args.get('channel');
        const known =
          CHANNELS[channel] ??
          (Object.values(fake.dms).includes(channel) ? { is_member: true } : null);
        if (!known) return { ok: false, error: 'channel_not_found' };
        if (!known.is_member) return { ok: false, error: 'not_in_channel' };
        const ts = nextTs();
        fake.posted.push({
          channel,
          text: args.get('text'),
          thread_ts: args.get('thread_ts'),
          ts,
          at: Date.now(),
        });
        return { ok: true, channel, ts, message: { text: args.get('text'), ts } };
      }
      case 'chat.getPermalink':
        return {
          ok: true,
          channel: args.get('channel'),
          permalink: `${TEAM.url}archives/${args.get('channel')}/p${String(args.get('message_ts')).replace('.', '')}`,
        };
      case 'files.getUploadURLExternal': {
        seq += 1;
        const id = `F0FILE${String(seq).padStart(4, '0')}`;
        fake.uploads.push({
          id,
          filename: args.get('filename'),
          length: Number(args.get('length')),
          bytes: null,
        });
        return { ok: true, upload_url: `${base}/upload/${id}`, file_id: id };
      }
      case 'files.completeUploadExternal': {
        const files = JSON.parse(args.get('files') ?? '[]');
        const upload = fake.uploads.find((entry) => entry.id === files[0]?.id);
        if (!upload?.bytes) return { ok: false, error: 'file_not_found' };
        fake.completed.push({
          files,
          channel_id: args.get('channel_id'),
          initial_comment: args.get('initial_comment'),
        });
        return { ok: true, files: files.map((file) => ({ id: file.id, title: file.title })) };
      }
      default:
        return { ok: false, error: 'unknown_method' };
    }
  }

  /**
   * @param {import('node:http').IncomingMessage} request - The request.
   * @param {import('node:http').ServerResponse} response - The response.
   */
  async function handle(request, response) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(request.url, base);
    const upload = /^\/upload\/(F\w+)$/.exec(url.pathname);
    if (upload && request.method === 'POST') {
      const entry = fake.uploads.find((item) => item.id === upload[1]);
      if (!entry || entry.length !== body.length) {
        response.writeHead(400).end('bad length');
        return;
      }
      entry.bytes = body;
      response.writeHead(200, { 'Content-Type': 'text/plain' }).end(`OK - ${body.length}`);
      return;
    }
    if (control && url.pathname.startsWith('/_control/')) {
      // Another process (scripts/simulate.mjs) drives Slack over HTTP.
      const order = body.length ? JSON.parse(body.toString('utf8')) : {};
      const result = await controlOrder(url.pathname.slice('/_control/'.length), order);
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(result ?? null));
      return;
    }
    const api = /^\/api\/([\w.]+)$/.exec(url.pathname);
    if (!api || request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    const method = api[1];
    const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? null;
    const args = new URLSearchParams(body.toString('utf8'));
    fake.requests.push({
      method,
      args: Object.fromEntries(args),
      token: token ? `${token.slice(0, 5)}…` : null,
      at: Date.now(),
    });
    if (args.has('token')) {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: false, error: 'token_in_body' }));
      return;
    }
    if (fake.rateLimit[method] > 0) {
      fake.rateLimit[method] -= 1;
      response
        .writeHead(429, {
          'Retry-After': String(fake.retryAfter),
          'Content-Type': 'application/json',
        })
        .end(JSON.stringify({ ok: false, error: 'ratelimited' }));
      return;
    }
    response
      .writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      .end(JSON.stringify(answer(method, args, token)));
  }

  /**
   * @description An order of the simulator.
   * @param {string} name - envelope, disconnect, kill, set, state.
   * @param {object} order - Its arguments.
   * @returns {Promise<any>} Its result.
   */
  async function controlOrder(name, order) {
    if (name === 'envelope') {
      const envelope = fake[order.builder](...order.args);
      return { envelope_id: envelope.envelope_id, ack: await fake.envelope(envelope) };
    }
    if (name === 'disconnect') return fake.disconnect(order.reason);
    if (name === 'kill') return fake.kill();
    if (name === 'set') {
      Object.assign(fake.rateLimit, order.rateLimit ?? {});
      Object.assign(fake.errors, order.errors ?? {});
      return null;
    }
    const { requests, posted, uploads, completed, connections, dms } = fake;
    return {
      requests,
      posted,
      uploads: uploads.map(({ id, filename, length }) => ({ id, filename, length })),
      completed,
      connections,
      dms,
      open: fake.openSockets(),
    };
  }

  /**
   * @description Send a message to every open socket.
   * @param {object} message - The message.
   */
  function broadcast(message) {
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    }
  }

  const eventCallback = (event, { eventId, retry } = {}) => {
    seq += 1;
    return {
      type: 'events_api',
      envelope_id: `env-${seq}`,
      accepts_response_payload: false,
      ...(retry ? { retry_attempt: retry, retry_reason: 'timeout' } : {}),
      payload: {
        token: 'deprecated',
        team_id: TEAM.id,
        api_app_id: 'A0FAKE0001',
        event: { event_ts: event.ts, ...event },
        type: 'event_callback',
        event_id: eventId ?? `Ev${String(seq).padStart(8, '0')}`,
        event_time: Math.floor(now() / 1000),
        authorizations: [{ team_id: TEAM.id, user_id: BOT.user_id, is_bot: true }],
      },
    };
  };

  Object.assign(fake, {
    BOT_TOKEN,
    APP_TOKEN,
    TEAM,
    BOT,
    USERS,
    CHANNELS,

    /** @returns {Promise<string>} The base URL, once listening. */
    async start(port = 0) {
      server = createServer((request, response) => {
        handle(request, response).catch(() => response.writeHead(500).end());
      });
      wss = new WebSocketServer({ noServer: true });
      server.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url, base);
        const ticket = url.searchParams.get('ticket');
        if (url.pathname !== '/link' || !tickets.delete(ticket)) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          sockets.add(ws);
          fake.connections += 1;
          ws.on('close', () => sockets.delete(ws));
          ws.on('message', (data) => {
            const message = JSON.parse(data.toString('utf8'));
            fake.acks.push(message);
            acks.get(message.envelope_id)?.(message);
            acks.delete(message.envelope_id);
          });
          if (fake.hello) {
            ws.send(
              JSON.stringify({
                type: 'hello',
                num_connections: sockets.size,
                debug_info: { host: 'applink-fake', approximate_connection_time: 18060 },
                connection_info: { app_id: 'A0FAKE0001' },
              }),
            );
          }
        });
      });
      await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${server.address().port}`;
      return base;
    },

    /** @returns {Promise<void>} */
    async stop() {
      for (const socket of sockets) socket.terminate();
      wss?.close();
      await new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
    },

    /** @returns {string} The Web API root for SLACK_API_URL. */
    apiUrl: () => `${base}/api/`,

    /** @returns {number} Open sockets. */
    openSockets: () => [...sockets].filter((socket) => socket.readyState === socket.OPEN).length,

    /**
     * @description Send an envelope, resolve with its acknowledgement.
     * @param {object} envelope - The envelope.
     * @param {number} [timeoutMs] - How long to wait for the ack.
     * @returns {Promise<object|null>} The ack, null when none came.
     */
    envelope(envelope, timeoutMs = 3000) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          acks.delete(envelope.envelope_id);
          resolve(null);
        }, timeoutMs);
        acks.set(envelope.envelope_id, (ack) => {
          clearTimeout(timer);
          resolve(ack);
        });
        broadcast(envelope);
      });
    },

    /** @param {string} reason - refresh_requested, warning, link_disabled… */
    disconnect(reason) {
      broadcast({ type: 'disconnect', reason, debug_info: { host: 'wss-fake' } });
      if (reason !== 'warning') {
        const old = [...sockets];
        setTimeout(() => old.forEach((socket) => socket.close(1000)), 50);
      }
    },

    /** @description Close every socket without a word (a network cut). */
    kill() {
      sockets.forEach((socket) => socket.terminate());
    },

    // --- payload builders ----------------------------------------------------------
    dm: (user, text, options = {}) =>
      eventCallback(
        {
          type: 'message',
          // A member writing to the bot opens the DM: it exists from then on.
          channel: (fake.dms[user] = fake.dms[user] ?? `D0${user.slice(2, 10)}`),
          channel_type: 'im',
          user,
          text,
          ts: options.ts ?? nextTs(),
          ...(options.extra ?? {}),
        },
        options,
      ),
    channelMessage: (user, channel, text, options = {}) =>
      eventCallback(
        {
          type: 'message',
          channel,
          channel_type: channel.startsWith('G') ? 'group' : 'channel',
          user,
          text,
          ts: options.ts ?? nextTs(),
          ...(options.extra ?? {}),
        },
        options,
      ),
    mention: (user, channel, text, options = {}) =>
      eventCallback(
        {
          type: 'app_mention',
          channel,
          user,
          text: `<@${BOT.user_id}> ${text}`,
          ts: options.ts ?? nextTs(),
        },
        options,
      ),
    botMessage: (channel, text) =>
      eventCallback({
        type: 'message',
        subtype: 'bot_message',
        channel,
        channel_type: 'im',
        bot_id: BOT.bot_id,
        user: BOT.user_id,
        text,
        ts: nextTs(),
      }),
    edit: (user, channel, text) =>
      eventCallback({
        type: 'message',
        subtype: 'message_changed',
        channel,
        channel_type: 'im',
        hidden: true,
        message: { user, text },
        ts: nextTs(),
      }),
    slash: (user, text, channel = 'C0HOME0001') => {
      seq += 1;
      return {
        type: 'slash_commands',
        envelope_id: `env-${seq}`,
        accepts_response_payload: true,
        payload: {
          token: 'deprecated',
          team_id: TEAM.id,
          team_domain: 'home-fake',
          channel_id: channel,
          channel_name: CHANNELS[channel]?.name ?? 'directmessage',
          user_id: user,
          user_name: USERS[user]?.name ?? 'someone',
          command: '/gladys',
          text,
          api_app_id: 'A0FAKE0001',
          response_url: 'https://hooks.slack.com/commands/fake',
          trigger_id: 'trigger.fake',
        },
      };
    },
  });
  return fake;
}

export { createFakeSlack, BOT_TOKEN, APP_TOKEN, TEAM, BOT, USERS, CHANNELS };
