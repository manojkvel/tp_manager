/**
 * TASK-013 — Feature flags module (DEC-010).
 *
 * Resolution order: env/Key Vault override wins over DB row. Cached for `ttlMs`.
 *
 * DB schema (landed by TASK-019):
 *   feature_flags (key text primary key, enabled boolean not null default false,
 *                  description text, updated_at timestamptz not null default now())
 */

export type FlagKey = string;

export interface FlagStore {
  /** Return the persisted flag record, or null if no row exists. */
  get(key: FlagKey): Promise<{ key: FlagKey; enabled: boolean } | null>;
}

export interface KeyVaultOverride {
  /** Return the override value if one is set, otherwise undefined. */
  get(key: FlagKey): Promise<boolean | undefined>;
}

export interface FeatureFlagsOptions {
  store: FlagStore;
  override?: KeyVaultOverride;
  /** Default state for a flag that has no row and no override. */
  defaults?: Readonly<Record<FlagKey, boolean>>;
  /** Cache TTL in ms. Defaults to 30_000. */
  ttlMs?: number;
  /** Clock injection for tests. */
  now?: () => number;
}

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

export class FeatureFlags {
  private readonly store: FlagStore;
  private readonly override?: KeyVaultOverride;
  private readonly defaults: Readonly<Record<FlagKey, boolean>>;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<FlagKey, CacheEntry>();

  constructor(opts: FeatureFlagsOptions) {
    this.store = opts.store;
    this.override = opts.override;
    this.defaults = opts.defaults ?? {};
    this.ttlMs = opts.ttlMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  async isEnabled(key: FlagKey): Promise<boolean> {
    const cached = this.cache.get(key);
    const nowTs = this.now();
    if (cached && cached.expiresAt > nowTs) {
      return cached.value;
    }

    const overrideValue = await this.override?.get(key);
    if (overrideValue !== undefined) {
      this.cache.set(key, { value: overrideValue, expiresAt: nowTs + this.ttlMs });
      return overrideValue;
    }

    const row = await this.store.get(key);
    const value = row !== null ? row.enabled : (this.defaults[key] ?? false);
    this.cache.set(key, { value, expiresAt: nowTs + this.ttlMs });
    return value;
  }

  invalidate(key?: FlagKey): void {
    if (key === undefined) {
      this.cache.clear();
    } else {
      this.cache.delete(key);
    }
  }
}
