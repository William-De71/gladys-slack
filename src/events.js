// -----------------------------------------------------------------------------
// Scene triggers and the scene action of the Slack integration: their keys
// (eternal, like the external ids: scenes store them) and the flat data of
// each event.
//
// Triggers (one event per thing that happened, only for members linked to a
// Gladys user, never because of a scene action of this integration):
//   message_received   a linked member wrote to the bot in a direct message,
//                      or in a channel the bot was invited to
//   mention_received   a linked member mentioned @bot in a channel
//   slash_command      a linked member typed /gladys …
//   message_not_sent   a message of Gladys to a member could not be delivered
//                      (once, then again only after a message went through)
//
// Action:
//   send_message       post a message in a channel, or in a direct message to
//                      a member; outputs ts, channel_id, link
// -----------------------------------------------------------------------------

import { shorten } from './text.js';

const TRIGGERS = {
  MESSAGE_RECEIVED: 'message_received',
  MENTION_RECEIVED: 'mention_received',
  SLASH_COMMAND: 'slash_command',
  MESSAGE_NOT_SENT: 'message_not_sent',
};

const SCENE_ACTIONS = { SEND_MESSAGE: 'send_message' };

// Event data: strings of 1,000 characters at most.
const MAX_EVENT_STRING = 1000;

const CHANNEL_TYPES = ['im', 'channel', 'group'];

/**
 * @description A string for event data.
 * @param {any} value - The value.
 * @returns {string} At most 1,000 characters.
 */
const str = (value) => shorten(value ?? '', MAX_EVENT_STRING);

/**
 * @description The link of a message, built from the workspace URL of
 * auth.test (no API call): https://team.slack.com/archives/C…/p1234567890123456.
 * @param {string|null} workspaceUrl - auth.test `url`.
 * @param {string} channel - The channel id.
 * @param {string} ts - The message ts.
 * @param {string|null} [threadTs] - The thread of a reply.
 * @returns {string} The link, '' when unknown.
 * @example
 * messageLink('https://home.slack.com/', 'C1', '1700000000.000100');
 * // -> 'https://home.slack.com/archives/C1/p1700000000000100'
 */
function messageLink(workspaceUrl, channel, ts, threadTs = null) {
  if (!workspaceUrl || !channel || !/^\d+\.\d+$/.test(String(ts ?? ''))) {
    return '';
  }
  const base = workspaceUrl.endsWith('/') ? workspaceUrl : `${workspaceUrl}/`;
  const link = `${base}archives/${channel}/p${String(ts).replace('.', '')}`;
  return threadTs && threadTs !== ts ? `${link}?thread_ts=${threadTs}&cid=${channel}` : link;
}

/**
 * @description The people part of an event.
 * @param {object} message - A classified message (receiver.js).
 * @returns {object} user_id, user_name, gladys_user, first_name.
 */
const who = (message) => ({
  user_id: message.user,
  user_name: str(message.userName),
  gladys_user: message.gladysUser?.selector ?? '',
  first_name: str(message.gladysUser?.first_name),
});

/**
 * @description Data of `message_received`.
 * @param {object} message - A classified message.
 * @param {string|null} workspaceUrl - For the link.
 * @returns {object} Flat event data.
 */
const messageEvent = (message, workspaceUrl) => ({
  text: str(message.text),
  ...who(message),
  channel_id: message.channel,
  channel_type: CHANNEL_TYPES.includes(message.channelType) ? message.channelType : 'channel',
  ts: message.ts,
  thread_ts: message.threadTs ?? '',
  link: messageLink(workspaceUrl, message.channel, message.ts, message.threadTs),
});

/**
 * @description Data of `mention_received`.
 * @param {object} message - A classified mention.
 * @param {string|null} workspaceUrl - For the link.
 * @returns {object} Flat event data.
 */
const mentionEvent = (message, workspaceUrl) => ({
  text: str(message.text),
  ...who(message),
  channel_id: message.channel,
  ts: message.ts,
  thread_ts: message.threadTs ?? '',
  link: messageLink(workspaceUrl, message.channel, message.ts, message.threadTs),
});

/**
 * @description Data of `slash_command`.
 * @param {object} command - A classified slash command.
 * @returns {object} Flat event data.
 */
const commandEvent = (command) => ({
  text: str(command.text),
  command: str(command.command),
  ...who(command),
  channel_id: command.channel,
  channel_name: str(command.channelName),
});

/**
 * @description Data of `message_not_sent`.
 * @param {object} failure - `{ target, user, reason, error }`.
 * @returns {object} Flat event data.
 */
const notSentEvent = ({ target, user, reason, error }) => ({
  target,
  gladys_user: user?.selector ?? '',
  first_name: str(user?.first_name),
  reason,
  error: str(error),
});

/**
 * @description Fire `message_not_sent` once per target until a message to it
 * goes through again: a scene warning on Slack about Slack cannot loop.
 * @param {object} gladys - The Gladys client.
 * @param {object} logger - Logger.
 * @returns {{ failed: Function, delivered: Function }} The tracker.
 */
function createFailureEvents(gladys, logger) {
  const failing = new Set();
  return {
    /**
     * @param {object} failure - `{ target, user, reason, error }`.
     * @returns {Promise<boolean>} Whether an event was published.
     */
    async failed(failure) {
      if (failing.has(failure.target)) {
        return false;
      }
      failing.add(failure.target);
      try {
        await gladys.publishSceneEvent(TRIGGERS.MESSAGE_NOT_SENT, notSentEvent(failure));
        return true;
      } catch (err) {
        logger.warn(`Unable to publish the message_not_sent event: ${err.message}`);
        return false;
      }
    },
    /** @param {string} target - A message to this target went through. */
    delivered(target) {
      failing.delete(target);
    },
  };
}

export {
  TRIGGERS,
  SCENE_ACTIONS,
  CHANNEL_TYPES,
  MAX_EVENT_STRING,
  messageLink,
  messageEvent,
  mentionEvent,
  commandEvent,
  notSentEvent,
  createFailureEvents,
};
