/**
 * Test suite for ObjectUtils
 * Tests object manipulation utilities for nested operations
 */

import { describe, it, expect } from '@jest/globals';
import ObjectUtils from '../src/search/object-utils';

describe('ObjectUtils', () => {
  describe('assign', () => {
    /**
     * Test: should assign value to simple path
     */
    it('should assign value to simple path', () => {
      const target = {};
      ObjectUtils.assign(target, 'name', 'John');
      expect(target).toEqual({ name: 'John' });
    });

    /**
     * Test: should assign value to nested path
     */
    it('should assign value to nested path', () => {
      const target = {};
      ObjectUtils.assign(target, 'user.name', 'John');
      expect(target).toEqual({ user: { name: 'John' } });
    });

    /**
     * Test: should assign value to deeply nested path
     */
    it('should assign value to deeply nested path', () => {
      const target = {};
      ObjectUtils.assign(target, 'user.profile.name', 'John');
      expect(target).toEqual({ user: { profile: { name: 'John' } } });
    });

    /**
     * Test: should overwrite existing value
     */
    it('should overwrite existing value', () => {
      const target = { name: 'Jane' };
      ObjectUtils.assign(target, 'name', 'John');
      expect(target).toEqual({ name: 'John' });
    });

    /**
     * Test: should preserve existing nested properties
     */
    it('should preserve existing nested properties', () => {
      const target = { user: { age: 30 } };
      ObjectUtils.assign(target, 'user.name', 'John');
      expect(target).toEqual({ user: { age: 30, name: 'John' } });
    });

    /**
     * Test: should handle array values
     */
    it('should handle array values', () => {
      const target = {};
      ObjectUtils.assign(target, 'tags', ['a', 'b', 'c']);
      expect(target).toEqual({ tags: ['a', 'b', 'c'] });
    });
  });

  describe('build', () => {
    /**
     * Test: should build simple path object
     */
    it('should build simple path object', () => {
      const result = ObjectUtils.build('name', 'John');
      expect(result).toEqual({ name: 'John' });
    });

    /**
     * Test: should build nested path object
     */
    it('should build nested path object', () => {
      const result = ObjectUtils.build('user.name', 'John');
      expect(result).toEqual({ user: { name: 'John' } });
    });

    /**
     * Test: should build deeply nested path object
     */
    it('should build deeply nested path object', () => {
      const result = ObjectUtils.build('user.profile.name', 'John');
      expect(result).toEqual({ user: { profile: { name: 'John' } } });
    });

    /**
     * Test: should handle complex values
     */
    it('should handle complex values', () => {
      const result = ObjectUtils.build('user', { name: 'John', age: 30 });
      expect(result).toEqual({ user: { name: 'John', age: 30 } });
    });
  });

  describe('get', () => {
    /**
     * Test: should get simple property
     */
    it('should get simple property', () => {
      const obj = { name: 'John' };
      const result = ObjectUtils.get(obj, 'name');
      expect(result).toBe('John');
    });

    /**
     * Test: should get nested property
     */
    it('should get nested property', () => {
      const obj = { user: { name: 'John' } };
      const result = ObjectUtils.get(obj, 'user.name');
      expect(result).toBe('John');
    });

    /**
     * Test: should get deeply nested property
     */
    it('should get deeply nested property', () => {
      const obj = { user: { profile: { name: 'John' } } };
      const result = ObjectUtils.get(obj, 'user.profile.name');
      expect(result).toBe('John');
    });

    /**
     * Test: should return undefined for non-existent path
     */
    it('should return undefined for non-existent path', () => {
      const obj = { name: 'John' };
      const result = ObjectUtils.get(obj, 'user.name');
      expect(result).toBeUndefined();
    });

    /**
     * Test: should handle null values in path
     */
    it('should handle null values in path', () => {
      const obj = { user: null };
      const result = ObjectUtils.get(obj, 'user.name');
      expect(result).toBeUndefined();
    });
  });

  describe('clean', () => {
    /**
     * Test: should remove simple property
     */
    it('should remove simple property', () => {
      const filter = { name: 'John', age: 30 };
      ObjectUtils.clean(filter, new Set(['name']));
      expect(filter).toEqual({ age: 30 });
    });

    /**
     * Test: should remove nested property
     */
    it('should remove nested property', () => {
      const filter = { user: { name: 'John', age: 30 } };
      ObjectUtils.clean(filter, new Set(['user.name']));
      expect(filter).toEqual({ user: { age: 30 } });
    });

    /**
     * Test: should remove empty parent objects
     */
    it('should remove empty parent objects', () => {
      const filter = { user: { name: 'John' } };
      ObjectUtils.clean(filter, new Set(['user.name']));
      // Empty parent objects are recursively removed
      expect(filter.user).toBeUndefined();
      expect(Object.keys(filter).length).toBe(0);
    });

    /**
     * Test: should clean deeply nested empty objects
     */
    it('should clean deeply nested empty objects', () => {
      const filter = { a: { b: { c: 'value' } } };
      ObjectUtils.clean(filter, new Set(['a.b.c']));
      // Empty parent structures are removed recursively
      expect(filter.a).toBeUndefined();
      expect(Object.keys(filter).length).toBe(0);
    });

    /**
     * Test: should not remove non-empty parents
     */
    it('should not remove non-empty parents', () => {
      const filter = { user: { name: 'John', age: 30 }, status: 'active' };
      ObjectUtils.clean(filter, new Set(['user.name']));
      expect(filter).toEqual({ user: { age: 30 }, status: 'active' });
    });

    /**
     * Test: should handle multiple paths
     */
    it('should handle multiple paths', () => {
      const filter = { a: { b: 1 }, c: { d: 2 }, e: 3 };
      ObjectUtils.clean(filter, new Set(['a.b', 'c.d']));
      expect(filter.e).toBe(3);
      // Empty parents are removed
      expect(filter.a).toBeUndefined();
      expect(filter.c).toBeUndefined();
      expect(Object.keys(filter)).toEqual(['e']);
    });

    /**
     * Test: should handle non-existent paths gracefully
     */
    it('should handle non-existent paths gracefully', () => {
      const filter = { name: 'John' };
      ObjectUtils.clean(filter, new Set(['user.age']));
      expect(filter).toEqual({ name: 'John' });
    });
  });
});
