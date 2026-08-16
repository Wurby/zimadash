/**
 * Inbox — types shared by both sides.
 *
 * Keep this free of Node built-ins and browser globals; the frontend reaches it
 * through the `@shared/*` alias.
 */

export type InboxStatus = 'working' | 'placed' | 'unsorted' | 'failed';

export interface InboxEntry {
  id: string;
  at: number;
  settledAt: number | null;
  filename: string;
  bytes: number;
  instructions: string;
  status: InboxStatus;
  /** Relative to the configured root — never the absolute path, which is a
   *  real filesystem location and has no business leaving the server. */
  destination: string | null;
  confidence: number | null;
  /** The brain's own one-sentence "why here". */
  reasoning: string;
  /** Our sentence, set only for unsorted/failed — why it didn't just place. */
  reason: string | null;
}

export interface InboxState {
  configured: boolean;
  entries: InboxEntry[];
}

export const MAX_INSTRUCTIONS = 1000;
export const MAX_FILENAME = 200;
export const MAX_LOG_ENTRIES = 200;
