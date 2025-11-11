/**
 * Tests for Query Utilities
 */

import {
    needsOrBatching,
    createOrBatches,
    deduplicateResults,
    executeWithOrBatching
} from '../../src/utils/query-utils';
import * as performanceUtils from '../../src/utils/performance-utils';
import * as parallelUtils from '../../src/utils/parallel-utils';
import * as config from '../../src/config';

// Mock dependencies
jest.mock('../../src/utils/performance-utils');
jest.mock('../../src/utils/parallel-utils');
jest.mock('../../src/config');

const mockPerformanceUtils = performanceUtils as jest.Mocked<typeof performanceUtils>;
const mockParallelUtils = parallelUtils as jest.Mocked<typeof parallelUtils>;
const mockConfig = config as jest.Mocked<typeof config>;

describe('Query Utilities', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('needsOrBatching', () => {
        it('should return true when OR conditions exceed database limits', () => {
            mockPerformanceUtils.isOrQuerySafe.mockReturnValue(false);

            const orConditions = [
                { email: 'user1@example.com' },
                { email: 'user2@example.com' }
            ];

            const result = needsOrBatching(orConditions);

            expect(result).toBe(true);
            expect(mockPerformanceUtils.isOrQuerySafe).toHaveBeenCalledWith(orConditions);
        });

        it('should return false when OR conditions are within database limits', () => {
            mockPerformanceUtils.isOrQuerySafe.mockReturnValue(true);

            const orConditions = [
                { email: 'user1@example.com' },
                { email: 'user2@example.com' }
            ];

            const result = needsOrBatching(orConditions);

            expect(result).toBe(false);
            expect(mockPerformanceUtils.isOrQuerySafe).toHaveBeenCalledWith(orConditions);
        });

        it('should handle empty OR conditions', () => {
            mockPerformanceUtils.isOrQuerySafe.mockReturnValue(true);

            const result = needsOrBatching([]);

            expect(result).toBe(false);
        });
    });

    describe('createOrBatches', () => {
        it('should create batches based on optimal batch size', () => {
            mockPerformanceUtils.getOptimalOrBatchSize.mockReturnValue(2);

            const orConditions = [
                { email: 'user1@example.com' },
                { email: 'user2@example.com' },
                { email: 'user3@example.com' },
                { email: 'user4@example.com' },
                { email: 'user5@example.com' }
            ];

            const batches = createOrBatches(orConditions, 1);

            expect(batches).toHaveLength(3);
            expect(batches[0]).toHaveLength(2);
            expect(batches[1]).toHaveLength(2);
            expect(batches[2]).toHaveLength(1);
            expect(mockPerformanceUtils.getOptimalOrBatchSize).toHaveBeenCalledWith(1);
        });

        it('should handle composite keys with multiple fields per condition', () => {
            mockPerformanceUtils.getOptimalOrBatchSize.mockReturnValue(3);

            const orConditions = [
                { email: 'user1@example.com', tenantId: 1 },
                { email: 'user2@example.com', tenantId: 1 },
                { email: 'user3@example.com', tenantId: 2 },
                { email: 'user4@example.com', tenantId: 2 }
            ];

            const batches = createOrBatches(orConditions, 2);

            expect(batches).toHaveLength(2);
            expect(batches[0]).toHaveLength(3);
            expect(batches[1]).toHaveLength(1);
            expect(mockPerformanceUtils.getOptimalOrBatchSize).toHaveBeenCalledWith(2);
        });

        it('should return empty array for empty input', () => {
            const batches = createOrBatches([]);

            expect(batches).toEqual([]);
        });

        it('should create single batch when conditions fit in one batch', () => {
            mockPerformanceUtils.getOptimalOrBatchSize.mockReturnValue(100);

            const orConditions = [
                { email: 'user1@example.com' },
                { email: 'user2@example.com' }
            ];

            const batches = createOrBatches(orConditions, 1);

            expect(batches).toHaveLength(1);
            expect(batches[0]).toHaveLength(2);
        });

        it('should use default fieldsPerCondition of 1', () => {
            mockPerformanceUtils.getOptimalOrBatchSize.mockReturnValue(10);

            const orConditions = [{ email: 'user1@example.com' }];

            createOrBatches(orConditions);

            expect(mockPerformanceUtils.getOptimalOrBatchSize).toHaveBeenCalledWith(1);
        });
    });

    describe('deduplicateResults', () => {
        it('should remove duplicate results by id', () => {
            const results = [
                { id: 1, name: 'User 1' },
                { id: 2, name: 'User 2' },
                { id: 1, name: 'User 1 Duplicate' },
                { id: 3, name: 'User 3' },
                { id: 2, name: 'User 2 Duplicate' }
            ];

            const deduplicated = deduplicateResults(results);

            expect(deduplicated).toHaveLength(3);
            expect(deduplicated).toEqual([
                { id: 1, name: 'User 1' },
                { id: 2, name: 'User 2' },
                { id: 3, name: 'User 3' }
            ]);
        });

        it('should preserve first occurrence of duplicate', () => {
            const results = [
                { id: 1, name: 'First' },
                { id: 1, name: 'Second' }
            ];

            const deduplicated = deduplicateResults(results);

            expect(deduplicated).toHaveLength(1);
            expect(deduplicated[0].name).toBe('First');
        });

        it('should handle empty array', () => {
            const deduplicated = deduplicateResults([]);

            expect(deduplicated).toEqual([]);
        });

        it('should handle array with no duplicates', () => {
            const results = [
                { id: 1, name: 'User 1' },
                { id: 2, name: 'User 2' },
                { id: 3, name: 'User 3' }
            ];

            const deduplicated = deduplicateResults(results);

            expect(deduplicated).toHaveLength(3);
            expect(deduplicated).toEqual(results);
        });

        it('should handle results with string ids', () => {
            const results = [
                { id: 'abc', name: 'User 1' },
                { id: 'def', name: 'User 2' },
                { id: 'abc', name: 'User 1 Duplicate' }
            ];

            const deduplicated = deduplicateResults(results);

            expect(deduplicated).toHaveLength(2);
            expect(deduplicated).toEqual([
                { id: 'abc', name: 'User 1' },
                { id: 'def', name: 'User 2' }
            ]);
        });

        it('should handle results with undefined id', () => {
            const results = [
                { id: undefined as any, name: 'User 1' },
                { id: 1, name: 'User 2' }
            ];

            const deduplicated = deduplicateResults(results);

            expect(deduplicated).toHaveLength(2);
        });
    });

    describe('executeWithOrBatching', () => {
        let mockModel: any;

        beforeEach(() => {
            mockModel = {
                findMany: jest.fn()
            };
        });

        it('should execute single query when batching not needed', async () => {
            mockPerformanceUtils.isOrQuerySafe.mockReturnValue(true);

            const orConditions = [
                { email: 'user1@example.com' },
                { email: 'user2@example.com' }
            ];

            const mockResults = [
                { id: 1, email: 'user1@example.com' },
                { id: 2, email: 'user2@example.com' }
            ];

            mockModel.findMany.mockResolvedValue(mockResults);

            const results = await executeWithOrBatching(mockModel, orConditions);

            expect(results).toEqual(mockResults);
            expect(mockModel.findMany).toHaveBeenCalledTimes(1);
            expect(mockModel.findMany).toHaveBeenCalledWith({
                where: { OR: orConditions },
                include: undefined
            });
        });

        it('should execute batched queries sequentially when parallel disabled', async () => {
            mockPerformanceUtils.isOrQuerySafe.mockReturnValue(false);
            mockPerformanceUtils.getOptimalOrBatchSize.mockReturnValue(2);
            mockConfig.isParallelEnabled.mockReturnValue(false);

            const orConditions = [
                { email: 'user1@example.com' },
                { email: 'user2@example.com' },
                { email: 'user3@example.com' }
            ];

            const batch1Results = [
                { id: 1, email: 'user1@example.com' },
                { id: 2, email: 'user2@example.com' }
            ];

            const batch2Results = [
                { id: 3, email: 'user3@example.com' }
            ];

            mockModel.findMany
                .mockResolvedValueOnce(batch1Results)
                .mockResolvedValueOnce(batch2Results);

            const results = await executeWithOrBatching(mockModel, orConditions, {
                parallel: false
            });

            expect(results).toHaveLength(3);
            expect(mockModel.findMany).toHaveBeenCalledTimes(2);
        });

        it('should execute batched queries in parallel when enabled', async () => {
            mockPerformanceUtils.isOrQuerySafe.mockReturnValue(false);
            mockPerformanceUtils.getOptimalOrBatchSize.mockReturnValue(2);
            mockConfig.isParallelEnabled.mockReturnValue(true);

            const orConditions = [
                { email: 'user1@example.com' },
                { email: 'user2@example.com' },
                { email: 'user3@example.com' }
            ];

            const batch1Results = [
                { id: 1, email: 'user1@example.com' },
                { id: 2, email: 'user2@example.com' }
            ];

            const batch2Results = [
                { id: 3, email: 'user3@example.com' }
            ];

            mockParallelUtils.executeInParallel.mockResolvedValue({
                results: [batch1Results, batch2Results],
                errors: [],
                metrics: {} as any
            });

            const results = await executeWithOrBatching(mockModel, orConditions, {
                parallel: true
            });

            expect(results).toHaveLength(3);
            expect(mockParallelUtils.executeInParallel).toHaveBeenCalledTimes(1);
            expect(mockParallelUtils.executeInParallel).toHaveBeenCalledWith(
                expect.any(Array),
                { concurrency: undefined }
            );
        });

        it('should deduplicate results from multiple batches', async () => {
            mockPerformanceUtils.isOrQuerySafe.mockReturnValue(false);
            mockPerformanceUtils.getOptimalOrBatchSize.mockReturnValue(2);
            mockConfig.isParallelEnabled.mockReturnValue(true);

            const orConditions = [
                { email: 'user1@example.com' },
                { email: 'user2@example.com' },
                { email: 'user1@example.com' } // duplicate
            ];

            const batch1Results = [
                { id: 1, email: 'user1@example.com' },
                { id: 2, email: 'user2@example.com' }
            ];

            const batch2Results = [
                { id: 1, email: 'user1@example.com' } // duplicate
            ];

            mockParallelUtils.executeInParallel.mockResolvedValue({
                results: [batch1Results, batch2Results],
                errors: [],
                metrics: {} as any
            });

            const results = await executeWithOrBatching(mockModel, orConditions);

            expect(results).toHaveLength(2);
            expect(results).toEqual([
                { id: 1, email: 'user1@example.com' },
                { id: 2, email: 'user2@example.com' }
            ]);
        });

        it('should pass include option to queries', async () => {
            mockPerformanceUtils.isOrQuerySafe.mockReturnValue(true);

            const orConditions = [{ email: 'user1@example.com' }];
            const include = { posts: true, profile: true };

            mockModel.findMany.mockResolvedValue([]);

            await executeWithOrBatching(mockModel, orConditions, { include });

            expect(mockModel.findMany).toHaveBeenCalledWith({
                where: { OR: orConditions },
                include
            });
        });

        it('should pass concurrency option to parallel execution', async () => {
            mockPerformanceUtils.isOrQuerySafe.mockReturnValue(false);
            mockPerformanceUtils.getOptimalOrBatchSize.mockReturnValue(1);
            mockConfig.isParallelEnabled.mockReturnValue(true);

            const orConditions = [
                { email: 'user1@example.com' },
                { email: 'user2@example.com' }
            ];

            mockParallelUtils.executeInParallel.mockResolvedValue({
                results: [[], []],
                errors: [],
                metrics: {} as any
            });

            await executeWithOrBatching(mockModel, orConditions, {
                parallel: true,
                concurrency: 4
            });

            expect(mockParallelUtils.executeInParallel).toHaveBeenCalledWith(
                expect.any(Array),
                { concurrency: 4 }
            );
        });

        it('should handle empty OR conditions', async () => {
            const results = await executeWithOrBatching(mockModel, []);

            expect(results).toEqual([]);
            expect(mockModel.findMany).not.toHaveBeenCalled();
        });

        it('should log warning when parallel queries fail', async () => {
            mockPerformanceUtils.isOrQuerySafe.mockReturnValue(false);
            mockPerformanceUtils.getOptimalOrBatchSize.mockReturnValue(1);
            mockConfig.isParallelEnabled.mockReturnValue(true);

            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

            const orConditions = [
                { email: 'user1@example.com' },
                { email: 'user2@example.com' }
            ];

            mockParallelUtils.executeInParallel.mockResolvedValue({
                results: [[{ id: 1, email: 'user1@example.com' }]],
                errors: [{ index: 1, error: new Error('Query failed') }],
                metrics: {} as any
            });

            const results = await executeWithOrBatching(mockModel, orConditions);

            // Should return partial results even with errors
            expect(results).toHaveLength(1);
            expect(results[0]).toEqual({ id: 1, email: 'user1@example.com' });

            consoleWarnSpy.mockRestore();
        });

        it('should use fieldsPerCondition for batch size calculation', async () => {
            mockPerformanceUtils.isOrQuerySafe.mockReturnValue(false);
            mockPerformanceUtils.getOptimalOrBatchSize.mockReturnValue(10);
            mockConfig.isParallelEnabled.mockReturnValue(false);

            const orConditions = [
                { email: 'user1@example.com', tenantId: 1 }
            ];

            mockModel.findMany.mockResolvedValue([]);

            await executeWithOrBatching(mockModel, orConditions, {
                fieldsPerCondition: 2
            });

            expect(mockPerformanceUtils.getOptimalOrBatchSize).toHaveBeenCalledWith(2);
        });

        it('should not use parallel when only one batch', async () => {
            mockPerformanceUtils.isOrQuerySafe.mockReturnValue(false);
            mockPerformanceUtils.getOptimalOrBatchSize.mockReturnValue(10);
            mockConfig.isParallelEnabled.mockReturnValue(true);

            const orConditions = [
                { email: 'user1@example.com' },
                { email: 'user2@example.com' }
            ];

            mockModel.findMany.mockResolvedValue([]);

            await executeWithOrBatching(mockModel, orConditions, {
                parallel: true
            });

            // Should execute sequentially since only one batch
            expect(mockParallelUtils.executeInParallel).not.toHaveBeenCalled();
            expect(mockModel.findMany).toHaveBeenCalledTimes(1);
        });
    });
});
