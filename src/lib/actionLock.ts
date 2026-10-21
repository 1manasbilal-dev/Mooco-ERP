/**
 * Prevents rapid double-clicks, duplicate API requests, and concurrent race-conditions
 * across the entire application.
 */

class ActionLockManager {
  private activeLocks = new Map<string, number>();

  /**
   * Run an asynchronous action exclusively.
   * If an action with the same lockKey is already in progress, subsequent calls are rejected immediately.
   */
  async runExclusive<T>(
    lockKey: string,
    action: () => Promise<T>,
    timeoutMs: number = 10000,
    cooldownMs: number = 500
  ): Promise<T | null> {
    const now = Date.now();
    const existingLockTime = this.activeLocks.get(lockKey);

    if (existingLockTime && now - existingLockTime < timeoutMs) {
      console.warn(`[ActionLock] Blocked duplicate execution for action key: "${lockKey}"`);
      return null;
    }

    this.activeLocks.set(lockKey, now);

    try {
      const result = await action();
      return result;
    } finally {
      // Keep a short cooldown debounce to absorb micro-clicks
      setTimeout(() => {
        this.activeLocks.delete(lockKey);
      }, cooldownMs);
    }
  }

  isLocked(lockKey: string): boolean {
    return this.activeLocks.has(lockKey);
  }

  release(lockKey: string): void {
    this.activeLocks.delete(lockKey);
  }
}

export const actionLock = new ActionLockManager();
