// -----------------------------------------------------------------------------
// The Slack Web API (https://docs.slack.dev/apis/web-api/), with the bot token
// (xoxb-) or, for apps.connections.open only, the app-level token (xapp-).
//
//   - every call is a POST to https://slack.com/api/<method>, the token in the
//     `Authorization: Bearer` header (never in the body nor in a URL),
//     arguments form-encoded, as the official Node SDK sends them (the docs
//     do not list which methods refuse a JSON body);
//   - an answer is a JSON object with `ok`: `{ ok: false, error }` is an error
//     even with HTTP 200;
//   - HTTP 429 carries `Retry-After` (seconds): the method is paused for that
//     long, the call waits and tries again when the pause fits its deadline;
//   - chat.postMessage allows about one message per second and per channel:
//     the messages of a channel leave one after the other, 1.1 s apart.
//
// Images: files.getUploadURLExternal -> POST of the bytes to the upload URL ->
// files.completeUploadExternal (files.upload was sunset on 2025-11-12).
//
// A development endpoint (SLACK_API_URL, the fake Slack of the tests) must be
// on 127.0.0.1 or localhost: a token never leaves for another host.
// -----------------------------------------------------------------------------

const SLACK_API_URL = 'https://slack.com/api/';
const CHANNEL_SPACING_MS = 1100;
const DEFAULT_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 3600_000;

const AUTH_ERRORS = [
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
  'token_expired',
  'not_allowed_token_type',
  'no_permission',
  'team_access_not_granted',
];
const PERMISSION_ERRORS = ['missing_scope', 'restricted_action', 'ekm_access_denied'];
const TARGET_ERRORS = [
  'channel_not_found',
  'not_in_channel',
  'is_archived',
  'user_not_found',
  'user_disabled',
  'cannot_dm_bot',
  'messages_tab_disabled',
];

/** An error of Slack or of the way to it. */
class SlackError extends Error {
  /**
   * @param {string} code - The `error` of Slack ('ratelimited', 'network', 'http_502'…).
   * @param {object} [details] - `{ status, retryAfter }`.
   */
  constructor(code, { status = null, retryAfter = null } = {}) {
    super(code);
    this.name = 'SlackError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }

  /** @returns {string} auth, permission, target, rate_limited, network or other. */
  get reason() {
    if (AUTH_ERRORS.includes(this.code)) return 'auth';
    if (PERMISSION_ERRORS.includes(this.code)) return 'permission';
    if (TARGET_ERRORS.includes(this.code)) return 'target';
    if (this.code === 'ratelimited') return 'rate_limited';
    if (this.code === 'network' || /^http_5/.test(this.code)) return 'network';
    return 'other';
  }
}

/**
 * @description Whether an URL may receive a token: slack.com, or a local
 * development server.
 * @param {string} url - The URL.
 * @returns {boolean} Whether it is allowed.
 */
function isAllowedBase(url) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol === 'https:' && (hostname === 'slack.com' || hostname.endsWith('.slack.com'))) {
      return true;
    }
    return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

/**
 * @description Form-encode Web API arguments (objects and arrays as JSON).
 * @param {object} args - The arguments.
 * @returns {URLSearchParams} The body.
 */
function formOf(args) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(args ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    form.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  return form;
}

/**
 * @description Create the Web API client.
 * @param {object} [options] - Options.
 * @param {string} [options.baseUrl] - The API root (SLACK_API_URL).
 * @param {typeof fetch} [options.fetchImpl] - fetch.
 * @param {() => number} [options.now] - Clock.
 * @param {(ms: number) => Promise<void>} [options.sleep] - Pause.
 * @param {number} [options.timeoutMs] - Timeout of one request.
 * @param {object} [options.logger] - Logger.
 * @returns {object} The client.
 * @example
 * const api = createSlackApi();
 * await api.authTest('xoxb-…');
 */
