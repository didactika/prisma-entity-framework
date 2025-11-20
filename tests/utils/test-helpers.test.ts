/**
 * Tests for test helper utilities
 */

import {
  skipIfNotSupported,
  isProvider,
  getIdType,
  getMaxConcurrency,
  assertCorrectIdType,
  createTestDataHelper,
  PerformanceMetrics,
  measureTime,
  waitFor,
  assertJSONEquals,
  assertArrayEquals,
  createTestBatch,
  retryWithBackoff,
  assertPerformance,
  getDatabaseConfig,
} from '../helpers/test-helpers';

describe('Test Helper Utilities', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    // Restore original DATABASE_URL
    if (originalDatabaseUrl) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  describe('skipIfNotSupported', () => {
    it('should return true when capability is not supported', () => {
      process.env.DATABASE_URL = 'file:./test.db';
      expect(skipIfNotSupported('supportsJSON')).toBe(true);
    });

    it('should return false when capability is supported', () => {
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      expect(skipIfNotSupported('supportsJSON')).toBe(false);
    });
  });

  describe('isProvider', () => {
    it('should correctly identify MySQL', () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';
      expect(isProvider('mysql')).toBe(true);
      expect(isProvider('postgresql')).toBe(false);
    });

    it('should correctly identify PostgreSQL', () => {
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      expect(isProvider('postgresql')).toBe(true);
      expect(isProvider('mysql')).toBe(false);
    });

    it('should correctly identify MongoDB', () => {
      process.env.DATABASE_URL = 'mongodb://localhost/test';
      expect(isProvider('mongodb')).toBe(true);
      expect(isProvider('sqlite')).toBe(false);
    });

    it('should correctly identify SQLite', () => {
      process.env.DATABASE_URL = 'file:./test.db';
      expect(isProvider('sqlite')).toBe(true);
      expect(isProvider('mongodb')).toBe(false);
    });
  });

  describe('getIdType', () => {
    it('should return number for relational databases', () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';
      expect(getIdType()).toBe('number');

      process.env.DATABASE_URL = 'postgresql://localhost/test';
      expect(getIdType()).toBe('number');

      process.env.DATABASE_URL = 'file:./test.db';
      expect(getIdType()).toBe('number');
    });

    it('should return string for MongoDB', () => {
      process.env.DATABASE_URL = 'mongodb://localhost/test';
      expect(getIdType()).toBe('string');
    });
  });

  describe('getMaxConcurrency', () => {
    it('should return correct concurrency for each database', () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';
      expect(getMaxConcurrency()).toBe(8);

      process.env.DATABASE_URL = 'postgresql://localhost/test';
      expect(getMaxConcurrency()).toBe(8);

      process.env.DATABASE_URL = 'mongodb://localhost/test';
      expect(getMaxConcurrency()).toBe(2);

      process.env.DATABASE_URL = 'file:./test.db';
      expect(getMaxConcurrency()).toBe(1);
    });
  });

  describe('assertCorrectIdType', () => {
    it('should not throw for correct ID types', () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';
      expect(() => assertCorrectIdType(123)).not.toThrow();

      process.env.DATABASE_URL = 'mongodb://localhost/test';
      expect(() => assertCorrectIdType('507f1f77bcf86cd799439011')).not.toThrow();
    });

    it('should throw for incorrect ID types', () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';
      expect(() => assertCorrectIdType('string-id')).toThrow();

      process.env.DATABASE_URL = 'mongodb://localhost/test';
      expect(() => assertCorrectIdType(123)).toThrow();
    });

    it('should use custom error message when provided', () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';
      expect(() => assertCorrectIdType('wrong', 'Custom error')).toThrow('Custom error');
    });
  });

  describe('createTestDataHelper', () => {
    it('should generate appropriate ID types', () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';
      const helper = createTestDataHelper();
      const id = helper.generateId();
      expect(typeof id).toBe('number');

      process.env.DATABASE_URL = 'mongodb://localhost/test';
      const mongoHelper = createTestDataHelper();
      const mongoId = mongoHelper.generateId();
      expect(typeof mongoId).toBe('string');
    });

    it('should validate ID types correctly', () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';
      const helper = createTestDataHelper();
      expect(helper.isValidId(123)).toBe(true);
      expect(helper.isValidId('string')).toBe(false);

      process.env.DATABASE_URL = 'mongodb://localhost/test';
      const mongoHelper = createTestDataHelper();
      expect(mongoHelper.isValidId('507f1f77bcf86cd799439011')).toBe(true);
      expect(mongoHelper.isValidId(123)).toBe(false);
    });

    it('should return capabilities', () => {
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      const helper = createTestDataHelper();
      const capabilities = helper.getCapabilities();
      expect(capabilities.provider).toBe('postgresql');
      expect(capabilities.supportsJSON).toBe(true);
    });
  });

  describe('PerformanceMetrics', () => {
    let metrics: PerformanceMetrics;

    beforeEach(() => {
      metrics = new PerformanceMetrics();
    });

    it('should record and retrieve metrics', () => {
      metrics.record('test-metric', 100);
      metrics.record('test-metric', 200);
      metrics.record('test-metric', 300);

      const values = metrics.getValues('test-metric');
      expect(values).toEqual([100, 200, 300]);
    });

    it('should calculate average correctly', () => {
      metrics.record('test-metric', 100);
      metrics.record('test-metric', 200);
      metrics.record('test-metric', 300);

      expect(metrics.getAverage('test-metric')).toBe(200);
    });

    it('should return 0 for non-existent metrics', () => {
      expect(metrics.getAverage('non-existent')).toBe(0);
      expect(metrics.getValues('non-existent')).toEqual([]);
    });

    it('should clear all metrics', () => {
      metrics.record('metric1', 100);
      metrics.record('metric2', 200);
      metrics.clear();

      expect(metrics.getValues('metric1')).toEqual([]);
      expect(metrics.getValues('metric2')).toEqual([]);
    });

    it('should generate summary report', () => {
      metrics.record('operation1', 100);
      metrics.record('operation1', 200);
      metrics.record('operation2', 50);

      const summary = metrics.getSummary();
      expect(summary).toContain('Performance Metrics Summary');
      expect(summary).toContain('operation1');
      expect(summary).toContain('operation2');
      expect(summary).toContain('Average');
      expect(summary).toContain('Min');
      expect(summary).toContain('Max');
    });
  });

  describe('measureTime', () => {
    it('should measure execution time', async () => {
      const { result, duration } = await measureTime(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'test-result';
      });

      expect(result).toBe('test-result');
      expect(duration).toBeGreaterThanOrEqual(95); // Allow small timing variance
      expect(duration).toBeLessThan(200); // Allow some margin
    });

    it('should handle errors in measured function', async () => {
      await expect(
        measureTime(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
    });
  });

  describe('waitFor', () => {
    it('should resolve when condition becomes true', async () => {
      let counter = 0;
      const condition = () => {
        counter++;
        return counter >= 3;
      };

      await waitFor(condition, 1000, 50);
      expect(counter).toBeGreaterThanOrEqual(3);
    });

    it('should timeout if condition never becomes true', async () => {
      const condition = () => false;

      await expect(
        waitFor(condition, 200, 50)
      ).rejects.toThrow('Timeout waiting for condition after 200ms');
    });

    it('should work with async conditions', async () => {
      let counter = 0;
      const condition = async () => {
        counter++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return counter >= 3;
      };

      await waitFor(condition, 1000, 50);
      expect(counter).toBeGreaterThanOrEqual(3);
    });

    it('should resolve immediately if condition is already true', async () => {
      const condition = () => true;
      const start = Date.now();

      await waitFor(condition, 1000, 50);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });

  describe('assertJSONEquals', () => {
    it('should pass for equal JSON objects', () => {
      expect(() => assertJSONEquals({ key: 'value' }, { key: 'value' })).not.toThrow();
    });

    it('should pass for JSON strings', () => {
      expect(() => assertJSONEquals('{"key":"value"}', { key: 'value' })).not.toThrow();
    });

    it('should throw for different JSON objects', () => {
      expect(() => assertJSONEquals({ key: 'value1' }, { key: 'value2' })).toThrow();
    });

    it('should use custom error message', () => {
      expect(() => assertJSONEquals({ a: 1 }, { a: 2 }, 'Custom error')).toThrow('Custom error');
    });
  });

  describe('assertArrayEquals', () => {
    it('should pass for equal arrays', () => {
      expect(() => assertArrayEquals([1, 2, 3], [1, 2, 3])).not.toThrow();
    });

    it('should throw for different lengths', () => {
      expect(() => assertArrayEquals([1, 2], [1, 2, 3])).toThrow('Array length mismatch');
    });

    it('should throw for different elements', () => {
      expect(() => assertArrayEquals([1, 2, 3], [1, 2, 4])).toThrow('Array element mismatch');
    });

    it('should throw for non-arrays', () => {
      expect(() => assertArrayEquals('not-array' as any, [1, 2])).toThrow('Expected array');
    });
  });

  describe('createTestBatch', () => {
    it('should create correct number of records', () => {
      const batch = createTestBatch(5, (i) => ({ id: i, name: `Item ${i}` }));
      expect(batch).toHaveLength(5);
    });

    it('should apply template function correctly', () => {
      const batch = createTestBatch(3, (i) => ({ index: i, value: i * 2 }));
      expect(batch[0]).toEqual({ index: 0, value: 0 });
      expect(batch[1]).toEqual({ index: 1, value: 2 });
      expect(batch[2]).toEqual({ index: 2, value: 4 });
    });
  });

  describe('retryWithBackoff', () => {
    it('should succeed on first attempt', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const result = await retryWithBackoff(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      const result = await retryWithBackoff(fn, 3, 10);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max attempts', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Always fails'));

      await expect(retryWithBackoff(fn, 3, 10)).rejects.toThrow('Always fails');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('assertPerformance', () => {
    it('should pass when duration is within limit', () => {
      expect(() => assertPerformance(500, 1000, 'test-op')).not.toThrow();
    });

    it('should throw when duration exceeds limit', () => {
      expect(() => assertPerformance(1500, 1000, 'test-op')).toThrow(
        'Performance assertion failed: test-op took 1500ms, expected < 1000ms'
      );
    });
  });

  describe('getDatabaseConfig', () => {
    it('should return correct config for MySQL', () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';
      const config = getDatabaseConfig();
      
      expect(config.provider).toBe('mysql');
      expect(config.maxConcurrency).toBe(8);
      expect(config.idType).toBe('number');
      expect(config.recommendedBatchSize).toBe(1000);
      expect(config.useTransactions).toBe(true);
    });

    it('should return correct config for SQLite', () => {
      process.env.DATABASE_URL = 'file:./test.db';
      const config = getDatabaseConfig();
      
      expect(config.provider).toBe('sqlite');
      expect(config.maxConcurrency).toBe(1);
      expect(config.idType).toBe('number');
      expect(config.recommendedBatchSize).toBe(100);
      expect(config.connectionPool.min).toBe(1);
      expect(config.connectionPool.max).toBe(1);
    });

    it('should return correct config for MongoDB', () => {
      process.env.DATABASE_URL = 'mongodb://localhost/test';
      const config = getDatabaseConfig();
      
      expect(config.provider).toBe('mongodb');
      expect(config.maxConcurrency).toBe(2);
      expect(config.idType).toBe('string');
      expect(config.operationTimeout).toBe(10000);
    });
  });
});
