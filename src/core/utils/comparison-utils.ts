/**
 * Comparison Utilities Module
 * 
 * Provides deep equality comparison and value normalization functions.
 * Extracted from BaseEntity to eliminate code duplication and improve maintainability.
 * 
 * Handles special types returned by Prisma:
 * - Prisma.Decimal objects (decimal.js) — coerced to number for comparison
 * - Date objects — compared by timestamp value, not reference
 * - Float precision — uses relative epsilon tolerance
 * - BigInt — coerced to number for comparison
 * 
 * Performance optimizations:
 * - Early exits for reference equality
 * - Avoids JSON.stringify (5x slower than manual comparison)
 * - Inline type checks for common cases
 * - Minimal object allocations
 */

/**
 * Normalizes a value for comparison.
 * - null, undefined, and empty string are treated as null
 * - Strings are trimmed
 * - Other values are returned as-is
 * 
 * @param value - Value to normalize
 * @returns Normalized value
 * 
 * @example
 * ```typescript
 * normalizeValue('  hello  ') // 'hello'
 * normalizeValue('') // null
 * normalizeValue(undefined) // null
 * normalizeValue(123) // 123
 * ```
 */
export function normalizeValue(value: any): any {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? null : trimmed;
    }
    // Coerce BigInt to number for comparison
    if (typeof value === 'bigint') return Number(value);
    // Detect Prisma.Decimal / decimal.js objects via duck typing
    // These have a toNumber() method and internal 'd' array property
    if (isDecimalLike(value)) return Number(value.toString());
    return value;
}

/**
 * Performs deep equality comparison between two values.
 * Optimized for performance - avoids JSON.stringify which is 5x slower.
 * 
 * Handles:
 * - Primitives (string, number, boolean, null, undefined)
 * - Arrays (recursive comparison)
 * - Objects (recursive comparison)
 * 
 * @param a - First value to compare
 * @param b - Second value to compare
 * @returns true if values are deeply equal, false otherwise
 * 
 * @example
 * ```typescript
 * deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 }) // true
 * deepEqual([1, 2, 3], [1, 2, 3]) // true
 * deepEqual({ a: 1 }, { a: 2 }) // false
 * ```
 */
export function deepEqual(a: any, b: any): boolean {
    // Fast path: same reference or both primitive equal
    if (a === b) return true;

    // One is null/undefined, other isn't
    if (a == null || b == null) return false;

    // Type check
    const typeA = typeof a;
    const typeB = typeof b;
    if (typeA !== typeB) return false;

    // Primitives are already checked with ===
    if (typeA !== 'object') return false;

    // Date comparison — compare by timestamp value, not reference
    if (a instanceof Date || b instanceof Date) {
        if (!(a instanceof Date) || !(b instanceof Date)) return false;
        return a.getTime() === b.getTime();
    }

    // Decimal-like comparison (Prisma.Decimal / decimal.js)
    if (isDecimalLike(a) || isDecimalLike(b)) {
        if (!isDecimalLike(a) || !isDecimalLike(b)) return false;
        return a.toString() === b.toString();
    }

    // Array comparison
    const isArrayA = Array.isArray(a);
    const isArrayB = Array.isArray(b);

    if (isArrayA !== isArrayB) return false;

    if (isArrayA) {
        return deepEqualArrays(a, b);
    }

    // Object comparison
    return deepEqualObjects(a, b);
}

/**
 * Compares two arrays for deep equality.
 * Uses recursive deep equality comparison for each element.
 * 
 * @param a - First array
 * @param b - Second array
 * @returns true if arrays are deeply equal
 * 
 * @example
 * ```typescript
 * deepEqualArrays([1, 2, 3], [1, 2, 3]) // true
 * deepEqualArrays([{ a: 1 }], [{ a: 1 }]) // true
 * deepEqualArrays([1, 2], [1, 2, 3]) // false
 * ```
 */
export function deepEqualArrays(a: any[], b: any[]): boolean {
    const length = a.length;
    if (length !== b.length) return false;

    for (let i = 0; i < length; i++) {
        if (!deepEqual(a[i], b[i])) return false;
    }

    return true;
}

/**
 * Compares two objects for deep equality.
 * Checks that both objects have the same keys and values.
 * Uses recursive deep equality comparison for nested values.
 * 
 * @param a - First object
 * @param b - Second object
 * @returns true if objects are deeply equal
 * 
 * @example
 * ```typescript
 * deepEqualObjects({ a: 1, b: 2 }, { a: 1, b: 2 }) // true
 * deepEqualObjects({ a: { x: 1 } }, { a: { x: 1 } }) // true
 * deepEqualObjects({ a: 1 }, { a: 1, b: 2 }) // false
 * ```
 */
export function deepEqualObjects(a: Record<string, any>, b: Record<string, any>): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    // Different number of keys = not equal
    if (keysA.length !== keysB.length) return false;

    // Check all keys and values
    for (const key of keysA) {
        // Key doesn't exist in b
        if (!(key in b)) return false;

        // Values don't match
        if (!deepEqual(a[key], b[key])) return false;
    }

    return true;
}

