// -----------------------------------------------------------------------------
// What a Socket Mode envelope means for Gladys (pure, no I/O).
//
//   events_api      `payload` is the event_callback of the Events API:
//                   `{ event_id, event_time, team_id, event: { type, … } }`
//     message       a message in a conversation the bot is in: a direct
//                   message (`channel_type: "im"`, event message.im), a
//                   public (message.channels) or private channel
//                   (message.groups). Group DMs (mpim) are not subscribed.
//     app_mention   @bot in a channel
//   slash_commands  `/gladys …`: `{ command, text, user_id, channel_id, … }`
//   interactive     not used (acknowledged and dropped)
//
// Dropped, with the reason (debug logs): messages of bots, the bot itself
// included (`bot_id`, `bot_profile`, the bot's own member id); edits,
// deletions and every other subtype except a message with a file
// (`file_share`), a thread reply also sent to the channel (`thread_broadcast`)
// and /me (`me_message`); hidden events.
// -----------------------------------------------------------------------------

const KEPT_SUBTYPES = ['file_share', 'thread_broadcast', 'me_message'];
const CHANNEL_TYPES = { im: 'im', channel: 'channel', group: 'group' };

/**
 * @description The instant of a Slack ts ('1700000000.000100'), in ms.
 * @param {string} ts - The ts.
 * @returns {number|null} The instant.
 */
function instantOf(ts) {
  const seconds = Number.parseFloat(ts);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

/**
 * @description Classify an envelope.
 * @param {object} envelope - The Socket Mode envelope.
 * @param {object} bot - `{ userId, botId }` of auth.test.
 * @returns {object} `{ kind: 'ignore', reason }`, or a message
 * (`kind` 'message' | 'mention' | 'command') with its fields.
 * @example
 * classify({ type: 'events_api', payload: { event_id: 'Ev1', event: { type: 'message',
 *   channel_type: 'im', user: 'U1', channel: 'D1', text: 'hi', ts: '1.2' } } }, { userId: 'UB' });
 */
function classify(envelope, bot = {}) {
  if (envelope?.type === 'slash_commands') {
    const p = envelope.payload ?? {};
    if (typeof p.user_id !== 'string' || typeof p.channel_id !== 'string') {
      return { kind: 'ignore', reason: 'invalid_command' };
    }
    return {
      kind: 'command',
      command: String(p.command ?? ''),
      rawText: String(p.text ?? ''),
      user: p.user_id,
      userName: String(p.user_name ?? ''),
      channel: p.channel_id,
      channelName: String(p.channel_name ?? ''),
      teamId: p.team_id ?? null,
      at: null,
    };
  }
  if (envelope?.type !== 'events_api') {
    return { kind: 'ignore', reason: envelope?.type ?? 'unknown' };
  }
  const payload = envelope.payload ?? {};
  const event = payload.event;
  if (!event || typeof event !== 'object') {
    return { kind: 'ignore', reason: 'no_event' };
  }
  const base = {
    eventId: typeof payload.event_id === 'string' ? payload.event_id : null,
    retry: Number.isInteger(envelope.retry_attempt) ? envelope.retry_attempt : 0,
    teamId: payload.team_id ?? null,
  };
  if (event.hidden) {
    return { kind: 'ignore', reason: 'hidden', ...base };
  }
  if (event.bot_id || event.bot_profile || (bot.botId && event.bot_id === bot.botId)) {
    return { kind: 'ignore', reason: 'bot', ...base };
  }
  if (typeof event.user !== 'string' || !event.user) {
    return { kind: 'ignore', reason: 'no_user', ...base };
  }
  if (bot.userId && event.user === bot.userId) {
    return { kind: 'ignore', reason: 'self', ...base };
  }
  const common = {
    ...base,
    user: event.user,
    channel: String(event.channel ?? ''),
    ts: String(event.ts ?? ''),
    threadTs: typeof event.thread_ts === 'string' ? event.thread_ts : null,
    rawText: typeof event.text === 'string' ? event.text : '',
    files: Array.isArray(event.files) ? event.files.length : 0,
    at:
      instantOf(event.ts) ??
      (Number.isFinite(payload.event_time) ? payload.event_time * 1000 : null),
  };
  if (!common.channel || !common.ts) {
    return { kind: 'ignore', reason: 'incomplete', ...base };
  }
  if (event.type === 'message') {
    if (event.subtype && !KEPT_SUBTYPES.includes(event.subtype)) {
      return { kind: 'ignore', reason: `subtype:${event.subtype}`, ...base };
    }
    const channelType = CHANNEL_TYPES[event.channel_type];
    if (!channelType) {
      return { kind: 'ignore', reason: `channel_type:${event.channel_type}`, ...base };
    }
    return { kind: 'message', channelType, ...common };
  }
  if (event.type === 'app_mention') {
    // A direct message reaches the bot as message.im: never twice.
    if (common.channel.startsWith('D')) {
      return { kind: 'ignore', reason: 'mention_in_dm', ...base };
    }
    return { kind: 'mention', ...common };
  }
  return { kind: 'ignore', reason: `event:${event.type}`, ...base };
}

export { classify, instantOf, KEPT_SUBTYPES };
