import { isValidValue } from "./utils/validation-utils";

/**
 * ConditionUtils class for validating filter values
 *
 * @class ConditionUtils
 *
 * @remarks
 * Operator construction lives in {@link SearchResolver}, which maps a condition's operator
 * straight to its Prisma equivalent. What remains here is the validity check shared by the
 * resolver and by plain filter translation.
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
}
