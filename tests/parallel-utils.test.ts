import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import {
    executeInParallel,
    chunkForParallel,
    getOptimalConcurrency,
    shouldUseParallel,
    createParallelMetrics,
    ParallelMetricsTracker,
    configurePrisma,
    resetPrismaConfiguration,
    type ParallelOptions
} from '../src/index';

describe('Parallel Execution Engine', () => {
    beforeEach(() => {
        resetPrismaConfiguration();
        const prisma = new PrismaClient();
        configurePrisma(prisma, { maxConcurrency: 4 });
    });

    afterEach(() => {
        resetPrismaConfiguration();
    });

    describe('executeInParallel', () => {
        it('should execute operations in parallel', async () => {
            const operations = [
                () => Promise.resolve(1),
                () => Promise.resolve(2),
                () => Promise.resolve(3),
                () => Promise.resolve(4),
                () => Promise.resolve(5)
            ];

            const result = await executeInParallel(operations);

            expect(result.results).toEqual([1, 2, 3, 4, 5]);
            expect(result.errors).toHaveLength(0);
            expect(result.metrics).toBeDefined();
        });

        it('should handle empty operations array', async () => {
            const result = await executeInParallel([]);

            expect(result.results).toEqual([]);
            expect(result.errors).toEqual([]);
        });

        it('should handle individual operation failures', async () => {
            const operations = [
                () => Promise.resolve(1),
                () => Promise.reject(new Error('Test error')),
                () => Promise.resolve(3)
            ];

            const result = await executeInParallel(operations);

            expect(result.results).toEqual([1, 3]);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].error.message).toBe('Test error');
            expect(result.errors[0].index).toBe(1);
        });

        it('should continue execution when one operation fails', async () => {
            const operations = [
                () => Promise.resolve('a'),
                () => Promise.reject(new Error('Fail 1')),
                () => Promise.resolve('b'),
                () => Promise.reject(new Error('Fail 2')),
                () => Promise.resolve('c')
            ];

            const result = await executeInParallel(operations);

            expect(result.results).toEqual(['a', 'b', 'c']);
            expect(result.errors).toHaveLength(2);
        });

        it('should respect concurrency limit', async () => {
            let concurrentCount = 0;
            let maxConcurrent = 0;

            const operations = Array.from({ length: 10 }, () =>
                async () => {
                    concurrentCount++;
                    maxConcurrent = Math.max(maxConcurrent, concurrentCount);

                    await new Promise(resolve => setTimeout(resolve, 10));

                    concurrentCount--;
                    return 'done';
                }
            );

            await executeInParallel(operations, { concurrency: 3 });

            // Should not exceed concurrency limit of 3
            expect(maxConcurrent).toBeLessThanOrEqual(3);
            expect(maxConcurrent).toBeGreaterThan(0);
        });

        it('should call onProgress callback', async () => {
            const progressUpdates: Array<{ completed: number; total: number }> = [];

            const operations = Array.from({ length: 5 }, (_, i) =>
                () => Promise.resolve(i)
            );

            const options: ParallelOptions = {
                onProgress: (completed, total) => {
                    progressUpdates.push({ completed, total });
                }
            };

            await executeInParallel(operations, options);

            expect(progressUpdates.length).toBeGreaterThan(0);
            expect(progressUpdates[progressUpdates.length - 1].completed).toBe(5);
            expect(progressUpdates[progressUpdates.length - 1].total).toBe(5);
        });

        it('should call onError callback for failures', async () => {
            const errorCallbacks: Array<{ error: Error; index: number }> = [];

            const operations = [
                () => Promise.resolve(1),
                () => Promise.reject(new Error('Error 1')),
                () => Promise.reject(new Error('Error 2'))
            ];

            const options: ParallelOptions = {
                onError: (error, index) => {
                    errorCallbacks.push({ error, index });
                }
            };

            await executeInParallel(operations, options);

            expect(errorCallbacks).toHaveLength(2);
            expect(errorCallbacks[0].error.message).toBe('Error 1');
            expect(errorCallbacks[1].error.message).toBe('Error 2');
        });

        it('should provide performance metrics', async () => {
            const operations = Array.from({ length: 10 }, (_, i) =>
                () => new Promise<number>(resolve =>
                    setTimeout(() => resolve(i), 10)
                )
            );

            const result = await executeInParallel(operations);

            expect(result.metrics.totalTime).toBeGreaterThan(0);
            expect(result.metrics.itemsPerSecond).toBeGreaterThan(0);
            expect(result.metrics.speedupFactor).toBeGreaterThanOrEqual(1);
            expect(result.metrics.parallelEfficiency).toBeGreaterThanOrEqual(0);
            expect(result.metrics.parallelEfficiency).toBeLessThanOrEqual(1);
        });

        it('should use custom concurrency when provided', async () => {
            let maxConcurrent = 0;
            let concurrentCount = 0;

            const operations = Array.from({ length: 10 }, () =>
                async () => {
                    concurrentCount++;
                    maxConcurrent = Math.max(maxConcurrent, concurrentCount);
                    await new Promise(resolve => setTimeout(resolve, 10));
                    concurrentCount--;
                    return 'done';
                }
            );

            await executeInParallel(operations, { concurrency: 2 });

            expect(maxConcurrent).toBeLessThanOrEqual(2);
        });
    });

    describe('chunkForParallel', () => {
        it('should chunk items correctly', () => {
            const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const chunks = chunkForParallel(items, 3, 2);

            expect(chunks).toEqual([
                [1, 2, 3],
                [4, 5, 6],
                [7, 8, 9],
                [10]
            ]);
        });

        it('should handle empty array', () => {
            const chunks = chunkForParallel([], 5, 2);
            expect(chunks).toEqual([]);
        });

        it('should handle single item', () => {
            const chunks = chunkForParallel([1], 5, 2);
            expect(chunks).toEqual([[1]]);
        });

        it('should handle batch size larger than array', () => {
            const items = [1, 2, 3];
            const chunks = chunkForParallel(items, 10, 2);

            expect(chunks).toEqual([[1, 2, 3]]);
        });

        it('should throw error for invalid batch size', () => {
            expect(() => chunkForParallel([1, 2, 3], 0, 2))
                .toThrow('batchSize must be positive');

            expect(() => chunkForParallel([1, 2, 3], -1, 2))
                .toThrow('batchSize must be positive');
        });

        it('should throw error for invalid concurrency', () => {
            expect(() => chunkForParallel([1, 2, 3], 2, 0))
                .toThrow('concurrency must be positive');

            expect(() => chunkForParallel([1, 2, 3], 2, -1))
                .toThrow('concurrency must be positive');
        });
    });

    describe('getOptimalConcurrency', () => {
        it('should return 1 for small datasets', () => {
            const concurrency = getOptimalConcurrency('write', 50);
            expect(concurrency).toBe(1);
        });

        it('should return limited concurrency for medium datasets', () => {
            const concurrency = getOptimalConcurrency('write', 500);
            expect(concurrency).toBeGreaterThanOrEqual(1);
            expect(concurrency).toBeLessThanOrEqual(2);
        });

        it('should return higher concurrency for large datasets', () => {
            const concurrency = getOptimalConcurrency('write', 5000);
            expect(concurrency).toBeGreaterThanOrEqual(2);
            expect(concurrency).toBeLessThanOrEqual(4);
        });

        it('should return maximum concurrency for very large datasets', () => {
            const concurrency = getOptimalConcurrency('write', 50000);
            expect(concurrency).toBeGreaterThanOrEqual(4);
            expect(concurrency).toBeLessThanOrEqual(8);
        });

        it('should respect configured maxConcurrency', () => {
            resetPrismaConfiguration();
            const prisma = new PrismaClient();
            configurePrisma(prisma, { maxConcurrency: 2 });

            const concurrency = getOptimalConcurrency('write', 50000);
            expect(concurrency).toBeLessThanOrEqual(2);
        });

        it('should handle both read and write operation types', () => {
            const readConcurrency = getOptimalConcurrency('read', 5000);
            const writeConcurrency = getOptimalConcurrency('write', 5000);

            // Both should return valid values
            expect(readConcurrency).toBeGreaterThan(0);
            expect(writeConcurrency).toBeGreaterThan(0);
        });
    });

    describe('shouldUseParallel', () => {
        it('should return false for small datasets', () => {
            const result = shouldUseParallel(50, 4);
            expect(result).toBe(false);
        });

        it('should return false for pool size of 1', () => {
            const result = shouldUseParallel(1000, 1);
            expect(result).toBe(false);
        });

        it('should return true for large datasets with pool size > 1', () => {
            const result = shouldUseParallel(1000, 4);
            expect(result).toBe(true);
        });

        it('should return true at threshold (100 items)', () => {
            const result = shouldUseParallel(100, 4);
            expect(result).toBe(true);
        });
    });

    describe('ParallelMetricsTracker', () => {
        it('should track metrics correctly', async () => {
            const tracker = new ParallelMetricsTracker(10, 4);

            tracker.start();

            // Simulate operations with actual delay
            for (let i = 0; i < 10; i++) {
                tracker.recordOperation(10); // 10ms per operation
            }

            // Add small delay to ensure totalTime > 0
            await new Promise(resolve => setTimeout(resolve, 5));

            const metrics = tracker.complete();

            expect(metrics.totalTime).toBeGreaterThan(0);
            expect(metrics.sequentialEstimate).toBe(100); // 10 ops * 10ms
            expect(metrics.speedupFactor).toBeGreaterThan(0);
            expect(metrics.itemsPerSecond).toBeGreaterThan(0);
        });

        it('should calculate speedup factor', () => {
            const tracker = new ParallelMetricsTracker(100, 4);

            tracker.start();

            // Simulate fast parallel execution
            for (let i = 0; i < 100; i++) {
                tracker.recordOperation(1);
            }

            // Wait a bit to simulate actual time
            const startTime = Date.now();
            while (Date.now() - startTime < 50) {
                // Busy wait
            }

            const metrics = tracker.complete();

            // Speedup should be significant
            expect(metrics.speedupFactor).toBeGreaterThan(1);
        });

        it('should calculate parallel efficiency', () => {
            const tracker = new ParallelMetricsTracker(10, 4);

            tracker.start();

            for (let i = 0; i < 10; i++) {
                tracker.recordOperation(10);
            }

            const metrics = tracker.complete();

            expect(metrics.parallelEfficiency).toBeGreaterThanOrEqual(0);
            expect(metrics.parallelEfficiency).toBeLessThanOrEqual(1);
        });
    });

    describe('createParallelMetrics', () => {
        it('should create metrics with default values', () => {
            const metrics = createParallelMetrics();

            expect(metrics.totalTime).toBe(0);
            expect(metrics.sequentialEstimate).toBe(0);
            expect(metrics.speedupFactor).toBe(1);
            expect(metrics.itemsPerSecond).toBe(0);
            expect(metrics.parallelEfficiency).toBe(0);
            expect(metrics.connectionUtilization).toBe(0);
        });
    });

    describe('Performance characteristics', () => {
        it('should demonstrate speedup with parallel execution', async () => {
            const operations = Array.from({ length: 20 }, (_, i) =>
                () => new Promise<number>(resolve =>
                    setTimeout(() => resolve(i), 10)
                )
            );

            const result = await executeInParallel(operations, { concurrency: 4 });

            // With 4 concurrent operations, should be faster than sequential
            expect(result.metrics.speedupFactor).toBeGreaterThan(1.5);
        });

        it('should have low overhead for fast operations', async () => {
            const operations = Array.from({ length: 100 }, (_, i) =>
                () => Promise.resolve(i)
            );

            const startTime = Date.now();
            await executeInParallel(operations);
            const totalTime = Date.now() - startTime;

            // Should complete quickly (< 100ms for 100 instant operations)
            expect(totalTime).toBeLessThan(100);
        });
    });
});
