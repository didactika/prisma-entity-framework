/**
 * Validation Utilities Module
 * 
 * Provides common type checking and validation functions used throughout the codebase.
 * Consolidates repeated validation patterns into reusable utilities.
 * 
 * @module validation-utils
 */

/**
 * Checks if a value is a plain object (not null, not an array)
 * 
 * @param value - The value to check
 * @returns True if the value is a plain object, false otherwise
 * 
 * @example
 * ```typescript
 * isObject({ key: 'value' })  // true
 * isObject([1, 2, 3])         // false
 * isObject(null)              // false
 * isObject('string')          // false
 * ```
 */
export function isObject(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks if an object is empty (has no keys)
 * 
 * @param obj - The object to check
 * @returns True if the object has no keys, false otherwise
 * 
 * @example
 * ```typescript
 * isEmpty({})              // true
 * isEmpty({ key: 'val' })  // false
 * ```
 */
export function isEmpty(obj: Record<string, any>): boolean {
    return Object.keys(obj).length === 0;
}

/**
 * Checks if a value is valid for filtering operations
 * 
 * A value is considered invalid if it is:
 * - null or undefined
 * - An empty string (including whitespace-only strings)
 * - An empty array
 * - An object where all nested values are invalid
 * 
 * @param value - The value to validate
 * @returns True if the value is valid for filtering, false otherwise
 * 
 * @remarks
 * - Numbers (including 0), booleans, and dates are always considered valid
 * - For objects, recursively validates all nested values
 * - For arrays, checks if the array has at least one element
 * 
 * @example
 * ```typescript
 * isValidValue('hello')           // true
 * isValidValue('')                // false
 * isValidValue('   ')             // false
 * isValidValue(0)                 // true
 * isValidValue(false)             // true
 * isValidValue([])                // false
 * isValidValue([1, 2])            // true
 * isValidValue({ key: 'val' })    // true
 * isValidValue({ key: '' })       // false
 * isValidValue(null)              // false
 * isValidValue(undefined)         // false
 * ```
 */
export function isValidValue(value: any): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (typeof value === 'boolean') return true;
    if (typeof value === 'number') return true;
    if (value instanceof Date) return true;
    if (Array.isArray(value)) return value.length > 0;

    if (typeof value === 'object') {
        const entries = Object.entries(value);
        if (entries.length === 0) return false;
        for (const [, val] of entries) {
            if (!isValidValue(val)) return false;
        }
        return true;
    }

    return true;
}

/**
 * Checks if an object contains Prisma operation keys
 * 
 * Prisma operation keys include: connect, create, update, delete, disconnect, set, upsert, connectOrCreate
 * 
 * @param value - The value to check
 * @returns True if the value is an object containing Prisma operation keys, false otherwise
 * 
 * @example
 * ```typescript
 * hasPrismaOperations({ connect: { id: 1 } })           // true
 * hasPrismaOperations({ create: { name: 'John' } })     // true
 * hasPrismaOperations({ name: 'John' })                 // false
 * hasPrismaOperations([])                               // false
 * hasPrismaOperations(null)                             // false
 * ```
 */
export function hasPrismaOperations(value: any): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

    const prismaOperationKeys = new Set([
        'connect',
        'create',
        'update',
        'delete',
        'disconnect',
        'set',
        'upsert',
        'connectOrCreate'
    ]);

    return Object.keys(value).some(key => prismaOperationKeys.has(key));
}

/**
 * Validates that an array is non-empty
 * 
 * Type guard that narrows the type to a non-empty array
 * 
 * @param value - The value to check
 * @returns True if the value is a non-empty array, false otherwise
 * 
 * @example
 * ```typescript
 * isNonEmptyArray([1, 2, 3])  // true
 * isNonEmptyArray([])         // false
 * isNonEmptyArray(null)       // false
 * isNonEmptyArray('string')   // false
 * ```
 */
export function isNonEmptyArray<T>(value: any): value is T[] {
    return Array.isArray(value) && value.length > 0;
}

/**
 * Checks if a field should be skipped in update operations
 * 
 * A field should be skipped if:
 * - It is 'createdAt' (always skip)
 * - It is 'updatedAt' and the value is undefined or an object (Prisma operation)
 * - The value is an empty object
 * - The value contains Prisma operation keys
 * 
 * @param key - The field name
 * @param value - The field value
 * @returns True if the field should be skipped, false otherwise
 * 
 * @example
 * ```typescript
 * shouldSkipField('createdAt', new Date())              // true
 * shouldSkipField('updatedAt', undefined)               // true
 * shouldSkipField('updatedAt', { set: new Date() })     // true
 * shouldSkipField('name', 'John')                       // false
 * shouldSkipField('data', {})                           // true
 * shouldSkipField('relation', { connect: { id: 1 } })   // true
 * ```
 */
export function shouldSkipField(key: string, value: any): boolean {
    // Skip createdAt always
    if (key === 'createdAt') return true;

    // Skip updatedAt if it's undefined or an object (Prisma operation)
    if (key === 'updatedAt' && (value === undefined || typeof value === 'object')) return true;

    // Skip empty objects
    if (isObject(value) && isEmpty(value)) return true;

    // Skip objects that have Prisma operation keys
    if (hasPrismaOperations(value)) return true;

    return false;
}
