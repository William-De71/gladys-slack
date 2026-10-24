// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK and to the fake Slack of the tests (test/helpers/fake-slack.js, on
// 127.0.0.1), on a fixed date. Two cards of the "Slack" widget:
//   hidden   the default: the last messages without their text
//   shown    the widget setting "Show the text of the messages" on
// The members, the workspace and the messages are invented.
// Written as JSON for render.js: node gen.mjs <repo> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { createApp } = await load('src/app.js');
const { createSlackApi } = await load('src/slack-api.js');
const { LANGUAGES } = await load('src/i18n.js');
const { createFakeSlack, BOT_TOKEN, APP_TOKEN } = await load('test/helpers/fake-slack.js');
const { createFakeGladys } = await import(
  pathToFileURL(join(repo, 'node_modules/@gladysassistant/integration-sdk/lib/testing.js')).href
);

const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ALICE = 'U0ALICE001';
const BOB = 'U0BOB00001';

const MESSAGES = {
  en: ['Turn on the kitchen light', 'lights off in the living room', 'goodnight'],
  fr: ['Allume la lumière de la cuisine', 'éteins tout dans le salon', 'bonne nuit'],
  de: ['Mach das Licht in der Küche an', 'Licht aus im Wohnzimmer', 'gute Nacht'],
  es: ['Enciende la luz de la cocina', 'apaga todo en el salón', 'buenas noches'],
};
const ANSWERS = {
  en: 'The kitchen light is on.',
  fr: 'La lumière de la cuisine est allumée.',
  de: 'Das Licht in der Küche ist an.',
  es: 'La luz de la cocina está encendida.',
};

const cards = { hidden: { show_text: false }, shown: { show_text: true } };
const contents = Object.fromEntries(LANGUAGES.map((language) => [language, {}]));

for (const language of LANGUAGES) {
  // Saturday 24 October 2026, from 19:12 in Paris.
  let clock = Date.UTC(2026, 9, 24, 17, 12, 0);
  const now = () => clock;
  const slack = createFakeSlack({ now });
  await slack.start();
  const dir = await mkdtemp(join(tmpdir(), 'gladys-slack-illustration-'));
  const gladys = createFakeGladys({
    config: { bot_token: BOT_TOKEN, app_token: APP_TOKEN, language, default_channel: 'C0HOME0001' },
    contacts: [
      {
        contact_id: ALICE,
        contact_name: 'Alice',
        linked_at: null,
        user: { selector: 'alice', first_name: 'Alice', language },
      },
      {
        contact_id: BOB,
        contact_name: 'Bob',
        linked_at: null,
        user: { selector: 'bob', first_name: 'Bob', language },
      },
    ],
  });
  const app = createApp(gladys, {
    api: createSlackApi({ baseUrl: slack.apiUrl(), now, logger: silent }),
    statePath: join(dir, 'state.json'),
    now,
    logger: silent,
  });
  await gladys.connect();
  await app.start();
  while (app.connection() !== 'connected') await sleep(10);
  const [dm, mention, command] = MESSAGES[language];
  await slack.envelope(slack.dm(ALICE, dm));
  await app.idle();
  await gladys.fake.sendMessage({ id: ALICE }, { text: ANSWERS[language], file: null });
  clock += 34 * 60 * 1000;
  await slack.envelope(slack.mention(BOB, 'C0HOME0001', mention));
  await app.idle();
  clock += 61 * 60 * 1000;
  await slack.envelope(slack.slash(ALICE, command));
  await app.idle();
  await gladys.fake.sendMessage({ id: ALICE }, { text: '🌙', file: null });
  for (const [name, settings] of Object.entries(cards)) {
    const ack = await gladys.fake.widgetGet('status', { settings, language });
    if (!ack.success) throw new Error(`${name}: ${ack.error}`);
    contents[language][name] = ack.data.content;
  }
  await app.stop();
  await gladys.fake.shutdown();
  await slack.stop();
  await rm(dir, { recursive: true, force: true });
}

const declaration = manifest.widgets.find((widget) => widget.key === 'status');
writeFileSync(
  out,
  JSON.stringify({
    contents,
    images: {},
    cards: Object.fromEntries(
      Object.keys(cards).map((name) => [
        name,
        { icon: declaration.icon, label: declaration.label },
      ]),
    ),
  }),
);
