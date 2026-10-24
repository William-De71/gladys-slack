// -----------------------------------------------------------------------------
// What the integration remembers across restarts, in /data/state.json (the
// only writable path of the container). Ids and instants only, never the
// text of a message nor a token:
//
//   seen      the last event ids handled (Socket Mode re-delivers an event
//             that was not acknowledged in time, possibly after a restart)
//   invited   member id -> instant of the last invitation to link the
//             account, so that a stranger is told once a day at most
//   day, received, sent, failed   counters of the current day (widget)
//
// The links between Slack members and Gladys users are kept by Gladys itself
// (linkContact / getContacts), never here. A missing or broken file starts
// empty. Writes go through a temporary file and a rename, one at a time.
// -----------------------------------------------------------------------------

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_PATH = '/data/state.json';
const MAX_SEEN = 500;
const MAX_INVITED = 200;
const COUNTERS = ['received', 'sent', 'failed'];

/**
 * @description The day of an instant, 'YYYY-MM-DD' (UTC).
 * @param {number} instant - The instant, in ms.
 * @returns {string} The day.
 */
const dayOf = (instant) => new Date(instant).toISOString().slice(0, 10);

/**
 * @description A fresh state.
 * @param {number} now - Now, in ms.
 * @returns {object} The state.
 */
function emptyState(now) {
  return { version: 1, day: dayOf(now), received: 0, sent: 0, failed: 0, seen: [], invited: {} };
}

/**
 * @description Keep the known fields of a state read from disk.
 * @param {object} data - The parsed file.
 * @param {number} now - Now, in ms.
 * @returns {object} The state.
 */
function sanitize(data, now) {
  const state = emptyState(now);
  if (typeof data?.day === 'string') {
    state.day = data.day;
  }
  COUNTERS.forEach((key) => {
    if (Number.isInteger(data?.[key]) && data[key] >= 0) {
      state[key] = data[key];
    }
  });
  if (Array.isArray(data?.seen)) {
    state.seen = data.seen
      .filter((id) => typeof id === 'string' && id.length <= 100)
      .slice(-MAX_SEEN);
  }
  if (data?.invited && typeof data.invited === 'object') {
    for (const [member, at] of Object.entries(data.invited).slice(-MAX_INVITED)) {
      if (/^[UW][A-Z0-9]{2,20}$/.test(member) && Number.isFinite(at)) {
        state.invited[member] = at;
      }
    }
  }
  return state;
}

/**
 * @description Create the store.
 * @param {object} options - Options.
 * @param {string} [options.path] - The JSON file.
 * @param {Function} [options.now] - `() => number` in ms.
 * @param {object} options.logger - Logger.
 * @returns {object} The store.
 * @example
 * const store = createStore({ logger });
 * await store.load();
 */
function createStore({ path = DEFAULT_PATH, now = () => Date.now(), logger }) {
  let state = emptyState(now());
  let seen = new Set();
  let dirty = false;
  let saving = Promise.resolve();

  /** @description A new day starts the counters again. */
  function rollDay() {
    const day = dayOf(now());
    if (state.day !== day) {
      state.day = day;
      COUNTERS.forEach((key) => {
        state[key] = 0;
      });
      dirty = true;
    }
  }

  return {
    /**
     * @description Read the file (a broken one starts empty).
     * @returns {Promise<void>}
     */
    async load() {
      try {
        state = sanitize(JSON.parse(await readFile(path, 'utf8')), now());
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Unreadable ${path}, starting empty: ${err.message}`);
        }
        state = emptyState(now());
      }
      seen = new Set(state.seen);
      rollDay();
    },

    /**
     * @description Write the state when it changed (queued, never throws).
     * @returns {Promise<void>} Resolves once written (or failed).
     */
    save() {
      if (!dirty) {
        return saving;
      }
      dirty = false;
      const body = `${JSON.stringify({ ...state, seen: [...seen].slice(-MAX_SEEN) })}\n`;
      saving = saving.then(async () => {
        try {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(`${path}.tmp`, body, { mode: 0o600 });
          await rename(`${path}.tmp`, path);
        } catch (err) {
          logger.warn(`Unable to write ${path}: ${err.message}`);
        }
      });
      return saving;
    },

    /**
     * @description Remember an event id; false when it was already handled.
     * @param {string} id - The id.
     * @returns {boolean} Whether it is new.
     */
    remember(id) {
      if (!id) {
        return true;
      }
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      if (seen.size > MAX_SEEN) {
        seen.delete(seen.values().next().value);
      }
      dirty = true;
      return true;
    },

    /**
     * @description Whether a stranger may be invited again (once a day), and
     * remember the invitation when so.
     * @param {string} member - The member id.
     * @param {number} [everyMs] - The minimum interval.
     * @returns {boolean} Whether to invite.
     */
    invite(member, everyMs = 24 * 3600 * 1000) {
      const last = state.invited[member];
      if (Number.isFinite(last) && now() - last < everyMs) {
        return false;
      }
      delete state.invited[member];
      state.invited[member] = now();
      const members = Object.keys(state.invited);
      if (members.length > MAX_INVITED) {
        delete state.invited[members[0]];
      }
      dirty = true;
      return true;
    },

    /**
     * @description Forget the invitation of a member (now linked).
     * @param {string} member - The member id.
     */
    forgetInvitation(member) {
      if (member in state.invited) {
        delete state.invited[member];
        dirty = true;
      }
    },

    /**
     * @description Count a received, sent or failed message.
     * @param {'received'|'sent'|'failed'} key - The counter.
     */
    count(key) {
      rollDay();
      state[key] += 1;
      dirty = true;
    },

    /**
     * @description The counters of the day.
     * @returns {{ received: number, sent: number, failed: number }} The counters.
     */
    counters() {
      rollDay();
      return { received: state.received, sent: state.sent, failed: state.failed };
    },
  };
}

export { createStore, DEFAULT_PATH, MAX_SEEN };
