import "server-only";

import { open, stat, unlink } from "node:fs/promises";

/**
 * Cross-process advisory lock for local file-store records (P0-5).
 *
 * Uses `open(path, "wx")` — an atomic exclusive create — as the test-and-set,
 * which needs no two-step stamping and therefore has no takeover race: a
 * contender either creates the lock file or sees EEXIST and waits. Locks are
 * keyed per resource, auto-expire via file mtime (the stale window is longer
 * than the maximum challenge hold time, `MATCH_TIMEOUT_MS`), and are always
 * released in a `finally` block.
 *
 * Scope: this app is a single-process local Next.js server writing JSON
 * records to a local directory; an exclusive-create lock file is the
 * appropriate primitive.
 */

/**
 * Stale-lock window. Must exceed the longest possible lock hold (a full
 * challenge lifecycle is bounded by `MATCH_TIMEOUT_MS` = 420s) so a live
 * holder's lock is never stolen; crashed holders clear after this window.
 */
const LOCK_STALE_MS = 600_000;
const LOCK_POLL_MS = 25;

export class LockTimeoutError extends Error {
  constructor(resource: string) {
    super(`Another operation is in progress for ${resource}`);
    this.name = "LockTimeoutError";
  }
}

function lockPathFor(resource: string): string {
  return `${resource}.lock`;
}

async function isLockStale(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return Date.now() - info.mtimeMs > LOCK_STALE_MS;
  } catch {
    // Vanished between the EEXIST and the stat: not stale, just gone —
    // the next acquire attempt will simply create it.
    return false;
  }
}

/**
 * Run `fn` while holding an exclusive advisory lock on `resource` (a file
 * path; the lock lives next to it as `<resource>.lock`). Waits up to
 * `timeoutMs` for a competing holder, then throws {@link LockTimeoutError}.
 * Stale locks (mtime older than the stale window) are taken over.
 */
export async function withRecordLock<T>(
  resource: string,
  fn: () => Promise<T>,
  timeoutMs = 30_000,
): Promise<T> {
  const lockPath = lockPathFor(resource);
  const deadline = Date.now() + timeoutMs;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (;;) {
    try {
      // Atomic test-and-set: "wx" fails with EEXIST when the lock is held.
      handle = await open(lockPath, "wx");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await isLockStale(lockPath)) {
        // Take over the stale lock: remove and retry immediately. A race
        // with another taker is safe — the next "wx" decides.
        try {
          await unlink(lockPath);
        } catch {
          // Someone else removed it first; loop and retry.
        }
        continue;
      }
      if (Date.now() >= deadline) throw new LockTimeoutError(resource);
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
  try {
    // Best-effort owner stamp for diagnostics; never required for correctness.
    await handle.write(`${process.pid}\n`).catch(() => {});
    return await fn();
  } finally {
    try {
      await handle.close();
    } catch {
      // Already closed.
    }
    try {
      await unlink(lockPath);
    } catch {
      // Best-effort release; stale locks expire on their own.
    }
  }
}