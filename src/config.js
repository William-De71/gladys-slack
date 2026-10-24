// -----------------------------------------------------------------------------
// Configuration of the Slack integration (the `config_schema` of the
// manifest, filled once by an administrator of Gladys):
//
//   bot_token                 xoxb-…  the Web API (post, open a DM, upload)
//   app_token                 xapp-…  Socket Mode (apps.connections.open)
//   default_channel           C…/G…   where scene messages go when no target
//                                     is given (optional)
//   forward_direct_messages   true    direct messages of linked members go to
//                                     the brain of Gladys
//   language                  auto    the texts the integration writes itself
//                                     (link code accepted, invitation to link)
//
// Both tokens are `secret` fields: never logged, never part of an error.
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];
const AUTO_LANGUAGE = 'auto';

// The language of the last widget request, remembered for `auto`. A key the
// manifest does not declare: Gladys keeps it, the form never shows it.
const INTERNAL_KEYS = { language: 'last_dashboard_language' };

// Slack ids: a member (U… or W… on Enterprise Grid), a channel (C…), a
// private channel or a group DM (G…), a direct message (D…).
const MEMBER_ID = /^[UW][A-Z0-9]{2,20}$/;
const CHANNEL_ID = /^[CGD][A-Z0-9]{2,20}$/;
const BOT_TOKEN = /^xoxb-[A-Za-z0-9-]{10,}$/;
const APP_TOKEN = /^xapp-[A-Za-z0-9-]{10,}$/;

/**
 * @description A trimmed string, '' for anything else.
 * @param {any} value - The raw value.
 * @returns {string} The string.
 */
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @description A boolean of the configuration (Gladys may store "true").
 * @param {any} value - The raw value.
 * @param {boolean} fallback - The default when unset.
 * @returns {boolean} The value.
 */
function flag(value, fallback) {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return fallback;
}

/**
 * @description A Slack target typed by a user: a channel id, a member id, a
 * `<#C…|name>` or `<@U…>` reference copied from Slack, or a link to a
 * channel (…/archives/C…). Names (#general) are not resolved: they change,
 * ids never do.
 * @param {any} value - The raw value.
 * @returns {{ kind: 'channel'|'member', id: string }|null} The target.
 * @example
 * readTarget('<#C0123ABCD|general>'); // -> { kind: 'channel', id: 'C0123ABCD' }
 */
function readTarget(value) {
  const raw = text(value);
  if (!raw) {
    return null;
  }
  const reference = /^<([#@])([A-Z0-9]+)(?:\|[^>]*)?>$/.exec(raw);
  const archive = /\/archives\/([A-Z0-9]+)(?:[/?#]|$)/.exec(raw);
  // Ids are upper case: `#general` (a name) must not pass for G… or C….
  const id = reference?.[2] ?? archive?.[1] ?? raw.replace(/^[#@]/, '');
  if (MEMBER_ID.test(id)) {
    return { kind: 'member', id };
  }
  if (CHANNEL_ID.test(id)) {
    return { kind: 'channel', id };
  }
  return null;
}

/**
 * @description Normalize the integration configuration.
 * @param {object} [raw] - The raw values (gladys.config).
 * @returns {object} The configuration used by the integration.
 * @example
 * normalizeConfig({ bot_token: 'xoxb-…', app_token: 'xapp-…' });
 */
function normalizeConfig(raw = {}) {
  const language = text(raw.language);
  return {
    botToken: text(raw.bot_token),
    appToken: text(raw.app_token),
    defaultChannel: readTarget(raw.default_channel),
    defaultChannelRaw: text(raw.default_channel),
    forwardDirect: flag(raw.forward_direct_messages, true),
    language: LANGUAGES.includes(language) ? language : AUTO_LANGUAGE,
  };
}

/**
 * @description What is wrong with the tokens, if anything.
 * @param {object} config - normalizeConfig.
 * @returns {string|null} 'missing', 'bot_token_format', 'app_token_format' or null.
 */
function tokenProblem(config) {
  if (!config.botToken || !config.appToken) {
    return 'missing';
  }
  if (!BOT_TOKEN.test(config.botToken)) {
    return 'bot_token_format';
  }
  if (!APP_TOKEN.test(config.appToken)) {
    return 'app_token_format';
  }
  return null;
}

/**
 * @description The remembered dashboard language, when valid.
 * @param {object} raw - The raw config.
 * @param {string} fallback - The default.
 * @returns {string} A language.
 */
function readLanguage(raw, fallback) {
  const value = text(raw?.[INTERNAL_KEYS.language]);
  return LANGUAGES.includes(value) ? value : fallback;
}

export {
  LANGUAGES,
  AUTO_LANGUAGE,
  INTERNAL_KEYS,
  MEMBER_ID,
  CHANNEL_ID,
  normalizeConfig,
  tokenProblem,
  readTarget,
  readLanguage,
  flag,
};
