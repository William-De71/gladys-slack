// -----------------------------------------------------------------------------
// The dashboard widget of the Slack integration (pure: the contents are built
// from plain data, so that docs/illustrations draws them with this code).
//
//   status   the Socket Mode connection, the workspace, the bot, the default
//            channel; three tiles (received and sent today, linked members);
//            the last messages of linked members (8 at most, kept in memory
//            only: never on disk); a "Send a test" button.
//
// A dashboard can be shared by every user of the house: the text of the
// messages only shows when the widget setting `show_text` is on. Budget of
// the card: 1 caption, 3 tiles, 1 card-list, 1 status, 1 button (7 of 8).
// -----------------------------------------------------------------------------

import { t } from './i18n.js';
import { shorten } from './text.js';

const WIDGETS = { STATUS: 'status' };
const WIDGET_ACTIONS = { SEND_TEST: 'send_test' };
const MAX_RECENT = 8;

const CONNECTION = {
  connected: { key: 'widgetConnected', color: 'success' },
  connecting: { key: 'widgetReconnecting', color: 'warning' },
  reconnecting: { key: 'widgetReconnecting', color: 'warning' },
  refused: { key: 'widgetRefused', color: 'danger' },
  disabled: { key: 'widgetSocketOff', color: 'danger' },
  not_configured: { key: 'widgetNotConfigured', color: 'neutral' },
  stopped: { key: 'widgetNotConfigured', color: 'neutral' },
};

const KIND_BADGES = {
  im: { key: 'widgetKindDm', color: 'primary' },
  mention: { key: 'widgetKindMention', color: 'info' },
  command: { key: 'widgetKindCommand', color: 'success' },
  channel: { key: 'widgetKindChannel', color: 'neutral' },
};

/**
 * @description The title of a message card.
 * @param {object} entry - A recent message.
 * @param {boolean} showText - Whether the text may show.
 * @returns {string} The title, ≤ 60 characters.
 */
function cardTitle(entry, showText) {
  const name = entry.name || entry.user;
  if (!showText || !entry.text) {
    return shorten(name, 60);
  }
  return shorten(`${name}: ${entry.text}`, 60);
}

/**
 * @description The content of the status widget.
 * @param {object} data - The data.
 * @param {string} data.connection - A key of CONNECTION.
 * @param {string|null} data.team - The workspace name.
 * @param {string|null} data.bot - The bot user name.
 * @param {string|null} data.channel - The default channel, as shown ('#home'), or null.
 * @param {{ received: number, sent: number }} data.counters - Counters of the day.
 * @param {number} data.members - Linked members.
 * @param {object[]} data.recent - `{ kind, name, user, text, channel, at, link }`, newest first.
 * @param {boolean} data.showText - The widget setting.
 * @param {string} data.language - en, fr, de or es.
 * @returns {object} The widget content.
 */
function buildStatusWidget({
  connection,
  team,
  bot,
  channel,
  counters,
  members,
  recent,
  showText,
  language,
}) {
  const state = CONNECTION[connection] ?? CONNECTION.not_configured;
  const components = [
    { type: 'text', variant: 'caption', text: t('widgetToday', language) },
    {
      type: 'value',
      value: counters.received,
      label: t('widgetReceived', language),
      icon: 'inbox',
      color: 'primary',
    },
    {
      type: 'value',
      value: counters.sent,
      label: t('widgetSent', language),
      icon: 'send',
      color: 'info',
    },
    {
      type: 'value',
      value: members,
      label: t('widgetMembers', language),
      icon: 'users',
      color: members > 0 ? 'success' : 'neutral',
    },
  ];
  const items = recent.slice(0, MAX_RECENT).map((entry) => {
    const badge = KIND_BADGES[entry.kind] ?? KIND_BADGES.channel;
    const where = entry.channelLabel || entry.channel;
    const item = {
      title: cardTitle(entry, showText),
      date: new Date(entry.at).toISOString(),
      badge: { text: t(badge.key, language), color: badge.color },
      description: showText
        ? shorten(entry.text || '…', 2000)
        : entry.kind === 'im'
          ? t('widgetHiddenDm', language)
          : t('widgetHiddenIn', language, { channel: where }),
    };
    if (entry.link) {
      item.links = [{ url: entry.link, label: 'Slack' }];
    }
    return item;
  });
  if (items.length > 0) {
    components.push({ type: 'card-list', display: 'list', items });
  } else {
    components.push({ type: 'text', variant: 'body', text: t('widgetNoMessage', language) });
  }
  const rows = [
    {
      label: t('widgetConnection', language),
      value: t(state.key, language),
      color: state.color,
    },
  ];
  if (team) {
    rows.push({ label: t('widgetWorkspace', language), value: shorten(team, 40) });
  }
  if (bot) {
    rows.push({ label: t('widgetBot', language), value: shorten(`@${bot}`, 40) });
  }
  if (channel) {
    rows.push({ label: t('widgetDefaultChannel', language), value: shorten(channel, 40) });
  }
  components.push({ type: 'status', items: rows });
  if (connection === 'connected') {
    components.push({
      type: 'button',
      label: t('widgetTest', language),
      icon: 'send',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.SEND_TEST, params: {} },
    });
  }
  return { ttl_seconds: 60, components };
}

export { WIDGETS, WIDGET_ACTIONS, MAX_RECENT, CONNECTION, buildStatusWidget };
