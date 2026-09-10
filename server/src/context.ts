import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The signed-in person for this request (and any work it spawns).
 *
 * Tools that don't have the Express req in hand — calories' queue, the
 * trainer's planner — read the user from here rather than threading an id
 * through every helper. `requireAuth` enters the store before calling `next`.
 */

export interface AuthUser {
  id: string;
  owner: boolean;
}

const storage = new AsyncLocalStorage<AuthUser>();

export function runAs<T>(user: AuthUser, fn: () => T): T {
  return storage.run(user, fn);
}

export function currentUser(): AuthUser {
  const user = storage.getStore();
  if (!user) throw new Error('no authenticated user in context');
  return user;
}
