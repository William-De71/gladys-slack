// -----------------------------------------------------------------------------
// Socket Mode (https://docs.slack.dev/apis/events-api/using-socket-mode/):
// Slack delivers the events, slash commands and interactions of the app over
// a WebSocket the integration opens itself, so Gladys needs no public URL.
//
//   1. apps.connections.open with the app-level token -> a wss:// URL (it
//      holds a ticket: never logged);
//   2. Slack says `hello` once the connection is ready, with an approximate
//      lifetime: it refreshes the connection every few hours, announced by a
//      `disconnect` message (reason refresh_requested, warning, link_disabled
//      when Socket Mode was turned off, too_many_websockets);
//   3. every envelope `{ envelope_id, type, payload, accepts_response_payload }`
//      must be acknowledged by sending `{ envelope_id, payload? }` back within
//      3 seconds, or Slack delivers it again (the `retry_attempt` field).
//
// A new URL is asked for every connection (a URL is single use). The pause
// between failed attempts grows from 1 second to 2 minutes, with jitter, and
// goes back to 1 second after a `hello`. A refused token waits 5 minutes.
//
// Half-open connections: the WHATWG WebSocket of Node cannot send pings nor
// see them, so this module uses `ws` (already a dependency of the Gladys SDK):
// a ping every 30 s, no pong within 10 s -> the connection is dropped and
// opened again. Slack's own pings are answered by `ws` automatically.
// -----------------------------------------------------------------------------

import WebSocket from 'ws';

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 120_000;
const REFUSED_RETRY_MS = 5 * 60_000;
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;
const HELLO_TIMEOUT_MS = 30_000;
const ACK_DEADLINE_MS = 2500;

/**
 * @description Create the Socket Mode client.
 * @param {object} options - Options.
 * @param {() => Promise<string>} options.openUrl - apps.connections.open.
 * @param {(envelope: object) => any} options.onEnvelope - Handles an envelope;
 * may resolve the `payload` of the acknowledgement (slash commands), within
 * 2.5 s or the envelope is acknowledged without it.
 * @param {(state: string, detail?: object) => void} [options.onState] -
 * 'connecting', 'connected', 'reconnecting', 'refused', 'disabled', 'stopped'.
 * @param {object} options.logger - Logger.
 * @param {Function} [options.WebSocketImpl] - The `ws` class (tests).
 * @param {object} [options.timers] - `{ setTimeout, clearTimeout, setInterval, clearInterval }`.
 * @param {() => number} [options.random] - Jitter source.
 * @param {object} [options.delays] - Overrides of the delays (tests).
 * @returns {object} The client.
 * @example
 * const socket = createSocketMode({ openUrl, onEnvelope, logger });
 * socket.start();
 */
