/**
 * Query Utilities
 * 
 * Provides utilities for handling large OR conditions in WHERE clauses,
 * including batching to avoid database placeholder limits and result deduplication.
 */

import { getOptimalOrBatchSize, isOrQuerySafe } from './utils/performance-utils';
import { executeInParallel } from './utils/parallel-utils';
import { isParallelEnabled } from './config';
import { logError } from './utils/error-utils';

/**
 * Options for OR query batching
 */
export interface OrBatchingOptions {
    /**
     * Include clause for relations
     */
    include?: any;

    /**
     * Enable parallel execution of batches
     * Default: true (if parallel is enabled globally)
     */
    parallel?: boolean;

    /**
     * Maximum number of concurrent batch queries
     */
    concurrency?: number;

    /**
     * Number of fields per OR condition (for batch size calculation)
     * Default: 1
     */
    fieldsPerCondition?: number;
}

/**
 * Checks if OR conditions need batching based on database placeholder limits
 * 
 * @param orConditions - Array of OR condition objects
 * @returns true if batching is needed, false if can execute in single query
 * 
 * @example
 * ```typescript
 * const orConditions = [{ email: 'user1@example.com' }, { email: 'user2@example.com' }];
 * 
 * if (needsOrBatching(orConditions)) {
 *   // Use executeWithOrBatching
 * } else {
 *   // Execute directly
 *   await model.findMany({ where: { OR: orConditions } });
 * }
 * ```
 */
export function needsOrBatching(orConditions: Record<string, any>[]): boolean {
    return !isOrQuerySafe(orConditions);
}

/**
 * Creates batches of OR conditions based on database placeholder limits
 * 
 * @param orConditions - Array of OR condition objects to batch
 * @param fieldsPerCondition - Number of fields in each condition (default: 1)
 * @returns Array of batched OR conditions
 * 
 * @example
 * ```typescript
 * const orConditions = [
 *   { email: 'user1@example.com' },
 *   { email: 'user2@example.com' },
 *   // ... many more
 * ];
 * 
 * const batches = createOrBatches(orConditions, 1);
 * // Returns: [[{email: 'user1@...'}, ...], [{email: 'userN@...'}, ...]]
 * ```
 */
export function createOrBatches(
    orConditions: Record<string, any>[],
    fieldsPerCondition: number = 1
): Record<string, any>[][] {
    if (orConditions.length === 0) return [];

    const batchSize = getOptimalOrBatchSize(fieldsPerCondition);
    
    // Pre-allocate array with exact size for better performance
    const batchCount = Math.ceil(orConditions.length / batchSize);
    const batches: Record<string, any>[][] = new Array(batchCount);

    for (let i = 0, batchIndex = 0; i < orConditions.length; i += batchSize, batchIndex++) {
        batches[batchIndex] = orConditions.slice(i, i + batchSize);
    }

    return batches;
}

/**
 * Deduplicates query results by ID field
 * 
 * @param results - Array of query results with id field
 * @returns Deduplicated array of results
 * 
 * @example
 * ```typescript
 * const results = [
 *   { id: 1, name: 'User 1' },
 *   { id: 2, name: 'User 2' },
 *   { id: 1, name: 'User 1' }, // duplicate
 * ];
 * 
 * const deduplicated = deduplicateResults(results);
 * // Returns: [{ id: 1, name: 'User 1' }, { id: 2, name: 'User 2' }]
 * ```
 */
export function deduplicateResults<T extends { id: any }>(results: T[]): T[] {
    if (results.length === 0) return results;

    // Use Map for O(1) lookups instead of Set for better performance with objects
    const seen = new Set<any>();
    // Pre-allocate array with estimated size for better performance
    const deduplicated: T[] = [];

    for (const item of results) {
        const id = item.id;
        if (id !== undefined) {
            if (!seen.has(id)) {
                seen.add(id);
                deduplicated.push(item);
            }
        } else {
            // Include items without id (shouldn't happen in normal cases)
            deduplicated.push(item);
        }
    }

    return deduplicated;
}

/**
 * Executes a query with large OR conditions, automatically batching if necessary
 * 
 * This function handles the complexity of:
 * - Detecting if batching is needed based on database limits
 * - Creating optimal batches
 * - Executing batches in parallel or sequentially
 * - Deduplicating results
 * 
 * @param model - Prisma model to query
 * @param orConditions - Array of OR condition objects
 * @param options - Query options (include, parallel, concurrency, fieldsPerCondition)
 * @returns Array of query results
 * 
 * @example
 * ```typescript
 * // Simple usage with single field conditions
 * const users = await executeWithOrBatching(
 *   prisma.user,
 *   [{ email: 'user1@example.com' }, { email: 'user2@example.com' }]
 * );
 * 
 * // With relations and parallel execution
 * const users = await executeWithOrBatching(
 *   prisma.user,
 *   orConditions,
 *   {
 *     include: { posts: true, profile: true },
 *     parallel: true,
 *     concurrency: 4,
 *     fieldsPerCondition: 2 // for composite keys like {email, tenantId}
 *   }
 * );
 * ```
 */
export async function executeWithOrBatching<T extends { id: any }>(
    model: any,
    orConditions: Record<string, any>[],
    options: OrBatchingOptions = {}
): Promise<T[]> {
    // Handle empty conditions
    if (orConditions.length === 0) {
        return [];
    }

    const {
        include,
        parallel = true,
        concurrency,
        fieldsPerCondition = 1
    } = options;

    // Check if we can execute in a single query
    if (!needsOrBatching(orConditions)) {
        // Execute directly without batching
        const results = await model.findMany({
            where: { OR: orConditions },
            include
        });
        return results as T[];
    }

    // Need to batch the query
    const batches = createOrBatches(orConditions, fieldsPerCondition);

    // Determine if we should use parallel execution
    const useParallel = parallel &&
        isParallelEnabled() &&
        batches.length > 1;

    let allResults: T[] = [];

    if (useParallel) {
        // Execute batches in parallel
        const operations = batches.map(batch =>
            () => model.findMany({
                where: { OR: batch },
                include
            }) as Promise<T[]>
        );

        const result = await executeInParallel(operations, { concurrency });

        // Merge results from all parallel queries
        for (const batchResults of result.results) {
            allResults.push(...(batchResults as T[]));
        }

        // Log any errors but continue with partial results
        if (result.errors.length > 0) {
            logError('executeWithOrBatching - parallel batches', new Error(`${result.errors.length} batch queries failed`), { failedCount: result.errors.length });
        }
    } else {
        // Execute batches sequentially
        for (const batch of batches) {
            const batchResults = await model.findMany({
                where: { OR: batch },
                include
            }) as T[];
            allResults.push(...batchResults);
        }
    }

    // Deduplicate results by id
    return deduplicateResults(allResults);
}
