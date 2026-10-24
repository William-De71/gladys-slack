// -----------------------------------------------------------------------------
// Text in and out of Slack.
//
// Slack sends message text in its own markup: `&amp;`, `&lt;` and `&gt;` stand
// for the three control characters, `<@U123>` is a mention, `<#C123|name>` a
// channel, `<https://…|label>` a link, `<!here>` a special mention. Gladys
// wants plain text: `plainText` turns the markup back into what the member
// typed (the mention of the bot itself is removed).
//
// The other way, a reply of Gladys is plain text: `escapeText` escapes the
// three control characters so that Slack shows them as they are. A message is
// cut in parts of at most 3,900 characters, at a line or a space when it can
// (Slack truncates a `text` over 40,000 characters and recommends 4,000).
// -----------------------------------------------------------------------------

const MAX_PART = 3900;
const MAX_GLADYS_TEXT = 4096;

/**
 * @description Decode the three entities of Slack.
 * @param {string} value - Encoded text.
 * @returns {string} Decoded text.
 */
const decodeEntities = (value) =>
  value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * @description Escape the three control characters of Slack.
 * @param {string} value - Plain text.
 * @returns {string} Text for the `text` field of chat.postMessage.
 * @example
 * escapeText('a < b & c'); // -> 'a &lt; b &amp; c'
 */
const escapeText = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// The Slack references a scene author may write on purpose: a member, a
// channel, a special mention, a link (with or without a label).
const SLACK_REFERENCE =
  /^(?:@[UW][A-Z0-9]+|#[CG][A-Z0-9]+|![a-z^]|https?:\/\/[^\s<>|]+|mailto:[^\s<>|]+)/;

/**
 * @description Escape a text written in Slack formatting (mrkdwn) by a scene
 * author: `*bold*`, `<@U123>`, `<https://…|label>` and the entities already
 * written stay as they are; any other `&`, `<` or `>` is escaped.
 * @param {string} value - The text.
 * @returns {string} Text for chat.postMessage.
 * @example
 * escapeMrkdwn('Door <@U123> open, 3 < 5'); // -> 'Door <@U123> open, 3 &lt; 5'
 */
function escapeMrkdwn(value) {
  const input = String(value ?? '');
  let out = '';
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char === '<') {
      const end = input.indexOf('>', index + 1);
      const inner = end > index ? input.slice(index + 1, end) : null;
      if (inner !== null && !inner.includes('<') && SLACK_REFERENCE.test(inner)) {
        out += `<${inner}>`;
        index = end + 1;
        continue;
      }
      out += '&lt;';
    } else if (char === '>') {
      out += '&gt;';
    } else if (char === '&') {
      out += /^&(?:amp|lt|gt);/.test(input.slice(index)) ? '&' : '&amp;';
    } else {
      out += char;
    }
    index += 1;
  }
  return out;
}

/**
 * @description The plain text of a Slack message.
 * @param {string} value - The `text` of the event.
 * @param {object} [options] - Options.
 * @param {string|null} [options.botUserId] - The member id of the bot (its mention is dropped).
 * @param {(id: string) => string|null} [options.nameOf] - Display name of a member, when known.
 * @returns {string} Plain text, trimmed.
 * @example
 * plainText('<@UBOT> turn on the &lt;kitchen&gt; light', { botUserId: 'UBOT' });
 * // -> 'turn on the <kitchen> light'
 */
function plainText(value, { botUserId = null, nameOf = () => null } = {}) {
  const replaced = String(value ?? '').replace(/<([^<>]*)>/g, (_whole, inner) => {
    const [target, label] = inner.split('|', 2);
    if (target.startsWith('@')) {
      const id = target.slice(1);
      if (id === botUserId) {
        return '';
      }
      const name = label || nameOf(id);
      return name ? `@${name}` : `@${id}`;
    }
    if (target.startsWith('#')) {
      return `#${label || target.slice(1)}`;
    }
    if (target.startsWith('!')) {
      // <!here>, <!channel>, <!subteam^ID|@team>, <!date^…|fallback>
      if (label) {
        return label;
      }
      return `@${target.slice(1).split('^')[0]}`;
    }
    // A link: what the member typed is the label when there is one.
    return label || target.replace(/^mailto:/, '');
  });
  return decodeEntities(replaced).replace(/\s+/g, ' ').trim();
}

/**
 * @description Cut a text in parts Slack shows whole.
 * @param {string} value - The text.
 * @param {number} [max] - The size of a part.
 * @returns {string[]} The parts (none for an empty text).
 * @example
 * splitText('short'); // -> ['short']
 */
function splitText(value, max = MAX_PART) {
  const parts = [];
  let rest = String(value ?? '').trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) {
      cut = rest.lastIndexOf(' ', max);
    }
    if (cut < max / 2) {
      cut = max;
    }
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) {
    parts.push(rest);
  }
  return parts;
}

/**
 * @description An image attached by Gladys (`message.file`): the camera
 * snapshots arrive as `image/jpg;base64,…`, with or without `data:`.
 * @param {string|null} file - The attached file.
 * @returns {{ bytes: Buffer, mime: string, extension: string }|null} The image.
 */
function decodeImage(file) {
  if (typeof file !== 'string' || !file) {
    return null;
  }
  const match = /^(?:data:)?image\/(jpe?g|png|gif|webp);base64,/i.exec(file);
  const body = match ? file.slice(match[0].length) : file;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(body.slice(0, 200))) {
    return null;
  }
  const bytes = Buffer.from(body, 'base64');
  if (bytes.length < 8 || bytes.length > 10 * 1024 * 1024) {
    return null;
  }
  let kind = match?.[1]?.toLowerCase().replace('jpg', 'jpeg');
  if (!kind) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) kind = 'jpeg';
    else if (bytes.toString('latin1', 1, 4) === 'PNG') kind = 'png';
    else return null;
  }
  return { bytes, mime: `image/${kind}`, extension: kind === 'jpeg' ? 'jpg' : kind };
}

/**
 * @description Shorten a text for a widget or an event.
 * @param {string} value - The text.
 * @param {number} max - The maximum length.
 * @returns {string} The text, with … when cut.
 */
const shorten = (value, max) => {
  const plain = String(value ?? '');
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
};

export {
  MAX_PART,
  MAX_GLADYS_TEXT,
  escapeText,
  escapeMrkdwn,
  plainText,
  splitText,
  decodeImage,
  decodeEntities,
  shorten,
};