function createSocketMode({
  openUrl,
  onEnvelope,
  onState = () => {},
  logger,
  WebSocketImpl = WebSocket,
  timers = {
    // Unref'd: the socket alone never keeps the process alive (the SDK
    // connection does). unref() returns the timer itself.
    setTimeout: (callback, ms) => setTimeout(callback, ms).unref(),
    clearTimeout,
    setInterval: (callback, ms) => setInterval(callback, ms).unref(),
    clearInterval,
  },
  random = Math.random,
  delays = {},
}) {
  const delay = {
    minBackoff: MIN_BACKOFF_MS,
    maxBackoff: MAX_BACKOFF_MS,
    refused: REFUSED_RETRY_MS,
    ping: PING_INTERVAL_MS,
    pong: PONG_TIMEOUT_MS,
    hello: HELLO_TIMEOUT_MS,
    ack: ACK_DEADLINE_MS,
    ...delays,
  };
  let running = false;
  let socket = null;
  let generation = 0;
  let state = 'stopped';
  let backoff = delay.minBackoff;
  let reconnectTimer = null;
  let pingTimer = null;
  let helloTimer = null;
  let awaitingPong = false;
  const stats = { connectedAt: null, connections: 0, envelopes: 0, lastEnvelopeAt: null };

  const later = (callback, ms) => timers.setTimeout(callback, ms);

  /**
   * @param {string} next - The new state.
   * @param {object} [detail] - Details (error code).
   */
  function setState(next, detail) {
    if (state !== next || detail) {
      state = next;
      onState(next, detail);
    }
  }

  /** @description Stop the timers of the current socket. */
  function clearSocketTimers() {
    timers.clearInterval(pingTimer);
    timers.clearTimeout(helloTimer);
    pingTimer = null;
    helloTimer = null;
    awaitingPong = false;
  }

  /** @description Drop the current socket without reacting to its events. */
  function drop() {
    clearSocketTimers();
    const current = socket;
    socket = null;
    generation += 1;
    if (current) {
      current.removeAllListeners?.();
      current.on?.('error', () => {});
      try {
        current.terminate?.() ?? current.close();
      } catch {
        // already closed
      }
    }
  }

  /**
   * @description Open again after a pause.
   * @param {number} [wait] - The pause; the growing backoff when omitted.
   */
  function scheduleReconnect(wait) {
    if (!running || reconnectTimer) {
      return;
    }
    let pause = wait;
    if (pause === undefined) {
      pause = Math.round(backoff * (0.8 + random() * 0.4));
      backoff = Math.min(backoff * 2, delay.maxBackoff);
    }
    reconnectTimer = later(() => {
      reconnectTimer = null;
      open();
    }, pause);
  }

  /**
   * @description Send a JSON message on the current socket.
   * @param {object} message - The message.
   * @param {object} current - The socket it is for.
   */
  function send(message, current) {
    if (current !== socket || current.readyState !== WebSocketImpl.OPEN) {
      return;
    }
    current.send(JSON.stringify(message));
  }

  /**
   * @description Acknowledge an envelope, with the payload its handler
   * resolved in time.
   * @param {object} envelope - The envelope.
   * @param {object} current - Its socket.
   */
  async function handleEnvelope(envelope, current) {
    stats.envelopes += 1;
    stats.lastEnvelopeAt = Date.now();
    let payload;
    try {
      let timer;
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => resolve(undefined), delay.ack).unref();
      });
      payload = await Promise.race([Promise.resolve().then(() => onEnvelope(envelope)), deadline]);
      clearTimeout(timer);
    } catch (err) {
      logger.warn(`Unable to handle a Slack ${envelope.type} envelope: ${err.message}`);
    }
    const ack = { envelope_id: envelope.envelope_id };
    if (payload && envelope.accepts_response_payload) {
      ack.payload = payload;
    }
    send(ack, current);
  }

  /**
   * @description A message of Slack.
   * @param {string} raw - The text frame.
   * @param {object} current - Its socket.
   */
  function handle(raw, current) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      logger.debug('Ignored a Socket Mode frame that is not JSON');
      return;
    }
    if (message?.type === 'hello') {
      timers.clearTimeout(helloTimer);
      helloTimer = null;
      backoff = delay.minBackoff;
      stats.connectedAt = Date.now();
      stats.connections += 1;
      const lifetime = message.debug_info?.approximate_connection_time;
      logger.info(
        `Slack Socket Mode connected (${message.num_connections ?? '?'} connection(s)${
          lifetime ? `, refreshed in about ${Math.round(lifetime / 60)} min` : ''
        })`,
      );
      setState('connected');
      return;
    }
    if (message?.type === 'disconnect') {
      const reason = String(message.reason ?? 'unknown');
      if (reason === 'warning') {
        logger.debug('Slack will refresh the Socket Mode connection in a few seconds');
        return;
      }
      drop();
      if (reason === 'link_disabled') {
        logger.warn('Socket Mode was turned off in the Slack app: retrying in 5 minutes');
        setState('disabled', { error: reason });
        scheduleReconnect(delay.refused);
        return;
      }
      logger.info(`Slack asked to reconnect (${reason})`);
      setState('reconnecting', { error: reason });
      scheduleReconnect(0);
      return;
    }
    if (typeof message?.envelope_id === 'string' && message.envelope_id) {
      handleEnvelope(message, current);
    }
  }

  /** @description Ask for a URL and open a socket. */
  async function open() {
    if (!running) {
      return;
    }
    drop();
    const mine = generation;
    setState(state === 'connected' || state === 'reconnecting' ? 'reconnecting' : 'connecting');
    let url;
    try {
      url = await openUrl();
    } catch (err) {
      if (!running || mine !== generation) {
        return;
      }
      if (err.reason === 'auth' || err.reason === 'permission') {
        logger.warn(`Slack refuses the app-level token (${err.code}): retrying in 5 minutes`);
        setState('refused', { error: err.code });
        scheduleReconnect(delay.refused);
        return;
      }
      if (err.reason === 'rate_limited' && Number.isFinite(err.retryAfter)) {
        setState('reconnecting', { error: err.code });
        scheduleReconnect(Math.max(err.retryAfter * 1000, delay.minBackoff));
        return;
      }
      logger.warn(`Unable to open a Socket Mode connection: ${err.code ?? err.message}`);
      setState('reconnecting', { error: err.code ?? 'network' });
      scheduleReconnect();
      return;
    }
    if (!running || mine !== generation) {
      return;
    }
    let current;
    try {
      current = new WebSocketImpl(url);
    } catch {
      setState('reconnecting', { error: 'websocket' });
      scheduleReconnect();
      return;
    }
    socket = current;
    helloTimer = later(() => {
      if (socket === current) {
        logger.warn('No hello from Slack within 30 s: reconnecting');
        drop();
        setState('reconnecting', { error: 'no_hello' });
        scheduleReconnect();
      }
    }, delay.hello);
    current.on('open', () => {
      if (socket !== current) return;
      pingTimer = timers.setInterval(() => {
        if (socket !== current) return;
        if (awaitingPong) {
          logger.warn('Slack did not answer a ping: reconnecting');
          drop();
          setState('reconnecting', { error: 'ping_timeout' });
          scheduleReconnect();
          return;
        }
        awaitingPong = true;
        try {
          current.ping();
        } catch {
          // the close event follows
        }
      }, delay.ping);
    });
    current.on('pong', () => {
      awaitingPong = false;
    });
    current.on('message', (data, isBinary) => {
      if (socket !== current || isBinary) return;
      awaitingPong = false;
      handle(data.toString('utf8'), current);
    });
    current.on('error', (err) => {
      // Never the URL: it carries the ticket. The close event follows.
      logger.debug(`Socket Mode error: ${err?.code ?? 'unknown'}`);
    });
    current.on('close', (code) => {
      if (socket !== current) return;
      drop();
      logger.warn(`Socket Mode connection closed (${code}): reconnecting`);
      setState('reconnecting', { error: `close_${code}` });
      scheduleReconnect();
    });
  }

  return {
    /** @description Connect (again, with the current tokens). */
    start() {
      running = true;
      backoff = delay.minBackoff;
      timers.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      state = 'stopped';
      open();
    },
    /** @description Disconnect for good. */
    stop() {
      running = false;
      timers.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      const current = socket;
      drop();
      if (current) {
        logger.info('Slack Socket Mode disconnected');
      }
      setState('stopped');
    },
    /** @returns {string} The current state. */
    state: () => state,
    /** @returns {boolean} Whether a `hello` was received on the current socket. */
    connected: () => state === 'connected',
    /** @returns {object} Counters for the diagnostic. */
    stats: () => ({ ...stats }),
  };
}

export { createSocketMode, PING_INTERVAL_MS, PONG_TIMEOUT_MS, ACK_DEADLINE_MS };
