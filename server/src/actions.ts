import type { Request, Response } from 'express';
import { readJson } from './paths.js';
import type { ActionSummary } from './shared/types.js';

/**
 * Header quick actions — one tap, real side effect.
 *
 * Actions are configured in `actions.json` in DATA_DIR, never in this repo,
 * because the request they fire usually carries a credential. The browser is
 * told the id, label, and icon and nothing else; the URL, headers, and body
 * stay on the server and the server makes the call.
 *
 * This deliberately fires operator-configured URLs, so treat `actions.json` as
 * privileged: it is only writable by whoever owns the box, and every route here
 * sits behind the PIN gate.
 */

const FILE = 'actions.json';
const TIMEOUT_MS = 10_000;

interface ActionRequest {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

interface ActionConfig {
  id: string;
  label: string;
  icon?: string;
  /** For things you don't want firing on a pocket-tap. */
  confirm?: boolean;
  request: ActionRequest;
}

function loadActions(): ActionConfig[] {
  const file = readJson<{ actions?: ActionConfig[] }>(FILE);
  if (!file?.actions || !Array.isArray(file.actions)) return [];
  return file.actions.filter((action) => action?.id && action?.label && action?.request?.url);
}

/** Only the parts that are safe to hand the browser. */
function summarise(action: ActionConfig): ActionSummary {
  return {
    id: action.id,
    label: action.label,
    icon: action.icon ?? 'bolt',
    confirm: action.confirm === true,
  };
}

export function handleListActions(_req: Request, res: Response): void {
  res.json({ actions: loadActions().map(summarise) });
}

export async function handleFireAction(req: Request, res: Response): Promise<void> {
  const action = loadActions().find((candidate) => candidate.id === req.params.id);

  if (!action) {
    res.status(404).json({ error: `unknown action "${req.params.id}"` });
    return;
  }

  const { url, method = 'POST', headers = {}, body } = action.request;

  // A hung endpoint must not hold the request open — the UI is waiting to show
  // a checkmark, and a wall display can't clear a spinner by itself.
  const abort = AbortSignal.timeout(TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort,
    });

    if (!upstream.ok) {
      // Deliberately not forwarding the upstream body — it can carry back
      // details of an endpoint the browser is not supposed to know about.
      res.status(502).json({ error: `action failed upstream (${upstream.status})` });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    res.status(504).json({ error: timedOut ? 'action timed out' : 'action could not be reached' });
  }
}
