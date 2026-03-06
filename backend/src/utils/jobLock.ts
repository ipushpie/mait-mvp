/**
 * In-memory job lock — prevents the same document from being ingested or
 * analyzed more than once concurrently within a single Node.js process.
 *
 * A Set of active job keys. Callers acquire a lock before starting work
 * and release it (in a finally block) when done, success or failure.
 */

const activeLocks = new Set<string>();

/**
 * Try to acquire a lock for `key`.
 * Returns true if the lock was acquired, false if already held.
 */
export function acquireLock(key: string): boolean {
  if (activeLocks.has(key)) return false;
  activeLocks.add(key);
  return true;
}

/**
 * Release a held lock. Safe to call even if the lock isn't held.
 */
export function releaseLock(key: string): void {
  activeLocks.delete(key);
}

/** Check whether a lock is currently held without acquiring it. */
export function isLocked(key: string): boolean {
  return activeLocks.has(key);
}
