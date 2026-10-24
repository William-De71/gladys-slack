// -----------------------------------------------------------------------------
// Every handler of the Slack integration, registered on the Gladys client it
// receives: index.js passes the real one, the tests the fake Gladys of the
// SDK (`@gladysassistant/integration-sdk/testing`).
//
// Slack is a COMMUNICATION integration of the BIDIRECTIONAL family
// (`messaging: { receive: true }`), on a Slack app the user creates in their
// own workspace from the manifest of this repository:
//   - incoming: Socket Mode (src/socket-mode.js), no public URL. A link code
//     generated in Gladys and sent to the bot in a direct message (or with
//     /gladys) links the member to their Gladys user (linkContact). Direct
//     messages of linked members go to the brain of Gladys (publishMessage);
//     their messages, mentions and /gladys commands fire scene triggers.
//     Members who are not linked only get an invitation to link, once a day:
//     never the brain, never a scene;
//   - outgoing: onSendMessage(contact, message) -> the direct message of the
//     bot with the member (conversations.open), text and image (upload v2).
//     Gladys waits 5 s for the acknowledgement: what is not sent by then
//     (rate limit, slow upload) goes on in the background;
//   - scene action send_message, a widget, a "Test the connection" button.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';

import {
  AUTO_LANGUAGE,
  INTERNAL_KEYS,
  LANGUAGES,
  MEMBER_ID,
  normalizeConfig,
  readLanguage,
  readTarget,
  tokenProblem,
} from './config.js';
import { createSlackApi, SlackError } from './slack-api.js';
import { createSocketMode } from './socket-mode.js';
import { classify } from './receiver.js';
import { createStore } from './store.js';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  messageEvent,
  mentionEvent,
  commandEvent,
  messageLink,
  createFailureEvents,
} from './events.js';
import { WIDGETS, WIDGET_ACTIONS, MAX_RECENT, buildStatusWidget } from './widgets.js';
import {
  MAX_GLADYS_TEXT,
  decodeImage,
  escapeMrkdwn,
  escapeText,
  plainText,
  splitText,
  shorten,
} from './text.js';
import { all, t } from './i18n.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const CONFIG_ACTIONS = { TEST_CONNECTION: 'test_connection' };
// The link codes of Gladys: 8 characters of an alphabet without 0/O, 1/I/L
// (server/lib/external-integration/externalIntegration.createLinkCode.js).
const LINK_CODE = /^[A-HJKMNP-Z2-9]{8}$/;
// A message older than this (a re-delivery after an outage) does not reach
// the brain nor the scenes: "open the garage" from an hour ago must not run.
const MAX_MESSAGE_AGE_MS = 5 * 60_000;
// Gladys waits 5 s for the acknowledgement of a message to send.
const SEND_DEADLINE_MS = 4000;
// A connection lost for less than this (the refresh of Slack every few hours)
// is not reported on the Configuration screen.
const LOST_GRACE_MS = 30_000;
const IDENTITY_RETRY_MS = 60_000;
const CONTACTS_TTL_MS = 60_000;
const MAX_STATUS = 200;

/**
 * @description A link code sent in a message, if it is one.
 * @param {string} text - The plain text.
 * @returns {string|null} The code, in capitals.
 * @example
 * linkCodeOf(' abcd2345 '); // -> 'ABCD2345'
 */
function linkCodeOf(text) {
  const code = String(text ?? '')
    .trim()
    .toUpperCase();
  return LINK_CODE.test(code) ? code : null;
}

/**
 * @description Cut every language of a message to the 200 characters of the
 * Configuration screen and of the toasts.
 * @param {Record<string, string>} message - The message.
 * @returns {Record<string, string>} The message.
 */
const bounded = (message) =>
  Object.fromEntries(
    Object.entries(message).map(([language, text]) => [language, shorten(text, MAX_STATUS)]),
  );

