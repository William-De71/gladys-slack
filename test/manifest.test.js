import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  messageEvent,
  mentionEvent,
  commandEvent,
  notSentEvent,
} from '../src/events.js';
import { CONFIG_ACTIONS } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import { LANGUAGES } from '../src/config.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const slackApp = read('../slack-app-manifest.json');
const pkg = read('../package.json');
const lock = read('../package-lock.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const REPO = 'William-De71/gladys-slack';

test('a bidirectional communication integration, in lockstep with package.json, at 0.x', () => {
  assert.equal(manifest.type, 'communication');
  assert.deepEqual(manifest.messaging, { receive: true });
  assert.equal(manifest.contact_schema, undefined, 'linked by code: no contact_schema');
  assert.equal(manifest.name, 'Slack');
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.match(pkg.version, /^0\./);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-slack:${pkg.version}`);
  assert.equal(manifest.cover_image, `https://raw.githubusercontent.com/${REPO}/main/cover.jpg`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-slack');
  // ws is already a dependency of the SDK: same major, no new package.
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk', 'ws']);
  assert.equal(lock.packages['node_modules/ws'].version.split('.')[0], '8');
});

test('declares the cloud transport: slack.com only, from the Web API client', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.match(source('../src/slack-api.js'), /https:\/\/slack\.com\/api\//);
  for (const file of ['app', 'events', 'widgets', 'config', 'store', 'i18n', 'text', 'receiver']) {
    assert.doesNotMatch(
      source(`../src/${file}.js`),
      /fetch\(|node:https?|node:net|node:dgram|new WebSocket/,
      file,
    );
  }
  assert.doesNotMatch(source('../src/app.js'), /publishTransports|GLADYS_PREFER_LOCAL/);
});

test('widgets and scenes need Gladys 5.1.0; no field of a newer Gladys, no permission', () => {
  assert.equal(manifest.gladys_version, '>=5.1.0');
  assert.deepEqual(manifest.categories, ['notifications', 'assistants']);
  const text = JSON.stringify(manifest);
  assert.doesNotMatch(text, /"source":"houses"/, 'houses need 5.2.0');
  for (const key of [
    'location',
    'network_wake',
    'network_discovery',
    'containers',
    'webhooks',
    // Added to the store on 2026-10-23, they need Gladys 5.3.0.
    'keywords',
    'countries',
    'energy_contracts',
    'account_schema',
  ]) {
    assert.equal(manifest[key], undefined, `${key} (permission, or a newer Gladys)`);
  }
  // A widget button with a form needs 5.2.0: never `fields` in a button.
  assert.doesNotMatch(source('../src/widgets.js'), /fields:/);
});

test('the configuration: two secret tokens, help sections, the language', () => {
  const config = byKey(manifest.config_schema);
  assert.deepEqual(
    [...config.keys()],
    [
      'intro',
      'bot_token',
      'app_token',
      'link_help',
      'forward_direct_messages',
      'channels_help',
      'default_channel',
      'language',
    ],
  );
  for (const key of ['bot_token', 'app_token']) {
    assert.equal(config.get(key).type, 'secret');
    assert.equal(config.get(key).required, true);
    assert.equal(config.get(key).default, undefined);
  }
  assert.equal(config.get('forward_direct_messages').default, true);
  assert.deepEqual(
    config.get('language').options.map((option) => option.value),
    ['auto', ...LANGUAGES],
  );
  for (const field of manifest.config_schema) {
    assert.ok(!['text', 'password'].includes(field.type), field.key);
    assert.equal(field.display_if, undefined, `${field.key}: display_if is refused by the store`);
    if (field.type === 'section') {
      for (const language of LANGUAGES) assert.ok(field.description[language].length <= 1000);
      for (const link of field.links ?? []) assert.match(link.url, /^https:\/\//);
    }
  }
  assert.match(config.get('intro').description.en, /not affiliated with Slack Technologies/);
});

test('the "Create the Gladys app" link carries exactly slack-app-manifest.json', () => {
  const link = manifest.config_schema[0].links[0];
  const url = new URL(link.url);
  assert.equal(url.origin + url.pathname, 'https://api.slack.com/apps');
  assert.equal(url.searchParams.get('new_app'), '1');
  assert.deepEqual(JSON.parse(url.searchParams.get('manifest_json')), slackApp);
});

test('the Slack app: Socket Mode, the messages tab open, minimal scopes for what the code calls', () => {
  assert.equal(slackApp.settings.socket_mode_enabled, true);
  assert.equal(slackApp.settings.token_rotation_enabled, false);
  assert.equal(slackApp.settings.org_deploy_enabled, false);
  assert.equal(slackApp.settings.event_subscriptions.request_url, undefined);
  assert.deepEqual(slackApp.features.app_home, {
    home_tab_enabled: false,
    messages_tab_enabled: true,
    messages_tab_read_only_enabled: false,
  });
  assert.deepEqual(
    slackApp.features.slash_commands.map((command) => command.command),
    ['/gladys'],
  );
  assert.equal(slackApp.features.slash_commands[0].url, undefined, 'Socket Mode: no URL');
  assert.ok(slackApp.display_information.name.length <= 35);
  assert.deepEqual(slackApp.settings.event_subscriptions.bot_events, [
    'app_mention',
    'message.channels',
    'message.groups',
    'message.im',
  ]);
  // Each scope, and the call or the event that needs it.
  const needs = {
    'app_mentions:read': 'app_mention',
    'channels:history': 'message.channels',
    'groups:history': 'message.groups',
    'im:history': 'message.im',
    'channels:read': 'conversations.info',
    'groups:read': 'conversations.info',
    'chat:write': 'chat.postMessage',
    commands: '/gladys',
    'files:write': 'files.getUploadURLExternal',
    'im:write': 'conversations.open',
    'users:read': 'users.info',
  };
  assert.deepEqual([...slackApp.oauth_config.scopes.bot].sort(), Object.keys(needs).sort());
  assert.equal(slackApp.oauth_config.scopes.user, undefined, 'no user token');
  const code = source('../src/slack-api.js');
  for (const method of Object.values(needs).filter((need) => /^[a-z]+\.[a-zA-Z]+$/.test(need))) {
    assert.ok(
      code.includes(`'${method}'`) ||
        ['message.im', 'message.channels', 'message.groups'].includes(method),
      method,
    );
  }
});

test('declares exactly the scene triggers, actions, buttons and widgets the code handles', () => {
  const app = source('../src/app.js');
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key),
    Object.values(TRIGGERS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key),
    Object.values(SCENE_ACTIONS),
  );
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    Object.values(WIDGETS),
  );
  assert.match(app, /onWidgetGet\(WIDGETS\.STATUS/);
  assert.match(app, /onWidgetAction\(WIDGETS\.STATUS/);
  assert.match(app, /onSceneAction\(SCENE_ACTIONS\.SEND_MESSAGE/);
  assert.match(app, /onSendMessage\(/);
  assert.deepEqual(
    manifest.actions.map((action) => action.key),
    Object.values(CONFIG_ACTIONS),
  );
  assert.match(app, /onAction\(CONFIG_ACTIONS\.TEST_CONNECTION/);
  // Every trigger field filters a key of the event data, declared as a variable.
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields ?? []) {
      assert.ok(
        trigger.variables.some((variable) => variable.key === field.key),
        `${trigger.key}.${field.key}`,
      );
    }
  }
});

test('limits of the store: counts, timeouts, sizes, no secret in widget settings', () => {
  assert.ok(manifest.actions.length <= 10);
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  assert.ok(manifest.scene_triggers.length <= 20 && manifest.scene_actions.length <= 20);
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10 && trigger.variables.length <= 20, trigger.key);
  }
  for (const action of manifest.scene_actions) {
    assert.ok(action.fields.length <= 10, action.key);
    assert.ok(action.outputs.length <= 20, action.key);
  }
  for (const action of [...manifest.scene_actions, ...manifest.actions]) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
  }
  for (const widget of manifest.widgets) {
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
  const size = statSync(new URL('../gladys-assistant-integration.json', import.meta.url)).size;
  assert.ok(size < 100 * 1024, `${size} bytes`);
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024, `cover.jpg: ${cover.length} bytes`);
  assert.equal(cover.readUInt16BE(0), 0xffd8, 'cover.jpg is a JPEG');
});

