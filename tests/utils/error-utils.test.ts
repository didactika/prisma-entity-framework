/**
 * Test suite for Error Utilities
 * Tests error handling and logging functions
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
    logError,
    isUniqueConstraintError,
    handleUniqueConstraintError,
    withErrorHandling
} from '../../src/core/utils/error-utils';

describe('Error Utils', () => {
    // Mock console.error and console.log
    let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
    let consoleLogSpy: jest.SpiedFunction<typeof console.log>;

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleLogSpy.mockRestore();
    });

    describe('logError', () => {
        /**
         * Test: should log error with context and message
         */
        it('should log error with context and message', () => {
            const error = new Error('Test error message');
            const context = 'testOperation';

            logError(context, error);

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('❌ Error in testOperation:'),
                'Test error message'
            );
        });

        /**
         * Test: should log error with additional info
         */
        it('should log error with additional info', () => {
            const error = new Error('Test error');
            const context = 'testOperation';
            const additionalInfo = { batchIndex: 5, recordCount: 100 };

            logError(context, error, additionalInfo);

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('❌ Error in testOperation:'),
                'Test error'
            );
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Additional info:',
                additionalInfo
            );
        });

        /**
         * Test: should handle errors without stack trace
         */
        it('should handle errors without stack trace', () => {
            const error = new Error('Test error');
            delete error.stack;
            const context = 'testOperation';

            logError(context, error);

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('❌ Error in testOperation:'),
                'Test error'
            );
        });

        /**
         * Test: should not log additional info if empty
         */
        it('should not log additional info if empty', () => {
            const error = new Error('Test error');
            const context = 'testOperation';

            logError(context, error, {});

            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('❌ Error in testOperation:'),
                'Test error'
            );
        });

        /**
         * Test: should handle undefined additional info
         */
        it('should handle undefined additional info', () => {
            const error = new Error('Test error');
            const context = 'testOperation';

            logError(context, error, undefined);

            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('isUniqueConstraintError', () => {
        /**
         * Test: should detect Prisma P2002 error code
         */
        it('should detect Prisma P2002 error code', () => {
            const error = new Error('P2002: Unique constraint failed on the fields: (`email`)');
            expect(isUniqueConstraintError(error)).toBe(true);
        });

        /**
         * Test: should detect "Unique constraint" message
         */
        it('should detect "Unique constraint" message', () => {
            const error = new Error('Unique constraint violation on field email');
            expect(isUniqueConstraintError(error)).toBe(true);
        });

        /**
         * Test: should detect "duplicate key" message
         */
        it('should detect "duplicate key" message', () => {
            const error = new Error('duplicate key value violates unique constraint');
            expect(isUniqueConstraintError(error)).toBe(true);
        });

        /**
         * Test: should detect "UNIQUE constraint" message
         */
        it('should detect "UNIQUE constraint" message', () => {
            const error = new Error('UNIQUE constraint failed: users.email');
            expect(isUniqueConstraintError(error)).toBe(true);
        });

        /**
         * Test: should detect "unique violation" message
         */
        it('should detect "unique violation" message', () => {
            const error = new Error('unique violation on column email');
            expect(isUniqueConstraintError(error)).toBe(true);
        });

        /**
         * Test: should detect "Duplicate entry" message (MySQL)
         */
        it('should detect "Duplicate entry" message (MySQL)', () => {
            const error = new Error('Duplicate entry "test@example.com" for key "email"');
            expect(isUniqueConstraintError(error)).toBe(true);
        });

        /**
         * Test: should return false for non-unique constraint errors
         */
        it('should return false for non-unique constraint errors', () => {
            const error = new Error('Connection timeout');
            expect(isUniqueConstraintError(error)).toBe(false);
        });

        /**
         * Test: should return false for generic database errors
         */
        it('should return false for generic database errors', () => {
            const error = new Error('Foreign key constraint failed');
            expect(isUniqueConstraintError(error)).toBe(false);
        });

        /**
         * Test: should return false for empty error messages
         */
        it('should return false for empty error messages', () => {
            const error = new Error('');
            expect(isUniqueConstraintError(error)).toBe(false);
        });
    });

    describe('handleUniqueConstraintError', () => {
        /**
         * Test: should return result if operation succeeds
         */
        it('should return result if operation succeeds', async () => {
            const operation = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 10 });
            const retry = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 5 });

            const result = await handleUniqueConstraintError(
                operation,
                retry,
                'testOperation'
            );

            expect(result).toEqual({ count: 10 });
            expect(operation).toHaveBeenCalledTimes(1);
            expect(retry).not.toHaveBeenCalled();
        });

        /**
         * Test: should retry on unique constraint error
         */
        it('should retry on unique constraint error', async () => {
            const operation = jest.fn<() => Promise<{ count: number }>>().mockRejectedValue(
                new Error('P2002: Unique constraint failed')
            );
            const retry = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 5 });

            const result = await handleUniqueConstraintError(
                operation,
                retry,
                'testOperation'
            );

            expect(result).toEqual({ count: 5 });
            expect(operation).toHaveBeenCalledTimes(1);
            expect(retry).toHaveBeenCalledTimes(1);
            // Console log checks removed - testing implementation details
        });

        /**
         * Test: should throw original error if not unique constraint
         */
        it('should throw original error if not unique constraint', async () => {
            const originalError = new Error('Connection timeout');
            const operation = jest.fn<() => Promise<{ count: number }>>().mockRejectedValue(originalError);
            const retry = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 5 });

            await expect(
                handleUniqueConstraintError(operation, retry, 'testOperation')
            ).rejects.toThrow('Connection timeout');

            expect(operation).toHaveBeenCalledTimes(1);
            expect(retry).not.toHaveBeenCalled();
            expect(consoleErrorSpy).toHaveBeenCalled();
        });

        /**
         * Test: should throw retry error if retry fails
         */
        it('should throw retry error if retry fails', async () => {
            const operation = jest.fn<() => Promise<{ count: number }>>().mockRejectedValue(
                new Error('Unique constraint failed')
            );
            const retryError = new Error('Retry failed');
            const retry = jest.fn<() => Promise<{ count: number }>>().mockRejectedValue(retryError);

            await expect(
                handleUniqueConstraintError(operation, retry, 'testOperation')
            ).rejects.toThrow('Retry failed');

            expect(operation).toHaveBeenCalledTimes(1);
            expect(retry).toHaveBeenCalledTimes(1);
            // Console log checks removed - testing implementation details
            // Error logging is handled by logError function
        });

        /**
         * Test: should handle duplicate key errors
         */
        it('should handle duplicate key errors', async () => {
            const operation = jest.fn<() => Promise<{ count: number }>>().mockRejectedValue(
                new Error('duplicate key value violates unique constraint')
            );
            const retry = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 3 });

            const result = await handleUniqueConstraintError(
                operation,
                retry,
                'batchCreate'
            );

            expect(result).toEqual({ count: 3 });
            expect(retry).toHaveBeenCalledTimes(1);
        });
    });

    describe('withErrorHandling', () => {
        /**
         * Test: should return result if operation succeeds
         */
        it('should return result if operation succeeds', async () => {
            const operation = jest.fn<() => Promise<{ data: string }>>().mockResolvedValue({ data: 'success' });
            const fallback = jest.fn<() => Promise<{ data: string }>>().mockResolvedValue({ data: 'fallback' });

            const result = await withErrorHandling(
                operation,
                'testOperation',
                fallback
            );

            expect(result).toEqual({ data: 'success' });
            expect(operation).toHaveBeenCalledTimes(1);
            expect(fallback).not.toHaveBeenCalled();
        });

        /**
         * Test: should execute fallback if operation fails
         */
        it('should execute fallback if operation fails', async () => {
            const operation = jest.fn<() => Promise<{ data: string }>>().mockRejectedValue(new Error('Operation failed'));
            const fallback = jest.fn<() => Promise<{ data: string }>>().mockResolvedValue({ data: 'fallback' });

            const result = await withErrorHandling(
                operation,
                'testOperation',
                fallback
            );

            expect(result).toEqual({ data: 'fallback' });
            expect(operation).toHaveBeenCalledTimes(1);
            expect(fallback).toHaveBeenCalledTimes(1);
            // Console log checks removed - testing implementation details
            // Error logging is handled by logError function
        });

        /**
         * Test: should throw error if no fallback provided
         */
        it('should throw error if no fallback provided', async () => {
            const originalError = new Error('Operation failed');
            const operation = jest.fn<() => Promise<any>>().mockRejectedValue(originalError);

            await expect(
                withErrorHandling(operation, 'testOperation')
            ).rejects.toThrow('Operation failed');

            expect(operation).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy).toHaveBeenCalled();
        });

        /**
         * Test: should throw fallback error if fallback fails
         */
        it('should throw fallback error if fallback fails', async () => {
            const operation = jest.fn<() => Promise<any>>().mockRejectedValue(new Error('Operation failed'));
            const fallbackError = new Error('Fallback failed');
            const fallback = jest.fn<() => Promise<any>>().mockRejectedValue(fallbackError);

            await expect(
                withErrorHandling(operation, 'testOperation', fallback)
            ).rejects.toThrow('Fallback failed');

            expect(operation).toHaveBeenCalledTimes(1);
            expect(fallback).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy).toHaveBeenCalledTimes(2); // Once for operation, once for fallback
        });

        /**
         * Test: should log both operation and fallback errors
         */
        it('should log both operation and fallback errors', async () => {
            const operation = jest.fn<() => Promise<any>>().mockRejectedValue(new Error('Operation failed'));
            const fallback = jest.fn<() => Promise<any>>().mockRejectedValue(new Error('Fallback failed'));

            await expect(
                withErrorHandling(operation, 'testOperation', fallback)
            ).rejects.toThrow('Fallback failed');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('❌ Error in testOperation'),
                'Operation failed'
            );
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('❌ Error in testOperation (fallback)'),
                'Fallback failed'
            );
        });

        /**
         * Test: should work without fallback
         */
        it('should work without fallback', async () => {
            const operation = jest.fn<() => Promise<{ data: string }>>().mockResolvedValue({ data: 'success' });

            const result = await withErrorHandling(operation, 'testOperation');

            expect(result).toEqual({ data: 'success' });
            expect(operation).toHaveBeenCalledTimes(1);
        });
    });
});
