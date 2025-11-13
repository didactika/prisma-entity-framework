/**
 * Tests for performance utilities
 */

import { describe, it, expect } from '@jest/globals';
import {
    getOptimalBatchSize,
    estimateBatchMemoryUsage,
    isBatchSafe,
    createBatchMetrics,
    withRetry,
    BATCH_SIZE_CONFIG,
} from '../src/core/utils/performance-utils';

describe('Performance Utils', () => {
    describe('getOptimalBatchSize', () => {
        it('should return appropriate batch size for createMany', () => {
            const size = getOptimalBatchSize('createMany');
            expect(size).toBeGreaterThan(0);
            expect(size).toBeLessThanOrEqual(1500);
        });

        it('should return appropriate batch size for updateMany', () => {
            const size = getOptimalBatchSize('updateMany');
            expect(size).toBeGreaterThan(0);
            expect(size).toBeLessThanOrEqual(1500);
        });

        it('should return appropriate batch size for transaction', () => {
            const size = getOptimalBatchSize('transaction');
            expect(size).toBeGreaterThan(0);
            expect(size).toBeLessThanOrEqual(1000);
        });
    });

    describe('estimateBatchMemoryUsage', () => {
        it('should estimate memory for 1000 items with default size', () => {
            const memoryMB = estimateBatchMemoryUsage(1000);
            expect(memoryMB).toBeCloseTo(0.98, 1); // ~1MB
        });

        it('should estimate memory for 1000 items with custom size', () => {
            const memoryMB = estimateBatchMemoryUsage(1000, 2048);
            expect(memoryMB).toBeCloseTo(1.95, 1); // ~2MB
        });

        it('should return 0 for empty batch', () => {
            const memoryMB = estimateBatchMemoryUsage(0);
            expect(memoryMB).toBe(0);
        });
    });

    describe('isBatchSafe', () => {
        it('should return true for safe batch size', () => {
            const safe = isBatchSafe(1000, 100, 1024);
            expect(safe).toBe(true);
        });

        it('should return false for unsafe batch size', () => {
            const safe = isBatchSafe(100000, 10, 1024);
            expect(safe).toBe(false);
        });

        it('should handle edge cases', () => {
            expect(isBatchSafe(0, 100)).toBe(true);
            expect(isBatchSafe(1, 0)).toBe(false);
        });
    });


    describe('createBatchMetrics', () => {
        it('should create metrics with correct initial values', () => {
            const metrics = createBatchMetrics(1000, 100);

            expect(metrics.totalItems).toBe(1000);
            expect(metrics.batchCount).toBe(10);
            expect(metrics.avgBatchSize).toBe(100);
            expect(metrics.startTime).toBeDefined();
            expect(metrics.endTime).toBeUndefined();
        });

        it('should calculate duration and throughput on complete', () => {
            const metrics = createBatchMetrics(1000, 100) as any;

            // Simulate some work
            const startTime = metrics.startTime;
            setTimeout(() => {
                metrics.complete();

                expect(metrics.endTime).toBeGreaterThan(startTime);
                expect(metrics.durationMs).toBeGreaterThan(0);
                expect(metrics.itemsPerSecond).toBeGreaterThan(0);
            }, 10);
        });
    });

    describe('withRetry', () => {
        it('should succeed on first attempt', async () => {
            let attempts = 0;
            const operation = async () => {
                attempts++;
                return 'success';
            };

            const result = await withRetry(operation, { maxRetries: 3 });

            expect(result).toBe('success');
            expect(attempts).toBe(1);
        });

        it('should retry on retryable errors', async () => {
            let attempts = 0;
            const operation = async () => {
                attempts++;
                if (attempts < 3) {
                    throw new Error('Connection timeout');
                }
                return 'success';
            };

            const result = await withRetry(operation, {
                maxRetries: 3,
                initialDelayMs: 10,
                maxDelayMs: 100
            });

            expect(result).toBe('success');
            expect(attempts).toBe(3);
        });

        it('should not retry on non-retryable errors', async () => {
            let attempts = 0;
            const operation = async () => {
                attempts++;
                throw new Error('Invalid data');
            };

            await expect(withRetry(operation, { maxRetries: 3 }))
                .rejects.toThrow('Invalid data');

            expect(attempts).toBe(1);
        });

        it('should throw after max retries', async () => {
            let attempts = 0;
            const operation = async () => {
                attempts++;
                throw new Error('Connection timeout');
            };

            await expect(withRetry(operation, {
                maxRetries: 2,
                initialDelayMs: 10
            })).rejects.toThrow('Connection timeout');

            expect(attempts).toBe(3); // Initial + 2 retries
        });
    });


    describe('BATCH_SIZE_CONFIG', () => {
        it('should have configuration for all database providers', () => {
            expect(BATCH_SIZE_CONFIG.sqlite).toBeDefined();
            expect(BATCH_SIZE_CONFIG.mysql).toBeDefined();
            expect(BATCH_SIZE_CONFIG.postgresql).toBeDefined();
            expect(BATCH_SIZE_CONFIG.sqlserver).toBeDefined();
            expect(BATCH_SIZE_CONFIG.mongodb).toBeDefined();
        });

        it('should have all operation types for each provider', () => {
            const providers = Object.keys(BATCH_SIZE_CONFIG);

            providers.forEach(provider => {
                const config = (BATCH_SIZE_CONFIG as any)[provider];
                expect(config.createMany).toBeGreaterThan(0);
                expect(config.updateMany).toBeGreaterThan(0);
                expect(config.transaction).toBeGreaterThan(0);
            });
        });

        it('should have smaller transaction sizes for MongoDB', () => {
            expect(BATCH_SIZE_CONFIG.mongodb.transaction).toBeLessThan(
                BATCH_SIZE_CONFIG.postgresql.transaction
            );
        });
    });
});
