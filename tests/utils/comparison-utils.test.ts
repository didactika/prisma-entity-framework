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
    fieldHasChanged,
    isStandardIgnoredField,
    isDecimalLike,
    numbersAreEqual
} from '../../src/core/utils/comparison-utils';

function createMockDecimal(value: string) {
    const num = Number.parseFloat(value);
    return {
        d: [Number.parseInt(value.replace('.', ''))],
        e: value.includes('.') ? value.indexOf('.') - 1 : value.length - 1,
        s: num >= 0 ? 1 : -1,
        toNumber: () => num,
        toString: () => value
    };
}

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
            expect(normalizeValue('   ')).toBe(null);
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

    describe('isDecimalLike', () => {
        it('should return true for Prisma.Decimal-like objects', () => {
            const mockDecimal = { d: [1999], e: 1, s: 1, toNumber: () => 19.99, toString: () => '19.99' };
            expect(isDecimalLike(mockDecimal)).toBe(true);
        });

        it('should return false for plain objects', () => {
            expect(isDecimalLike({ a: 1 })).toBe(false);
            expect(isDecimalLike({})).toBe(false);
        });

        it('should return false for primitives', () => {
            expect(isDecimalLike(42)).toBe(false);
            expect(isDecimalLike('19.99')).toBe(false);
            expect(isDecimalLike(null)).toBe(false);
            expect(isDecimalLike(undefined)).toBe(false);
        });

        it('should return false for objects with partial Decimal interface', () => {
            expect(isDecimalLike({ toNumber: () => 1 })).toBe(false);
            expect(isDecimalLike({ d: [1], e: 1, s: 1 })).toBe(false);
            expect(isDecimalLike({ toNumber: () => 1, toString: () => '1' })).toBe(false);
        });

        it('should return false for Date objects', () => {
            expect(isDecimalLike(new Date())).toBe(false);
        });

        it('should return false for arrays', () => {
            expect(isDecimalLike([1, 2, 3])).toBe(false);
        });
    });

    describe('numbersAreEqual', () => {
        it('should return true for identical numbers', () => {
            expect(numbersAreEqual(1, 1)).toBe(true);
            expect(numbersAreEqual(0, 0)).toBe(true);
            expect(numbersAreEqual(-5, -5)).toBe(true);
        });

        it('should return true for float precision differences', () => {
            // Simulates MySQL FLOAT precision loss
            expect(numbersAreEqual(19.99, 19.990000000000002)).toBe(true);
            expect(numbersAreEqual(0.1 + 0.2, 0.3)).toBe(true);
            expect(numbersAreEqual(1.0000000000000002, 1)).toBe(true);
        });

        it('should return false for genuinely different numbers', () => {
            expect(numbersAreEqual(19.99, 20.5)).toBe(false);
            expect(numbersAreEqual(1, 2)).toBe(false);
            expect(numbersAreEqual(0, 1)).toBe(false);
            expect(numbersAreEqual(-1, 1)).toBe(false);
            expect(numbersAreEqual(100, 100.01)).toBe(false);
        });

        it('should treat both NaN as equal', () => {
            expect(numbersAreEqual(Number.NaN, Number.NaN)).toBe(true);
        });

        it('should treat NaN vs number as not equal', () => {
            expect(numbersAreEqual(Number.NaN, 0)).toBe(false);
            expect(numbersAreEqual(0, Number.NaN)).toBe(false);
            expect(numbersAreEqual(Number.NaN, 1)).toBe(false);
        });

        it('should handle Infinity correctly', () => {
            expect(numbersAreEqual(Infinity, Infinity)).toBe(true);
            expect(numbersAreEqual(-Infinity, -Infinity)).toBe(true);
            expect(numbersAreEqual(Infinity, -Infinity)).toBe(false);
            expect(numbersAreEqual(Infinity, 1e308)).toBe(false);
        });

        it('should handle zero edge cases', () => {
            expect(numbersAreEqual(0, -0)).toBe(true);
            expect(numbersAreEqual(0, 0)).toBe(true);
        });
    });

    describe('fieldHasChanged', () => {
        it('should return false for identical values', () => {
            expect(fieldHasChanged('hello', 'hello')).toBe(false);
            expect(fieldHasChanged(42, 42)).toBe(false);
            expect(fieldHasChanged(null, null)).toBe(false);
        });

        it('should return true for different values', () => {
            expect(fieldHasChanged('hello', 'world')).toBe(true);
            expect(fieldHasChanged(1, 2)).toBe(true);
        });

        it('should normalize then compare', () => {
            expect(fieldHasChanged('  hello  ', 'hello')).toBe(false);
            expect(fieldHasChanged('', null)).toBe(false);
            expect(fieldHasChanged(undefined, null)).toBe(false);
        });

        it('should use epsilon for float comparison', () => {
            expect(fieldHasChanged(19.99, 19.990000000000002)).toBe(false);
            expect(fieldHasChanged(19.99, 20.5)).toBe(true);
        });

        it('should handle Decimal-like vs number comparison', () => {
            const decimal = { d: [1999], e: 1, s: 1, toNumber: () => 19.99, toString: () => '19.99' };
            // Decimal is normalized to 19.99 (number), compared with epsilon
            expect(fieldHasChanged(19.99, decimal)).toBe(false);
            expect(fieldHasChanged(decimal, 19.99)).toBe(false);
            expect(fieldHasChanged(20, decimal)).toBe(true);
        });

        it('should deep compare objects', () => {
            expect(fieldHasChanged({ a: 1 }, { a: 1 })).toBe(false);
            expect(fieldHasChanged({ a: 1 }, { a: 2 })).toBe(true);
        });

        it('should compare Dates by timestamp', () => {
            const d1 = new Date('2024-06-15T10:00:00Z');
            const d2 = new Date('2024-06-15T10:00:00Z');
            const d3 = new Date('2024-06-16T10:00:00Z');
            expect(fieldHasChanged(d1, d2)).toBe(false);
            expect(fieldHasChanged(d1, d3)).toBe(true);
        });
    });

    describe('normalizeValue - Decimal/BigInt/whitespace edge cases', () => {
        it('should normalize whitespace-only strings to null', () => {
            expect(normalizeValue('   ')).toBe(null);
            expect(normalizeValue('\t')).toBe(null);
            expect(normalizeValue('\n')).toBe(null);
            expect(normalizeValue('  \t\n  ')).toBe(null);
        });

        it('should coerce Prisma.Decimal-like objects to number', () => {
            const mockDecimal = { d: [1999], e: 1, s: 1, toNumber: () => 19.99, toString: () => '19.99' };
            expect(normalizeValue(mockDecimal)).toBe(19.99);
        });

        it('should coerce zero Decimal to number', () => {
            const zeroDecimal = { d: [0], e: 0, s: 1, toNumber: () => 0, toString: () => '0' };
            expect(normalizeValue(zeroDecimal)).toBe(0);
        });

        it('should coerce negative Decimal to number', () => {
            const negDecimal = { d: [500], e: 2, s: -1, toNumber: () => -5, toString: () => '-5.00' };
            expect(normalizeValue(negDecimal)).toBe(-5);
        });

        it('should coerce BigInt to number', () => {
            expect(normalizeValue(BigInt(42))).toBe(42);
            expect(normalizeValue(BigInt(0))).toBe(0);
            expect(normalizeValue(BigInt(-100))).toBe(-100);
        });

        it('should not coerce regular objects', () => {
            const obj = { a: 1, b: 2 };
            expect(normalizeValue(obj)).toBe(obj);
        });

        it('should not coerce arrays', () => {
            const arr = [1, 2, 3];
            expect(normalizeValue(arr)).toBe(arr);
        });

        it('should not coerce Date objects', () => {
            const date = new Date('2024-01-01');
            expect(normalizeValue(date)).toBe(date);
        });
    });

    describe('deepEqual - Date comparison', () => {
        it('should return true for Date objects with same timestamp', () => {
            const d1 = new Date('2024-06-15T10:00:00.000Z');
            const d2 = new Date('2024-06-15T10:00:00.000Z');
            expect(deepEqual(d1, d2)).toBe(true);
        });

        it('should return false for Date objects with different timestamps', () => {
            const d1 = new Date('2024-06-15T10:00:00.000Z');
            const d2 = new Date('2024-06-16T10:00:00.000Z');
            expect(deepEqual(d1, d2)).toBe(false);
        });

        it('should return true for same Date reference', () => {
            const d = new Date();
            expect(deepEqual(d, d)).toBe(true);
        });

        it('should return false for Date vs non-Date', () => {
            expect(deepEqual(new Date(), {})).toBe(false);
            expect(deepEqual(new Date(), 12345)).toBe(false);
            expect(deepEqual(new Date(), 'string')).toBe(false);
        });

        it('should compare Date objects with millisecond precision', () => {
            const d1 = new Date('2024-06-15T10:00:00.123Z');
            const d2 = new Date('2024-06-15T10:00:00.123Z');
            const d3 = new Date('2024-06-15T10:00:00.124Z');
            expect(deepEqual(d1, d2)).toBe(true);
            expect(deepEqual(d1, d3)).toBe(false);
        });
    });

    describe('deepEqual - Decimal-like comparison', () => {

        it('should return true for Decimal objects with same value', () => {
            const d1 = createMockDecimal('19.99');
            const d2 = createMockDecimal('19.99');
            expect(deepEqual(d1, d2)).toBe(true);
        });

        it('should return false for Decimal objects with different values', () => {
            const d1 = createMockDecimal('19.99');
            const d2 = createMockDecimal('20.00');
            expect(deepEqual(d1, d2)).toBe(false);
        });

        it('should return true for same Decimal reference', () => {
            const d = createMockDecimal('100.50');
            expect(deepEqual(d, d)).toBe(true);
        });

        it('should return true for zero Decimals', () => {
            const d1 = createMockDecimal('0');
            const d2 = createMockDecimal('0');
            expect(deepEqual(d1, d2)).toBe(true);
        });

        it('should handle Decimal with trailing zeros', () => {
            const d1 = createMockDecimal('19.90');
            const d2 = createMockDecimal('19.9');
            // Different toString output = different (conservative)
            expect(deepEqual(d1, d2)).toBe(false);
        });
    });

    describe('hasChanges - Float/Decimal precision', () => {
        it('should not detect changes for float precision differences', () => {
            expect(hasChanges(
                { price: 19.99 },
                { price: 19.990000000000002 }
            )).toBe(false);
        });

        it('should not detect changes for 0.1 + 0.2 vs 0.3', () => {
            expect(hasChanges(
                { value: 0.1 + 0.2 },
                { value: 0.3 }
            )).toBe(false);
        });

        it('should detect changes for genuinely different floats', () => {
            expect(hasChanges(
                { price: 19.99 },
                { price: 20.5 }
            )).toBe(true);
        });

        it('should not detect changes when Prisma.Decimal equals the number', () => {
            const mockDecimal = { d: [1999], e: 1, s: 1, toNumber: () => 19.99, toString: () => '19.99' };
            // newData has number 19.99, existingData has Decimal('19.99')
            expect(hasChanges(
                { price: 19.99 },
                { price: mockDecimal }
            )).toBe(false);
        });

        it('should not detect changes when both are Prisma.Decimal with same value', () => {
            const d1 = { d: [1999], e: 1, s: 1, toNumber: () => 19.99, toString: () => '19.99' };
            const d2 = { d: [1999], e: 1, s: 1, toNumber: () => 19.99, toString: () => '19.99' };
            expect(hasChanges(
                { price: d1 },
                { price: d2 }
            )).toBe(false);
        });

        it('should detect changes when Prisma.Decimal differs from number', () => {
            const mockDecimal = { d: [1999], e: 1, s: 1, toNumber: () => 19.99, toString: () => '19.99' };
            expect(hasChanges(
                { price: 25 },
                { price: mockDecimal }
            )).toBe(true);
        });

        it('should not detect changes for integer as float', () => {
            expect(hasChanges(
                { value: 5 },
                { value: 5 }
            )).toBe(false);
        });

        it('should handle NaN fields as unchanged', () => {
            expect(hasChanges(
                { value: Number.NaN },
                { value: Number.NaN }
            )).toBe(false);
        });

        it('should handle NaN vs number as changed', () => {
            expect(hasChanges(
                { value: Number.NaN },
                { value: 0 }
            )).toBe(true);
        });
    });

    describe('hasChanges - Date fields', () => {
        it('should not detect changes for same Date timestamp', () => {
            const d1 = new Date('2024-06-15T10:00:00.000Z');
            const d2 = new Date('2024-06-15T10:00:00.000Z');
            expect(hasChanges(
                { scheduledFor: d1 },
                { scheduledFor: d2 }
            )).toBe(false);
        });

        it('should detect changes for different Date timestamp', () => {
            const d1 = new Date('2024-06-15T10:00:00.000Z');
            const d2 = new Date('2024-06-16T10:00:00.000Z');
            expect(hasChanges(
                { scheduledFor: d1 },
                { scheduledFor: d2 }
            )).toBe(true);
        });

        it('should still ignore createdAt and updatedAt dates', () => {
            expect(hasChanges(
                { createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-01'), name: 'Test' },
                { createdAt: new Date('2024-12-31'), updatedAt: new Date('2024-12-31'), name: 'Test' }
            )).toBe(false);
        });

        it('should detect change when Date vs null', () => {
            expect(hasChanges(
                { scheduledFor: new Date('2024-06-15') },
                { scheduledFor: null }
            )).toBe(true);
        });

        it('should not detect change when both Date are null/undefined', () => {
            expect(hasChanges(
                { scheduledFor: null },
                { scheduledFor: undefined }
            )).toBe(false);
        });
    });

    describe('hasChanges - JSON deep comparison', () => {
        it('should not detect changes for identical JSON objects', () => {
            expect(hasChanges(
                { metadata: { key: 'value', count: 5 } },
                { metadata: { key: 'value', count: 5 } }
            )).toBe(false);
        });

        it('should detect changes when JSON has different values', () => {
            expect(hasChanges(
                { metadata: { key: 'value', count: 5 } },
                { metadata: { key: 'value', count: 10 } }
            )).toBe(true);
        });

        it('should detect changes when JSON has extra keys', () => {
            expect(hasChanges(
                { metadata: { a: 1 } },
                { metadata: { a: 1, b: 2 } }
            )).toBe(true);
        });

        it('should not detect changes for deeply nested identical JSON', () => {
            const json = {
                level1: {
                    level2: {
                        level3: {
                            items: [1, 2, 3],
                            config: { enabled: true, name: 'test' }
                        }
                    }
                }
            };
            expect(hasChanges(
                { settings: structuredClone(json) },
                { settings: structuredClone(json) }
            )).toBe(false);
        });

        it('should detect changes in deeply nested JSON', () => {
            expect(hasChanges(
                { settings: { database: { host: 'localhost', port: 5432 } } },
                { settings: { database: { host: 'localhost', port: 3306 } } }
            )).toBe(true);
        });

        it('should not detect changes for identical JSON arrays', () => {
            expect(hasChanges(
                { tags: ['tag1', 'tag2', 'tag3'] },
                { tags: ['tag1', 'tag2', 'tag3'] }
            )).toBe(false);
        });

        it('should detect changes for JSON arrays with different order', () => {
            expect(hasChanges(
                { tags: ['tag1', 'tag2'] },
                { tags: ['tag2', 'tag1'] }
            )).toBe(true);
        });

        it('should handle JSON with null values correctly', () => {
            expect(hasChanges(
                { metadata: { a: null, b: 'test' } },
                { metadata: { a: null, b: 'test' } }
            )).toBe(false);
        });

        it('should handle JSON with mixed types', () => {
            const complex = {
                str: 'text',
                num: 42,
                bool: true,
                nil: null,
                arr: [1, 'two', { three: 3 }],
                nested: { deep: { value: 'found' } }
            };
            expect(hasChanges(
                { metadata: structuredClone(complex) },
                { metadata: structuredClone(complex) }
            )).toBe(false);
        });

        it('should not detect changes for null vs null JSON fields', () => {
            expect(hasChanges(
                { metadata: null },
                { metadata: null }
            )).toBe(false);
        });

        it('should detect changes for null vs empty object JSON fields', () => {
            expect(hasChanges(
                { metadata: null },
                { metadata: {} }
            )).toBe(true);
        });

        it('should not detect changes for empty object vs empty object', () => {
            expect(hasChanges(
                { metadata: {} },
                { metadata: {} }
            )).toBe(false);
        });
    });

    describe('hasChanges - combined field types (simulated upsert comparison)', () => {
        it('should correctly compare a record with mixed field types - no changes', () => {
            const decimal = { d: [2999], e: 1, s: 1, toNumber: () => 29.99, toString: () => '29.99' };
            const date = new Date('2024-06-15T10:00:00.000Z');

            // Simulates: user provides data, DB returns with Prisma types
            const newData: Record<string, unknown> = {
                id: 1,
                name: 'Product A',
                price: 29.99,
                discount: 0.15,
                metadata: { color: 'red', sizes: ['S', 'M', 'L'] },
                scheduledFor: new Date('2024-06-15T10:00:00.000Z')
            };

            const existingData: Record<string, unknown> = {
                id: 1,
                name: 'Product A',
                price: decimal,              // Prisma.Decimal
                discount: 0.15,
                metadata: { color: 'red', sizes: ['S', 'M', 'L'] },
                scheduledFor: date,           // Date object from DB
                createdAt: new Date('2024-01-01'),
                updatedAt: new Date('2024-06-01')
            };

            expect(hasChanges(newData, existingData)).toBe(false);
        });

        it('should correctly compare a record with mixed field types - with changes', () => {
            const decimal = { d: [2999], e: 1, s: 1, toNumber: () => 29.99, toString: () => '29.99' };

            const newData: Record<string, unknown> = {
                id: 1,
                name: 'Product A Updated',   // Changed
                price: 29.99,
                metadata: { color: 'blue' }   // Changed
            };

            const existingData: Record<string, unknown> = {
                id: 1,
                name: 'Product A',
                price: decimal,
                metadata: { color: 'red' },
                createdAt: new Date(),
                updatedAt: new Date()
            };

            expect(hasChanges(newData, existingData)).toBe(true);
        });

        it('should handle upsertMany scenario - batch of items with DB-returned types', () => {
            const items: Record<string, unknown>[] = [
                { name: 'Item 1', price: 9.99, metadata: { tag: 'a' } },
                { name: 'Item 2', price: 19.99, metadata: { tag: 'b' } },
                { name: 'Item 3', price: 29.99, metadata: { tag: 'c' } }
            ];

            const existingRecords: Record<string, unknown>[] = [
                {
                    id: 1, name: 'Item 1',
                    price: { d: [999], e: 0, s: 1, toNumber: () => 9.99, toString: () => '9.99' },
                    metadata: { tag: 'a' }, createdAt: new Date(), updatedAt: new Date()
                },
                {
                    id: 2, name: 'Item 2',
                    price: { d: [1999], e: 1, s: 1, toNumber: () => 19.99, toString: () => '19.99' },
                    metadata: { tag: 'b' }, createdAt: new Date(), updatedAt: new Date()
                },
                {
                    id: 3, name: 'Item 3',
                    price: { d: [2999], e: 1, s: 1, toNumber: () => 29.99, toString: () => '29.99' },
                    metadata: { tag: 'DIFFERENT' }, createdAt: new Date(), updatedAt: new Date()
                }
            ];

            // Items 0 and 1 should have no changes, item 2 has changed metadata
            expect(hasChanges(items[0], existingRecords[0])).toBe(false);
            expect(hasChanges(items[1], existingRecords[1])).toBe(false);
            expect(hasChanges(items[2], existingRecords[2])).toBe(true);
        });
    });
});
