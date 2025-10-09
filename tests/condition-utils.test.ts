/**
 * Test suite for ConditionUtils
 * Tests validation and condition building for search operations
 */

import { describe, it, expect } from '@jest/globals';
import ConditionUtils from '../src/search/condition-utils';

describe('ConditionUtils', () => {
  describe('isValid', () => {
    /**
     * Test: should return false for null
     */
    it('should return false for null', () => {
      expect(ConditionUtils.isValid(null)).toBe(false);
    });

    /**
     * Test: should return false for undefined
     */
    it('should return false for undefined', () => {
      expect(ConditionUtils.isValid(undefined)).toBe(false);
    });

    /**
     * Test: should return false for empty string
     */
    it('should return false for empty string', () => {
      expect(ConditionUtils.isValid('')).toBe(false);
      expect(ConditionUtils.isValid('   ')).toBe(false);
    });

    /**
     * Test: should return false for empty array
     */
    it('should return false for empty array', () => {
      expect(ConditionUtils.isValid([])).toBe(false);
    });

    /**
     * Test: should return false for empty object
     */
    it('should return false for empty object', () => {
      expect(ConditionUtils.isValid({})).toBe(false);
    });

    /**
     * Test: should return true for valid string
     */
    it('should return true for valid string', () => {
      expect(ConditionUtils.isValid('hello')).toBe(true);
    });

    /**
     * Test: should return true for valid number
     */
    it('should return true for valid number', () => {
      expect(ConditionUtils.isValid(0)).toBe(true);
      expect(ConditionUtils.isValid(42)).toBe(true);
      expect(ConditionUtils.isValid(-1)).toBe(true);
    });

    /**
     * Test: should return true for valid array
     */
    it('should return true for valid array', () => {
      expect(ConditionUtils.isValid([1, 2, 3])).toBe(true);
    });

    /**
     * Test: should return true for valid object
     */
    it('should return true for valid object', () => {
      expect(ConditionUtils.isValid({ key: 'value' })).toBe(true);
    });

    /**
     * Test: should return false for object with invalid nested values
     */
    it('should return false for object with invalid nested values', () => {
      expect(ConditionUtils.isValid({ key: null })).toBe(false);
      expect(ConditionUtils.isValid({ key: '' })).toBe(false);
    });

    /**
     * Test: should return true for boolean values
     */
    it('should return true for boolean values', () => {
      expect(ConditionUtils.isValid(true)).toBe(true);
      expect(ConditionUtils.isValid(false)).toBe(true);
    });
  });

  describe('string', () => {
    /**
     * Test: should create LIKE condition
     */
    it('should create LIKE condition', () => {
      const result = ConditionUtils.string({ value: 'test', mode: 'LIKE' });
      expect(result).toEqual({ contains: 'test' });
    });

    /**
     * Test: should create STARTS_WITH condition
     */
    it('should create STARTS_WITH condition', () => {
      const result = ConditionUtils.string({ value: 'test', mode: 'STARTS_WITH' });
      expect(result).toEqual({ startsWith: 'test' });
    });

    /**
     * Test: should create ENDS_WITH condition
     */
    it('should create ENDS_WITH condition', () => {
      const result = ConditionUtils.string({ value: 'test', mode: 'ENDS_WITH' });
      expect(result).toEqual({ endsWith: 'test' });
    });

    /**
     * Test: should create EXACT condition by default
     */
    it('should create EXACT condition by default', () => {
      const result = ConditionUtils.string({ value: 'test', mode: 'EXACT' });
      expect(result).toEqual({ equals: 'test' });
    });

    /**
     * Test: should handle undefined mode as EXACT
     */
    it('should handle undefined mode as EXACT', () => {
      const result = ConditionUtils.string({ value: 'test' } as any);
      expect(result).toEqual({ equals: 'test' });
    });
  });

  describe('range', () => {
    /**
     * Test: should create range with min only
     */
    it('should create range with min only', () => {
      const result = ConditionUtils.range({ min: 10 });
      expect(result).toEqual({ gte: 10 });
    });

    /**
     * Test: should create range with max only
     */
    it('should create range with max only', () => {
      const result = ConditionUtils.range({ max: 100 });
      expect(result).toEqual({ lte: 100 });
    });

    /**
     * Test: should create range with both min and max
     */
    it('should create range with both min and max', () => {
      const result = ConditionUtils.range({ min: 10, max: 100 });
      expect(result).toEqual({ gte: 10, lte: 100 });
    });

    /**
     * Test: should create empty object when no values provided
     */
    it('should create empty object when no values provided', () => {
      const result = ConditionUtils.range({});
      expect(result).toEqual({});
    });

    /**
     * Test: should handle Date objects
     */
    it('should handle Date objects', () => {
      const minDate = new Date('2024-01-01');
      const maxDate = new Date('2024-12-31');
      const result = ConditionUtils.range({ min: minDate, max: maxDate });
      expect(result).toEqual({ gte: minDate, lte: maxDate });
    });
  });

  describe('list', () => {
    /**
     * Test: should create IN condition
     */
    it('should create IN condition', () => {
      const result = ConditionUtils.list({ values: [1, 2, 3] });
      expect(result).toEqual({ in: [1, 2, 3] });
    });

    /**
     * Test: should create IN condition explicitly
     */
    it('should create IN condition explicitly', () => {
      const result = ConditionUtils.list({ values: [1, 2, 3], mode: 'IN' });
      expect(result).toEqual({ in: [1, 2, 3] });
    });

    /**
     * Test: should create NOT_IN condition
     */
    it('should create NOT_IN condition', () => {
      const result = ConditionUtils.list({ values: ['deleted', 'banned'], mode: 'NOT_IN' });
      expect(result).toEqual({ notIn: ['deleted', 'banned'] });
    });

    /**
     * Test: should create HAS_SOME condition
     */
    it('should create HAS_SOME condition', () => {
      const result = ConditionUtils.list({ values: ['tag1', 'tag2'], mode: 'HAS_SOME' });
      expect(result).toEqual({ hasSome: ['tag1', 'tag2'] });
    });

    /**
     * Test: should create HAS_EVERY condition
     */
    it('should create HAS_EVERY condition', () => {
      const result = ConditionUtils.list({ values: ['required1', 'required2'], mode: 'HAS_EVERY' });
      expect(result).toEqual({ hasEvery: ['required1', 'required2'] });
    });

    /**
     * Test: should handle string arrays
     */
    it('should handle string arrays', () => {
      const result = ConditionUtils.list({ values: ['a', 'b', 'c'] });
      expect(result).toEqual({ in: ['a', 'b', 'c'] });
    });

    /**
     * Test: should handle empty array
     */
    it('should handle empty array', () => {
      const result = ConditionUtils.list({ values: [] });
      expect(result).toEqual({ in: [] });
    });

    /**
     * Test: should handle mixed type arrays
     */
    it('should handle mixed type arrays', () => {
      const result = ConditionUtils.list({ values: [1, 'two', true] });
      expect(result).toEqual({ in: [1, 'two', true] });
    });
  });
});
