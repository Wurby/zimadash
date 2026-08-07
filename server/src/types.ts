/**
 * Wire types live in shared/ so the frontend can import the same declarations.
 * Re-exported here so existing server imports keep working.
 */
export type { DiskStats, Stats, ActionSummary } from './shared/types.js';
