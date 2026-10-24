// -----------------------------------------------------------------------------
// Non-regression of everything users store: every key of the manifest a
// scene, a widget or a saved configuration refers to (configuration keys,
// buttons, widgets and their settings, triggers with their fields, options
// and variables, scene actions with their fields and outputs).
//
// test/fixtures/manifest.baseline.json was generated from version 0.1.0 (the
// first release). A failure here means existing users would lose a scene, a
// widget setting or a saved value: never update the baseline without a
// documented migration (UPDATE_BASELINE=1 npm test rewrites it, on purpose
// only).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');

const keys = (list) => (list ?? []).map((item) => item.key);
const byKey = (list) => new Map((list ?? []).map((item) => [item.key, item]));
/**
 * @description The keys of the manifest users store.
 * @returns {object} The keys.
 */
export function manifestKeys() {
  return {
    config_schema: manifest.config_schema.map(({ key, type }) => ({ key, type })),
    actions: keys(manifest.actions),
    action_fields: Object.fromEntries(manifest.actions.map((a) => [a.key, keys(a.fields)])),
    widgets: manifest.widgets.map((w) => ({
      key: w.key,
      settings: keys(w.settings),
      options: Object.fromEntries(
        (w.settings ?? [])
          .filter((setting) => setting.options)
          .map((setting) => [setting.key, setting.options.map((option) => option.value)]),
      ),
    })),
    scene_triggers: manifest.scene_triggers.map((trigger) => ({
      key: trigger.key,
      fields: (trigger.fields ?? []).map(({ key, options }) => ({
        key,
        options: (options ?? []).map((option) => option.value),
      })),
      variables: trigger.variables.map(({ key, type }) => ({ key, type })),
    })),
    scene_actions: manifest.scene_actions.map((action) => ({
      key: action.key,
      fields: keys(action.fields),
      options: Object.fromEntries(
        action.fields
          .filter((field) => field.options)
          .map((field) => [field.key, field.options.map((option) => option.value)]),
      ),
      outputs: action.outputs.map(({ key, type }) => ({ key, type })),
    })),
  };
}

if (process.env.UPDATE_BASELINE === '1') {
  writeFileSync(
    new URL('./fixtures/manifest.baseline.json', import.meta.url),
    `${JSON.stringify({ manifest: manifestKeys() }, null, 2)}\n`,
  );
}
const baseline = read('./fixtures/manifest.baseline.json');

test('no configuration key, action or action field disappears', () => {
  const current = manifestKeys();
  const config = byKey(manifest.config_schema);
  for (const { key, type } of baseline.manifest.config_schema) {
    assert.equal(config.get(key)?.type, type, `config_schema.${key}`);
  }
  for (const [action, fields] of Object.entries(baseline.manifest.action_fields)) {
    assert.ok(current.action_fields[action], action);
    fields.forEach((key) =>
      assert.ok(current.action_fields[action].includes(key), `${action}.${key}`),
    );
  }
});

test('widgets, scene triggers and scene actions keep their keys, options, variables and outputs', () => {
  const widgets = byKey(manifestKeys().widgets);
  for (const widget of baseline.manifest.widgets) {
    widget.settings.forEach((key) =>
      assert.ok(widgets.get(widget.key)?.settings.includes(key), `${widget.key}.${key}`),
    );
    for (const [key, values] of Object.entries(widget.options)) {
      values.forEach((value) =>
        assert.ok(
          widgets.get(widget.key).options[key]?.includes(value),
          `${widget.key}.${key}: ${value}`,
        ),
      );
    }
  }
  const triggers = byKey(manifest.scene_triggers);
  for (const trigger of baseline.manifest.scene_triggers) {
    const now = triggers.get(trigger.key);
    assert.ok(now, trigger.key);
    const fields = byKey(now.fields ?? []);
    for (const { key, options } of trigger.fields) {
      const values = (fields.get(key)?.options ?? []).map((option) => option.value);
      assert.ok(fields.has(key), `${trigger.key}.${key}`);
      options.forEach((value) =>
        assert.ok(values.includes(value), `${trigger.key}.${key}: ${value}`),
      );
    }
    const variables = byKey(now.variables);
    for (const { key, type } of trigger.variables) {
      assert.equal(variables.get(key)?.type, type, `${trigger.key}.variables.${key}`);
    }
  }
  const actions = byKey(manifestKeys().scene_actions);
  for (const action of baseline.manifest.scene_actions) {
    const now = actions.get(action.key);
    assert.ok(now, action.key);
    action.fields.forEach((key) => assert.ok(now.fields.includes(key), `${action.key}.${key}`));
    for (const [key, values] of Object.entries(action.options ?? {})) {
      values.forEach((value) =>
        assert.ok(now.options[key]?.includes(value), `${action.key}.${key}: ${value}`),
      );
    }
    assert.deepEqual(
      now.outputs.filter((o) => action.outputs.some((b) => b.key === o.key)),
      action.outputs,
    );
  }
});
