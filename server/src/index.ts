import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPolling, getCachedStats, getAllHostIds } from './cache.js';
import { handleLogin, handleSetup, handleStatus, initSessionSecret, requireAuth } from './auth.js';
import { DATA_DIR, ensureDataDir } from './paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 3107;
// server/dist/index.js -> ../../dist (vite build output at project root)
const STATIC_DIR = path.resolve(__dirname, '../../dist');

ensureDataDir();
initSessionSecret();

const app = express();
app.use(express.json({ limit: '1mb' }));

// ─── Public routes ───────────────────────────────────────────────────────────
// Everything below the auth gate. The health endpoint has to stay open because
// scripts/deploy.sh curls it to verify a deploy, before anyone has a token.

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/auth/status', handleStatus);
app.post('/api/auth/setup', handleSetup);
app.post('/api/auth/login', handleLogin);

// ─── Gate ────────────────────────────────────────────────────────────────────

app.use('/api', requireAuth);

// ─── Authenticated routes ────────────────────────────────────────────────────

app.get('/api/hosts', (_req, res) => {
  res.json({ hosts: getAllHostIds() });
});

app.get('/api/stats/:host', (req, res) => {
  const entry = getCachedStats(req.params.host);
  if (!entry) {
    res.status(404).json({ error: `unknown host "${req.params.host}"` });
    return;
  }
  if (entry.error) {
    res.status(502).json({ error: entry.error, fetchedAt: entry.fetchedAt });
    return;
  }
  res.json(entry.data);
});

// ─── Frontend ────────────────────────────────────────────────────────────────
// The app shell is public; it renders the PIN screen and gets no data without a
// token. Serving it unauthenticated is what makes the PIN screen reachable.

app.use(express.static(STATIC_DIR));
app.get('*', (_req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

startPolling();

app.listen(PORT, () => {
  console.log(`zimadash listening on :${PORT}`);
  console.log(`data dir: ${DATA_DIR}`);
});
