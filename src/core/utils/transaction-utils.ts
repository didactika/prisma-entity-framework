import { getActiveTransaction, type TransactionClient } from '../transaction-context';
import { getPrismaInstance } from '../config';
import { EntityPrismaModel } from '../structures/interfaces/entity.interface';

/**
 * Resolves the Prisma client to use for operations.
 *
 * Priority:
 * 1. Explicit `tx` parameter (highest priority)
 * 2. Active AsyncLocalStorage transaction context
 * 3. Global PrismaClient instance (fallback)
 *
 * @param tx - Optional explicit transactional client
 * @returns The resolved client (TransactionClient or PrismaClient)
 */
export function resolveClient(tx?: TransactionClient): TransactionClient {
    // 1. Explicit tx has highest priority
    if (tx) return tx;

    // 2. Check AsyncLocalStorage context
    const activeTx = getActiveTransaction();
    if (activeTx) return activeTx;

    // 3. Fallback to global PrismaClient
    return getPrismaInstance() as unknown as TransactionClient;
}

/**
 * Resolves a Prisma model delegate to use for operations.
 *
 * When running inside a transaction, the model delegate must come from the
 * transactional client (`tx.user` instead of `prisma.user`) to ensure the
 * operation participates in the transaction.
 *
 * @param model     - The original entity model delegate (e.g., `prisma.user`)
 * @param tx        - Optional explicit transactional client
 * @returns The model delegate from the transactional client, or the original
 *
 * @example
 * ```typescript
 * const effectiveModel = resolveModel(User.model, tx);
 * await effectiveModel.create({ data: { name: 'John' } });
 * ```
 */
export function resolveModel<TModel extends object>(
    model: EntityPrismaModel<TModel>,
    tx?: TransactionClient
): EntityPrismaModel<TModel> {
    const client = resolveClient(tx);

    // If there's no active transaction and no explicit tx, return the original model
    const activeTx = getActiveTransaction();
    if (!tx && !activeTx) return model;

    // Extract the model name from the original model delegate
    const modelName = model.name;
    if (!modelName) return model;

    // Access the corresponding model delegate from the transactional client
    // Prisma model names are camelCase on the client (e.g., prisma.user, prisma.blogPost)
    const camelCaseName = modelName.charAt(0).toLowerCase() + modelName.slice(1);
    const txModel = (client as Record<string, unknown>)[camelCaseName];

    if (txModel && typeof txModel === 'object' && txModel !== null && 'findMany' in txModel) {
        return txModel as unknown as EntityPrismaModel<TModel>;
    }

    // Fallback: return the original model if we can't resolve from tx
    return model;
}

/**
 * Resolves the Prisma client to use for raw SQL operations
 * ($executeRawUnsafe, $queryRawUnsafe).
 *
 * @param tx - Optional explicit transactional client
 * @returns Client with raw query capabilities
 */
export function resolvePrismaForRaw(
    tx?: TransactionClient
): {
    $executeRawUnsafe: (...args: any[]) => Promise<number>;
    $queryRawUnsafe: <T = unknown>(...args: any[]) => Promise<T>;
    $transaction: (...args: any[]) => Promise<any>;
} {
    const client = resolveClient(tx);
    return client as any;
}

/**
 * Checks whether parallel execution should be disabled.
 *
 * Inside a Prisma interactive transaction, all queries are serialized
 * through the same connection. Running parallel batches would cause
 * deadlocks or errors. This helper returns `true` when parallel
 * execution must be suppressed.
 *
 * @param tx - Optional explicit transactional client
 * @returns `true` if parallel execution must be disabled
 */
export function shouldDisableParallel(tx?: TransactionClient): boolean {
    if (tx) return true;
    return getActiveTransaction() !== null;
}
