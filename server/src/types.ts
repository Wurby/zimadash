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
