/**
 * Test suite for SearchUtils
 * Tests search filter application and default filter processing
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import SearchUtils from '../src/core/search-utils';
import { mockRuntimeDataModel } from './__mocks__/prisma-client.mock';
import { configurePrisma, resetPrismaConfiguration } from '../src/core/config';

describe('SearchUtils', () => {
  // Mock Prisma client for nested relation tests
  beforeAll(() => {
    const mockPrisma = {
      _runtimeDataModel: mockRuntimeDataModel,
    };
    configurePrisma(mockPrisma as any);
  });

  afterAll(() => {
    resetPrismaConfiguration();
  });
  describe('applySearchFilter', () => {
    /**
     * Test: should apply a single condition
     */
    it('should apply a single condition', () => {
      const result = SearchUtils.applySearchFilter(
        { isActive: true },
        { field: 'name', like: 'John' }
      );

      expect(result).toEqual({
        isActive: true,
        name: { contains: 'John' },
      });
    });

    /**
     * Test: should apply a range condition
     */
    it('should apply a range condition', () => {
      const result = SearchUtils.applySearchFilter({}, { field: 'age', between: [18, 65] });

      expect(result).toEqual({
        age: { gte: 18, lte: 65, not: null },
      });
    });

    /**
     * Test: should apply a list condition
     */
    it('should apply a list condition', () => {
      const result = SearchUtils.applySearchFilter(
        {},
        { field: 'status', in: ['active', 'pending'] }
      );

      expect(result).toEqual({
        status: { in: ['active', 'pending'] },
      });
    });

    /**
     * Test: should apply an or node
     */
    it('should apply an or node', () => {
      const result = SearchUtils.applySearchFilter({}, {
        or: [
          { field: 'name', like: 'test' },
          { field: 'email', like: 'test' },
        ],
      });

      expect(result.OR).toBeDefined();
      expect(result.OR).toHaveLength(2);
    });

    /**
     * Test: should combine several conditions with a root array
     */
    it('should combine several conditions with a root array', () => {
      const result = SearchUtils.applySearchFilter({ isActive: true }, [
        { field: 'name', like: 'John' },
        { field: 'age', gte: 18 },
      ]);

      expect(result).toEqual({
        isActive: true,
        AND: [{ name: { contains: 'John' } }, { age: { gte: 18, not: null } }],
      });
    });

    /**
     * Test: should skip invalid conditions
     */
    it('should skip invalid conditions', () => {
      const result = SearchUtils.applySearchFilter({}, { field: 'name', like: '' });

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
     * Test: should translate null values to { equals: null } (IS NULL filter)
     */
    it('should translate null values to { equals: null }', () => {
      const input = { name: null };
      const result = SearchUtils.applyDefaultFilters(input);
      expect(result).toEqual({ name: { equals: null } });
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

  describe('conditionsFrom', () => {
    /**
     * Test: should create one condition per string field
     */
    it('should create one condition per string field', () => {
      const result = SearchUtils.conditionsFrom({
        name: 'John',
        email: 'john@example.com',
        age: 30,
      });

      expect(result).toEqual([
        { field: 'name', equals: 'John' },
        { field: 'email', equals: 'john@example.com' },
      ]);
    });

    /**
     * Test: should use the requested operator
     */
    it('should use the requested operator', () => {
      expect(SearchUtils.conditionsFrom({ name: 'John' }, 'like'))
        .toEqual([{ field: 'name', like: 'John' }]);

      expect(SearchUtils.conditionsFrom({ name: 'John' }, 'startsWith'))
        .toEqual([{ field: 'name', startsWith: 'John' }]);

      expect(SearchUtils.conditionsFrom({ name: 'John' }, 'endsWith'))
        .toEqual([{ field: 'name', endsWith: 'John' }]);
    });

    /**
     * Test: should skip empty and whitespace-only strings
     */
    it('should skip empty and whitespace-only strings', () => {
      const result = SearchUtils.conditionsFrom({
        name: '',
        nickname: '   ',
        email: 'john@example.com',
      });

      expect(result).toEqual([{ field: 'email', equals: 'john@example.com' }]);
    });

    /**
     * Test: should return an empty array when there are no string fields
     */
    it('should return an empty array when there are no string fields', () => {
      expect(SearchUtils.conditionsFrom({ age: 30, isActive: true })).toEqual([]);
    });

    /**
     * Test: the result should drop straight into a search tree
     */
    it('should produce conditions usable as a search tree', () => {
      const conditions = SearchUtils.conditionsFrom({ name: 'John', email: 'john' }, 'like');
      const result = SearchUtils.applySearchFilter({}, { or: conditions });

      expect(result).toEqual({
        OR: [{ name: { contains: 'John' } }, { email: { contains: 'john' } }],
      });
    });
  });

  describe('applyDefaultFilters - Nested Relations', () => {
    /**
     * Test: should handle deeply nested relations with correct filters
     */
    it('should handle deeply nested relations with correct filters', () => {
      const filter = {
        author: {
          posts: {
            title: 'Test Post'
          }
        }
      };

      const result = SearchUtils.applyDefaultFilters(filter, mockRuntimeDataModel.models.Comment);

      // Verify the structure is correct
      // author is a single relation (is)
      expect(result).toHaveProperty('author');
      expect(result.author).toHaveProperty('is');
      // posts is an array relation (some)
      expect(result.author.is).toHaveProperty('posts');
      expect(result.author.is.posts).toHaveProperty('some');
      expect(result.author.is.posts.some).toHaveProperty('title');
      expect(result.author.is.posts.some.title).toEqual({ equals: 'Test Post' });
    });

    /**
     * Test: should correctly identify array relations at any nesting level
     */
    it('should correctly identify array relations at any nesting level', () => {
      const filter = {
        post: {
          comments: {
            text: 'Great!'
          }
        }
      };

      const result = SearchUtils.applyDefaultFilters(filter, mockRuntimeDataModel.models.Comment);

      // post is a single relation (is)
      expect(result).toHaveProperty('post');
      expect(result.post).toHaveProperty('is');
      // comments is an array relation (some)
      expect(result.post.is).toHaveProperty('comments');
      expect(result.post.is.comments).toHaveProperty('some');
      expect(result.post.is.comments.some).toHaveProperty('text');
      expect(result.post.is.comments.some.text).toEqual({ equals: 'Great!' });
    });

    /**
     * Test: should handle multiple levels of array relations
     */
    it('should handle multiple levels of array relations', () => {
      const filter = {
        posts: {
          comments: {
            text: 'Awesome!'
          }
        }
      };

      const result = SearchUtils.applyDefaultFilters(filter, mockRuntimeDataModel.models.User);

      // posts is an array relation (some)
      expect(result).toHaveProperty('posts');
      expect(result.posts).toHaveProperty('some');
      // comments is an array relation (some)
      expect(result.posts.some).toHaveProperty('comments');
      expect(result.posts.some.comments).toHaveProperty('some');
      expect(result.posts.some.comments.some).toHaveProperty('text');
      expect(result.posts.some.comments.some.text).toEqual({ equals: 'Awesome!' });
    });
  });
});

