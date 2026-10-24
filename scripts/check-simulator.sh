#!/usr/bin/env bash
# Run the real integration (Web API over fetch, Socket Mode over ws) against
# the fake Slack of the tests, served in another process on 127.0.0.1
# (scripts/fake-slack.mjs): hello, acknowledgements, a linked member talks to
# Gladys and gets the answer, a stranger is invited, a bot and a re-delivered
# event are ignored, a refresh reconnects, a 429 waits Retry-After.
#
# The fake follows the documentation of Slack (docs.slack.dev); it cannot
# prove the behavior of a real workspace, which only a real app can.
set -euo pipefail
cd "$(dirname "$0")/.."
port=18790
trap 'kill "${fake_pid:-0}" 2>/dev/null || true' EXIT
node scripts/fake-slack.mjs "$port" >/dev/null &
fake_pid=$!
for _ in $(seq 1 50); do
  (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && break
  sleep 0.1
done
SLACK_API_URL="http://127.0.0.1:$port/api/" node scripts/simulate.mjs "http://127.0.0.1:$port"
