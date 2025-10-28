/**
 * Performance utilities for optimizing batch operations
 */

import { getDatabaseProvider } from './database-utils';
import { getPrismaInstance } from './config';

/**
 * Database-specific batch size configurations
 */
export const BATCH_SIZE_CONFIG = {
    sqlite: {
        createMany: 500,
        updateMany: 500,
        transaction: 100,
    },
    mysql: {
        createMany: 1500,
        updateMany: 1500,
        transaction: 1000,
    },
    postgresql: {
        createMany: 1500,
        updateMany: 1500,
        transaction: 1000,
    },
    sqlserver: {
        createMany: 1000,
        updateMany: 1000,
        transaction: 1000,
    },
    mongodb: {
        createMany: 1000,
        updateMany: 100, // Smaller for transactions
        transaction: 100, // MongoDB transaction limits
    },
} as const;

/**
 * Get optimal batch size for a specific operation and database
 * 
 * @param operation - The type of operation (createMany, updateMany, transaction)
 * @returns Optimal batch size for the current database
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
export function getOptimalBatchSize(operation: 'createMany' | 'updateMany' | 'transaction'): number {
    try {
        const prisma = getPrismaInstance();
        const provider = getDatabaseProvider(prisma);
        return BATCH_SIZE_CONFIG[provider][operation];
    } catch (error) {
        // Fallback to conservative defaults if detection fails
        console.warn('Could not detect database provider, using default batch size');
        return operation === 'transaction' ? 100 : 500;
    }
}

/**
 * Estimate memory usage for a batch operation
 * Helps prevent out-of-memory errors with large datasets
 * 
 * @param itemCount - Number of items in the batch
 * @param avgItemSize - Average size of each item in bytes (default: 1KB)
 * @returns Estimated memory usage in MB
 */
export function estimateBatchMemoryUsage(itemCount: number, avgItemSize: number = 1024): number {
    return (itemCount * avgItemSize) / (1024 * 1024);
}

/**
 * Check if a batch operation is safe to execute based on memory constraints
 * 
 * @param itemCount - Number of items in the batch
 * @param maxMemoryMB - Maximum allowed memory in MB (default: 100MB)
 * @param avgItemSize - Average size of each item in bytes (default: 1KB)
 * @returns True if the operation is safe, false otherwise
 */
export function isBatchSafe(itemCount: number, maxMemoryMB: number = 100, avgItemSize: number = 1024): boolean {
    const estimatedMemory = estimateBatchMemoryUsage(itemCount, avgItemSize);
    return estimatedMemory <= maxMemoryMB;
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
    const batches: T[][] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
    }
    
    return batches;
}

/**
 * Performance metrics for batch operations
 */
export interface BatchMetrics {
    totalItems: number;
    batchCount: number;
    avgBatchSize: number;
    estimatedMemoryMB: number;
    startTime: number;
    endTime?: number;
    durationMs?: number;
    itemsPerSecond?: number;
}

/**
 * Create a batch metrics tracker
 * 
 * @param totalItems - Total number of items to process
 * @param batchSize - Size of each batch
 * @returns Metrics object with tracking methods
 * 
 * @example
 * ```typescript
 * const metrics = createBatchMetrics(1000, 100);
 * // ... perform operations
 * metrics.complete();
 * console.log(`Processed ${metrics.itemsPerSecond} items/sec`);
 * ```
 */
export function createBatchMetrics(totalItems: number, batchSize: number): BatchMetrics {
    const metrics: BatchMetrics = {
        totalItems,
        batchCount: Math.ceil(totalItems / batchSize),
        avgBatchSize: batchSize,
        estimatedMemoryMB: estimateBatchMemoryUsage(batchSize),
        startTime: Date.now(),
    };

    return {
        ...metrics,
        complete() {
            this.endTime = Date.now();
            this.durationMs = this.endTime - this.startTime;
            this.itemsPerSecond = (this.totalItems / this.durationMs) * 1000;
        },
    } as BatchMetrics & { complete: () => void };
}

/**
 * Retry configuration for batch operations
 */
export interface RetryConfig {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    initialDelayMs: 100,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
};

/**
 * Execute a batch operation with exponential backoff retry
 * 
 * @param operation - The operation to execute
 * @param config - Retry configuration
 * @returns Result of the operation
 * 
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => model.createMany({ data: batch }),
 *   { maxRetries: 3, initialDelayMs: 100 }
 * );
 * ```
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    config: Partial<RetryConfig> = {}
): Promise<T> {
    const { maxRetries, initialDelayMs, maxDelayMs, backoffMultiplier } = {
        ...DEFAULT_RETRY_CONFIG,
        ...config,
    };

    let lastError: Error | undefined;
    let delay = initialDelayMs;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error as Error;
            
            if (attempt === maxRetries) {
                break;
            }

            // Check if error is retryable
            const errorMsg = lastError.message.toLowerCase();
            const isRetryable = 
                errorMsg.includes('timeout') ||
                errorMsg.includes('connection') ||
                errorMsg.includes('deadlock') ||
                errorMsg.includes('lock');

            if (!isRetryable) {
                throw lastError;
            }

            console.warn(`⚠️  Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            delay = Math.min(delay * backoffMultiplier, maxDelayMs);
        }
    }

    throw lastError;
}

/**
 * Chunk an array into smaller arrays
 * More efficient than slice for large arrays
 * 
 * @param array - Array to chunk
 * @param size - Size of each chunk
 * @returns Array of chunks
 */
export function chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}
