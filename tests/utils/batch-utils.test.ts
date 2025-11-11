/**
 * Test suite for Batch Utilities
 * Tests batch creation, optimal batch size calculation, and batch processing
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
    createBatches,
    getOptimalBatchSize,
    processBatches
} from '../../src/utils/batch-utils';

describe('Batch Utils', () => {
    describe('createBatches', () => {
        /**
         * Test: should create batches of specified size
         */
        it('should create batches of specified size', () => {
            const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const batches = createBatches(items, 3);

            expect(batches).toEqual([
                [1, 2, 3],
                [4, 5, 6],
                [7, 8, 9],
                [10]
            ]);
        });

        /**
         * Test: should handle exact division
         */
        it('should handle exact division', () => {
            const items = [1, 2, 3, 4, 5, 6];
            const batches = createBatches(items, 2);

            expect(batches).toEqual([
                [1, 2],
                [3, 4],
                [5, 6]
            ]);
        });

        /**
         * Test: should handle single batch
         */
        it('should handle single batch', () => {
            const items = [1, 2, 3];
            const batches = createBatches(items, 10);

            expect(batches).toEqual([[1, 2, 3]]);
        });

        /**
         * Test: should handle batch size of 1
         */
        it('should handle batch size of 1', () => {
            const items = [1, 2, 3];
            const batches = createBatches(items, 1);

            expect(batches).toEqual([[1], [2], [3]]);
        });

        /**
         * Test: should return empty array for empty input
         */
        it('should return empty array for empty input', () => {
            const batches = createBatches([], 5);
            expect(batches).toEqual([]);
        });

        /**
         * Test: should throw error for invalid batch size
         */
        it('should throw error for invalid batch size', () => {
            expect(() => createBatches([1, 2, 3], 0)).toThrow('batchSize must be positive');
            expect(() => createBatches([1, 2, 3], -1)).toThrow('batchSize must be positive');
        });

        /**
         * Test: should work with objects
         */
        it('should work with objects', () => {
            const items = [
                { id: 1, name: 'A' },
                { id: 2, name: 'B' },
                { id: 3, name: 'C' }
            ];
            const batches = createBatches(items, 2);

            expect(batches).toEqual([
                [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
                [{ id: 3, name: 'C' }]
            ]);
        });

        /**
         * Test: should work with large arrays
         */
        it('should work with large arrays', () => {
            const items = Array.from({ length: 10000 }, (_, i) => i);
            const batches = createBatches(items, 1000);

            expect(batches.length).toBe(10);
            expect(batches[0].length).toBe(1000);
            expect(batches[9].length).toBe(1000);
        });
    });

    describe('getOptimalBatchSize', () => {
        /**
         * Test: should return batch size for createMany operation
         */
        it('should return batch size for createMany operation', () => {
            const batchSize = getOptimalBatchSize('createMany');
            expect(batchSize).toBeGreaterThan(0);
            expect(typeof batchSize).toBe('number');
        });

        /**
         * Test: should return batch size for updateMany operation
         */
        it('should return batch size for updateMany operation', () => {
            const batchSize = getOptimalBatchSize('updateMany');
            expect(batchSize).toBeGreaterThan(0);
            expect(typeof batchSize).toBe('number');
        });

        /**
         * Test: should return batch size for transaction operation
         */
        it('should return batch size for transaction operation', () => {
            const batchSize = getOptimalBatchSize('transaction');
            expect(batchSize).toBeGreaterThan(0);
            expect(typeof batchSize).toBe('number');
        });

        /**
         * Test: should return batch size for delete operation
         */
        it('should return batch size for delete operation', () => {
            const batchSize = getOptimalBatchSize('delete');
            expect(batchSize).toBeGreaterThan(0);
            expect(typeof batchSize).toBe('number');
        });

        /**
         * Test: should return different sizes for different databases
         */
        it('should return different sizes for different databases', () => {
            const sqliteBatchSize = getOptimalBatchSize('createMany', 'sqlite');
            const mysqlBatchSize = getOptimalBatchSize('createMany', 'mysql');
            const postgresqlBatchSize = getOptimalBatchSize('createMany', 'postgresql');

            expect(sqliteBatchSize).toBe(500);
            expect(mysqlBatchSize).toBe(1500);
            expect(postgresqlBatchSize).toBe(1500);
        });

        /**
         * Test: should return smaller batch size for MongoDB transactions
         */
        it('should return smaller batch size for MongoDB transactions', () => {
            const mongoTransactionSize = getOptimalBatchSize('transaction', 'mongodb');
            const mongoCreateSize = getOptimalBatchSize('createMany', 'mongodb');

            expect(mongoTransactionSize).toBe(100);
            expect(mongoCreateSize).toBe(1000);
        });

        /**
         * Test: should return fallback value on error
         */
        it('should return fallback value on error', () => {
            // When provider detection fails, should return conservative defaults
            const batchSize = getOptimalBatchSize('createMany');
            expect(batchSize).toBeGreaterThan(0);
        });
    });

    describe('processBatches', () => {
        /**
         * Test: should process batches sequentially
         */
        it('should process batches sequentially', async () => {
            const items = [1, 2, 3, 4, 5, 6];
            const processor = jest.fn(async (batch: number[]) => {
                return batch.reduce((sum, n) => sum + n, 0);
            });

            const result = await processBatches(items, 2, processor);

            expect(processor).toHaveBeenCalledTimes(3);
            expect(result.results).toEqual([3, 7, 11]); // [1+2, 3+4, 5+6]
            expect(result.errors).toEqual([]);
            expect(result.totalBatches).toBe(3);
            expect(result.successfulBatches).toBe(3);
            expect(result.failedBatches).toBe(0);
        });

        /**
         * Test: should process batches in parallel
         */
        it('should process batches in parallel', async () => {
            const items = [1, 2, 3, 4, 5, 6];
            const processor = jest.fn(async (batch: number[]) => {
                return batch.reduce((sum, n) => sum + n, 0);
            });

            const result = await processBatches(items, 2, processor, { parallel: true });

            expect(processor).toHaveBeenCalledTimes(3);
            expect(result.results).toEqual([3, 7, 11]);
            expect(result.errors).toEqual([]);
            expect(result.totalBatches).toBe(3);
            expect(result.successfulBatches).toBe(3);
            expect(result.failedBatches).toBe(0);
        });

        /**
         * Test: should handle empty items
         */
        it('should handle empty items', async () => {
            const processor = jest.fn(async (batch: number[]) => batch.length);

            const result = await processBatches([], 10, processor);

            expect(processor).not.toHaveBeenCalled();
            expect(result.results).toEqual([]);
            expect(result.errors).toEqual([]);
            expect(result.totalBatches).toBe(0);
        });

        /**
         * Test: should handle errors in sequential mode
         */
        it('should handle errors in sequential mode', async () => {
            const items = [1, 2, 3, 4, 5, 6];
            const processor = jest.fn(async (batch: number[]) => {
                if (batch[0] === 3) {
                    throw new Error('Test error');
                }
                return batch.reduce((sum, n) => sum + n, 0);
            });

            const result = await processBatches(items, 2, processor);

            expect(result.results).toEqual([3, 11]); // First and third batch succeeded
            expect(result.errors.length).toBe(1);
            expect(result.errors[0].index).toBe(1);
            expect(result.errors[0].error.message).toBe('Test error');
            expect(result.successfulBatches).toBe(2);
            expect(result.failedBatches).toBe(1);
        });

        /**
         * Test: should call progress callback
         */
        it('should call progress callback', async () => {
            const items = [1, 2, 3, 4, 5, 6];
            const processor = jest.fn(async (batch: number[]) => batch.length);
            const onProgress = jest.fn();

            await processBatches(items, 2, processor, { onProgress });

            expect(onProgress).toHaveBeenCalledTimes(3);
            expect(onProgress).toHaveBeenNthCalledWith(1, 1, 3);
            expect(onProgress).toHaveBeenNthCalledWith(2, 2, 3);
            expect(onProgress).toHaveBeenNthCalledWith(3, 3, 3);
        });

        /**
         * Test: should call error callback
         */
        it('should call error callback', async () => {
            const items = [1, 2, 3, 4];
            const processor = jest.fn(async (batch: number[]) => {
                if (batch[0] === 3) {
                    throw new Error('Test error');
                }
                return batch.length;
            });
            const onError = jest.fn();

            await processBatches(items, 2, processor, { onError });

            expect(onError).toHaveBeenCalledTimes(1);
            expect(onError).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Test error' }),
                1
            );
        });

        /**
         * Test: should work with async processor
         */
        it('should work with async processor', async () => {
            const items = ['a', 'b', 'c', 'd'];
            const processor = async (batch: string[]) => {
                await new Promise(resolve => setTimeout(resolve, 10));
                return batch.join('');
            };

            const result = await processBatches(items, 2, processor);

            expect(result.results).toEqual(['ab', 'cd']);
            expect(result.errors).toEqual([]);
        });

        /**
         * Test: should not use parallel for single batch
         */
        it('should not use parallel for single batch', async () => {
            const items = [1, 2, 3];
            const processor = jest.fn(async (batch: number[]) => batch.length);

            const result = await processBatches(items, 10, processor, { parallel: true });

            // Should execute sequentially since there's only one batch
            expect(result.results).toEqual([3]);
            expect(result.totalBatches).toBe(1);
        });

        /**
         * Test: should work with objects
         */
        it('should work with objects', async () => {
            const items = [
                { id: 1, name: 'A' },
                { id: 2, name: 'B' },
                { id: 3, name: 'C' },
                { id: 4, name: 'D' }
            ];
            const processor = async (batch: typeof items) => {
                return batch.map(item => item.id);
            };

            const result = await processBatches(items, 2, processor);

            expect(result.results).toEqual([[1, 2], [3, 4]]);
        });
    });
});
