import SearchBuilder from "./search-builder";
import {FindByFilterOptions} from "../types/search.types";
import ConditionUtils from "./condition-utils";
import ObjectUtils from "./object-utils";

/**
 * SearchUtils class for high-level search filter operations
 * Provides utilities for applying search filters and default filters to queries
 * 
 * @class SearchUtils
 */
export default  class SearchUtils {
    /**
     * Applies search filters to a base filter using SearchBuilder
     * 
     * @param baseFilter - The base filter object to extend
     * @param searchOptions - Search options with string, range, and list searches
     * @returns Combined filter with search conditions applied
     * 
     * @remarks
     * This is a wrapper around SearchBuilder.build() for convenience
     * Combines the base filter with advanced search options
     * 
     * @example
     * ```typescript
     * const filter = SearchUtils.applySearchFilter(
     *   { isActive: true },
     *   {
     *     stringSearch: [{ keys: ['name'], value: 'John', mode: 'LIKE' }]
     *   }
     * );
     * ```
     */
    public static applySearchFilter(
        baseFilter: Record<string, any>,
        searchOptions: FindByFilterOptions.SearchOptions
    ): Record<string, any> {
        return SearchBuilder.build(baseFilter, searchOptions);
    }

    /**
     * Converts plain filter objects into Prisma-compatible query conditions
     * Automatically detects field types and applies appropriate conditions
     * 
     * @param input - Plain object with field values to filter by
     * @param modelInfo - Optional Prisma model information for relation detection
     * @returns Prisma-compatible filter object
     * 
     * @remarks
     * Automatic condition mapping:
     * - Strings/Numbers/Dates → { equals: value }
     * - Arrays → { hasEvery: value }
     * - Nested objects → { is: {...} } for single relations
     * - Nested objects → { some: {...} } for array relations (when modelInfo provided)
     * - Skips null, undefined, empty strings, and empty arrays
     * 
     * @example
     * ```typescript
     * SearchUtils.applyDefaultFilters({ name: 'John', age: 30 })
     * // Returns: { name: { equals: 'John' }, age: { equals: 30 } }
     * 
     * SearchUtils.applyDefaultFilters({ author: { name: 'John' } })
     * // Returns: { author: { is: { name: { equals: 'John' } } } }
     * ```
     */
    public static applyDefaultFilters(input: Record<string, any>, modelInfo?: any): Record<string, any> {
        const output: Record<string, any> = {};

        for (const [key, value] of Object.entries(input)) {
            if (!ConditionUtils.isValid(value)) continue;

            const condition = this.buildDefaultCondition(value, key, modelInfo);
            if (!condition) continue;

            ObjectUtils.assign(output, key, condition);
        }

        return output;
    }

    /**
     * Builds a default condition based on value type
     * 
     * @param value - The value to create a condition for
     * @param fieldName - Optional field name for relation detection
     * @param modelInfo - Optional model information for relation type detection
     * @returns Prisma condition object or undefined for invalid values
     * @private
     * 
     * @remarks
     * - Scalars (string/number/boolean/Date) → { equals: value }
     * - Arrays → { hasEvery: value } (or undefined if empty)
     * - Objects → { is: {...} } or { some: {...} } depending on relation type
     */
    private static buildDefaultCondition(value: any, fieldName?: string, modelInfo?: any): any {
        if (typeof value === "string" || 
            typeof value === "number" || 
            typeof value === "boolean" ||
            value instanceof Date) {
            return { equals: value };
        }

        if (Array.isArray(value)) {
            return value.length > 0 ? { hasEvery: value } : undefined;
        }

        if (typeof value === "object" && value !== null) {
            const nested = this.applyDefaultFilters(value, modelInfo);
            if (!ConditionUtils.isValid(nested)) return undefined;

            // Detectar si es una relación de array
            if (fieldName && modelInfo && this.isArrayRelation(fieldName, modelInfo)) {
                return { some: nested };
            }

            return { is: nested };
        }

        return undefined;
    }

    /**
     * Determines if a field represents an array relation in the Prisma model
     * 
     * @param fieldName - The name of the field to check
     * @param modelInfo - Prisma model information containing field definitions
     * @returns True if the field is an array relation (isList: true), false otherwise
     * @private
     * 
     * @remarks
     * Used to determine whether to use 'some' or 'is' for nested object filters
     * Array relations use 'some', single relations use 'is'
     */
    private static isArrayRelation(fieldName: string, modelInfo: any): boolean {
        if (!modelInfo?.fields) return false;

        const field = modelInfo.fields.find((f: any) => f.name === fieldName);
        if (!field) return false;

        // Es una relación de array si es tipo object y tiene isList = true
        return field.kind === 'object' && field.isList === true;
    }



    /**
     * Generates string search options for all string fields in a filter object
     * 
     * @param filters - Object with field values to create search options from
     * @param mode - Search mode to apply (default: 'EXACT')
     * @param grouping - Whether to use 'and' or 'or' grouping (default: 'and')
     * @returns Array of string search options for all non-empty string fields
     * 
     * @remarks
     * - Only processes string fields with non-empty values
     * - Useful for quickly creating search options from form data
     * - Each field gets its own search option
     * 
     * @example
     * ```typescript
     * SearchUtils.getCustomSearchOptionsForAll(
     *   { name: 'John', email: 'john@example.com' },
     *   'LIKE',
     *   'or'
     * );
     * // Returns: [
     * //   { keys: ['name'], value: 'John', mode: 'LIKE', grouping: 'or' },
     * //   { keys: ['email'], value: 'john@example.com', mode: 'LIKE', grouping: 'or' }
     * // ]
     * ```
     */
    public static getCustomSearchOptionsForAll(
        filters: Record<string, any>,
        mode: "LIKE" | "EXACT" | "STARTS_WITH" | "ENDS_WITH" = "EXACT",
        grouping: "and" | "or" = "and"
    ): FindByFilterOptions.StringSearch[] {
        return Object.entries(filters)
            .filter(([_, v]) => typeof v === "string" && v.trim() !== "")
            .map(([k, v]) => ({ keys: [k], value: v as string, mode, grouping }));
    }
}