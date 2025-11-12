import {FindByFilterOptions} from "../types/search.types";
import { isValidValue } from "./validation-utils";

/**
 * ConditionUtils class for validating and building search conditions
 * Provides utilities for creating Prisma-compatible query conditions
 * 
 * @class ConditionUtils
 */
export default class ConditionUtils {
    /**
     * Validates if a value is considered valid for filtering
     * 
     * @param value - The value to validate
     * @returns True if the value is valid, false otherwise
     * 
     * @remarks
     * - Returns false for: null, undefined, empty strings (including whitespace-only), empty arrays
     * - Returns false for objects where all nested values are invalid
     * - Returns true for: non-empty strings, numbers (including 0), booleans, non-empty arrays, valid objects
     * 
     * @example
     * ```typescript
     * ConditionUtils.isValid('hello')      // true
     * ConditionUtils.isValid('')           // false
     * ConditionUtils.isValid(0)            // true
     * ConditionUtils.isValid([])           // false
     * ConditionUtils.isValid({ key: 'val' }) // true
     * ```
     */
    public static isValid(value: any): boolean {
        // Use validation-utils.isValidValue
        return isValidValue(value);
    }

    /**
     * Creates a Prisma string condition based on the search mode
     * 
     * @param option - String search options with value and mode
     * @returns Prisma condition object for string matching
     * 
     * @remarks
     * Supported modes:
     * - LIKE: Creates { contains: value } for substring matching
     * - STARTS_WITH: Creates { startsWith: value }
     * - ENDS_WITH: Creates { endsWith: value }
     * - EXACT (default): Creates { equals: value } for exact matching
     * 
     * @example
     * ```typescript
     * ConditionUtils.string({ value: 'John', mode: 'LIKE' })
     * // Returns: { contains: 'John' }
     * 
     * ConditionUtils.string({ value: 'John', mode: 'STARTS_WITH' })
     * // Returns: { startsWith: 'John' }
     * ```
     */
    public static string(option: FindByFilterOptions.StringSearch): any {
        switch (option.mode) {
            case "LIKE":
                return { contains: option.value };
            case "STARTS_WITH":
                return { startsWith: option.value };
            case "ENDS_WITH":
                return { endsWith: option.value };
            default:
                return { equals: option.value };
        }
    }

    /**
     * Creates a Prisma range condition for numeric or date filtering
     * 
     * @param option - Range search options with min and/or max values
     * @returns Prisma condition object with gte/lte operators
     * 
     * @remarks
     * - If only min is provided: returns { gte: min }
     * - If only max is provided: returns { lte: max }
     * - If both provided: returns { gte: min, lte: max }
     * - If neither provided: returns empty object
     * 
     * @example
     * ```typescript
     * ConditionUtils.range({ min: 18, max: 65 })
     * // Returns: { gte: 18, lte: 65 }
     * 
     * ConditionUtils.range({ min: new Date('2024-01-01') })
     * // Returns: { gte: Date('2024-01-01') }
     * ```
     */
    public static range(option: FindByFilterOptions.RangeSearch): any {
        const condition: Record<string, any> = {};
        if (option.min !== undefined) condition.gte = option.min;
        if (option.max !== undefined) condition.lte = option.max;
        return condition;
    }

    /**
     * Creates a Prisma list condition for array matching
     * 
     * @param option - List search options with array of values and mode
     * @returns Prisma condition object based on mode
     * 
     * @remarks
     * Supported modes:
     * - IN (default): Creates { in: values } for matching any value in the list
     * - NOT_IN: Creates { notIn: values } for excluding values in the list
     * - HAS_SOME: Creates { hasSome: values } for array fields that contain some values
     * - HAS_EVERY: Creates { hasEvery: values } for array fields that contain all values
     * 
     * @example
     * ```typescript
     * ConditionUtils.list({ values: ['active', 'pending'], mode: 'IN' })
     * // Returns: { in: ['active', 'pending'] }
     * 
     * ConditionUtils.list({ values: ['deleted'], mode: 'NOT_IN' })
     * // Returns: { notIn: ['deleted'] }
     * 
     * ConditionUtils.list({ values: ['tag1', 'tag2'], mode: 'HAS_SOME' })
     * // Returns: { hasSome: ['tag1', 'tag2'] }
     * 
     * ConditionUtils.list({ values: ['required1', 'required2'], mode: 'HAS_EVERY' })
     * // Returns: { hasEvery: ['required1', 'required2'] }
     * ```
     */
    public static list(option: FindByFilterOptions.ListSearch): any {
        const mode = option.mode || 'IN';
        
        switch (mode) {
            case 'NOT_IN':
                return { notIn: option.values };
            case 'HAS_SOME':
                return { hasSome: option.values };
            case 'HAS_EVERY':
                return { hasEvery: option.values };
            case 'IN':
            default:
                return { in: option.values };
        }
    }
}