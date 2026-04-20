// Shared types for TP Manager — mirrors spec §8 domain model (TASK-024 / Wave 2).
export type Uuid = string;
export type Iso8601 = string;
export type UnitCategory = 'weight' | 'volume' | 'count';

export type Role = 'owner' | 'manager' | 'staff';

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  service: string;
  version: string;
  timestamp: Iso8601;
}

export * from './domain.js';
