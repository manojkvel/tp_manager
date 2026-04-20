import { describe, expect, it } from 'vitest';
import { FeatureFlags, type FlagStore, type KeyVaultOverride } from './feature-flags.js';

function makeStore(rows: Record<string, boolean>): FlagStore {
  return {
    async get(key) {
      if (!(key in rows)) return null;
      return { key, enabled: rows[key] as boolean };
    },
  };
}

function makeOverride(values: Record<string, boolean | undefined>): KeyVaultOverride {
  return {
    async get(key) {
      return values[key];
    },
  };
}

describe('FeatureFlags', () => {
  it('returns DB value when no override', async () => {
    const ff = new FeatureFlags({ store: makeStore({ 'ml.enabled': true }) });
    expect(await ff.isEnabled('ml.enabled')).toBe(true);
  });

  it('override beats DB row', async () => {
    const ff = new FeatureFlags({
      store: makeStore({ 'ml.enabled': true }),
      override: makeOverride({ 'ml.enabled': false }),
    });
    expect(await ff.isEnabled('ml.enabled')).toBe(false);
  });

  it('falls back to defaults when no row and no override', async () => {
    const ff = new FeatureFlags({
      store: makeStore({}),
      defaults: { 'operational.orders': true },
    });
    expect(await ff.isEnabled('operational.orders')).toBe(true);
    expect(await ff.isEnabled('ml.enabled')).toBe(false);
  });

  it('caches for ttlMs', async () => {
    let calls = 0;
    const store: FlagStore = {
      async get(key) {
        calls += 1;
        return { key, enabled: true };
      },
    };
    let t = 0;
    const ff = new FeatureFlags({ store, ttlMs: 1000, now: () => t });
    await ff.isEnabled('x');
    await ff.isEnabled('x');
    expect(calls).toBe(1);
    t = 2000;
    await ff.isEnabled('x');
    expect(calls).toBe(2);
  });

  it('invalidate clears the cache', async () => {
    let calls = 0;
    const store: FlagStore = {
      async get(key) {
        calls += 1;
        return { key, enabled: true };
      },
    };
    const ff = new FeatureFlags({ store });
    await ff.isEnabled('x');
    ff.invalidate('x');
    await ff.isEnabled('x');
    expect(calls).toBe(2);
  });

  it('treats undefined override as "no override"', async () => {
    const ff = new FeatureFlags({
      store: makeStore({ 'ml.enabled': true }),
      override: makeOverride({ 'ml.enabled': undefined }),
    });
    expect(await ff.isEnabled('ml.enabled')).toBe(true);
  });
});
