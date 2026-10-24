# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - unreleased

### Added

- **slack:** a Slack app each user creates in their own workspace from `slack-app-manifest.json` (a prefilled "Create the Gladys app in Slack" link in the configuration), with Socket Mode: the events reach Gladys over a WebSocket the integration opens itself, no public URL and no Gladys Plus needed
- **socket mode:** a fresh connection URL each time, every envelope acknowledged within 3 seconds, `hello` and `disconnect` handled (refresh, Socket Mode turned off), pings to detect a dead connection, reconnection with a growing delay; a short refresh is not reported as an outage
- **chat:** a Slack member links their account by sending the link code of Gladys to the bot in a direct message, or with `/gladys <code>`; their direct messages then go to Gladys, who answers in the same conversation; members who are not linked only get an invitation (once a day), never the brain nor the scenes; bots, the bot itself, edits, re-delivered events and messages older than 5 minutes are ignored
- **notifications:** messages of Gladys to a linked member in the direct message of the bot, camera images included (upload in three steps); one message per second and per channel, `Retry-After` respected on HTTP 429, delivery going on in the background past the 5 seconds Gladys waits
- **scenes:** triggers when a linked member writes to the bot or in a channel it was invited to, mentions @gladys, types `/gladys`, and when a message of Gladys could not be delivered (once until a message goes through again); a "Send a Slack message" action to a channel, a member or a thread, with Slack formatting, returning the ts and the link of the message
- **widget:** the Socket Mode connection, the workspace, the messages of the day, the last messages of linked members (text hidden unless the widget setting asks for it, kept in memory only) and a "Send a test" button
- **configuration:** a "Test the connection" button (workspace, bot, socket, default channel, linked members); tokens never logged, never stored outside the secret fields of Gladys; nothing private in `/data`
- **i18n:** English, French, German and Spanish for the manifest, the runtime texts, the replies of the bot, the documentation and the README

[0.1.0]: https://github.com/William-De71/gladys-slack/releases/tag/v0.1.0
