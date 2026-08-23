import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPolling, getCachedStats, getAllHostIds } from './cache.js';
import { handleLogin, handleSetup, handleStatus, initSessionSecret, requireAuth } from './auth.js';
import { handleFireAction, handleListActions } from './actions.js';
import { createAppShell } from './appShell.js';
import { serverTools } from './tools/registry.js';
import { DATA_DIR, ensureDataDir } from './paths.js';
import { handleReadLayout, handleWriteLayout } from './layout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 3107;
// server/dist/index.js -> ../../dist (vite build output at project root)
const STATIC_DIR = path.resolve(__dirname, '../../dist');

ensureDataDir();
initSessionSecret();

const app = express();

// A photographed meal is bigger than any other body this server takes, so it
// gets its own parser mounted ahead of the global one. Raising the global limit
// instead would hand every endpoint the same allowance, which is a needless
// amount of memory to let a stranger allocate.
app.use('/api/tools/calories/estimate/image', express.json({ limit: '12mb' }));
app.use('/api/tools/calories/queue', express.json({ limit: '12mb' }));
// /api/tools/inbox/upload deliberately gets no parser at all: it reads req as
// a raw byte stream itself (see inbox/index.ts) and pins its own Content-Type
// to application/octet-stream, which express.json() below ignores and passes
// through untouched. A future global express.raw({type: '*/*'}) would break
// that — mount it path-scoped, not here.
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

// Quick actions. Configured in DATA_DIR, fired server-side.
app.get('/api/actions', handleListActions);
app.post('/api/actions/:id/fire', handleFireAction);

// The dashboard arrangement: one order shared by every device, sizes per surface.
app.get('/api/layout', handleReadLayout);
app.put('/api/layout', handleWriteLayout);

// Each tool owns everything under its own namespace. Adding a tool means adding
// it to tools/registry.ts — this loop never changes.
for (const tool of serverTools) {
  app.use(`/api/tools/${tool.slug}`, tool.router);
}

// ─── Frontend ────────────────────────────────────────────────────────────────
// The app shell is public; it renders the PIN screen and gets no data without a
// token. Serving it unauthenticated is what makes the PIN screen reachable.

app.use(express.static(STATIC_DIR));

// The shell is rewritten per tool so "Add to Home Screen" installs the tool you
// are looking at, not the dashboard. Safari reads that metadata from the
// document as delivered, so it cannot be fixed up client-side afterwards.
const appShell = createAppShell(STATIC_DIR);

app.get('*', (req, res) => {
  const html = appShell.render(req.path);
  if (!html) {
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
    return;
  }
  res.type('html').send(html);
});

startPolling();

app.listen(PORT, () => {
  console.log(`zimadash listening on :${PORT}`);
  console.log(`data dir: ${DATA_DIR}`);
});
