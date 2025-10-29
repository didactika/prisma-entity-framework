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

/**
 * Database-specific placeholder/parameter limits
 * These are hard limits imposed by the database engines
 */
const DATABASE_LIMITS = {
    sqlite: {
        maxParameters: 999,        // SQLITE_MAX_VARIABLE_NUMBER default
        maxPlaceholders: 999,
    },
    mysql: {
        maxParameters: 65535,      // MySQL prepared statement limit
        maxPlaceholders: 65535,
    },
    postgresql: {
        maxParameters: 32767,      // PostgreSQL parameter limit ($1, $2, etc.)
        maxPlaceholders: 32767,
    },
    sqlserver: {
        maxParameters: 2100,       // SQL Server parameter limit
        maxPlaceholders: 2100,
    },
    mongodb: {
        maxParameters: Infinity,   // MongoDB doesn't have this limit
        maxPlaceholders: Infinity,
    },
} as const;

/**
 * Calculate optimal batch size for OR conditions in WHERE clauses
 * Prevents "too many placeholders" errors in databases
 * 
 * @param fieldsPerCondition - Number of fields in each OR condition (e.g., 2 for {email, username})
 * @param safetyMargin - Safety margin as percentage (default: 0.8 = 80% of max)
 * @returns Optimal number of OR conditions per batch
 * 
 * @example
 * ```typescript
 * // For upsert with email field (1 field per condition)
 * const batchSize = getOptimalOrBatchSize(1);
 * 
 * // For composite unique constraint {email, tenantId} (2 fields)
 * const batchSize = getOptimalOrBatchSize(2);
 * 
 * // Batch the OR conditions
 * for (let i = 0; i < orConditions.length; i += batchSize) {
 *   const batch = orConditions.slice(i, i + batchSize);
 *   await model.findMany({ where: { OR: batch } });
 * }
 * ```
 */
export function getOptimalOrBatchSize(
    fieldsPerCondition: number = 1,
    safetyMargin: number = 0.8
): number {
    try {
        const prisma = getPrismaInstance();
        const provider = getDatabaseProvider(prisma);
        const limits = DATABASE_LIMITS[provider];

        // Calculate max conditions based on placeholder limit
        // Each condition uses fieldsPerCondition placeholders
        const maxConditions = Math.floor(limits.maxPlaceholders / fieldsPerCondition);

        // Apply safety margin to avoid edge cases
        const safeMaxConditions = Math.floor(maxConditions * safetyMargin);

        // Return at least 1, but no more than a reasonable upper limit
        return Math.max(1, Math.min(safeMaxConditions, 10000));
    } catch (error) {
        // Fallback to conservative default if detection fails
        console.warn('Could not detect database provider for OR batch size, using conservative default');
        // Conservative default: assume 2 fields per condition, MySQL-like limit
        return Math.floor((65535 / Math.max(fieldsPerCondition, 1)) * 0.8);
    }
}

/**
 * Calculate the number of placeholders needed for a set of OR conditions
 * Useful for validating if a query will exceed database limits
 * 
 * @param orConditions - Array of OR condition objects
 * @returns Total number of placeholders needed
 * 
 * @example
 * ```typescript
 * const orConditions = [
 *   { email: 'user1@example.com' },
 *   { email: 'user2@example.com', username: 'user2' }
 * ];
 * 
 * const placeholders = calculateOrPlaceholders(orConditions);
 * // Returns: 3 (1 field in first condition + 2 fields in second)
 * ```
 */
export function calculateOrPlaceholders(orConditions: Record<string, any>[]): number {
    return orConditions.reduce((total, condition) => {
        return total + Object.keys(condition).length;
    }, 0);
}

/**
 * Check if a set of OR conditions is safe to execute without batching
 * 
 * @param orConditions - Array of OR condition objects
 * @param safetyMargin - Safety margin as percentage (default: 0.8)
 * @returns True if safe to execute in single query, false if batching needed
 * 
 * @example
 * ```typescript
 * const orConditions = [...]; // Large array of conditions
 * 
 * if (isOrQuerySafe(orConditions)) {
 *   // Execute in single query
 *   await model.findMany({ where: { OR: orConditions } });
 * } else {
 *   // Need to batch
 *   const batchSize = getOptimalOrBatchSize(1);
 *   for (let i = 0; i < orConditions.length; i += batchSize) {
 *     const batch = orConditions.slice(i, i + batchSize);
 *     await model.findMany({ where: { OR: batch } });
 *   }
 * }
 * ```
 */
export function isOrQuerySafe(
    orConditions: Record<string, any>[],
    safetyMargin: number = 0.8
): boolean {
    try {
        const prisma = getPrismaInstance();
        const provider = getDatabaseProvider(prisma);
        const limits = DATABASE_LIMITS[provider];

        const totalPlaceholders = calculateOrPlaceholders(orConditions);
        const safeLimit = Math.floor(limits.maxPlaceholders * safetyMargin);

        return totalPlaceholders <= safeLimit;
    } catch (error) {
        // If we can't detect, assume it's not safe (conservative approach)
        return false;
    }
}