/**
 * @description Register the handlers of the integration on a Gladys client.
 * @param {object} gladys - The GladysIntegration client (real or fake).
 * @param {object} [options] - Options (injected by the tests).
 * @param {object} [options.api] - The Web API client (createSlackApi).
 * @param {Function} [options.WebSocketImpl] - The `ws` class.
 * @param {object} [options.socketDelays] - Delays of Socket Mode (tests).
 * @param {string} [options.statePath] - The state file.
 * @param {() => number} [options.now] - Clock.
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles (start, stop, and what the tests look at).
 * @example
 * const app = createApp(new GladysIntegration());
 */
function createApp(
  gladys,
  {
    api: injectedApi,
    WebSocketImpl,
    socketDelays,
    statePath,
    now = () => Date.now(),
    logger = sdkLogger,
  } = {},
) {
  const api = injectedApi ?? createSlackApi({ logger, now });
  const store = createStore({ logger, now, ...(statePath ? { path: statePath } : {}) });
  const failures = createFailureEvents(gladys, logger);

  let config = normalizeConfig();
  let identity = null; // auth.test: { url, team, team_id, user, user_id, bot_id }
  let identityError = null;
  let connection = 'not_configured';
  let language = 'en';
  let lastStatus = null;
  let lostTimer = null;
  let identityTimer = null;
  let contactsCache = { at: 0, list: [] };
  let defaultChannelLabel = null;
  const recent = [];
  // Incoming messages are handled one after the other, in order.
  let queue = Promise.resolve();
  // Deliveries still running after their acknowledgement.
  const background = new Set();

  const replyLanguage = () => (config.language === AUTO_LANGUAGE ? language : config.language);
  const languageOf = (user) =>
    LANGUAGES.includes(user?.language) ? user.language : replyLanguage();

  // --- Gladys side -------------------------------------------------------------------

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} connected - Connected or not.
   * @param {object} [message] - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(connected, message) {
    const signature = JSON.stringify([connected, message ?? null]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, message ? bounded(message) : undefined);
    } catch (err) {
      lastStatus = null;
      logger.warn(`Unable to report the connection status: ${err.message}`);
    }
  }

  const requestRefresh = () => {
    try {
      gladys.requestWidgetRefresh(WIDGETS.STATUS);
    } catch {
      // best effort
    }
  };

  /**
   * @description Remember the language of a dashboard (for `auto`).
   * @param {string} next - The language.
   */
  function rememberLanguage(next) {
    if (!LANGUAGES.includes(next) || next === language) {
      return;
    }
    language = next;
    Promise.resolve()
      .then(() => gladys.setConfig({ [INTERNAL_KEYS.language]: next }))
      .catch((err) => logger.debug(`Unable to store the language: ${err.message}`));
  }

  /**
   * @description The linked contacts (cached a minute).
   * @param {boolean} [fresh] - Skip the cache.
   * @returns {Promise<object[]>} getContacts entries.
   */
  async function linkedContacts(fresh = false) {
    if (!fresh && now() - contactsCache.at < CONTACTS_TTL_MS) {
      return contactsCache.list;
    }
    try {
      const list = await gladys.getContacts();
      contactsCache = { at: now(), list: Array.isArray(list) ? list : [] };
    } catch (err) {
      logger.warn(`Unable to read the linked contacts: ${err.message}`);
    }
    return contactsCache.list;
  }

  const contactOf = async (member) =>
    (await linkedContacts()).find((entry) => entry.contact_id === member) ?? null;

  // --- Slack identity and connection -------------------------------------------------

  /**
   * @description The connection state changed (Socket Mode or tokens).
   * @param {string} next - A key of CONNECTION (src/widgets.js).
   * @param {object} [detail] - `{ error }`.
   */
  function onConnection(next, detail = {}) {
    const before = connection;
    connection = next;
    if (next === 'connected') {
      clearTimeout(lostTimer);
      lostTimer = null;
      reportStatus(
        true,
        all('statusConnected', { team: identity?.team ?? '?', bot: identity?.user ?? '?' }),
      );
    } else if (next === 'refused') {
      clearTimeout(lostTimer);
      lostTimer = null;
      reportStatus(false, all('statusAppRefused', { error: detail.error ?? '?' }));
    } else if (next === 'disabled') {
      clearTimeout(lostTimer);
      lostTimer = null;
      reportStatus(false, all('statusSocketDisabled'));
    } else if ((next === 'reconnecting' || next === 'connecting') && !lostTimer) {
      // The refresh of Slack every few hours takes a second: say nothing
      // unless the connection stays down.
      lostTimer = setTimeout(() => {
        lostTimer = null;
        if (connection !== 'connected' && connection !== 'stopped') {
          const unreachable = ['network', 'no_hello', 'ping_timeout'].includes(detail.error);
          reportStatus(false, all(unreachable ? 'statusUnreachable' : 'statusReconnecting'));
        }
      }, LOST_GRACE_MS);
      lostTimer.unref?.();
    }
    if (before !== next) {
      requestRefresh();
    }
  }

  const socket = createSocketMode({
    openUrl: () => api.connectionsOpen(config.appToken),
    onEnvelope: (envelope) => onEnvelope(envelope),
    onState: (state, detail) => onConnection(state, detail),
    logger,
    ...(WebSocketImpl ? { WebSocketImpl } : {}),
    ...(socketDelays ? { delays: socketDelays } : {}),
  });

  /**
   * @description Who the bot is (auth.test), then Socket Mode.
   * @returns {Promise<void>}
   */
  async function connect() {
    socket.stop();
    clearTimeout(identityTimer);
    identityTimer = null;
    api.clearCaches?.();
    const problem = tokenProblem(config);
    if (problem) {
      identity = null;
      connection = 'not_configured';
      const key = {
        missing: 'statusMissing',
        bot_token_format: 'statusBotFormat',
        app_token_format: 'statusAppFormat',
      }[problem];
      await reportStatus(false, all(key));
      requestRefresh();
      return;
    }
    try {
      identity = await api.authTest(config.botToken);
      identityError = null;
      logger.info(`Slack bot @${identity.user} in the workspace ${identity.team}`);
    } catch (err) {
      identity = null;
      identityError = err;
      if (err instanceof SlackError && ['auth', 'permission'].includes(err.reason)) {
        logger.warn(`Slack refuses the bot token (${err.code})`);
        connection = 'refused';
        await reportStatus(false, all('statusBotRefused', { error: err.code }));
      } else {
        logger.warn(`Slack unreachable (${err.code ?? err.message}): retrying in a minute`);
        connection = 'reconnecting';
        await reportStatus(
          false,
          all(err.reason === 'network' ? 'statusUnreachable' : 'statusError', {
            error: err.code ?? '?',
          }),
        );
        identityTimer = setTimeout(() => connect().catch(() => {}), IDENTITY_RETRY_MS);
        identityTimer.unref?.();
      }
      requestRefresh();
      return;
    }
    defaultChannelLabel = await describeTarget(config.defaultChannel);
    socket.start();
  }

  /**
   * @description How a target shows in the widget: '#name' or a member name.
   * @param {{ kind: string, id: string }|null} target - The target.
   * @returns {Promise<string|null>} The label.
   */
  async function describeTarget(target) {
    if (!target) {
      return null;
    }
    try {
      if (target.kind === 'member') {
        return `@${(await api.userInfo(config.botToken, target.id)).display}`;
      }
      const info = await api.conversationInfo(config.botToken, target.id);
      return info.name ? `#${info.name}` : target.id;
    } catch {
      return target.id;
    }
  }

  // --- replies in Slack ----------------------------------------------------------------

  /**
   * @description Post a text of the integration, best effort.
   * @param {string} channel - The channel (D… for a direct message).
   * @param {string} text - Plain text.
   * @param {string|null} [threadTs] - Reply in a thread.
   * @returns {Promise<boolean>} Whether it was posted.
   */
  async function reply(channel, text, threadTs = null) {
    try {
      await api.postMessage(config.botToken, {
        channel,
        text: escapeText(text),
        ...(threadTs ? { thread_ts: threadTs } : {}),
      });
      store.count('sent');
      return true;
    } catch (err) {
      logger.warn(`Unable to reply in Slack: ${err.code ?? err.message}`);
      return false;
    }
  }

  /**
   * @description Remember a message for the widget (memory only).
   * @param {object} entry - `{ kind, name, user, text, channel, channelLabel, at, link }`.
   */
  function remember(entry) {
    recent.unshift(entry);
    recent.length = Math.min(recent.length, MAX_RECENT);
    requestRefresh();
  }

  /**
   * @description Try a link code: link the member to the Gladys user who
   * generated it.
   * @param {string} code - The code.
   * @param {string} member - The member id.
   * @returns {Promise<{ status: 'linked'|'refused'|'error', user?: object }>} The result.
   */
  async function tryLink(code, member) {
    let display;
    try {
      display = (await api.userInfo(config.botToken, member)).display;
    } catch {
      display = undefined;
    }
    try {
      const user = await gladys.linkContact(code, member, display);
      contactsCache = { at: 0, list: [] };
      store.forgetInvitation(member);
      logger.info(`Slack member ${member} linked to the Gladys user ${user?.selector ?? '?'}`);
      return { status: 'linked', user };
    } catch (err) {
      if (err?.status === 404) {
        logger.info(`Link code refused for the Slack member ${member}`);
        return { status: 'refused' };
      }
      logger.warn(`Unable to link the Slack member ${member}: ${err.message}`);
      return { status: 'error' };
    }
  }

  /**
   * @description The display name of a member, best effort.
   * @param {string} member - The member id.
   * @returns {Promise<string>} The name.
   */
  async function nameOf(member) {
    try {
      return (await api.userInfo(config.botToken, member)).display;
    } catch {
      return member;
    }
  }

  // --- incoming --------------------------------------------------------------------------

  /**
   * @description Fire a scene event, best effort.
   * @param {string} key - The trigger.
   * @param {object} data - The data.
   */
  async function fire(key, data) {
    try {
      await gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Unable to publish the ${key} event: ${err.message}`);
    }
  }

  /**
   * @description A direct message to the bot.
   * @param {object} message - A classified message (channelType 'im').
   * @param {string} text - Its plain text.
   * @returns {Promise<void>}
   */
  async function directMessage(message, text) {
    const code = linkCodeOf(text);
    const contact = await contactOf(message.user);
    if (code) {
      const result = await tryLink(code, message.user);
      if (result.status === 'linked') {
        await reply(
          message.channel,
          t('replyLinked', languageOf(result.user), { name: result.user?.first_name ?? '' }),
        );
        return;
      }
      if (result.status === 'error') {
        await reply(message.channel, t('replyUnavailable', languageOf(contact?.user)));
        return;
      }
      if (!contact) {
        await reply(message.channel, t('replyCodeRefused', replyLanguage()));
        return;
      }
      // A linked member wrote something that looks like a code: a message.
    }
    if (!contact) {
      logger.info(`Direct message from ${message.user}, a member not linked to Gladys`);
      if (store.invite(message.user)) {
        await reply(message.channel, t('replyInvite', replyLanguage()));
      }
      return;
    }
    store.count('received');
    const name = contact.user?.first_name || (await nameOf(message.user));
    remember({
      kind: 'im',
      name,
      user: message.user,
      text,
      channel: message.channel,
      at: message.at ?? now(),
      link: messageLink(identity?.url, message.channel, message.ts, message.threadTs),
    });
    if (config.forwardDirect && text) {
      try {
        await gladys.publishMessage(message.user, text.slice(0, MAX_GLADYS_TEXT), {
          createdAt: new Date(message.at ?? now()),
        });
      } catch (err) {
        if (err?.status === 404) {
          // Unlinked in Gladys in the meantime.
          contactsCache = { at: 0, list: [] };
          if (store.invite(message.user)) {
            await reply(message.channel, t('replyInvite', replyLanguage()));
          }
          return;
        }
        logger.warn(`Gladys refused the message of ${message.user}: ${err.message}`);
        await reply(message.channel, t('replyUnavailable', languageOf(contact.user)));
      }
    }
    await fire(
      TRIGGERS.MESSAGE_RECEIVED,
      messageEvent({ ...message, text, userName: name, gladysUser: contact.user }, identity?.url),
    );
  }

  /**
   * @description A message in a channel, or a mention of the bot.
   * @param {object} message - A classified message or mention.
   * @param {string} text - Its plain text.
   * @returns {Promise<void>}
   */
  async function channelMessage(message, text) {
    const contact = await contactOf(message.user);
    if (!contact) {
      logger.debug(`Message of ${message.user} in ${message.channel}: member not linked, ignored`);
      return;
    }
    const name = contact.user?.first_name || (await nameOf(message.user));
    const data = { ...message, text, userName: name, gladysUser: contact.user };
    const link = messageLink(identity?.url, message.channel, message.ts, message.threadTs);
    let channelLabel = message.channel;
    try {
      const info = await api.conversationInfo(config.botToken, message.channel);
      channelLabel = info.name ? `#${info.name}` : message.channel;
    } catch {
      // the id will do
    }
    if (message.kind === 'mention') {
      store.count('received');
      remember({
        kind: 'mention',
        name,
        user: message.user,
        text,
        channel: message.channel,
        channelLabel,
        at: message.at ?? now(),
        link,
      });
      await fire(TRIGGERS.MENTION_RECEIVED, mentionEvent(data, identity?.url));
      return;
    }
    // A message that mentions the bot is also an app_mention: counted there.
    if (!(identity?.user_id && message.rawText.includes(`<@${identity.user_id}>`))) {
      store.count('received');
      remember({
        kind: 'channel',
        name,
        user: message.user,
        text,
        channel: message.channel,
        channelLabel,
        at: message.at ?? now(),
        link,
      });
    }
    await fire(TRIGGERS.MESSAGE_RECEIVED, messageEvent(data, identity?.url));
  }

  /**
   * @description The plain text of a message, the members it mentions by
   * their display name.
   * @param {string} raw - The Slack text.
   * @returns {Promise<string>} Plain text.
   */
  async function readText(raw) {
    const names = new Map();
    for (const [, id] of String(raw ?? '').matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)) {
      if (id !== identity?.user_id && !names.has(id) && names.size < 10) {
        names.set(id, await nameOf(id));
      }
    }
    return plainText(raw, {
      botUserId: identity?.user_id ?? null,
      nameOf: (id) => names.get(id) ?? null,
    });
  }

  /**
   * @description Handle a message or a mention (in the queue).
   * @param {object} message - A classified message.
   * @returns {Promise<void>}
   */
  async function receive(message) {
    if (Number.isFinite(message.at) && now() - message.at > MAX_MESSAGE_AGE_MS) {
      logger.info(
        `Slack message of ${message.user} delivered ${Math.round((now() - message.at) / 60000)} min late: ignored`,
      );
      return;
    }
    const text = await readText(message.rawText);
    if (message.kind === 'message' && message.channelType === 'im') {
      await directMessage(message, text);
    } else {
      await channelMessage(message, text);
    }
    await store.save();
  }

  /**
   * @description A /gladys command: answered in the acknowledgement (only the
   * member sees it), within 2.5 s.
   * @param {object} command - A classified command.
   * @returns {Promise<object>} The ack payload.
   */
  async function slashCommand(command) {
    const ephemeral = (text) => ({ response_type: 'ephemeral', text: escapeText(text) });
    const text = await readText(command.rawText);
    const code = linkCodeOf(text);
    const contact = await contactOf(command.user);
    if (code) {
      const result = await tryLink(code, command.user);
      if (result.status === 'linked') {
        return ephemeral(
          t('replyLinked', languageOf(result.user), { name: result.user?.first_name ?? '' }),
        );
      }
      if (result.status === 'error') {
        return ephemeral(t('replyUnavailable', languageOf(contact?.user)));
      }
      if (!contact) {
        return ephemeral(t('replyCodeRefused', replyLanguage()));
      }
    }
    if (!contact) {
      logger.info(`/gladys from ${command.user}, a member not linked to Gladys`);
      return ephemeral(t('replyInvite', replyLanguage()));
    }
    const lang = languageOf(contact.user);
    if (!text) {
      return ephemeral(t('slashHelp', lang));
    }
    store.count('received');
    const name = contact.user?.first_name || command.userName || command.user;
    remember({
      kind: 'command',
      name,
      user: command.user,
      text,
      channel: command.channel,
      channelLabel: command.channelName ? `#${command.channelName}` : command.channel,
      at: now(),
      link: '',
    });
    const data = commandEvent({
      ...command,
      text,
      userName: command.userName || name,
      gladysUser: contact.user,
    });
    queue = queue
      .then(async () => {
        if (config.forwardDirect) {
          try {
            await gladys.publishMessage(command.user, text.slice(0, MAX_GLADYS_TEXT), {
              createdAt: new Date(now()),
            });
          } catch (err) {
            logger.warn(`Gladys refused the /gladys message of ${command.user}: ${err.message}`);
          }
        }
        await fire(TRIGGERS.SLASH_COMMAND, data);
        await store.save();
      })
      .catch((err) => logger.error('Unable to handle a /gladys command', err));
    return ephemeral(t(config.forwardDirect ? 'slashSent' : 'slashScenes', lang));
  }

  /**
   * @description An envelope of Socket Mode.
   * @param {object} envelope - The envelope.
   * @returns {Promise<object|undefined>} The ack payload of a slash command.
   */
  async function onEnvelope(envelope) {
    const item = classify(envelope, { userId: identity?.user_id, botId: identity?.bot_id });
    if (item.kind === 'ignore') {
      logger.debug(`Slack ${envelope.type} ignored (${item.reason})`);
      if (item.eventId) store.remember(item.eventId);
      return undefined;
    }
    if (identity?.team_id && item.teamId && item.teamId !== identity.team_id) {
      logger.debug('Slack event of another workspace: ignored');
      return undefined;
    }
    if (item.kind === 'command') {
      return slashCommand(item);
    }
    if (!store.remember(item.eventId)) {
      logger.debug(`Slack event ${item.eventId} already handled (retry ${item.retry})`);
      return undefined;
    }
    queue = queue
      .then(() => receive(item))
      .catch((err) => logger.error('Unable to handle a Slack message', err));
    return undefined;
  }

  // --- outgoing --------------------------------------------------------------------------

  /**
   * @description Send a text and an image to a channel.
   * @param {string} channel - The channel (D… for a member).
   * @param {string} text - Escaped text.
   * @param {object|null} image - decodeImage.
   * @returns {Promise<string|null>} The ts of the first message.
   */
  async function deliver(channel, text, image) {
    const parts = splitText(text);
    let first = null;
    if (image && parts.length <= 1) {
      await api.uploadImage(config.botToken, {
        channel,
        bytes: image.bytes,
        filename: `gladys.${image.extension}`,
        title: 'Gladys',
        comment: parts[0],
      });
      store.count('sent');
      return null;
    }
    for (const part of parts) {
      const sent = await api.postMessage(config.botToken, { channel, text: part });
      store.count('sent');
      first = first ?? sent.ts;
    }
    if (image) {
      await api.uploadImage(config.botToken, {
        channel,
        bytes: image.bytes,
        filename: `gladys.${image.extension}`,
        title: 'Gladys',
      });
    }
    return first;
  }

  /**
   * @description A message of Gladys could not be delivered.
   * @param {string} member - The member.
   * @param {Error} err - The failure.
   * @returns {Promise<void>}
   */
  async function deliveryFailed(member, err) {
    store.count('failed');
    const reason = err instanceof SlackError ? err.reason : 'other';
    logger.warn(`Message to the Slack member ${member} not delivered: ${err.code ?? err.message}`);
    const contact = await contactOf(member);
    await failures.failed({
      target: member,
      user: contact?.user ?? null,
      reason,
      error: err.code ?? err.message,
    });
    await store.save();
    requestRefresh();
  }

  gladys.onSendMessage(async (contact, message) => {
    const member = String(contact?.id ?? '');
    if (!MEMBER_ID.test(member)) {
      throw new Error('The contact is not a Slack member id');
    }
    if (tokenProblem(config) || !identity) {
      throw new Error('The Slack integration is not connected');
    }
    const text = escapeText(String(message?.text ?? ''));
    const image = decodeImage(message?.file);
    if (message?.file && !image) {
      logger.warn('The attached file is not an image: only the text is sent');
    }
    if (!text.trim() && !image) {
      throw new Error('Empty message');
    }
    const delivery = (async () => {
      const channel = await api.openDm(config.botToken, member);
      await deliver(channel, text, image);
      failures.delivered(member);
      await store.save();
    })();
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => resolve('late'), SEND_DEADLINE_MS);
      timer.unref?.();
    });
    const outcome = await Promise.race([delivery.then(() => 'done'), late]).catch(async (err) => {
      await deliveryFailed(member, err);
      throw err;
    });
    clearTimeout(timer);
    if (outcome === 'late') {
      // Acknowledge now; the rest goes on (rate limit, upload).
      logger.info(`Message to ${member} still being sent after ${SEND_DEADLINE_MS / 1000} s`);
      const tracked = delivery
        .catch((err) => deliveryFailed(member, err))
        .finally(() => background.delete(tracked));
      background.add(tracked);
    }
  });

  // --- scene action ----------------------------------------------------------------------

  gladys.onSceneAction(SCENE_ACTIONS.SEND_MESSAGE, async (fields) => {
    if (tokenProblem(config)) {
      throw new Error('The Slack integration is not configured');
    }
    const raw = String(fields?.target ?? '').trim();
    const target = raw ? readTarget(raw) : config.defaultChannel;
    if (!target) {
      throw new Error(
        raw
          ? 'Invalid target: a channel ID (C…) or a member ID (U…)'
          : 'No target and no default channel in the configuration',
      );
    }
    const text = escapeMrkdwn(String(fields?.text ?? '').trim());
    if (!text) {
      throw new Error('Empty message');
    }
    const threadTs = String(fields?.thread_ts ?? '').trim();
    if (threadTs && !/^\d+\.\d+$/.test(threadTs)) {
      throw new Error('Invalid thread: the ts of a message, e.g. 1700000000.000100');
    }
    const channel =
      target.kind === 'member' ? await api.openDm(config.botToken, target.id) : target.id;
    let first = null;
    for (const part of splitText(text)) {
      const sent = await api.postMessage(
        config.botToken,
        { channel, text: part, ...(threadTs ? { thread_ts: threadTs } : {}) },
        { maxWaitMs: 20_000 },
      );
      store.count('sent');
      first = first ?? sent;
    }
    await store.save();
    return {
      ts: first?.ts ?? '',
      channel_id: first?.channel ?? channel,
      link: messageLink(identity?.url, first?.channel ?? channel, first?.ts, threadTs || null),
    };
  });

  // --- widget --------------------------------------------------------------------------

  gladys.onWidgetGet(WIDGETS.STATUS, async ({ settings, language: lang } = {}) => {
    rememberLanguage(lang);
    const members = tokenProblem(config) ? 0 : (await linkedContacts()).length;
    return buildStatusWidget({
      connection: tokenProblem(config) ? 'not_configured' : connection,
      team: identity?.team ?? null,
      bot: identity?.user ?? null,
      channel: defaultChannelLabel,
      counters: store.counters(),
      members,
      recent,
      showText: settings?.show_text === true || settings?.show_text === 'true',
      language: LANGUAGES.includes(lang) ? lang : 'en',
    });
  });

  gladys.onWidgetAction(WIDGETS.STATUS, async (actionKey) => {
    if (actionKey !== WIDGET_ACTIONS.SEND_TEST) {
      return undefined;
    }
    if (tokenProblem(config) || !identity) {
      return all('errorNotConfigured');
    }
    const lang = replyLanguage();
    try {
      if (config.defaultChannel) {
        const channel =
          config.defaultChannel.kind === 'member'
            ? await api.openDm(config.botToken, config.defaultChannel.id)
            : config.defaultChannel.id;
        await api.postMessage(config.botToken, {
          channel,
          text: escapeText(t('testMessage', lang)),
        });
        store.count('sent');
        await store.save();
        return bounded(
          all('toastTestSent', { target: defaultChannelLabel ?? config.defaultChannel.id }),
        );
      }
      const contacts = await linkedContacts(true);
      if (contacts.length === 0) {
        return bounded(all('toastTestNoTarget'));
      }
      for (const contact of contacts) {
        const channel = await api.openDm(config.botToken, contact.contact_id);
        await api.postMessage(config.botToken, {
          channel,
          text: escapeText(t('testMessage', languageOf(contact.user))),
        });
        store.count('sent');
      }
      await store.save();
      return bounded(
        all('toastTestSent', (l) => ({
          target: t('linkedMembers', l, { count: contacts.length }),
        })),
      );
    } catch (err) {
      return bounded(all('toastTestFailed', { error: err.code ?? err.message }));
    }
  });

  // --- Configuration screen ----------------------------------------------------------

  gladys.onAction(CONFIG_ACTIONS.TEST_CONNECTION, async () => {
    if (tokenProblem(config)) {
      return bounded(
        all(
          {
            missing: 'statusMissing',
            bot_token_format: 'statusBotFormat',
            app_token_format: 'statusAppFormat',
          }[tokenProblem(config)],
        ),
      );
    }
    try {
      identity = await api.authTest(config.botToken);
    } catch (err) {
      if (err instanceof SlackError && err.reason === 'auth') {
        return bounded(all('statusBotRefused', { error: err.code }));
      }
      return bounded(
        all(err.reason === 'network' ? 'statusUnreachable' : 'statusError', {
          error: err.code ?? err.message,
        }),
      );
    }
    let channel = (l) => t('channelNone', l);
    if (config.defaultChannelRaw && !config.defaultChannel) {
      channel = (l) => t('channelInvalid', l);
    } else if (config.defaultChannel?.kind === 'member') {
      const name = await nameOf(config.defaultChannel.id);
      channel = (l) => t('memberTarget', l, { name });
    } else if (config.defaultChannel) {
      api.clearCaches?.();
      try {
        const info = await api.conversationInfo(config.botToken, config.defaultChannel.id);
        defaultChannelLabel = info.name ? `#${info.name}` : info.id;
        channel = (l) =>
          t(info.is_member || info.is_im ? 'channelOk' : 'channelNotMember', l, {
            name: info.name || info.id,
          });
      } catch {
        channel = (l) => t('channelUnknown', l, { id: config.defaultChannel.id });
      }
    }
    const members = (await linkedContacts(true)).length;
    logger.info(
      `Slack test: integration ${version}, Socket Mode ${socket.state()}, ${JSON.stringify(socket.stats())}`,
    );
    return bounded(
      all('testOk', (l) => ({
        team: identity.team,
        bot: identity.user,
        socket: t(socket.connected() ? 'socketUp' : 'socketDown', l),
        channel: channel(l),
        members,
      })),
    );
  });

  // --- lifecycle ---------------------------------------------------------------------------

  /**
   * @description Read the configuration.
   * @param {object} [raw] - The raw config (else fetched).
   * @returns {Promise<void>}
   */
  async function loadConfig(raw) {
    let values = raw;
    if (!values) {
      try {
        values = await gladys.getConfig();
      } catch (err) {
        logger.warn(`Unable to read the configuration: ${err.message}`);
        values = gladys.config ?? {};
      }
    }
    config = normalizeConfig(values ?? {});
    language = readLanguage(values, language);
  }

  gladys.onConfigUpdated(async (raw) => {
    await loadConfig(raw);
    contactsCache = { at: 0, list: [] };
    lastStatus = null;
    logger.info('Configuration updated: reconnecting to Slack');
    await connect();
  });

  return {
    /**
     * @description Read the state and the configuration, connect to Slack.
     * @returns {Promise<void>}
     */
    async start() {
      await store.load();
      await loadConfig();
      await connect();
    },
    /**
     * @description Disconnect and write the state.
     * @returns {Promise<void>}
     */
    async stop() {
      socket.stop();
      clearTimeout(lostTimer);
      clearTimeout(identityTimer);
      await Promise.race([
        Promise.all([queue, ...background]),
        new Promise((resolve) => setTimeout(resolve, 3000).unref()),
      ]);
      await store.save();
    },
    store,
    socket,
    recent,
    idle: () => Promise.all([queue, ...background]),
    getConfig: () => config,
    getIdentity: () => identity,
    getIdentityError: () => identityError,
    connection: () => connection,
  };
}

export { createApp, CONFIG_ACTIONS, MAX_MESSAGE_AGE_MS, SEND_DEADLINE_MS, linkCodeOf };
