/**
 * Test suite for Comparison Utilities
 * Tests deep equality comparison and value normalization functions
 */

import { describe, it, expect } from '@jest/globals';
import {
    normalizeValue,
    deepEqual,
    deepEqualArrays,
    deepEqualObjects,
    hasChanges,
    isStandardIgnoredField
} from '../../src/core/utils/comparison-utils';

describe('Comparison Utils', () => {
    describe('normalizeValue', () => {
        /**
         * Test: should return null for null
         */
        it('should return null for null', () => {
            expect(normalizeValue(null)).toBe(null);
        });

        /**
         * Test: should return null for undefined
         */
        it('should return null for undefined', () => {
            expect(normalizeValue(undefined)).toBe(null);
        });

        /**
         * Test: should return null for empty string
         */
        it('should return null for empty string', () => {
            expect(normalizeValue('')).toBe(null);
        });

        /**
         * Test: should trim strings
         */
        it('should trim strings', () => {
            expect(normalizeValue('  hello  ')).toBe('hello');
            expect(normalizeValue('\thello\n')).toBe('hello');
            expect(normalizeValue('   ')).toBe('');
        });

        /**
         * Test: should return strings as-is if no trimming needed
         */
        it('should return strings as-is if no trimming needed', () => {
            expect(normalizeValue('hello')).toBe('hello');
            expect(normalizeValue('hello world')).toBe('hello world');
        });

        /**
         * Test: should return numbers unchanged
         */
        it('should return numbers unchanged', () => {
            expect(normalizeValue(0)).toBe(0);
            expect(normalizeValue(123)).toBe(123);
            expect(normalizeValue(-456)).toBe(-456);
            expect(normalizeValue(3.14)).toBe(3.14);
        });

        /**
         * Test: should return booleans unchanged
         */
        it('should return booleans unchanged', () => {
            expect(normalizeValue(true)).toBe(true);
            expect(normalizeValue(false)).toBe(false);
        });

        /**
         * Test: should return objects unchanged
         */
        it('should return objects unchanged', () => {
            const obj = { key: 'value' };
            expect(normalizeValue(obj)).toBe(obj);
        });

        /**
         * Test: should return arrays unchanged
         */
        it('should return arrays unchanged', () => {
            const arr = [1, 2, 3];
            expect(normalizeValue(arr)).toBe(arr);
        });

        /**
         * Test: should return dates unchanged
         */
        it('should return dates unchanged', () => {
            const date = new Date();
            expect(normalizeValue(date)).toBe(date);
        });
    });

    describe('deepEqual', () => {
        /**
         * Test: should return true for identical primitives
         */
        it('should return true for identical primitives', () => {
            expect(deepEqual(1, 1)).toBe(true);
            expect(deepEqual('hello', 'hello')).toBe(true);
            expect(deepEqual(true, true)).toBe(true);
            expect(deepEqual(false, false)).toBe(true);
        });

        /**
         * Test: should return true for same reference
         */
        it('should return true for same reference', () => {
            const obj = { key: 'value' };
            expect(deepEqual(obj, obj)).toBe(true);
            
            const arr = [1, 2, 3];
            expect(deepEqual(arr, arr)).toBe(true);
        });

        /**
         * Test: should return false for different primitives
         */
        it('should return false for different primitives', () => {
            expect(deepEqual(1, 2)).toBe(false);
            expect(deepEqual('hello', 'world')).toBe(false);
            expect(deepEqual(true, false)).toBe(false);
        });

        /**
         * Test: should return true for both null
         */
        it('should return true for both null', () => {
            expect(deepEqual(null, null)).toBe(true);
        });

        /**
         * Test: should return true for both undefined
         */
        it('should return true for both undefined', () => {
            expect(deepEqual(undefined, undefined)).toBe(true);
        });

        /**
         * Test: should return false when one is null
         */
        it('should return false when one is null', () => {
            expect(deepEqual(null, 1)).toBe(false);
            expect(deepEqual(1, null)).toBe(false);
            expect(deepEqual(null, {})).toBe(false);
        });

        /**
         * Test: should return false when one is undefined
         */
        it('should return false when one is undefined', () => {
            expect(deepEqual(undefined, 1)).toBe(false);
            expect(deepEqual(1, undefined)).toBe(false);
            expect(deepEqual(undefined, {})).toBe(false);
        });

        /**
         * Test: should return false for different types
         */
        it('should return false for different types', () => {
            expect(deepEqual(1, '1')).toBe(false);
            expect(deepEqual(true, 1)).toBe(false);
            expect(deepEqual({}, [])).toBe(false);
        });

        /**
         * Test: should return true for equal simple objects
         */
        it('should return true for equal simple objects', () => {
            expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
            expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
        });

        /**
         * Test: should return false for different simple objects
         */
        it('should return false for different simple objects', () => {
            expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
            expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
            expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
        });

        /**
         * Test: should return true for equal nested objects
         */
        it('should return true for equal nested objects', () => {
            expect(deepEqual(
                { a: { b: { c: 1 } } },
                { a: { b: { c: 1 } } }
            )).toBe(true);
            
            expect(deepEqual(
                { user: { name: 'John', age: 30 } },
                { user: { name: 'John', age: 30 } }
            )).toBe(true);
        });

        /**
         * Test: should return false for different nested objects
         */
        it('should return false for different nested objects', () => {
            expect(deepEqual(
                { a: { b: { c: 1 } } },
                { a: { b: { c: 2 } } }
            )).toBe(false);
            
            expect(deepEqual(
                { user: { name: 'John', age: 30 } },
                { user: { name: 'Jane', age: 30 } }
            )).toBe(false);
        });

        /**
         * Test: should return true for equal simple arrays
         */
        it('should return true for equal simple arrays', () => {
            expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
            expect(deepEqual(['a', 'b'], ['a', 'b'])).toBe(true);
        });

        /**
         * Test: should return false for different simple arrays
         */
        it('should return false for different simple arrays', () => {
            expect(deepEqual([1, 2, 3], [1, 2, 4])).toBe(false);
            expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
            expect(deepEqual(['a', 'b'], ['b', 'a'])).toBe(false);
        });

        /**
         * Test: should return true for equal nested arrays
         */
        it('should return true for equal nested arrays', () => {
            expect(deepEqual(
                [[1, 2], [3, 4]],
                [[1, 2], [3, 4]]
            )).toBe(true);
            
            expect(deepEqual(
                [{ a: 1 }, { b: 2 }],
                [{ a: 1 }, { b: 2 }]
            )).toBe(true);
        });

        /**
         * Test: should return false for different nested arrays
         */
        it('should return false for different nested arrays', () => {
            expect(deepEqual(
                [[1, 2], [3, 4]],
                [[1, 2], [3, 5]]
            )).toBe(false);
            
            expect(deepEqual(
                [{ a: 1 }, { b: 2 }],
                [{ a: 1 }, { b: 3 }]
            )).toBe(false);
        });

        /**
         * Test: should handle mixed nested structures
         */
        it('should handle mixed nested structures', () => {
            expect(deepEqual(
                { users: [{ name: 'John', tags: ['admin', 'user'] }] },
                { users: [{ name: 'John', tags: ['admin', 'user'] }] }
            )).toBe(true);
            
            expect(deepEqual(
                { users: [{ name: 'John', tags: ['admin', 'user'] }] },
                { users: [{ name: 'John', tags: ['user', 'admin'] }] }
            )).toBe(false);
        });
    });

    describe('deepEqualArrays', () => {
        /**
         * Test: should return true for empty arrays
         */
        it('should return true for empty arrays', () => {
            expect(deepEqualArrays([], [])).toBe(true);
        });

        /**
         * Test: should return false for arrays of different lengths
         */
        it('should return false for arrays of different lengths', () => {
            expect(deepEqualArrays([1], [1, 2])).toBe(false);
            expect(deepEqualArrays([1, 2, 3], [1, 2])).toBe(false);
        });

        /**
         * Test: should return true for equal primitive arrays
         */
        it('should return true for equal primitive arrays', () => {
            expect(deepEqualArrays([1, 2, 3], [1, 2, 3])).toBe(true);
            expect(deepEqualArrays(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true);
            expect(deepEqualArrays([true, false], [true, false])).toBe(true);
        });

        /**
         * Test: should return false for different primitive arrays
         */
        it('should return false for different primitive arrays', () => {
            expect(deepEqualArrays([1, 2, 3], [1, 2, 4])).toBe(false);
            expect(deepEqualArrays(['a', 'b'], ['a', 'c'])).toBe(false);
        });

        /**
         * Test: should return true for equal object arrays
         */
        it('should return true for equal object arrays', () => {
            expect(deepEqualArrays(
                [{ a: 1 }, { b: 2 }],
                [{ a: 1 }, { b: 2 }]
            )).toBe(true);
        });

        /**
         * Test: should return false for different object arrays
         */
        it('should return false for different object arrays', () => {
            expect(deepEqualArrays(
                [{ a: 1 }, { b: 2 }],
                [{ a: 1 }, { b: 3 }]
            )).toBe(false);
        });

        /**
         * Test: should handle nested arrays
         */
        it('should handle nested arrays', () => {
            expect(deepEqualArrays(
                [[1, 2], [3, 4]],
                [[1, 2], [3, 4]]
            )).toBe(true);
            
            expect(deepEqualArrays(
                [[1, 2], [3, 4]],
                [[1, 2], [3, 5]]
            )).toBe(false);
        });
    });

    describe('deepEqualObjects', () => {
        /**
         * Test: should return true for empty objects
         */
        it('should return true for empty objects', () => {
            expect(deepEqualObjects({}, {})).toBe(true);
        });

        /**
         * Test: should return false for objects with different number of keys
         */
        it('should return false for objects with different number of keys', () => {
            expect(deepEqualObjects({ a: 1 }, { a: 1, b: 2 })).toBe(false);
            expect(deepEqualObjects({ a: 1, b: 2 }, { a: 1 })).toBe(false);
        });

        /**
         * Test: should return false when keys don't match
         */
        it('should return false when keys don\'t match', () => {
            expect(deepEqualObjects({ a: 1 }, { b: 1 })).toBe(false);
            expect(deepEqualObjects({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
        });

        /**
         * Test: should return true for equal simple objects
         */
        it('should return true for equal simple objects', () => {
            expect(deepEqualObjects({ a: 1 }, { a: 1 })).toBe(true);
            expect(deepEqualObjects({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
            expect(deepEqualObjects({ name: 'John', age: 30 }, { name: 'John', age: 30 })).toBe(true);
        });

        /**
         * Test: should return false for different simple objects
         */
        it('should return false for different simple objects', () => {
            expect(deepEqualObjects({ a: 1 }, { a: 2 })).toBe(false);
            expect(deepEqualObjects({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
        });

        /**
         * Test: should handle nested objects
         */
        it('should handle nested objects', () => {
            expect(deepEqualObjects(
                { user: { name: 'John', age: 30 } },
                { user: { name: 'John', age: 30 } }
            )).toBe(true);
            
            expect(deepEqualObjects(
                { user: { name: 'John', age: 30 } },
                { user: { name: 'Jane', age: 30 } }
            )).toBe(false);
        });

        /**
         * Test: should handle objects with array values
         */
        it('should handle objects with array values', () => {
            expect(deepEqualObjects(
                { tags: ['a', 'b'] },
                { tags: ['a', 'b'] }
            )).toBe(true);
            
            expect(deepEqualObjects(
                { tags: ['a', 'b'] },
                { tags: ['a', 'c'] }
            )).toBe(false);
        });

        /**
         * Test: should handle objects with null values
         */
        it('should handle objects with null values', () => {
            expect(deepEqualObjects({ a: null }, { a: null })).toBe(true);
            expect(deepEqualObjects({ a: null }, { a: 1 })).toBe(false);
        });
    });

    describe('hasChanges', () => {
        /**
         * Test: should return false when data is identical
         */
        it('should return false when data is identical', () => {
            expect(hasChanges(
                { name: 'John', age: 30 },
                { name: 'John', age: 30 }
            )).toBe(false);
        });

        /**
         * Test: should return true when data has changes
         */
        it('should return true when data has changes', () => {
            expect(hasChanges(
                { name: 'John', age: 30 },
                { name: 'Jane', age: 30 }
            )).toBe(true);
            
            expect(hasChanges(
                { name: 'John', age: 31 },
                { name: 'John', age: 30 }
            )).toBe(true);
        });

        /**
         * Test: should ignore id field
         */
        it('should ignore id field', () => {
            expect(hasChanges(
                { id: 1, name: 'John' },
                { id: 2, name: 'John' }
            )).toBe(false);
        });

        /**
         * Test: should ignore createdAt field
         */
        it('should ignore createdAt field', () => {
            expect(hasChanges(
                { createdAt: new Date('2024-01-01'), name: 'John' },
                { createdAt: new Date('2024-01-02'), name: 'John' }
            )).toBe(false);
        });

        /**
         * Test: should ignore updatedAt field
         */
        it('should ignore updatedAt field', () => {
            expect(hasChanges(
                { updatedAt: new Date('2024-01-01'), name: 'John' },
                { updatedAt: new Date('2024-01-02'), name: 'John' }
            )).toBe(false);
        });

        /**
         * Test: should ignore custom fields
         */
        it('should ignore custom fields', () => {
            expect(hasChanges(
                { name: 'John', status: 'active' },
                { name: 'John', status: 'inactive' },
                ['status']
            )).toBe(false);
            
            expect(hasChanges(
                { name: 'John', age: 30, status: 'active' },
                { name: 'John', age: 31, status: 'inactive' },
                ['status']
            )).toBe(true);
        });

        /**
         * Test: should normalize empty strings to null
         */
        it('should normalize empty strings to null', () => {
            expect(hasChanges(
                { name: '' },
                { name: null }
            )).toBe(false);
            
            expect(hasChanges(
                { name: '' },
                { name: undefined }
            )).toBe(false);
        });

        /**
         * Test: should trim strings before comparison
         */
        it('should trim strings before comparison', () => {
            expect(hasChanges(
                { name: '  John  ' },
                { name: 'John' }
            )).toBe(false);
            
            expect(hasChanges(
                { name: '\tJohn\n' },
                { name: 'John' }
            )).toBe(false);
        });

        /**
         * Test: should detect changes in nested objects
         */
        it('should detect changes in nested objects', () => {
            expect(hasChanges(
                { user: { name: 'John', age: 30 } },
                { user: { name: 'John', age: 30 } }
            )).toBe(false);
            
            expect(hasChanges(
                { user: { name: 'John', age: 30 } },
                { user: { name: 'Jane', age: 30 } }
            )).toBe(true);
        });

        /**
         * Test: should detect changes in arrays
         */
        it('should detect changes in arrays', () => {
            expect(hasChanges(
                { tags: ['a', 'b'] },
                { tags: ['a', 'b'] }
            )).toBe(false);
            
            expect(hasChanges(
                { tags: ['a', 'b'] },
                { tags: ['a', 'c'] }
            )).toBe(true);
            
            expect(hasChanges(
                { tags: ['a', 'b'] },
                { tags: ['a', 'b', 'c'] }
            )).toBe(true);
        });

        /**
         * Test: should handle null vs undefined
         */
        it('should handle null vs undefined', () => {
            expect(hasChanges(
                { name: null },
                { name: undefined }
            )).toBe(false);
            
            expect(hasChanges(
                { name: null },
                { name: 'John' }
            )).toBe(true);
        });

        /**
         * Test: should detect type changes
         */
        it('should detect type changes', () => {
            expect(hasChanges(
                { value: '123' },
                { value: 123 }
            )).toBe(true);
            
            expect(hasChanges(
                { value: true },
                { value: 1 }
            )).toBe(true);
        });

        /**
         * Test: should handle empty objects
         */
        it('should handle empty objects', () => {
            expect(hasChanges({}, {})).toBe(false);
        });

        /**
         * Test: should handle complex nested structures
         */
        it('should handle complex nested structures', () => {
            expect(hasChanges(
                {
                    id: 1,
                    user: {
                        name: 'John',
                        profile: {
                            age: 30,
                            tags: ['admin', 'user']
                        }
                    }
                },
                {
                    id: 2,
                    user: {
                        name: 'John',
                        profile: {
                            age: 30,
                            tags: ['admin', 'user']
                        }
                    }
                }
            )).toBe(false);
            
            expect(hasChanges(
                {
                    user: {
                        name: 'John',
                        profile: {
                            age: 30,
                            tags: ['admin', 'user']
                        }
                    }
                },
                {
                    user: {
                        name: 'John',
                        profile: {
                            age: 30,
                            tags: ['user', 'admin']
                        }
                    }
                }
            )).toBe(true);
        });

        /**
         * Test: should handle same reference
         */
        it('should handle same reference', () => {
            const obj = { name: 'John', age: 30 };
            expect(hasChanges(obj, obj)).toBe(false);
        });
    });

    describe('isStandardIgnoredField', () => {
        /**
         * Test: should return true for id
         */
        it('should return true for id', () => {
            expect(isStandardIgnoredField('id')).toBe(true);
        });

        /**
         * Test: should return true for createdAt
         */
        it('should return true for createdAt', () => {
            expect(isStandardIgnoredField('createdAt')).toBe(true);
        });

        /**
         * Test: should return true for updatedAt
         */
        it('should return true for updatedAt', () => {
            expect(isStandardIgnoredField('updatedAt')).toBe(true);
        });

        /**
         * Test: should return false for other fields
         */
        it('should return false for other fields', () => {
            expect(isStandardIgnoredField('name')).toBe(false);
            expect(isStandardIgnoredField('age')).toBe(false);
            expect(isStandardIgnoredField('email')).toBe(false);
            expect(isStandardIgnoredField('status')).toBe(false);
        });

        /**
         * Test: should be case-sensitive
         */
        it('should be case-sensitive', () => {
            expect(isStandardIgnoredField('ID')).toBe(false);
            expect(isStandardIgnoredField('Id')).toBe(false);
            expect(isStandardIgnoredField('CreatedAt')).toBe(false);
            expect(isStandardIgnoredField('UpdatedAt')).toBe(false);
        });
    });
});
