# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for **Slack** (unofficial, not
affiliated with Slack Technologies): a Node.js service (Node 22+, ESM, no build
step) in its own sandboxed Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to Slack with the tokens of a Slack app each user creates in their own
workspace from `slack-app-manifest.json`:

- the **Web API** (`https://slack.com/api/`, bot token `xoxb-` in the
  `Authorization` header, form-encoded arguments);
- **Socket Mode** (`apps.connections.open` with the app-level token `xapp-`,
  then a WebSocket): no public URL, no Gladys Plus.

`type: "communication"`, `messaging: { receive: true }` (linked by code, no
`contact_schema`), `transports: ["cloud"]`, Gladys 5.1.0+ (widget, scenes). No
`keywords` nor `countries` in the manifest: they need Gladys 5.3.0. Runtime
dependencies: the SDK and `ws` (already a dependency of the SDK; needed for
ping/pong, which the WHATWG WebSocket of Node cannot do).

**Never tested in a real workspace.** Everything is tested against a fake Slack
(`test/helpers/fake-slack.js`) built from docs.slack.dev and the official Slack
SDK for Node.js.

## Commands

```bash
npm install
npm test                                  # node --test; a fake Slack on 127.0.0.1, never the network
node --test test/app.test.js              # one file
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/manifest.baseline.json (on purpose only)
npm run coverage                          # coverage of src/
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
node scripts/fake-slack.mjs 18790         # the fake Slack (Web API + Socket Mode), driven over /_control/*
scripts/check-simulator.sh                # the real app against the fake Slack in another process
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js                SDK wiring only: createApp(gladys) + connect + start
src/app.js              every handler: identity (auth.test), Socket Mode states,
                        incoming (link codes, DMs to the brain, triggers, /gladys),
                        outgoing (onSendMessage, images), scene action, widget,
                        configuration button, connection status
src/socket-mode.js      Socket Mode client (ws): URL per connection, hello,
                        disconnect, acks within 2.5 s, ping/pong, backoff
src/slack-api.js        Web API client: bearer header, {ok:false} errors, 429 +
                        Retry-After pauses per method, 1 message/s per channel,
                        upload v2, caches (members, channels, DMs)
src/receiver.js         envelope -> message / mention / command / ignore (pure)
src/text.js             Slack markup <-> plain text, escaping, splitting, images
src/events.js           trigger / action keys, flat event data, message_not_sent once
src/widgets.js          the "status" widget (pure, reused by docs/illustrations)
src/store.js            /data/state.json: event ids, invitations, counters of the day
src/config.js           tokens, default channel, flags, language, Slack ids
src/i18n.js             runtime texts and bot replies, en / fr / de / es
slack-app-manifest.json the Slack app (also encoded in the "Create" link of the manifest)
test/helpers/fake-slack.js    the fake Slack (HTTP + WebSocket, payload builders)
scripts/fake-slack.mjs        the same as a server; scripts/simulate.mjs drives the real app
.github/scripts/release.mjs   version, changelog, bump (tested in test/)
```

## Rules

- **Keys are forever**: the keys of `config_schema` and `actions`, the widget
  and its `show_text` setting, the triggers (fields, options, variables), the
  scene action (fields, outputs), and the contact id (the Slack member id
  `U…`/`W…`, as linked in Gladys). `test/structure.test.js` compares them to
  `test/fixtures/manifest.baseline.json`: never update it to make a test pass
  without a documented migration.
- **Only linked members** reach the brain (`publishMessage`) and the scenes.
  A stranger gets one invitation a day (`store.invite`), nothing else. Bots,
  the bot itself (`bot_id`, `user_id` of auth.test), edits and other subtypes,
  hidden events, group DMs and messages older than 5 minutes are ignored.
  An event id is handled once, across restarts.
- **Acknowledge fast**: every envelope gets `{ envelope_id }` within 2.5 s;
  events are queued and handled after the ack. A slash command is answered
  in its ack (ephemeral), so its handler must stay fast (no Slack call).
- **Gladys waits 5 s** for `onSendMessage`: deliver within 4 s or let the
  delivery go on in the background (`background`); a late failure still fires
  `message_not_sent`.
- **Scene events** never because of a scene action or a widget button (no
  loop); `message_not_sent` once per member until a message goes through.
- **Tokens** travel in the `Authorization` header only: never in a URL, a log,
  an error, `/data` or a scene output. `SLACK_API_URL` and an upload URL must be
  `slack.com` or a local server (`isAllowedBase`). The Socket Mode URL holds a
  ticket: never logged.
- **Privacy**: the text of a message is never logged at any level; the widget
  shows it only with `show_text`; the last messages live in memory only.
  `/data` holds ids, invitations and counters, nothing else.
- **Rate limits**: every Web API call goes through `call()` (429 pause per
  method); every post through `postMessage`/`uploadImage` (channel queue).
- **The Slack app manifest** is `slack-app-manifest.json`; the "Create the
  Gladys app in Slack" link of the manifest, the docs and the READMEs must
  carry exactly it (`test/manifest.test.js`). Each scope must serve a call or
  an event of the code; no user token.
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, `src/i18n.js`,
  `docs/*.md`, README) exists in en, fr, de, es; `test/i18n.test.js` checks it.
  German says "du" (like the Gladys interface), Spanish "usted". Gladys UI
  labels quoted word for word ("Link my account", "Generate a link code").
- **Widget images.** After any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
  Budget: 8 components; here 1 caption, 3 tiles, 1 card-list, 1 status, 1 button.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  Below 1.0.0 until the maintainer runs Release with `release-as: 1.0.0`.
- **Changelog.** Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Commits and PR titles** follow Conventional Commits, in English.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network beyond 127.0.0.1.

## Assumptions (not verifiable without a real workspace)

- Socket Mode acknowledgements: 3 seconds, as for HTTP events and slash
  commands (not stated for Socket Mode by the docs); acked within 2.5 s.
- `retry_attempt` / `retry_reason` on re-delivered envelopes, and the
  `too_many_websockets` disconnect reason: from the official SDK, not the docs.
- Slack answers WebSocket pings (the official SDK pings every 5 s); we ping
  every 30 s and drop the socket without a pong in 10 s.
- The bot receives its own messages (filtered anyway).
- Form-encoded arguments are accepted by every method called (the official
  SDK sends them this way); errors other than 429 come with HTTP 200.
- `files.getUploadURLExternal` + raw bytes POST + `files.completeUploadExternal`
  with `initial_comment` shares the image in a DM.
- The message link is built from the `url` of auth.test
  (`archives/<channel>/p<ts without dot>`), like `chat.getPermalink` returns.

## Pitfalls

- `node --test` also runs `test/helpers/`: nothing starts on import.
- A user id passed as `channel` to chat.postMessage posts in the DM with
  Slackbot, not with the app: always `conversations.open` first (`openDm`).
- `app_mention` also exists for a message that `message.channels` delivers:
  the count and the widget skip the plain message that mentions the bot.
- A name like `#general` would pass for an id if upper-cased: ids are taken
  as typed.
- The validator of the Gladys core creates `gladys-development.duckdb` in the
  current folder: run it from elsewhere.
- A top-level `const SVG` in `docs/illustrations/render.js` would shadow the
  global of ApexCharts: it is `SVG_NS`.
