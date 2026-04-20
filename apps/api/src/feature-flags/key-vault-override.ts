import type { KeyVaultOverride } from './feature-flags.js';

/**
 * Key Vault-backed override: reads secrets of the form `feature-flag-<key>`.
 * On prod the Container App's managed identity (TASK-007) grants `Key Vault Secrets User`.
 * On local dev we short-circuit via env vars: `FF_OVERRIDE_<KEY>=true|false`.
 */
export class EnvOverride implements KeyVaultOverride {
  async get(key: string): Promise<boolean | undefined> {
    const envKey = `FF_OVERRIDE_${key.toUpperCase().replace(/[.\-]/g, '_')}`;
    const value = process.env[envKey];
    if (value === undefined || value === '') return undefined;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return undefined;
  }
}
