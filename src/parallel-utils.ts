/**
 * Parallel Execution Utilities
 * 
 * Provides utilities for executing operations in parallel with controlled
 * concurrency, error handling, and performance metrics.
 */

import { getMaxConcurrency, getRateLimiter } from './config';

/**
 * Options for parallel execution
 */
export interface ParallelOptions {
    /**
     * Maximum number of concurrent operations
     * If not specified, uses configured maxConcurrency
     */
    concurrency?: number;

    /**
     * Rate limit (queries per second)
     * If not specified, uses configured rate limiter
     */
    rateLimit?: number;

    /**
     * Callback for progress updates
     */
    onProgress?: (completed: number, total: number) => void;

    /**
     * Callback for individual operation errors
     */
    onError?: (error: Error, index: number) => void;
}

/**
 * Result of parallel execution
 */
export interface ParallelResult<T> {
    /**
     * Successful results
     */
    results: T[];

    /**
     * Errors that occurred during execution
     */
    errors: Array<{ index: number; error: Error }>;

    /**
     * Performance metrics
     */
    metrics: ParallelMetrics;
}

/**
 * Performance metrics for parallel execution
 */
export interface ParallelMetrics {
    /**
     * Total execution time in milliseconds
     */
    totalTime: number;

    /**
     * Estimated time for sequential execution
     */
    sequentialEstimate: number;

    /**
     * Speedup factor (sequential / parallel)
     */
    speedupFactor: number;

    /**
     * Items processed per second
     */
    itemsPerSecond: number;

    /**
     * Parallel efficiency (0-1)
     * 1.0 = perfect parallelization
     */
    parallelEfficiency: number;

    /**
     * Connection pool utilization (0-1)
     */
    connectionUtilization: number;
}

/**
 * Tracks performance metrics during parallel execution
 */
export class ParallelMetricsTracker {
    private startTime: number = 0;
    private endTime: number = 0;
    private operationTimes: number[] = [];
    private totalOperations: number = 0;
    private concurrency: number = 1;

    constructor(totalOperations: number, concurrency: number) {
        this.totalOperations = totalOperations;
        this.concurrency = concurrency;
    }

    /**
     * Start tracking
     */
    start(): void {
        this.startTime = Date.now();
    }

    /**
     * Record an operation completion
     */
    recordOperation(duration: number): void {
        this.operationTimes.push(duration);
    }

    /**
     * Complete tracking and calculate metrics
     */
    complete(): ParallelMetrics {
        this.endTime = Date.now();

        const totalTime = this.endTime - this.startTime;

        // Calculate average operation time
        const avgOperationTime = this.operationTimes.length > 0
            ? this.operationTimes.reduce((sum, t) => sum + t, 0) / this.operationTimes.length
            : 0;

        // Estimate sequential execution time
        const sequentialEstimate = avgOperationTime * this.totalOperations;

        // Calculate speedup factor
        const speedupFactor = sequentialEstimate > 0
            ? sequentialEstimate / totalTime
            : 1;

        // Calculate items per second
        const itemsPerSecond = totalTime > 0
            ? (this.totalOperations / totalTime) * 1000
            : 0;

        // Calculate parallel efficiency
        // Ideal speedup is equal to concurrency
        const idealSpeedup = Math.min(this.concurrency, this.totalOperations);
        const parallelEfficiency = idealSpeedup > 0
            ? speedupFactor / idealSpeedup
            : 0;

        // Calculate connection utilization
        // This is an estimate based on how well we used available concurrency
        const connectionUtilization = this.totalOperations >= this.concurrency
            ? Math.min(1, speedupFactor / this.concurrency)
            : this.totalOperations / this.concurrency;

        return {
            totalTime,
            sequentialEstimate,
            speedupFactor,
            itemsPerSecond,
            parallelEfficiency: Math.min(1, parallelEfficiency),
            connectionUtilization: Math.min(1, connectionUtilization)
        };
    }
}

/**
 * Create a metrics object with default values
 * 
 * @returns ParallelMetrics with default values
 */
export function createParallelMetrics(): ParallelMetrics {
    return {
        totalTime: 0,
        sequentialEstimate: 0,
        speedupFactor: 1,
        itemsPerSecond: 0,
        parallelEfficiency: 0,
        connectionUtilization: 0
    };
}


/**
 * Execute operations in parallel with controlled concurrency
 * 
 * Uses Promise.allSettled to ensure individual failures don't crash other operations.
 * Respects connection pool limits and applies rate limiting.
 * 
 * @param operations - Array of async operations to execute
 * @param options - Parallel execution options
 * @returns Promise resolving to results, errors, and metrics
 * 
 * @example
 * ```typescript
 * const operations = batches.map(batch => 
 *   () => prisma.user.createMany({ data: batch })
 * );
 * 
 * const result = await executeInParallel(operations, { concurrency: 4 });
 * 
 * console.log(`Completed: ${result.results.length}`);
 * console.log(`Errors: ${result.errors.length}`);
 * console.log(`Speedup: ${result.metrics.speedupFactor}x`);
 * ```
 */
