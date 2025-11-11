/**
 * Test suite for BaseEntityHelpers
 * Tests internal helper methods for data sanitization and query building
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import BaseEntityHelpers from '../src/base-entity-helpers';
import { configurePrisma, resetPrismaConfiguration } from '../src/config';
import { mockPrismaClient } from './__mocks__/prisma-client.mock';

describe('BaseEntityHelpers', () => {
    beforeEach(() => {
        configurePrisma(mockPrismaClient as any);
    });

    afterEach(() => {
        resetPrismaConfiguration();
    });

    describe('sanitizeKeysRecursive', () => {
        /**
         * Test: should remove leading underscores from keys
         */
        it('should remove leading underscores from keys', () => {
            const input = {
                _name: 'John',
                __email: 'john@example.com',
                age: 30
            };
            const result = BaseEntityHelpers.sanitizeKeysRecursive(input);
            
            expect(result).toEqual({
                name: 'John',
                email: 'john@example.com',
                age: 30
            });
        });

        /**
         * Test: should handle nested objects
         */
        it('should handle nested objects', () => {
            const input = {
                _user: {
                    _name: 'John',
                    _profile: {
                        __bio: 'Developer'
                    }
                }
            };
            const result = BaseEntityHelpers.sanitizeKeysRecursive(input);
            
            expect(result).toEqual({
                user: {
                    name: 'John',
                    profile: {
                        bio: 'Developer'
                    }
                }
            });
        });

        /**
         * Test: should handle arrays
         */
        it('should handle arrays', () => {
            const input = {
                _users: [
                    { _name: 'John' },
                    { _name: 'Jane' }
                ]
            };
            const result = BaseEntityHelpers.sanitizeKeysRecursive(input);
            
            expect(result).toEqual({
                users: [
                    { name: 'John' },
                    { name: 'Jane' }
                ]
            });
        });

        /**
         * Test: should return primitives unchanged
         */
        it('should return primitives unchanged', () => {
            expect(BaseEntityHelpers.sanitizeKeysRecursive('test')).toBe('test');
            expect(BaseEntityHelpers.sanitizeKeysRecursive(123)).toBe(123);
            expect(BaseEntityHelpers.sanitizeKeysRecursive(true)).toBe(true);
            expect(BaseEntityHelpers.sanitizeKeysRecursive(null)).toBe(null);
        });
    });

    describe('pruneUpdatePayload', () => {
        /**
         * Test: should remove empty objects
         */
        it('should remove empty objects', () => {
            const input = {
                name: 'John',
                emptyField: {},
                age: 30
            };
            const result = BaseEntityHelpers.pruneUpdatePayload(input);
            
            expect(result).toEqual({
                name: 'John',
                age: 30
            });
        });

        /**
         * Test: should remove createdAt
         */
        it('should remove createdAt', () => {
            const input = {
                name: 'John',
                createdAt: new Date(),
                age: 30
            };
            const result = BaseEntityHelpers.pruneUpdatePayload(input);
            
            expect(result).toEqual({
                name: 'John',
                age: 30
            });
        });

        /**
         * Test: should remove updatedAt if it is an object
         */
        it('should remove updatedAt if it is an object', () => {
            const input = {
                name: 'John',
                updatedAt: { create: {} },
                age: 30
            };
            const result = BaseEntityHelpers.pruneUpdatePayload(input);
            
            expect(result).toEqual({
                name: 'John',
                age: 30
            });
        });

        /**
         * Test: should keep non-empty objects
         */
        it('should keep non-empty objects', () => {
            const input = {
                name: 'John',
                profile: { bio: 'Developer' },
                age: 30
            };
            const result = BaseEntityHelpers.pruneUpdatePayload(input);
            
            expect(result).toEqual({
                name: 'John',
                profile: { bio: 'Developer' },
                age: 30
            });
        });
    });

    describe('shouldSkipField', () => {
        /**
         * Test: should skip id field
         */
        it('should skip id field', () => {
            expect(BaseEntityHelpers.shouldSkipField('id', {})).toBe(true);
        });

        /**
         * Test: should skip createdAt field
         */
        it('should skip createdAt field', () => {
            expect(BaseEntityHelpers.shouldSkipField('createdAt', {})).toBe(true);
        });

        /**
         * Test: should skip updatedAt field
         */
        it('should skip updatedAt field', () => {
            expect(BaseEntityHelpers.shouldSkipField('updatedAt', {})).toBe(true);
        });

        /**
         * Test: should not skip regular fields
         */
        it('should not skip regular fields', () => {
            expect(BaseEntityHelpers.shouldSkipField('name', 'John')).toBe(false);
            expect(BaseEntityHelpers.shouldSkipField('age', 30)).toBe(false);
        });

        /**
         * Test: should skip empty objects
         */
        it('should skip empty objects', () => {
            expect(BaseEntityHelpers.shouldSkipField('profile', {})).toBe(true);
        });

        /**
         * Test: should not skip non-empty objects
         */
        it('should not skip non-empty objects', () => {
            expect(BaseEntityHelpers.shouldSkipField('profile', { bio: 'Developer' })).toBe(false);
        });
    });

    describe('escapeValue', () => {
        /**
         * Test: should escape string values
         */
        it('should escape string values', () => {
            const result = BaseEntityHelpers.escapeValue("John's");
            expect(result).toBe("'John''s'");
        });

        /**
         * Test: should handle null values
         */
        it('should handle null values', () => {
            const result = BaseEntityHelpers.escapeValue(null);
            expect(result).toBe('NULL');
        });

        /**
         * Test: should handle undefined values
         */
        it('should handle undefined values', () => {
            const result = BaseEntityHelpers.escapeValue(undefined);
            expect(result).toBe('NULL');
        });

        /**
         * Test: should handle boolean values
         */
        it('should handle boolean values', () => {
            const trueResult = BaseEntityHelpers.escapeValue(true);
            const falseResult = BaseEntityHelpers.escapeValue(false);
            // SQLite uses 1/0, PostgreSQL/MySQL use TRUE/FALSE
            expect(['TRUE', '1', 'true']).toContain(trueResult);
            expect(['FALSE', '0', 'false']).toContain(falseResult);
        });

        /**
         * Test: should handle number values
         */
        it('should handle number values', () => {
            expect(BaseEntityHelpers.escapeValue(123)).toBe('123');
            expect(BaseEntityHelpers.escapeValue(3.14)).toBe('3.14');
        });

        /**
         * Test: should handle Date values
         */
        it('should handle Date values', () => {
            const date = new Date('2024-01-01T00:00:00.000Z');
            const result = BaseEntityHelpers.escapeValue(date);
            expect(result).toContain('2024-01-01');
        });
    });
});