test('every scene event carries exactly the variables its trigger declares', () => {
  const message = {
    text: 'hi',
    user: 'U1',
    userName: 'Alice',
    channel: 'C1',
    channelType: 'channel',
    channelName: 'home',
    command: '/gladys',
    ts: '1.2',
    threadTs: null,
    gladysUser: { selector: 'alice', first_name: 'Alice' },
  };
  const data = {
    message_received: messageEvent(message, 'https://home.slack.com/'),
    mention_received: mentionEvent(message, 'https://home.slack.com/'),
    slash_command: commandEvent(message),
    message_not_sent: notSentEvent({ target: 'U1', user: null, reason: 'auth', error: 'x' }),
  };
  for (const trigger of manifest.scene_triggers) {
    assert.deepEqual(
      Object.keys(data[trigger.key]).sort(),
      trigger.variables.map((variable) => variable.key).sort(),
      trigger.key,
    );
  }
});

test('the docs and the READMEs show exactly slack-app-manifest.json', () => {
  for (const file of [
    'docs/en.md',
    'docs/fr.md',
    'docs/de.md',
    'docs/es.md',
    'README.md',
    'README.fr.md',
    'README.de.md',
    'README.es.md',
  ]) {
    const blocks = [...source(`../${file}`).matchAll(/```json\n([\s\S]*?)\n```/g)];
    assert.equal(blocks.length, 1, file);
    assert.deepEqual(JSON.parse(blocks[0][1]), slackApp, file);
  }
});
