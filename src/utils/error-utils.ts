/**
 * Error handling utilities for consistent error management across the codebase
 * @module error-utils
 */

/**
 * Logs an error with consistent formatting
 * @param context - The context where the error occurred (e.g., method name, operation)
 * @param error - The error object
 * @param additionalInfo - Optional additional information to include in the log
 */
export function logError(
    context: string,
    error: Error,
    additionalInfo?: Record<string, any>
): void {
    const errorMessage = error.message;

    // Log to console.error with consistent formatting
    console.error(`❌ Error in ${context}:`, errorMessage);
    
    // Log additional details if provided
    if (additionalInfo && Object.keys(additionalInfo).length > 0) {
        console.error('Additional info:', additionalInfo);
    }
}

/**
 * Checks if an error is a unique constraint violation
 * Detects Prisma unique constraint errors (P2002) and database-specific errors
 * @param error - The error to check
 * @returns True if the error is a unique constraint violation
 */
export function isUniqueConstraintError(error: Error): boolean {
    const errorMsg = error.message;
    
    // Check for Prisma P2002 error code (unique constraint violation)
    if (errorMsg.includes('P2002')) {
        return true;
    }
    
    // Check for common unique constraint error messages
    if (errorMsg.includes('Unique constraint')) {
        return true;
    }
    
    // Check for database-specific unique constraint errors
    if (errorMsg.includes('duplicate key') || 
        errorMsg.includes('UNIQUE constraint') ||
        errorMsg.includes('unique violation') ||
        errorMsg.includes('Duplicate entry')) {
        return true;
    }
    
    return false;
}

/**
 * Handles unique constraint violations with retry logic
 * Attempts the operation first, and if it fails with a unique constraint error,
 * retries with the provided retry operation (typically with skipDuplicates)
 * 
 * @template T - The return type of the operation
 * @param operation - The primary operation to execute
 * @param retryWithSkipDuplicates - The retry operation (typically with skipDuplicates=true)
 * @param context - The context for error logging
 * @returns The result of the operation or retry
 * @throws The original error if it's not a unique constraint error, or the retry error if retry fails
 */
export async function handleUniqueConstraintError<T>(
    operation: () => Promise<T>,
    retryWithSkipDuplicates: () => Promise<T>,
    context: string
): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (isUniqueConstraintError(error as Error)) {
            // Retry with skipDuplicates on unique constraint error
            try {
                const result = await retryWithSkipDuplicates();
                return result;
            } catch (retryError) {
                logError(`${context} (retry)`, retryError as Error);
                throw retryError;
            }
        } else {
            logError(context, error as Error);
            throw error;
        }
    }
}

/**
 * Wraps an operation with error handling and logging
 * Optionally provides a fallback operation if the primary operation fails
 * 
 * @template T - The return type of the operation
 * @param operation - The primary operation to execute
 * @param context - The context for error logging
 * @param fallback - Optional fallback operation to execute if primary fails
 * @returns The result of the operation or fallback
 * @throws The error if no fallback is provided or fallback also fails
 */
export async function withErrorHandling<T>(
    operation: () => Promise<T>,
    context: string,
    fallback?: () => Promise<T>
): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        logError(context, error as Error);
        
        if (fallback) {
            try {
                // Attempt fallback operation
                return await fallback();
            } catch (fallbackError) {
                logError(`${context} (fallback)`, fallbackError as Error);
                throw fallbackError;
            }
        }
        
        throw error;
    }
}
