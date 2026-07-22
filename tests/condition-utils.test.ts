/**
 * Test suite for ConditionUtils
 *
 * Only value validation lives here — operator construction moved to SearchResolver,
 * which is covered by tests/search-resolver.test.ts.
 */

import { describe, it, expect } from '@jest/globals';
import ConditionUtils from '../src/core/condition-utils';

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
});