export async function executeInParallel<T>(
    operations: Array<() => Promise<T>>,
    options?: ParallelOptions
): Promise<ParallelResult<T>> {
    // Handle empty operations
    if (operations.length === 0) {
        return {
            results: [],
            errors: [],
            metrics: createParallelMetrics()
        };
    }

    // Determine concurrency level
    const concurrency = options?.concurrency ?? getMaxConcurrency();

    // Get rate limiter if available
    const rateLimiter = getRateLimiter();

    // Initialize metrics tracker
    const metricsTracker = new ParallelMetricsTracker(operations.length, concurrency);
    metricsTracker.start();

    // Pre-allocate arrays for better memory performance
    const results: T[] = [];
    const errors: Array<{ index: number; error: Error }> = [];

    const totalOps = operations.length;
    const hasProgressCallback = !!options?.onProgress;
    const hasErrorCallback = !!options?.onError;

    // Helper type for operation results
    type OpResult = { success: true; value: T } | { success: false; error: Error; index: number };

    // For small operation counts or concurrency of 1, use simple sequential/chunked approach
    if (concurrency >= totalOps) {
        // All operations can run in parallel - single batch
        const settled = await Promise.all(
            operations.map(async (operation, index): Promise<OpResult> => {
                const operationStart = Date.now();

                try {
                    if (rateLimiter) await rateLimiter.acquire();
                    const value = await operation();
                    metricsTracker.recordOperation(Date.now() - operationStart);
                    return { success: true, value };
                } catch (error) {
                    const err = error as Error;
                    if (hasErrorCallback) options!.onError!(err, index);
                    return { success: false, error: err, index };
                }
            })
        );

        // Process results in order
        for (const result of settled) {
            if (result.success) {
                results.push(result.value);
            } else {
                errors.push({ index: result.index, error: result.error });
            }
        }

        if (hasProgressCallback) options!.onProgress!(totalOps, totalOps);
    } else {
        // Process in chunks - optimized loop
        let completedCount = 0;

        for (let i = 0; i < totalOps; i += concurrency) {
            const chunkEnd = Math.min(i + concurrency, totalOps);

            // Execute chunk in parallel - slice is optimized in V8
            const chunkResults = await Promise.all(
                operations.slice(i, chunkEnd).map(async (operation, offset): Promise<OpResult> => {
                    const index = i + offset;
                    const operationStart = Date.now();

                    try {
                        if (rateLimiter) await rateLimiter.acquire();
                        const value = await operation();
                        metricsTracker.recordOperation(Date.now() - operationStart);
                        return { success: true, value };
                    } catch (error) {
                        const err = error as Error;
                        if (hasErrorCallback) options!.onError!(err, index);
                        return { success: false, error: err, index };
                    }
                })
            );

            // Process chunk results in order
            for (const result of chunkResults) {
                if (result.success) {
                    results.push(result.value);
                } else {
                    errors.push({ index: result.index, error: result.error });
                }
            }

            // Batch progress update after chunk completes
            if (hasProgressCallback) {
                completedCount = chunkEnd;
                options!.onProgress!(completedCount, totalOps);
            }
        }
    }

    // Complete metrics tracking
    const metrics = metricsTracker.complete();

    return {
        results,
        errors,
        metrics
    };
}


/**
 * Create optimal chunks for parallel execution
 * 
 * Divides items into chunks that can be processed in parallel batches.
 * 
 * @param items - Items to chunk
 * @param batchSize - Size of each batch
 * @param concurrency - Number of concurrent operations
 * @returns Array of chunked items
 * 
 * @example
 * ```typescript
 * const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
 * const chunks = chunkForParallel(items, 2, 3);
 * // Result: [[1,2], [3,4], [5,6], [7,8], [9,10]]
 * // Can process 3 chunks at a time
 * ```
 */
export function chunkForParallel<T>(
    items: T[],
    batchSize: number,
    concurrency: number
): T[][] {
    if (items.length === 0) return [];
    if (batchSize <= 0) throw new Error('batchSize must be positive');
    if (concurrency <= 0) throw new Error('concurrency must be positive');

    const chunks: T[][] = [];

    for (let i = 0; i < items.length; i += batchSize) {
        chunks.push(items.slice(i, i + batchSize));
    }

    return chunks;
}

/**
 * Get optimal concurrency level for an operation
 * 
 * Recommends concurrency based on operation type and item count.
 * 
 * @param operationType - Type of operation (read or write)
 * @param itemCount - Number of items to process
 * @returns Recommended concurrency level
 * 
 * @example
 * ```typescript
 * const concurrency = getOptimalConcurrency('write', 5000);
 * console.log(`Recommended concurrency: ${concurrency}`);
 * ```
 */
export function getOptimalConcurrency(
    operationType: 'read' | 'write',
    itemCount: number
): number {
    const maxConcurrency = getMaxConcurrency();

    // Note: operationType can be used for future optimizations
    // (e.g., reads might allow higher concurrency than writes)
    void operationType; // Acknowledge parameter for future use

    // For small datasets, sequential is better
    if (itemCount < 100) return 1;

    // For medium datasets, use limited concurrency
    if (itemCount < 1000) {
        return Math.min(2, maxConcurrency);
    }

    // For large datasets, use more concurrency
    if (itemCount < 10000) {
        return Math.min(4, maxConcurrency);
    }

    // For very large datasets, use maximum concurrency (but cap at 8)
    return Math.min(8, maxConcurrency);
}

/**
 * Determine if parallel execution should be used
 * 
 * Checks if parallel execution would provide benefits based on
 * dataset size and connection pool configuration.
 * 
 * @param itemCount - Number of items to process
 * @param poolSize - Connection pool size
 * @returns true if parallel execution is recommended
 * 
 * @example
 * ```typescript
 * if (shouldUseParallel(items.length, getConnectionPoolSize())) {
 *   await executeInParallel(operations);
 * } else {
 *   // Execute sequentially
 * }
 * ```
 */
export function shouldUseParallel(itemCount: number, poolSize: number): boolean {
    // Too small for parallel benefit
    if (itemCount < 100) {
        console.warn('⚠️ Dataset too small for parallel execution benefit. Using sequential.');
        return false;
    }

    // Pool size of 1 means sequential only
    if (poolSize === 1) {
        console.info('ℹ️ Connection pool size is 1. Using sequential execution.');
        return false;
    }

    return true;
}
