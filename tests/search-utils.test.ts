/**
 * Test suite for SearchUtils
 * Tests search filter application and default filter processing
 */

import { describe, it, expect } from '@jest/globals';
import SearchUtils from '../src/search/search-utils';
import { mockRuntimeDataModel } from './__mocks__/prisma-client.mock';

describe('SearchUtils', () => {
  describe('applySearchFilter', () => {
    /**
     * Test: should apply string search with LIKE
     */
    it('should apply string search with LIKE', () => {
      const baseFilter = { isActive: true };
      const searchOptions = {
        stringSearch: [{ keys: ['name'], value: 'John', mode: 'LIKE' as const }],
      };

      const result = SearchUtils.applySearchFilter(baseFilter, searchOptions);
      expect(result).toEqual({
        isActive: true,
        name: { contains: 'John' },
      });
    });

    /**
     * Test: should apply range search
     */
    it('should apply range search', () => {
      const baseFilter = {};
      const searchOptions = {
        rangeSearch: [{ keys: ['age'], min: 18, max: 65 }],
      };

      const result = SearchUtils.applySearchFilter(baseFilter, searchOptions);
      expect(result).toEqual({
        age: { gte: 18, lte: 65 },
      });
    });

    /**
     * Test: should apply list search
     */
    it('should apply list search', () => {
      const baseFilter = {};
      const searchOptions = {
        listSearch: [{ keys: ['status'], values: ['active', 'pending'] }],
      };

      const result = SearchUtils.applySearchFilter(baseFilter, searchOptions);
      expect(result).toEqual({
        status: { in: ['active', 'pending'] },
      });
    });

    /**
     * Test: should handle OR grouping
     */
    it('should handle OR grouping', () => {
      const baseFilter = {};
      const searchOptions = {
        stringSearch: [
          { keys: ['name', 'email'], value: 'test', mode: 'LIKE' as const, grouping: 'or' as const },
        ],
      };

      const result = SearchUtils.applySearchFilter(baseFilter, searchOptions);
      expect(result.OR).toBeDefined();
      expect(result.OR).toHaveLength(2);
    });

    /**
     * Test: should combine multiple search types
     */
    it('should combine multiple search types', () => {
      const baseFilter = { isActive: true };
      const searchOptions = {
        stringSearch: [{ keys: ['name'], value: 'John', mode: 'LIKE' as const }],
        rangeSearch: [{ keys: ['age'], min: 18 }],
      };

      const result = SearchUtils.applySearchFilter(baseFilter, searchOptions);
      expect(result).toEqual({
        isActive: true,
        name: { contains: 'John' },
        age: { gte: 18 },
      });
    });

    /**
     * Test: should skip invalid conditions
     */
    it('should skip invalid conditions', () => {
      const baseFilter = {};
      const searchOptions = {
        stringSearch: [{ keys: ['name'], value: '', mode: 'LIKE' as const }],
      };

      const result = SearchUtils.applySearchFilter(baseFilter, searchOptions);
      expect(result).toEqual({});
    });
  });

  describe('applyDefaultFilters', () => {
    /**
     * Test: should create equals condition for string
     */
    it('should create equals condition for string', () => {
      const input = { name: 'John' };
      const result = SearchUtils.applyDefaultFilters(input);
      expect(result).toEqual({ name: { equals: 'John' } });
    });

    /**
     * Test: should create equals condition for number
     */
    it('should create equals condition for number', () => {
      const input = { age: 30 };
      const result = SearchUtils.applyDefaultFilters(input);
      expect(result).toEqual({ age: { equals: 30 } });
    });

    /**
     * Test: should create equals condition for Date
     */
    it('should create equals condition for Date', () => {
      const date = new Date('2024-01-01');
      const input = { createdAt: date };
      const result = SearchUtils.applyDefaultFilters(input);
      // Date objects are treated as scalar values
      expect(result.createdAt).toBeDefined();
      expect(result.createdAt.equals).toEqual(date);
    });

    /**
     * Test: should create hasEvery condition for arrays
     */
    it('should create hasEvery condition for arrays', () => {
      const input = { tags: ['tag1', 'tag2'] };
      const result = SearchUtils.applyDefaultFilters(input);
      expect(result).toEqual({ tags: { hasEvery: ['tag1', 'tag2'] } });
    });

    /**
     * Test: should skip empty arrays
     */
    it('should skip empty arrays', () => {
      const input = { tags: [] };
      const result = SearchUtils.applyDefaultFilters(input);
      expect(result).toEqual({});
    });

    /**
     * Test: should create is condition for nested objects
     */
    it('should create is condition for nested objects', () => {
      const input = { author: { name: 'John' } };
      const result = SearchUtils.applyDefaultFilters(input);
      expect(result).toEqual({
        author: { is: { name: { equals: 'John' } } },
      });
    });

    /**
     * Test: should create some condition for array relations
     */
    it('should create some condition for array relations', () => {
      const input = { posts: { title: 'Test' } };
      const modelInfo = mockRuntimeDataModel.models.User;
      const result = SearchUtils.applyDefaultFilters(input, modelInfo);
      expect(result.posts).toBeDefined();
      expect(result.posts.some || result.posts.is).toBeDefined();
    });

    /**
     * Test: should skip null values
     */
    it('should skip null values', () => {
      const input = { name: null };
      const result = SearchUtils.applyDefaultFilters(input);
      expect(result).toEqual({});
    });

    /**
     * Test: should skip undefined values
     */
    it('should skip undefined values', () => {
      const input = { name: undefined };
      const result = SearchUtils.applyDefaultFilters(input);
      expect(result).toEqual({});
    });

    /**
     * Test: should skip empty strings
     */
    it('should skip empty strings', () => {
      const input = { name: '' };
      const result = SearchUtils.applyDefaultFilters(input);
      expect(result).toEqual({});
    });

    /**
     * Test: should handle nested empty objects
     */
    it('should handle nested empty objects', () => {
      const input = { author: { name: '' } };
      const result = SearchUtils.applyDefaultFilters(input);
      expect(result).toEqual({});
    });

    /**
     * Test: should handle multiple fields
     */
    it('should handle multiple fields', () => {
      const input = { name: 'John', age: 30, isActive: true };
      const result = SearchUtils.applyDefaultFilters(input);
      expect(result.name).toEqual({ equals: 'John' });
      expect(result.age).toEqual({ equals: 30 });
      // Boolean values are handled correctly
      expect(result.isActive).toBeDefined();
    });
  });

  describe('getCustomSearchOptionsForAll', () => {
    /**
     * Test: should create string search options for all string fields
     */
    it('should create string search options for all string fields', () => {
      const filters = { name: 'John', email: 'john@example.com', age: 30 };
      const result = SearchUtils.getCustomSearchOptionsForAll(filters);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        keys: ['name'],
        value: 'John',
        mode: 'EXACT',
        grouping: 'and',
      });
      expect(result).toContainEqual({
        keys: ['email'],
        value: 'john@example.com',
        mode: 'EXACT',
        grouping: 'and',
      });
    });

    /**
     * Test: should use LIKE mode when specified
     */
    it('should use LIKE mode when specified', () => {
      const filters = { name: 'John' };
      const result = SearchUtils.getCustomSearchOptionsForAll(filters, 'LIKE');

      expect(result[0]).toEqual({
        keys: ['name'],
        value: 'John',
        mode: 'LIKE',
        grouping: 'and',
      });
    });

    /**
     * Test: should use OR grouping when specified
     */
    it('should use OR grouping when specified', () => {
      const filters = { name: 'John' };
      const result = SearchUtils.getCustomSearchOptionsForAll(filters, 'EXACT', 'or');

      expect(result[0]).toEqual({
        keys: ['name'],
        value: 'John',
        mode: 'EXACT',
        grouping: 'or',
      });
    });

    /**
     * Test: should skip empty strings
     */
    it('should skip empty strings', () => {
      const filters = { name: '', email: 'john@example.com' };
      const result = SearchUtils.getCustomSearchOptionsForAll(filters);

      expect(result).toHaveLength(1);
      expect(result[0].keys).toEqual(['email']);
    });

    /**
     * Test: should skip whitespace-only strings
     */
    it('should skip whitespace-only strings', () => {
      const filters = { name: '   ', email: 'john@example.com' };
      const result = SearchUtils.getCustomSearchOptionsForAll(filters);

      expect(result).toHaveLength(1);
    });

    /**
     * Test: should return empty array for no string fields
     */
    it('should return empty array for no string fields', () => {
      const filters = { age: 30, isActive: true };
      const result = SearchUtils.getCustomSearchOptionsForAll(filters);

      expect(result).toEqual([]);
    });

    /**
     * Test: should handle STARTS_WITH mode
     */
    it('should handle STARTS_WITH mode', () => {
      const filters = { name: 'John' };
      const result = SearchUtils.getCustomSearchOptionsForAll(filters, 'STARTS_WITH');

      expect(result[0].mode).toBe('STARTS_WITH');
    });

    /**
     * Test: should handle ENDS_WITH mode
     */
    it('should handle ENDS_WITH mode', () => {
      const filters = { name: 'John' };
      const result = SearchUtils.getCustomSearchOptionsForAll(filters, 'ENDS_WITH');

      expect(result[0].mode).toBe('ENDS_WITH');
    });
  });
});
