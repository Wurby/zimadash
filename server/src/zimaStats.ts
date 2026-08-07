import si from 'systeminformation';
import type { DiskStats, Stats } from './types.js';

// The 3.6TB WD data drive (/dev/sda1, btrfs) is mounted at both /home and /srv;
// /home is where the data that actually matters (vault, media, game servers) lives.
const DATA_MOUNT = '/home';

function toDiskStats(
  fs: { size: number; used: number; use: number; mount: string } | undefined,
): DiskStats {
  return fs
    ? {
        totalBytes: fs.size,
        usedBytes: fs.used,
        usagePercent: Math.round(fs.use * 10) / 10,
        mount: fs.mount,
      }
    : { totalBytes: 0, usedBytes: 0, usagePercent: 0, mount: 'unknown' };
}

export async function getZimaStats(): Promise<Stats> {
  const [load, mem, fsSize, netStats] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.networkStats(),
  ]);

  const dataFs = fsSize.find((d) => d.mount === DATA_MOUNT);
  const rootFs = fsSize.find((d) => d.mount === '/') ?? fsSize[0];
  const primaryNet = netStats[0];

  return {
    host: 'zima',
    timestamp: Date.now(),
    cpu: {
      usagePercent: Math.round(load.currentLoad * 10) / 10,
      loadAvg1: load.avgLoad,
      cores: load.cpus.length,
    },
    mem: {
      totalBytes: mem.total,
      usedBytes: mem.active,
      usagePercent: Math.round((mem.active / mem.total) * 1000) / 10,
    },
    disk: toDiskStats(dataFs ?? rootFs),
    rootDisk: toDiskStats(rootFs),
    net: primaryNet
      ? {
          rxBytesPerSec: primaryNet.rx_sec ?? null,
          txBytesPerSec: primaryNet.tx_sec ?? null,
          rxBytesTotal: primaryNet.rx_bytes ?? null,
          txBytesTotal: primaryNet.tx_bytes ?? null,
        }
      : { rxBytesPerSec: null, txBytesPerSec: null, rxBytesTotal: null, txBytesTotal: null },
  };
}
