/**
 * Test suite for Validation Utilities
 * Tests type checking and validation functions
 */

import { describe, it, expect } from '@jest/globals';
import {
    isObject,
    isEmpty,
    isValidValue,
    hasPrismaOperations,
    isNonEmptyArray,
    shouldSkipField
} from '../../src/utils/validation-utils';

describe('Validation Utils', () => {
    describe('isObject', () => {
        /**
         * Test: should return true for plain objects
         */
        it('should return true for plain objects', () => {
            expect(isObject({})).toBe(true);
            expect(isObject({ key: 'value' })).toBe(true);
            expect(isObject({ nested: { key: 'value' } })).toBe(true);
        });

        /**
         * Test: should return false for arrays
         */
        it('should return false for arrays', () => {
            expect(isObject([])).toBe(false);
            expect(isObject([1, 2, 3])).toBe(false);
            expect(isObject([{ key: 'value' }])).toBe(false);
        });

        /**
         * Test: should return false for null
         */
        it('should return false for null', () => {
            expect(isObject(null)).toBe(false);
        });

        /**
         * Test: should return false for primitives
         */
        it('should return false for primitives', () => {
            expect(isObject('string')).toBe(false);
            expect(isObject(123)).toBe(false);
            expect(isObject(true)).toBe(false);
            expect(isObject(undefined)).toBe(false);
        });

        /**
         * Test: should return false for functions
         */
        it('should return false for functions', () => {
            expect(isObject(() => { })).toBe(false);
            expect(isObject(function () { })).toBe(false);
        });

        /**
         * Test: should return true for Date objects
         */
        it('should return true for Date objects', () => {
            expect(isObject(new Date())).toBe(true);
        });
    });

    describe('isEmpty', () => {
        /**
         * Test: should return true for empty objects
         */
        it('should return true for empty objects', () => {
            expect(isEmpty({})).toBe(true);
        });

        /**
         * Test: should return false for non-empty objects
         */
        it('should return false for non-empty objects', () => {
            expect(isEmpty({ key: 'value' })).toBe(false);
            expect(isEmpty({ a: 1, b: 2 })).toBe(false);
        });

        /**
         * Test: should return false for objects with undefined values
         */
        it('should return false for objects with undefined values', () => {
            expect(isEmpty({ key: undefined })).toBe(false);
        });

        /**
         * Test: should return false for objects with null values
         */
        it('should return false for objects with null values', () => {
            expect(isEmpty({ key: null })).toBe(false);
        });
    });

    describe('isValidValue', () => {
        /**
         * Test: should return false for null and undefined
         */
        it('should return false for null and undefined', () => {
            expect(isValidValue(null)).toBe(false);
            expect(isValidValue(undefined)).toBe(false);
        });

        /**
         * Test: should return false for empty strings
         */
        it('should return false for empty strings', () => {
            expect(isValidValue('')).toBe(false);
            expect(isValidValue('   ')).toBe(false);
            expect(isValidValue('\t')).toBe(false);
            expect(isValidValue('\n')).toBe(false);
        });

        /**
         * Test: should return true for non-empty strings
         */
        it('should return true for non-empty strings', () => {
            expect(isValidValue('hello')).toBe(true);
            expect(isValidValue('0')).toBe(true);
            expect(isValidValue(' a ')).toBe(true);
        });

        /**
         * Test: should return true for all numbers
         */
        it('should return true for all numbers', () => {
            expect(isValidValue(0)).toBe(true);
            expect(isValidValue(1)).toBe(true);
            expect(isValidValue(-1)).toBe(true);
            expect(isValidValue(3.14)).toBe(true);
            expect(isValidValue(NaN)).toBe(true);
            expect(isValidValue(Infinity)).toBe(true);
        });

        /**
         * Test: should return true for all booleans
         */
        it('should return true for all booleans', () => {
            expect(isValidValue(true)).toBe(true);
            expect(isValidValue(false)).toBe(true);
        });

        /**
         * Test: should return true for dates
         */
        it('should return true for dates', () => {
            expect(isValidValue(new Date())).toBe(true);
            expect(isValidValue(new Date('2024-01-01'))).toBe(true);
        });

        /**
         * Test: should return false for empty arrays
         */
        it('should return false for empty arrays', () => {
            expect(isValidValue([])).toBe(false);
        });

        /**
         * Test: should return true for non-empty arrays
         */
        it('should return true for non-empty arrays', () => {
            expect(isValidValue([1])).toBe(true);
            expect(isValidValue([1, 2, 3])).toBe(true);
            expect(isValidValue(['a', 'b'])).toBe(true);
        });

        /**
         * Test: should return false for empty objects
         */
        it('should return false for empty objects', () => {
            expect(isValidValue({})).toBe(false);
        });

        /**
         * Test: should return true for valid objects
         */
        it('should return true for valid objects', () => {
            expect(isValidValue({ key: 'value' })).toBe(true);
            expect(isValidValue({ num: 0 })).toBe(true);
            expect(isValidValue({ bool: false })).toBe(true);
        });

        /**
         * Test: should return false for objects with all invalid values
         */
        it('should return false for objects with all invalid values', () => {
            expect(isValidValue({ key: '' })).toBe(false);
            expect(isValidValue({ key: null })).toBe(false);
            expect(isValidValue({ key: undefined })).toBe(false);
            expect(isValidValue({ a: '', b: null })).toBe(false);
        });

        /**
         * Test: should recursively validate nested objects
         */
        it('should recursively validate nested objects', () => {
            expect(isValidValue({ nested: { key: 'value' } })).toBe(true);
            expect(isValidValue({ nested: { key: '' } })).toBe(false);
            expect(isValidValue({ nested: {} })).toBe(false);
        });
    });

    describe('hasPrismaOperations', () => {
        /**
         * Test: should return true for objects with connect
         */
        it('should return true for objects with connect', () => {
            expect(hasPrismaOperations({ connect: { id: 1 } })).toBe(true);
        });

        /**
         * Test: should return true for objects with create
         */
        it('should return true for objects with create', () => {
            expect(hasPrismaOperations({ create: { name: 'John' } })).toBe(true);
        });

        /**
         * Test: should return true for objects with update
         */
        it('should return true for objects with update', () => {
            expect(hasPrismaOperations({ update: { name: 'Jane' } })).toBe(true);
        });

        /**
         * Test: should return true for objects with delete
         */
        it('should return true for objects with delete', () => {
            expect(hasPrismaOperations({ delete: true })).toBe(true);
        });

        /**
         * Test: should return true for objects with disconnect
         */
        it('should return true for objects with disconnect', () => {
            expect(hasPrismaOperations({ disconnect: true })).toBe(true);
        });

        /**
         * Test: should return true for objects with set
         */
        it('should return true for objects with set', () => {
            expect(hasPrismaOperations({ set: [{ id: 1 }] })).toBe(true);
        });

        /**
         * Test: should return true for objects with upsert
         */
        it('should return true for objects with upsert', () => {
            expect(hasPrismaOperations({ upsert: { create: {}, update: {} } })).toBe(true);
        });

        /**
         * Test: should return true for objects with connectOrCreate
         */
        it('should return true for objects with connectOrCreate', () => {
            expect(hasPrismaOperations({ connectOrCreate: { where: {}, create: {} } })).toBe(true);
        });

        /**
         * Test: should return false for regular objects
         */
        it('should return false for regular objects', () => {
            expect(hasPrismaOperations({ name: 'John' })).toBe(false);
            expect(hasPrismaOperations({ id: 1, name: 'John' })).toBe(false);
        });

        /**
         * Test: should return false for empty objects
         */
        it('should return false for empty objects', () => {
            expect(hasPrismaOperations({})).toBe(false);
        });

        /**
         * Test: should return false for arrays
         */
        it('should return false for arrays', () => {
            expect(hasPrismaOperations([])).toBe(false);
            expect(hasPrismaOperations([{ connect: { id: 1 } }])).toBe(false);
        });

        /**
         * Test: should return false for null and undefined
         */
        it('should return false for null and undefined', () => {
            expect(hasPrismaOperations(null)).toBe(false);
            expect(hasPrismaOperations(undefined)).toBe(false);
        });

        /**
         * Test: should return false for primitives
         */
        it('should return false for primitives', () => {
            expect(hasPrismaOperations('connect')).toBe(false);
            expect(hasPrismaOperations(123)).toBe(false);
            expect(hasPrismaOperations(true)).toBe(false);
        });

        /**
         * Test: should detect multiple Prisma operations
         */
        it('should detect multiple Prisma operations', () => {
            expect(hasPrismaOperations({ connect: { id: 1 }, create: { name: 'John' } })).toBe(true);
        });
    });

    describe('isNonEmptyArray', () => {
        /**
         * Test: should return true for non-empty arrays
         */
        it('should return true for non-empty arrays', () => {
            expect(isNonEmptyArray([1])).toBe(true);
            expect(isNonEmptyArray([1, 2, 3])).toBe(true);
            expect(isNonEmptyArray(['a', 'b'])).toBe(true);
            expect(isNonEmptyArray([{ key: 'value' }])).toBe(true);
        });

        /**
         * Test: should return false for empty arrays
         */
        it('should return false for empty arrays', () => {
            expect(isNonEmptyArray([])).toBe(false);
        });

        /**
         * Test: should return false for non-arrays
         */
        it('should return false for non-arrays', () => {
            expect(isNonEmptyArray(null)).toBe(false);
            expect(isNonEmptyArray(undefined)).toBe(false);
            expect(isNonEmptyArray('string')).toBe(false);
            expect(isNonEmptyArray(123)).toBe(false);
            expect(isNonEmptyArray({})).toBe(false);
            expect(isNonEmptyArray({ length: 1 })).toBe(false);
        });

        /**
         * Test: should work as type guard
         */
        it('should work as type guard', () => {
            const value: any = [1, 2, 3];
            if (isNonEmptyArray<number>(value)) {
                // TypeScript should know value is number[] here
                expect(value[0]).toBe(1);
            }
        });
    });

    describe('shouldSkipField', () => {
        /**
         * Test: should always skip createdAt
         */
        it('should always skip createdAt', () => {
            expect(shouldSkipField('createdAt', new Date())).toBe(true);
            expect(shouldSkipField('createdAt', '2024-01-01')).toBe(true);
            expect(shouldSkipField('createdAt', null)).toBe(true);
            expect(shouldSkipField('createdAt', undefined)).toBe(true);
        });

        /**
         * Test: should skip updatedAt when undefined
         */
        it('should skip updatedAt when undefined', () => {
            expect(shouldSkipField('updatedAt', undefined)).toBe(true);
        });

        /**
         * Test: should skip updatedAt when it is an object
         */
        it('should skip updatedAt when it is an object', () => {
            expect(shouldSkipField('updatedAt', { set: new Date() })).toBe(true);
            expect(shouldSkipField('updatedAt', {})).toBe(true);
        });

        /**
         * Test: should skip updatedAt when it is a date (Date is an object)
         */
        it('should skip updatedAt when it is a date (Date is an object)', () => {
            expect(shouldSkipField('updatedAt', new Date())).toBe(true);
        });

        /**
         * Test: should not skip updatedAt when it is a string
         */
        it('should not skip updatedAt when it is a string', () => {
            expect(shouldSkipField('updatedAt', '2024-01-01')).toBe(false);
        });

        /**
         * Test: should skip empty objects
         */
        it('should skip empty objects', () => {
            expect(shouldSkipField('data', {})).toBe(true);
            expect(shouldSkipField('metadata', {})).toBe(true);
        });

        /**
         * Test: should skip objects with Prisma operations
         */
        it('should skip objects with Prisma operations', () => {
            expect(shouldSkipField('relation', { connect: { id: 1 } })).toBe(true);
            expect(shouldSkipField('relation', { create: { name: 'John' } })).toBe(true);
            expect(shouldSkipField('relation', { update: { name: 'Jane' } })).toBe(true);
        });

        /**
         * Test: should not skip regular fields
         */
        it('should not skip regular fields', () => {
            expect(shouldSkipField('name', 'John')).toBe(false);
            expect(shouldSkipField('age', 30)).toBe(false);
            expect(shouldSkipField('active', true)).toBe(false);
            expect(shouldSkipField('data', { key: 'value' })).toBe(false);
        });

        /**
         * Test: should not skip arrays
         */
        it('should not skip arrays', () => {
            expect(shouldSkipField('tags', [])).toBe(false);
            expect(shouldSkipField('tags', ['tag1', 'tag2'])).toBe(false);
        });

        /**
         * Test: should not skip null values
         */
        it('should not skip null values', () => {
            expect(shouldSkipField('name', null)).toBe(false);
        });

        /**
         * Test: should not skip zero values
         */
        it('should not skip zero values', () => {
            expect(shouldSkipField('count', 0)).toBe(false);
        });

        /**
         * Test: should not skip false values
         */
        it('should not skip false values', () => {
            expect(shouldSkipField('active', false)).toBe(false);
        });
    });
});
