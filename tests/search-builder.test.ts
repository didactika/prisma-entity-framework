/**
 * Test suite for SearchBuilder
 * Tests search filter building and condition combination
 */

import { describe, it, expect } from '@jest/globals';
import SearchBuilder from '../src/core/search-builder';
import { FindByFilterOptions } from '../src/core/structures/types/search.types';

describe('SearchBuilder', () => {
  describe('build', () => {
    /**
     * Test: should return base filter when no search options provided
     */
    it('should return base filter when no search options provided', () => {
      const baseFilter = { isActive: true };
      const result = SearchBuilder.build(baseFilter, {});

      expect(result).toEqual({ isActive: true });
    });

    /**
     * Test: should apply string search with LIKE mode
     */
    it('should apply string search with LIKE mode', () => {
      const baseFilter = { isActive: true };
      const options: FindByFilterOptions.SearchOptions = {
        stringSearch: [
          { keys: ['name'], value: 'John', mode: 'LIKE' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        isActive: true,
        name: { contains: 'John' }
      });
    });

    /**
     * Test: should apply string search with EXACT mode
     */
    it('should apply string search with EXACT mode', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        stringSearch: [
          { keys: ['email'], value: 'test@example.com', mode: 'EXACT' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        email: { equals: 'test@example.com' }
      });
    });

    /**
     * Test: should apply string search with STARTS_WITH mode
     */
    it('should apply string search with STARTS_WITH mode', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        stringSearch: [
          { keys: ['name'], value: 'Jo', mode: 'STARTS_WITH' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        name: { startsWith: 'Jo' }
      });
    });

    /**
     * Test: should apply string search with ENDS_WITH mode
     */
    it('should apply string search with ENDS_WITH mode', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        stringSearch: [
          { keys: ['name'], value: 'son', mode: 'ENDS_WITH' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        name: { endsWith: 'son' }
      });
    });

    /**
     * Test: should apply range search with min and max
     */
    it('should apply range search with min and max', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        rangeSearch: [
          { keys: ['age'], min: 18, max: 65 }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        age: { gte: 18, lte: 65 }
      });
    });

    /**
     * Test: should apply range search with only min
     */
    it('should apply range search with only min', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        rangeSearch: [
          { keys: ['age'], min: 18 }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        age: { gte: 18 }
      });
    });

    /**
     * Test: should apply range search with only max
     */
    it('should apply range search with only max', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        rangeSearch: [
          { keys: ['age'], max: 65 }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        age: { lte: 65 }
      });
    });

    /**
     * Test: should apply list search with IN mode
     */
    it('should apply list search with IN mode', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        listSearch: [
          { keys: ['status'], values: ['active', 'pending'], mode: 'IN' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        status: { in: ['active', 'pending'] }
      });
    });

    /**
     * Test: should apply list search with NOT_IN mode
     */
    it('should apply list search with NOT_IN mode', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        listSearch: [
          { keys: ['status'], values: ['deleted', 'banned'], mode: 'NOT_IN' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        status: { notIn: ['deleted', 'banned'] }
      });
    });

    /**
     * Test: should apply list search with HAS_SOME mode
     */
    it('should apply list search with HAS_SOME mode', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        listSearch: [
          { keys: ['tags'], values: ['urgent', 'important'], mode: 'HAS_SOME' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        tags: { hasSome: ['urgent', 'important'] }
      });
    });

    /**
     * Test: should apply list search with HAS_EVERY mode
     */
    it('should apply list search with HAS_EVERY mode', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        listSearch: [
          { keys: ['tags'], values: ['typescript', 'nodejs'], mode: 'HAS_EVERY' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        tags: { hasEvery: ['typescript', 'nodejs'] }
      });
    });

    /**
     * Test: should combine multiple search types
     */
    it('should combine multiple search types', () => {
      const baseFilter = { isActive: true };
      const options: FindByFilterOptions.SearchOptions = {
        stringSearch: [
          { keys: ['name'], value: 'John', mode: 'LIKE' }
        ],
        rangeSearch: [
          { keys: ['age'], min: 18, max: 65 }
        ],
        listSearch: [
          { keys: ['role'], values: ['admin', 'user'], mode: 'IN' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        isActive: true,
        name: { contains: 'John' },
        age: { gte: 18, lte: 65 },
        role: { in: ['admin', 'user'] }
      });
    });

    /**
     * Test: should handle OR grouping for string search
     */
    it('should handle OR grouping for string search', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        stringSearch: [
          { keys: ['name'], value: 'John', mode: 'LIKE', grouping: 'or' },
          { keys: ['email'], value: 'john', mode: 'LIKE', grouping: 'or' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toHaveProperty('OR');
      expect(Array.isArray(result.OR)).toBe(true);
      expect(result.OR).toContainEqual({ name: { contains: 'John' } });
      expect(result.OR).toContainEqual({ email: { contains: 'john' } });
    });

    /**
     * Test: should handle OR grouping for range search
     */
    it('should handle OR grouping for range search', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        rangeSearch: [
          { keys: ['age'], min: 18, max: 25, grouping: 'or' },
          { keys: ['experience'], min: 5, grouping: 'or' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toHaveProperty('OR');
      expect(result.OR).toContainEqual({ age: { gte: 18, lte: 25 } });
      expect(result.OR).toContainEqual({ experience: { gte: 5 } });
    });

    /**
     * Test: should handle OR grouping for list search
     */
    it('should handle OR grouping for list search', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        listSearch: [
          { keys: ['role'], values: ['admin'], mode: 'IN', grouping: 'or' },
          { keys: ['department'], values: ['IT'], mode: 'IN', grouping: 'or' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toHaveProperty('OR');
      expect(result.OR).toContainEqual({ role: { in: ['admin'] } });
      expect(result.OR).toContainEqual({ department: { in: ['IT'] } });
    });

    /**
     * Test: should mix AND and OR grouping
     */
    it('should mix AND and OR grouping', () => {
      const baseFilter = { isActive: true };
      const options: FindByFilterOptions.SearchOptions = {
        stringSearch: [
          { keys: ['name'], value: 'John', mode: 'LIKE' },  // AND
          { keys: ['email'], value: 'gmail', mode: 'LIKE', grouping: 'or' }  // OR
        ],
        rangeSearch: [
          { keys: ['age'], min: 18, max: 65 }  // AND
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result.isActive).toBe(true);
      expect(result.name).toEqual({ contains: 'John' });
      expect(result.age).toEqual({ gte: 18, lte: 65 });
      expect(result.OR).toContainEqual({ email: { contains: 'gmail' } });
    });

    /**
     * Test: should skip invalid conditions (empty strings)
     */
    it('should skip invalid conditions (empty strings)', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        stringSearch: [
          { keys: ['name'], value: '', mode: 'LIKE' },
          { keys: ['email'], value: 'test@example.com', mode: 'EXACT' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        email: { equals: 'test@example.com' }
      });
      expect(result).not.toHaveProperty('name');
    });

    /**
     * Test: should skip invalid conditions (empty arrays)
     */
    it('should skip invalid conditions (empty arrays)', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        listSearch: [
          { keys: ['tags'], values: [], mode: 'IN' },
          { keys: ['role'], values: ['admin'], mode: 'IN' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        role: { in: ['admin'] }
      });
      expect(result).not.toHaveProperty('tags');
    });

    /**
     * Test: should skip range conditions without min or max
     */
    it('should skip range conditions without min or max', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        rangeSearch: [
          { keys: ['age'] },  // No min or max
          { keys: ['salary'], min: 50000 }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        salary: { gte: 50000 }
      });
      expect(result).not.toHaveProperty('age');
    });

    /**
     * Test: should handle nested paths
     */
    it('should handle nested paths', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        stringSearch: [
          { keys: ['user.profile.name'], value: 'John', mode: 'LIKE' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        user: {
          profile: {
            name: { contains: 'John' }
          }
        }
      });
    });

    /**
     * Test: should handle multiple keys for same condition
     */
    it('should handle multiple keys for same condition', () => {
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        stringSearch: [
          { keys: ['name', 'email', 'username'], value: 'john', mode: 'LIKE', grouping: 'or' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toHaveProperty('OR');
      expect(result.OR).toContainEqual({ name: { contains: 'john' } });
      expect(result.OR).toContainEqual({ email: { contains: 'john' } });
      expect(result.OR).toContainEqual({ username: { contains: 'john' } });
    });

    /**
     * Test: should preserve base filter when applying searches
     */
    it('should preserve base filter when applying searches', () => {
      const baseFilter = { 
        isActive: true, 
        department: 'IT',
        nested: { value: 'test' }
      };
      const options: FindByFilterOptions.SearchOptions = {
        stringSearch: [
          { keys: ['name'], value: 'John', mode: 'LIKE' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result.isActive).toBe(true);
      expect(result.department).toBe('IT');
      expect(result.nested).toEqual({ value: 'test' });
      expect(result.name).toEqual({ contains: 'John' });
    });

    /**
     * Test: should handle Date objects in range search
     */
    it('should handle Date objects in range search', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      const baseFilter = {};
      const options: FindByFilterOptions.SearchOptions = {
        rangeSearch: [
          { keys: ['createdAt'], min: startDate, max: endDate }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result).toEqual({
        createdAt: { gte: startDate, lte: endDate }
      });
    });

    /**
     * Test: should handle complex nested OR conditions
     */
    it('should handle complex nested OR conditions', () => {
      const baseFilter = { isActive: true };
      const options: FindByFilterOptions.SearchOptions = {
        stringSearch: [
          { keys: ['user.name'], value: 'John', mode: 'LIKE', grouping: 'or' },
          { keys: ['user.email'], value: 'john', mode: 'LIKE', grouping: 'or' }
        ]
      };

      const result = SearchBuilder.build(baseFilter, options);

      expect(result.isActive).toBe(true);
      expect(result).toHaveProperty('OR');
      expect(result.OR).toContainEqual({ user: { name: { contains: 'John' } } });
      expect(result.OR).toContainEqual({ user: { email: { contains: 'john' } } });
    });
  });
});
