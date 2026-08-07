/**
 * Types crossing the client/server boundary. Imported by BOTH sides — the
 * frontend reaches them through the `@shared/*` alias. Declare a wire shape
 * here once rather than in each side's own file.
 */

export interface DiskStats {
  totalBytes: number;
  usedBytes: number;
  usagePercent: number;
  mount: string;
}

export interface Stats {
  host: string;
  timestamp: number;
  cpu: {
    usagePercent: number | null;
    loadAvg1: number;
    cores: number;
  };
  mem: {
    totalBytes: number;
    usedBytes: number;
    usagePercent: number;
  };
  disk: DiskStats;
  rootDisk: DiskStats;
  net: {
    rxBytesPerSec: number | null;
    txBytesPerSec: number | null;
    rxBytesTotal: number | null;
    txBytesTotal: number | null;
  };
}

/** A header quick action, as advertised to the client by GET /api/actions. */
export interface ActionSummary {
  id: string;
  label: string;
  icon: string;
  /** Ask for confirmation before firing. For things you don't want on a pocket-tap. */
  confirm: boolean;
}
