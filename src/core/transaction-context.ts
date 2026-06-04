import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient, Prisma } from '@prisma/client';
import { getPrismaInstance } from './config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A Prisma interactive-transaction client.
 *
 * Inside `prisma.$transaction(async (tx) => { … })`, the `tx` argument
 * exposes the same model delegates as PrismaClient but scoped to the
 * running transaction.  We type it as the return type of the callback so
 * that callers get full autocomplete.
 */
export type TransactionClient = Omit<
    PrismaClient,
    '$connect' | '$disconnect' | '$on' | '$use' | '$extends'
>;

/**
 * Options forwarded to Prisma's `$transaction()`.
 */
export interface TransactionOptions {
    /**
     * Maximum time (ms) Prisma will wait to acquire a connection from the pool.
     * @default 2000
     */
    maxWait?: number;

    /**
     * Maximum time (ms) the interactive transaction is allowed to run.
     * @default 5000
     */
    timeout?: number;

    /**
     * Transaction isolation level.
     * Only supported by PostgreSQL, MySQL and SQL Server.
     */
    isolationLevel?: Prisma.TransactionIsolationLevel;
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage singleton
// ---------------------------------------------------------------------------

const transactionStorage = new AsyncLocalStorage<TransactionClient>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Executes `fn` inside a Prisma interactive transaction.
 *
 * Every entity operation performed inside the callback will **automatically**
 * use the transactional client (via AsyncLocalStorage) — no need to pass `tx`
 * manually.  You may still pass `tx` explicitly via `{ tx }` options to
 * override the implicit context.
 *
 * @param fn       — Async callback that receives the transactional client
 * @param options  — Optional transaction settings (maxWait, timeout, isolationLevel)
 * @returns The value returned by `fn`
 * @throws Re-throws any error from `fn`, causing automatic rollback
 *
 * @example
 * ```typescript
 * import { runTransaction } from 'prisma-entity-framework';
 *
 * const user = await runTransaction(async (tx) => {
 *     const u = new User({ name: 'John', email: 'john@example.com' });
 *     await u.create();          // uses the active transaction automatically
 *
 *     const p = new Post({ title: 'Hello', authorId: u.id });
 *     await p.create();          // same transaction
 *
 *     return u;
 * });
 *
 * // Or with explicit tx (equivalent):
 * const user = await runTransaction(async (tx) => {
 *     const u = new User({ name: 'John' });
 *     await u.create({ tx });
 *     return u;
 * });
 * ```
 */
export async function runTransaction<T>(
    fn: (tx: TransactionClient) => Promise<T>,
    options?: TransactionOptions
): Promise<T> {
    // Detect nested transactions
    if (getActiveTransaction() !== null) {
        throw new Error(
            'Nested transactions are not supported. ' +
            'A transaction is already active in the current async context. ' +
            'If you need savepoints, consider restructuring your code.'
        );
    }

    const prisma = getPrismaInstance();

    // Build Prisma transaction options
    const txOptions: {
        maxWait?: number;
        timeout?: number;
        isolationLevel?: Prisma.TransactionIsolationLevel;
    } = {};

    if (options?.maxWait !== undefined) txOptions.maxWait = options.maxWait;
    if (options?.timeout !== undefined) txOptions.timeout = options.timeout;
    if (options?.isolationLevel !== undefined) txOptions.isolationLevel = options.isolationLevel;

    return prisma.$transaction(async (tx) => {
        // Run the user callback inside the AsyncLocalStorage context
        // so that all entity operations automatically pick up `tx`.
        return transactionStorage.run(tx as unknown as TransactionClient, () => fn(tx as unknown as TransactionClient));
    }, txOptions);
}

/**
 * Returns the currently active transactional client, or `null` if no
 * transaction is in progress in the current async context.
 *
 * @example
 * ```typescript
 * const tx = getActiveTransaction();
 * if (tx) {
 *     // We are inside a runTransaction() callback
 * }
 * ```
 */
export function getActiveTransaction(): TransactionClient | null {
    return transactionStorage.getStore() ?? null;
}

/**
 * Returns `true` when called inside a `runTransaction()` callback.
 *
 * @example
 * ```typescript
 * if (isInTransaction()) {
 *     console.log('Running inside a transaction');
 * }
 * ```
 */
export function isInTransaction(): boolean {
    return getActiveTransaction() !== null;
}