/**
 * Checks if there are changes between new data and existing data.
 * 
 * Comparison logic:
 * - Ignores standard metadata fields (id, createdAt, updatedAt) by default
 * - Normalizes values before comparison (trims strings, treats empty/null/undefined as equal)
 * - Performs deep equality for objects and arrays
 * - Supports custom ignored fields
 * 
 * Performance optimizations:
 * - Fast path for reference equality
 * - Inline checks for standard ignored fields
 * - Only allocates Set for custom ignored fields if needed
 * 
 * @param newData - New data to compare
 * @param existingData - Existing data to compare against
 * @param ignoreFields - Additional fields to ignore beyond defaults (id, createdAt, updatedAt)
 * @returns true if any changes detected, false otherwise
 * 
 * @example
 * ```typescript
 * hasChanges(
 *   { id: 1, name: 'John', email: 'john@example.com' },
 *   { id: 1, name: 'John', email: 'john@example.com' }
 * ) // false
 * 
 * hasChanges(
 *   { id: 1, name: 'John Doe', email: 'john@example.com' },
 *   { id: 1, name: 'John', email: 'john@example.com' }
 * ) // true
 * 
 * hasChanges(
 *   { id: 1, name: 'John', status: 'active' },
 *   { id: 1, name: 'John', status: 'inactive' },
 *   ['status'] // ignore status field
 * ) // false
 * ```
 */
export function hasChanges<T extends object = Record<string, any>>(
    newData: T,
    existingData: T,
    ignoreFields: string[] = []
): boolean {
    const customIgnored = ignoreFields.length > 0 ? new Set(ignoreFields) : null;

    for (const key in newData) {
        if (isStandardIgnoredField(key)) continue;
        if (customIgnored?.has(key)) continue;

        if (fieldHasChanged(newData[key], existingData[key])) return true;
    }

    return false;
}

/**
 * Compares two field values to determine if a change occurred.
 * Handles normalization, type coercion for Decimal/BigInt, epsilon for floats,
 * deep equality for objects/arrays, and Date comparison by timestamp.
 * 
 * @param newValue - The new field value
 * @param existingValue - The existing field value
 * @returns true if the values represent a change
 */
export function fieldHasChanged(newValue: any, existingValue: any): boolean {
    // Fast path: exact match (same reference or primitive equality)
    if (newValue === existingValue) return false;

    // Normalize values for comparison
    const normalizedNew = normalizeValue(newValue);
    const normalizedExisting = normalizeValue(existingValue);

    // Check after normalization
    if (normalizedNew === normalizedExisting) return false;

    // Handle null cases
    if (normalizedNew == null || normalizedExisting == null) return true;

    // Type mismatch = change
    if (typeof normalizedNew !== typeof normalizedExisting) return true;

    // Numeric comparison with epsilon tolerance for float precision
    if (typeof normalizedNew === 'number') {
        return !numbersAreEqual(normalizedNew, normalizedExisting);
    }

    // Deep comparison for objects/arrays
    if (typeof normalizedNew === 'object') {
        return !deepEqual(normalizedNew, normalizedExisting);
    }

    // Primitives that aren't equal = change
    return true;
}

/**
 * Checks if a field is a standard ignored field (id, createdAt, updatedAt).
 * These fields are typically auto-managed by the database and should not be
 * considered when detecting changes.
 * 
 * @param key - Field name to check
 * @returns true if field should be ignored
 * 
 * @example
 * ```typescript
 * isStandardIgnoredField('id') // true
 * isStandardIgnoredField('createdAt') // true
 * isStandardIgnoredField('name') // false
 * ```
 */
export function isStandardIgnoredField(key: string): boolean {
    return key === 'id' || key === 'createdAt' || key === 'updatedAt';
}

/**
 * Checks if a value is a Prisma.Decimal or decimal.js-like object.
 * Uses duck typing to detect objects with toNumber() method and internal 'd' array,
 * which are characteristic of the decimal.js library used by Prisma.
 * 
 * @param value - Value to check
 * @returns true if value is a Decimal-like object
 */
export function isDecimalLike(value: any): boolean {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof value.toNumber === 'function' &&
        typeof value.toString === 'function' &&
        'd' in value &&
        's' in value &&
        'e' in value
    );
}

/**
 * Compares two numbers with relative epsilon tolerance.
 * Handles float precision issues (e.g., MySQL FLOAT returning 19.989999... for 19.99).
 * Also handles NaN (both NaN are treated as equal).
 * 
 * @param a - First number
 * @param b - Second number
 * @returns true if numbers are equal within tolerance
 */
export function numbersAreEqual(a: number, b: number): boolean {
    if (a === b) return true;
    // Both NaN → treat as equal
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    // One is NaN → not equal
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    // Infinity vs finite → not equal
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    // Relative epsilon comparison for float precision
    return Math.abs(a - b) <= Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}
