/**
 * Batch Utilities Module
 * 
 * Provides centralized batching logic for consistent batch creation and processing
 * across all database operations.
 */

import { getDatabaseProvider, DatabaseProvider } from './database-utils';
import { getPrismaInstance } from '../config';
import { executeInParallel, ParallelOptions } from './parallel-utils';

/**
 * Database-specific batch size configurations
 */
export const BATCH_SIZE_CONFIG = {
    sqlite: {
        createMany: 500,
        updateMany: 500,
        transaction: 100,
        delete: 500,
    },
    mysql: {
        createMany: 1500,
        updateMany: 1500,
        transaction: 1000,
        delete: 1500,
    },
    postgresql: {
        createMany: 1500,
        updateMany: 1500,
        transaction: 1000,
        delete: 1500,
    },
    sqlserver: {
        createMany: 1000,
        updateMany: 1000,
        transaction: 1000,
        delete: 1000,
    },
    mongodb: {
        createMany: 1000,
        updateMany: 100,
        transaction: 100,
        delete: 1000,
    },
} as const;

/**
 * Creates batches from an array of items
 * 
 * @param items - Array of items to batch
 * @param batchSize - Size of each batch
 * @returns Array of batches
 * 
 * @example
 * ```typescript
 * const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
 * const batches = createBatches(items, 3);
 * // Result: [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10]]
 * ```
 */
export function createBatches<T>(items: T[], batchSize: number): T[][] {
    if (!Array.isArray(items) || items.length === 0) {
        return [];
    }

    if (batchSize <= 0) {
        throw new Error('batchSize must be positive');
    }

    // Pre-allocate array with exact size for better performance
    const batchCount = Math.ceil(items.length / batchSize);
    const batches: T[][] = new Array(batchCount);
    
    for (let i = 0, batchIndex = 0; i < items.length; i += batchSize, batchIndex++) {
        batches[batchIndex] = items.slice(i, i + batchSize);
    }

    return batches;
}

/**
 * Split an array into optimal batches based on database provider
 *
 * @param items - Array of items to batch
 * @param operation - The type of operation
 * @returns Array of batches
 *
 * @example
 * ```typescript
 * const batches = createOptimalBatches(users, 'createMany');
 * for (const batch of batches) {
 *   await User.createMany(batch);
 * }
 * ```
 */
export function createOptimalBatches<T>(
    items: T[],
    operation: 'createMany' | 'updateMany' | 'transaction'
): T[][] {
    const batchSize = getOptimalBatchSize(operation);
    return createBatches(items, batchSize);
}

/**
 * Gets optimal batch size for an operation and database
 * 
 * @param operation - The type of operation
 * @param provider - Optional database provider (auto-detected if not provided)
 * @returns Optimal batch size for the operation
 * 
 * @example
 * ```typescript
 * const batchSize = getOptimalBatchSize('createMany');
 * for (let i = 0; i < items.length; i += batchSize) {
 *   const batch = items.slice(i, i + batchSize);
 *   await model.createMany({ data: batch });
 * }
 * ```
 */
export function getOptimalBatchSize(
    operation: 'createMany' | 'updateMany' | 'transaction' | 'delete',
    provider?: DatabaseProvider
): number {
    try {
        const dbProvider = provider || getDatabaseProvider(getPrismaInstance());
        return BATCH_SIZE_CONFIG[dbProvider][operation];
    } catch (error) {
        // Fallback to conservative defaults if detection fails (using console.warn for configuration issues)
        console.warn('Could not detect database provider, using default batch size');
        return operation === 'transaction' ? 100 : 500;
    }
}

/**
 * Options for batch processing
 */
export interface BatchProcessingOptions {
    /**
     * Whether to execute batches in parallel
     */
    parallel?: boolean;

    /**
     * Maximum number of concurrent batch operations
     */
    concurrency?: number;

    /**
     * Rate limit (queries per second)
     */
    rateLimit?: number;

    /**
     * Callback for progress updates
     */
    onProgress?: (completed: number, total: number) => void;

    /**
     * Callback for individual batch errors
     */
    onError?: (error: Error, batchIndex: number) => void;
}

/**
 * Result of batch processing
 */
export interface BatchProcessingResult<R> {
    /**
     * Successful results from each batch
     */
    results: R[];

    /**
     * Errors that occurred during batch processing
     */
    errors: Array<{ index: number; error: Error }>;

    /**
     * Total number of batches processed
     */
    totalBatches: number;

    /**
     * Number of successful batches
     */
    successfulBatches: number;

    /**
     * Number of failed batches
     */
    failedBatches: number;
}

/**
 * Processes batches with a callback function
 * Handles both sequential and parallel execution
 * 
 * @param items - Array of items to process in batches
 * @param batchSize - Size of each batch
 * @param processor - Function to process each batch
 * @param options - Batch processing options
 * @returns Promise resolving to batch processing results
 * 
 * @example
 * ```typescript
 * // Sequential processing
 * const result = await processBatches(
 *   users,
 *   100,
 *   async (batch) => {
 *     return await User.createMany({ data: batch });
 *   }
 * );
 * 
 * // Parallel processing
 * const result = await processBatches(
 *   users,
 *   100,
 *   async (batch) => {
 *     return await User.createMany({ data: batch });
 *   },
 *   { parallel: true, concurrency: 4 }
 * );
 * ```
 */
export async function processBatches<T, R>(
    items: T[],
    batchSize: number,
    processor: (batch: T[]) => Promise<R>,
    options?: BatchProcessingOptions
): Promise<BatchProcessingResult<R>> {
    // Handle empty items
    if (!Array.isArray(items) || items.length === 0) {
        return {
            results: [],
            errors: [],
            totalBatches: 0,
            successfulBatches: 0,
            failedBatches: 0,
        };
    }

    // Create batches
    const batches = createBatches(items, batchSize);
    const totalBatches = batches.length;

    // Determine execution mode
    const useParallel = options?.parallel === true && batches.length > 1;

    if (useParallel) {
        // Parallel execution
        const operations = batches.map((batch) => () => processor(batch));

        const parallelOptions: ParallelOptions = {
            concurrency: options?.concurrency,
            rateLimit: options?.rateLimit,
            onProgress: options?.onProgress,
            onError: options?.onError,
        };

        const result = await executeInParallel(operations, parallelOptions);

        return {
            results: result.results,
            errors: result.errors,
            totalBatches,
            successfulBatches: result.results.length,
            failedBatches: result.errors.length,
        };
    } else {
        // Sequential execution
        const results: R[] = [];
        const errors: Array<{ index: number; error: Error }> = [];

        for (let i = 0; i < batches.length; i++) {
            try {
                const result = await processor(batches[i]);
                results.push(result);

                // Progress callback
                if (options?.onProgress) {
                    options.onProgress(i + 1, totalBatches);
                }
            } catch (error) {
                const err = error as Error;
                errors.push({ index: i, error: err });

                // Error callback
                if (options?.onError) {
                    options.onError(err, i);
                }
            }
        }

        return {
            results,
            errors,
            totalBatches,
            successfulBatches: results.length,
            failedBatches: errors.length,
        };
    }
}
