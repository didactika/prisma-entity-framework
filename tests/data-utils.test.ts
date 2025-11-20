/**
 * Test suite for DataUtils
 * Tests data processing utilities for relations and transformations
 */

import { describe, it, expect } from '@jest/globals';
import DataUtils from '../src/core/data-utils';

describe('DataUtils', () => {
  describe('processRelations', () => {
    /**
     * Test: should not modify scalar values
     */
    it('should not modify scalar values', () => {
      const data = { name: 'John', age: 30, active: true };
      const result = DataUtils.processRelations(data);
      expect(result).toEqual(data);
    });

    /**
     * Test: should process object with id as connect
     */
    it('should process object with id as connect', () => {
      const data = { name: 'John', author: { id: 1 } };
      const result = DataUtils.processRelations(data);
      expect(result).toEqual({
        name: 'John',
        author: { connect: { id: 1 } },
      });
    });

    /**
     * Test: should process object without id as create
     */
    it('should process object without id as create', () => {
      const data = { name: 'John', author: { name: 'Jane' } };
      const result = DataUtils.processRelations(data);
      expect(result).toEqual({
        name: 'John',
        author: { create: { name: 'Jane' } },
      });
    });

    /**
     * Test: should process array of objects with ids
     */
    it('should process array of objects with ids', () => {
      const data = {
        title: 'Post',
        tags: [{ id: 1 }, { id: 2 }, { id: 3 }],
      };
      const result = DataUtils.processRelations(data);
      expect(result).toEqual({
        title: 'Post',
        tags: { connect: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      });
    });

    /**
     * Test: should filter out array items without ids
     */
    it('should filter out array items without ids', () => {
      const data = {
        title: 'Post',
        tags: [{ id: 1 }, { name: 'tag2' }, { id: 3 }],
      };
      const result = DataUtils.processRelations(data);
      expect(result).toEqual({
        title: 'Post',
        tags: { connect: [{ id: 1 }, { id: 3 }] },
      });
    });

    /**
     * Test: should handle empty arrays
     */
    it('should handle empty arrays', () => {
      const data = { title: 'Post', tags: [] };
      const result = DataUtils.processRelations(data);
      // Empty arrays are preserved but won't create connect
      expect(result.title).toBe('Post');
      expect(result.tags).toBeDefined();
    });

    /**
     * Test: should handle null values
     */
    it('should handle null values', () => {
      const data = { name: 'John', author: null };
      const result = DataUtils.processRelations(data);
      expect(result).toEqual({ name: 'John', author: null });
    });

    /**
     * Test: should handle undefined values
     */
    it('should handle undefined values', () => {
      const data = { name: 'John', author: undefined };
      const result = DataUtils.processRelations(data);
      expect(result).toEqual({ name: 'John', author: undefined });
    });

    /**
     * Test: should process nested relations
     */
    it('should process nested relations', () => {
      const data = {
        title: 'Post',
        author: { id: 1 },
        category: { name: 'Tech' },
      };
      const result = DataUtils.processRelations(data);
      expect(result).toEqual({
        title: 'Post',
        author: { connect: { id: 1 } },
        category: { create: { name: 'Tech' } },
      });
    });

    /**
     * Test: should preserve JSON fields without wrapping in connect/create
     */
    it('should preserve JSON fields without wrapping in connect/create', () => {
      const modelInfo = {
        fields: [
          { name: 'title', kind: 'scalar', type: 'String' },
          { name: 'metadata', kind: 'scalar', type: 'Json' },
          { name: 'author', kind: 'object', type: 'User' },
        ],
      };

      const data = {
        title: 'Post',
        metadata: { views: 100, likes: 50, tags: ['tech', 'news'] },
        author: { id: 1 },
      };

      const result = DataUtils.processRelations(data, modelInfo);

      expect(result).toEqual({
        title: 'Post',
        metadata: { views: 100, likes: 50, tags: ['tech', 'news'] }, // JSON preserved as-is
        author: { connect: { id: 1 } }, // Relation processed normally
      });
    });

    /**
     * Test: should handle JSON fields with nested objects
     */
    it('should handle JSON fields with nested objects', () => {
      const modelInfo = {
        fields: [
          { name: 'config', kind: 'scalar', type: 'Json' },
        ],
      };

      const data = {
        config: {
          settings: {
            theme: 'dark',
            notifications: { email: true, push: false },
          },
          preferences: ['option1', 'option2'],
        },
      };

      const result = DataUtils.processRelations(data, modelInfo);

      // JSON field should be preserved exactly as-is
      expect(result.config).toEqual(data.config);
    });

    /**
     * Test: should work without modelInfo (backward compatibility)
     */
    it('should work without modelInfo (backward compatibility)', () => {
      const data = {
        title: 'Post',
        author: { id: 1 },
      };

      const result = DataUtils.processRelations(data);

      expect(result).toEqual({
        title: 'Post',
        author: { connect: { id: 1 } },
      });
    });

    /**
     * Test: should preserve scalar arrays (String[], Int[], etc.)
     */
    it('should preserve scalar arrays without wrapping in connect', () => {
      const modelInfo = {
        fields: [
          { name: 'title', kind: 'scalar', type: 'String', isList: false },
          { name: 'tags', kind: 'scalar', type: 'String', isList: true }, // String[]
          { name: 'ratings', kind: 'scalar', type: 'Int', isList: true }, // Int[]
          { name: 'author', kind: 'object', type: 'User', isList: false },
        ],
      };

      const data = {
        title: 'Post',
        tags: ['tech', 'news', 'javascript'],
        ratings: [5, 4, 5, 3],
        author: { id: 1 },
      };

      const result = DataUtils.processRelations(data, modelInfo);

      expect(result).toEqual({
        title: 'Post',
        tags: ['tech', 'news', 'javascript'], // Scalar array preserved as-is
        ratings: [5, 4, 5, 3], // Scalar array preserved as-is
        author: { connect: { id: 1 } }, // Relation processed normally
      });
    });

    /**
     * Test: should preserve ObjectId arrays (MongoDB use case)
     */
    it('should preserve ObjectId arrays for MongoDB', () => {
      const modelInfo = {
        fields: [
          { name: 'id', kind: 'scalar', type: 'String', isList: false },
          { name: 'areaIds', kind: 'scalar', type: 'String', isList: true }, // String[] @db.ObjectId
          { name: 'categoryIds', kind: 'scalar', type: 'String', isList: true },
        ],
      };

      const data = {
        id: '507f1f77bcf86cd799439011',
        areaIds: ['507f1f77bcf86cd799439012', '507f1f77bcf86cd799439013'],
        categoryIds: ['507f1f77bcf86cd799439014'],
      };

      const result = DataUtils.processRelations(data, modelInfo);

      expect(result).toEqual({
        id: '507f1f77bcf86cd799439011',
        areaIds: ['507f1f77bcf86cd799439012', '507f1f77bcf86cd799439013'], // Preserved
        categoryIds: ['507f1f77bcf86cd799439014'], // Preserved
      });
    });

    /**
     * Test: should handle empty scalar arrays
     */
    it('should handle empty scalar arrays', () => {
      const modelInfo = {
        fields: [
          { name: 'tags', kind: 'scalar', type: 'String', isList: true },
        ],
      };

      const data = {
        title: 'Post',
        tags: [],
      };

      const result = DataUtils.processRelations(data, modelInfo);

      expect(result.tags).toEqual([]); // Empty array preserved
    });

    /**
     * Test: should distinguish between scalar arrays and relation arrays
     */
    it('should distinguish between scalar arrays and relation arrays', () => {
      const modelInfo = {
        fields: [
          { name: 'tags', kind: 'scalar', type: 'String', isList: true }, // Scalar array
          { name: 'comments', kind: 'object', type: 'Comment', isList: true }, // Relation array
        ],
      };

      const data = {
        tags: ['tech', 'news'], // Should be preserved
        comments: [{ id: 1 }, { id: 2 }], // Should be wrapped in connect
      };

      const result = DataUtils.processRelations(data, modelInfo);

      expect(result).toEqual({
        tags: ['tech', 'news'], // Scalar array preserved
        comments: { connect: [{ id: 1 }, { id: 2 }] }, // Relation array processed
      });
    });

    /**
     * Test: should handle mixed scalar types in arrays
     */
    it('should handle mixed scalar types in arrays', () => {
      const modelInfo = {
        fields: [
          { name: 'stringArray', kind: 'scalar', type: 'String', isList: true },
          { name: 'intArray', kind: 'scalar', type: 'Int', isList: true },
          { name: 'floatArray', kind: 'scalar', type: 'Float', isList: true },
          { name: 'boolArray', kind: 'scalar', type: 'Boolean', isList: true },
        ],
      };

      const data = {
        stringArray: ['a', 'b', 'c'],
        intArray: [1, 2, 3],
        floatArray: [1.5, 2.5, 3.5],
        boolArray: [true, false, true],
      };

      const result = DataUtils.processRelations(data, modelInfo);

      expect(result).toEqual(data); // All scalar arrays preserved
    });
  });

  describe('normalizeRelationsToFK', () => {
    /**
     * Test: should convert connect relation to FK
     */
    it('should convert connect relation to FK', () => {
      const data = {
        title: 'Post',
        author: { connect: { id: 1 } },
      };
      const result = DataUtils.normalizeRelationsToFK(data);
      expect(result).toEqual({
        title: 'Post',
        authorId: 1,
      });
    });

    /**
     * Test: should handle multiple relations
     */
    it('should handle multiple relations', () => {
      const data = {
        title: 'Post',
        author: { connect: { id: 1 } },
        category: { connect: { id: 5 } },
      };
      const result = DataUtils.normalizeRelationsToFK(data);
      expect(result).toEqual({
        title: 'Post',
        authorId: 1,
        categoryId: 5,
      });
    });

    /**
     * Test: should use custom key transform template
     */
    it('should use custom key transform template', () => {
      const data = {
        title: 'Post',
        author: { connect: { id: 1 } },
      };
      const result = DataUtils.normalizeRelationsToFK(data, (key) => `${key}_fk`);
      expect(result).toEqual({
        title: 'Post',
        author_fk: 1,
      });
    });

    /**
     * Test: should not modify non-relation objects
     */
    it('should not modify non-relation objects', () => {
      const data = {
        title: 'Post',
        metadata: { views: 100 },
      };
      const result = DataUtils.normalizeRelationsToFK(data);
      expect(result).toEqual(data);
    });

    /**
     * Test: should not modify create relations
     */
    it('should not modify create relations', () => {
      const data = {
        title: 'Post',
        author: { create: { name: 'John' } },
      };
      const result = DataUtils.normalizeRelationsToFK(data);
      expect(result).toEqual(data);
    });

    /**
     * Test: should handle empty data
     */
    it('should handle empty data', () => {
      const data = {};
      const result = DataUtils.normalizeRelationsToFK(data);
      expect(result).toEqual({});
    });

    /**
     * Test: should preserve other properties
     */
    it('should preserve other properties', () => {
      const data = {
        id: 1,
        title: 'Post',
        author: { connect: { id: 5 } },
        published: true,
      };
      const result = DataUtils.normalizeRelationsToFK(data);
      expect(result).toEqual({
        id: 1,
        title: 'Post',
        authorId: 5,
        published: true,
      });
    });
  });
});

  describe('detectRelationType', () => {
    /**
     * Test: should handle when Prisma is not configured
     */
    it('should handle when Prisma is not configured', () => {
      // Mock model info with explicit relation
      const modelInfo = {
        fields: [
          {
            name: 'areas',
            kind: 'object',
            type: 'AreasOnSubjects',
            isList: true,
          },
        ],
      };

      // When Prisma is not configured, the method should handle gracefully
      // It will either throw or return a fallback value
      try {
        const result = (DataUtils as any).detectRelationType(modelInfo, 'areas');
        // If it doesn't throw, it should return a valid value or null
        expect(['explicit', 'implicit', null]).toContain(result);
      } catch (error: any) {
        // If it throws, verify it's the expected Prisma configuration error
        expect(error.message).toContain('Prisma instance not configured');
      }
    });

    /**
     * Test: should return null for non-existent fields
     */
    it('should return null for non-existent fields', () => {
      const modelInfo = {
        fields: [
          {
            name: 'title',
            kind: 'scalar',
            type: 'String',
          },
        ],
      };

      const result = (DataUtils as any).detectRelationType(modelInfo, 'nonExistent');
      
      expect(result).toBeNull();
    });

    /**
     * Test: should return null for scalar fields
     */
    it('should return null for scalar fields', () => {
      const modelInfo = {
        fields: [
          {
            name: 'title',
            kind: 'scalar',
            type: 'String',
          },
        ],
      };

      const result = (DataUtils as any).detectRelationType(modelInfo, 'title');
      
      expect(result).toBeNull();
    });

    /**
     * Test: should return null for non-list object fields
     */
    it('should return null for non-list object fields', () => {
      const modelInfo = {
        fields: [
          {
            name: 'author',
            kind: 'object',
            type: 'User',
            isList: false,
          },
        ],
      };

      const result = (DataUtils as any).detectRelationType(modelInfo, 'author');
      
      expect(result).toBeNull();
    });

    /**
     * Test: should handle missing modelInfo
     */
    it('should handle missing modelInfo', () => {
      const result = (DataUtils as any).detectRelationType(null, 'areas');
      
      expect(result).toBeNull();
    });
  });

  describe('getJoinTableInfo', () => {
    /**
     * Test: should handle when Prisma is not configured
     */
    it('should handle when Prisma is not configured', () => {
      // Mock model info with explicit relation
      const modelInfo = {
        fields: [
          {
            name: 'areas',
            kind: 'object',
            type: 'AreasOnSubjects',
            isList: true,
          },
        ],
      };

      // When Prisma is not configured, the method should handle gracefully
      try {
        const result = (DataUtils as any).getJoinTableInfo('Subject', 'areas', modelInfo);
        // If it doesn't throw, it should return null or valid join table info
        expect(result === null || typeof result === 'object').toBe(true);
      } catch (error: any) {
        // If it throws, verify it's the expected Prisma configuration error
        expect(error.message).toContain('Prisma instance not configured');
      }
    });

    /**
     * Test: should return null for non-existent fields
     */
    it('should return null for non-existent fields', () => {
      const modelInfo = {
        fields: [
          {
            name: 'title',
            kind: 'scalar',
            type: 'String',
          },
        ],
      };

      const result = (DataUtils as any).getJoinTableInfo('Subject', 'nonExistent', modelInfo);
      
      expect(result).toBeNull();
    });

    /**
     * Test: should return null for scalar fields
     */
    it('should return null for scalar fields', () => {
      const modelInfo = {
        fields: [
          {
            name: 'title',
            kind: 'scalar',
            type: 'String',
          },
        ],
      };

      const result = (DataUtils as any).getJoinTableInfo('Subject', 'title', modelInfo);
      
      expect(result).toBeNull();
    });

    /**
     * Test: should return null for non-list object fields
     */
    it('should return null for non-list object fields', () => {
      const modelInfo = {
        fields: [
          {
            name: 'author',
            kind: 'object',
            type: 'User',
            isList: false,
          },
        ],
      };

      const result = (DataUtils as any).getJoinTableInfo('Post', 'author', modelInfo);
      
      expect(result).toBeNull();
    });

    /**
     * Test: should handle missing modelInfo
     */
    it('should handle missing modelInfo', () => {
      const result = (DataUtils as any).getJoinTableInfo('Subject', 'areas', null);
      
      expect(result).toBeNull();
    });


  });
