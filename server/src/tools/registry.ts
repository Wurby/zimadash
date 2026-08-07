import type { Router } from 'express';
import calories from './calories/index.js';
import scratch from './scratch.js';

/**
 * A tool's server-side half. It owns everything under /api/tools/<slug> and
 * nothing outside it, so lifting a tool into its own repo means deleting one
 * file and one line here.
 */
export interface ServerTool {
  slug: string;
  router: Router;
}

/**
 * Node has no import.meta.glob, so this list is explicit — but it is the only
 * place that changes. `index.ts` mounts the whole array in a loop and never
 * grows a branch per tool.
 */
export const serverTools: ServerTool[] = [calories, scratch];