function createSlackApi({
  baseUrl = process.env.SLACK_API_URL || SLACK_API_URL,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = { debug() {}, warn() {} },
} = {}) {
  if (!isAllowedBase(baseUrl)) {
    throw new Error('SLACK_API_URL must be https://slack.com/api/ or a local server');
  }
  const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  // method -> instant until which Slack asked to wait (429 Retry-After)
  const pausedUntil = new Map();
  // channel -> { chain, last } : one chat.postMessage at a time per channel
  const channels = new Map();
  const caches = { users: new Map(), conversations: new Map(), dms: new Map() };

  /**
   * @description POST a request with a timeout.
   * @param {string} url - The URL.
   * @param {object} init - fetch options.
   * @returns {Promise<Response>} The response.
   */
  async function post(url, init) {
    try {
      return await fetchImpl(url, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        ...init,
      });
    } catch {
      // The message of a fetch error may quote the request: never keep it.
      throw new SlackError('network');
    }
  }

  /**
   * @description Call a Web API method.
   * @param {string} method - e.g. 'chat.postMessage'.
   * @param {object} args - The arguments.
   * @param {string} token - xoxb- or xapp-.
   * @param {object} [options] - Options.
   * @param {number} [options.maxWaitMs] - The longest wait for a rate limit.
   * @returns {Promise<object>} The answer (ok: true).
   */
  async function call(method, args, token, { maxWaitMs = 30_000 } = {}) {
    if (!token) {
      throw new SlackError('not_authed');
    }
    const deadline = now() + maxWaitMs;
    for (let attempt = 0; ; attempt += 1) {
      const pause = (pausedUntil.get(method) ?? 0) - now();
      if (pause > 0) {
        if (now() + pause > deadline) {
          throw new SlackError('ratelimited', { retryAfter: Math.ceil(pause / 1000) });
        }
        await sleep(pause);
      }
      const response = await post(`${root}${method}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        },
        body: formOf(args),
      });
      if (response.status === 429) {
        const seconds = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
        const retryAfter = Number.isFinite(seconds) && seconds >= 0 ? seconds : 30;
        pausedUntil.set(method, now() + retryAfter * 1000);
        logger.warn(`Slack rate limit on ${method}: waiting ${retryAfter} s`);
        if (attempt < 3 && now() + retryAfter * 1000 <= deadline) {
          continue;
        }
        throw new SlackError('ratelimited', { status: 429, retryAfter });
      }
      if (response.status >= 500 && attempt === 0) {
        await sleep(1000);
        continue;
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw new SlackError(`http_${response.status}`, { status: response.status });
      }
      if (!body || body.ok !== true) {
        throw new SlackError(String(body?.error ?? `http_${response.status}`), {
          status: response.status,
        });
      }
      if (body.warning) {
        logger.debug(`Slack warning on ${method}: ${body.warning}`);
      }
      return body;
    }
  }

  /**
   * @description Run a send to a channel after the previous one, 1.1 s apart.
   * @param {string} channel - The channel id.
   * @param {() => Promise<any>} task - The send.
   * @returns {Promise<any>} Its result.
   */
  function inChannelQueue(channel, task) {
    const entry = channels.get(channel) ?? { chain: Promise.resolve(), last: -Infinity };
    const run = entry.chain.then(async () => {
      const wait = entry.last + CHANNEL_SPACING_MS - now();
      if (wait > 0) {
        await sleep(wait);
      }
      try {
        return await task();
      } finally {
        entry.last = now();
      }
    });
    entry.chain = run.catch(() => {});
    channels.set(channel, entry);
    return run;
  }

  /**
   * @description A cached lookup (an hour).
   * @param {Map} cache - The cache.
   * @param {string} key - The key.
   * @param {() => Promise<any>} load - The loader.
   * @returns {Promise<any>} The value.
   */
  async function cached(cache, key, load) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_TTL_MS) {
      return hit.value;
    }
    const value = await load();
    cache.set(key, { value, at: now() });
    if (cache.size > 500) {
      cache.delete(cache.keys().next().value);
    }
    return value;
  }

  return {
    call,

    /**
     * @description Who the bot is: `{ url, team, team_id, user, user_id, bot_id }`.
     * @param {string} token - The bot token.
     * @returns {Promise<object>} The identity.
     */
    authTest: (token) => call('auth.test', {}, token),

    /**
     * @description A fresh Socket Mode WebSocket URL (app-level token).
     * @param {string} appToken - The xapp- token.
     * @returns {Promise<string>} The wss URL (holds a ticket: never logged).
     */
    async connectionsOpen(appToken) {
      const { url } = await call('apps.connections.open', {}, appToken);
      if (typeof url !== 'string' || !/^wss?:\/\//.test(url)) {
        throw new SlackError('invalid_url');
      }
      return url;
    },

    /**
     * @description Post a message (one per second per channel).
     * @param {string} token - The bot token.
     * @param {object} args - `{ channel, text, thread_ts?, … }`.
     * @param {object} [options] - `{ maxWaitMs }`.
     * @returns {Promise<{ channel: string, ts: string }>} The message.
     */
    postMessage(token, args, options) {
      return inChannelQueue(args.channel, async () => {
        const { channel, ts } = await call(
          'chat.postMessage',
          { unfurl_links: false, unfurl_media: false, ...args },
          token,
          options,
        );
        return { channel, ts };
      });
    },

    /**
     * @description The link of a message.
     * @param {string} token - The bot token.
     * @param {string} channel - The channel id.
     * @param {string} ts - The message ts.
     * @returns {Promise<string>} The permalink.
     */
    async permalink(token, channel, ts) {
      const { permalink } = await call('chat.getPermalink', { channel, message_ts: ts }, token);
      return String(permalink ?? '');
    },

    /**
     * @description The direct message channel of the bot with a member.
     * @param {string} token - The bot token.
     * @param {string} user - The member id.
     * @returns {Promise<string>} The D… id.
     */
    openDm(token, user) {
      return cached(caches.dms, user, async () => {
        const { channel } = await call('conversations.open', { users: user }, token);
        if (!channel?.id) {
          throw new SlackError('channel_not_found');
        }
        return channel.id;
      });
    },

    /**
     * @description A member: `{ id, name, display, is_bot, deleted }` (cached).
     * @param {string} token - The bot token.
     * @param {string} user - The member id.
     * @returns {Promise<object>} The member.
     */
    userInfo(token, user) {
      return cached(caches.users, user, async () => {
        const { user: info } = await call('users.info', { user }, token);
        const profile = info?.profile ?? {};
        return {
          id: info?.id ?? user,
          name: String(info?.name ?? ''),
          display:
            String(
              profile.display_name || profile.real_name || info?.real_name || info?.name || '',
            ) || user,
          is_bot: Boolean(info?.is_bot),
          deleted: Boolean(info?.deleted),
        };
      });
    },

    /**
     * @description A channel: `{ id, name, is_member, is_im }` (cached).
     * @param {string} token - The bot token.
     * @param {string} channel - The channel id.
     * @returns {Promise<object>} The channel.
     */
    conversationInfo(token, channel) {
      return cached(caches.conversations, channel, async () => {
        const { channel: info } = await call('conversations.info', { channel }, token);
        return {
          id: info?.id ?? channel,
          name: String(info?.name ?? ''),
          is_member: Boolean(info?.is_member),
          is_im: Boolean(info?.is_im),
        };
      });
    },

    /** @description Forget the cached members, channels and DMs (new tokens). */
    clearCaches() {
      Object.values(caches).forEach((cache) => cache.clear());
    },

    /**
     * @description Share an image in a channel (upload v2, three steps).
     * @param {string} token - The bot token.
     * @param {object} file - `{ channel, bytes, filename, title, comment?, thread_ts? }`.
     * @returns {Promise<{ id: string }>} The file.
     */
    uploadImage(token, { channel, bytes, filename, title, comment, thread_ts: threadTs }) {
      return inChannelQueue(channel, async () => {
        const { upload_url: uploadUrl, file_id: id } = await call(
          'files.getUploadURLExternal',
          { filename, length: bytes.length },
          token,
        );
        if (typeof uploadUrl !== 'string' || !isAllowedBase(uploadUrl) || !id) {
          throw new SlackError('invalid_upload_url');
        }
        const response = await post(uploadUrl, {
          headers: { 'Content-Type': 'application/octet-stream' },
          body: bytes,
        });
        if (response.status !== 200) {
          throw new SlackError(`upload_http_${response.status}`, { status: response.status });
        }
        await call(
          'files.completeUploadExternal',
          {
            files: [{ id, title }],
            channel_id: channel,
            initial_comment: comment,
            thread_ts: threadTs,
          },
          token,
        );
        return { id };
      });
    },
  };
}

export { createSlackApi, SlackError, SLACK_API_URL, CHANNEL_SPACING_MS, isAllowedBase, formOf };
