import { Search } from "./structures/types/search.types";
import SearchResolver from "./search-resolver";
import ConditionUtils from "./condition-utils";
import ObjectUtils from "./object-utils";
import { getPrismaInstance } from "./config";

/**
 * SearchUtils class for high-level search filter operations
 * Provides utilities for applying search trees and default filters to queries
 *
 * @class SearchUtils
 */
export default  class SearchUtils {
    /**
     * Combines a base filter with a search tree
     *
     * @param baseFilter - The base filter object to extend
     * @param search - Search tree (see {@link Search.Input})
     * @param modelInfo - Optional Prisma model information for relation detection
     * @returns Combined filter with the search conditions applied
     *
     * @remarks
     * Thin wrapper around {@link SearchResolver.merge}.
     *
     * @example
     * ```typescript
     * const filter = SearchUtils.applySearchFilter(
     *   { isActive: true },
     *   { field: 'name', like: 'John' }
     * );
     * // { isActive: true, name: { contains: 'John' } }
     * ```
     */
    public static applySearchFilter(
        baseFilter: Record<string, any>,
        search: Search.Input,
        modelInfo?: any
    ): Record<string, any> {
        return SearchResolver.merge(baseFilter, search, modelInfo);
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
            // Explicit null → translate to Prisma { equals: null } (IS NULL filter)
            if (value === null) {
                ObjectUtils.assign(output, key, { equals: null });
                continue;
            }

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
            // Get the model info for the nested relation
            const nestedModelInfo = fieldName && modelInfo ? this.getRelationModelInfo(fieldName, modelInfo) : undefined;
            
            const nested = this.applyDefaultFilters(value, nestedModelInfo);
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
     * Gets the model info for a related field
     * 
     * @param fieldName - The name of the relation field
     * @param modelInfo - Parent model information
     * @returns Model info for the related model, or undefined if not found
     * @private
     */
    private static getRelationModelInfo(fieldName: string, modelInfo: any): any {
        if (!modelInfo?.fields) return undefined;

        const field = modelInfo.fields.find((f: any) => f.name === fieldName);
        if (!field || field.kind !== 'object') return undefined;

        // Get the related model name
        const relatedModelName = field.type;
        
        try {
            const prisma = getPrismaInstance();
            const runtimeDataModel = (prisma as any)._runtimeDataModel;
            
            if (!runtimeDataModel?.models?.[relatedModelName]) {
                return undefined;
            }

            return runtimeDataModel.models[relatedModelName];
        } catch (error) {
            return undefined;
        }
    }



    /**
     * Builds one search condition per non-empty string field of a plain object
     *
     * @param filters - Object with field values to turn into conditions
     * @param operator - Which string operator to apply (default: `'equals'`)
     * @returns One condition per usable field, ready to drop into an `or`/`and` node
     *
     * @remarks
     * Convenience for turning form data or query params into a search tree. Fields that are not
     * non-empty strings are skipped. The result is a plain array, so it can be used directly as
     * the root of a search (which means AND) or wrapped in `{ or: [...] }`.
     *
     * @example
     * ```typescript
     * const conditions = SearchUtils.conditionsFrom(
     *   { name: 'John', email: 'john@example.com' },
     *   'like'
     * );
     * // [ { field: 'name', like: 'John' }, { field: 'email', like: 'john@example.com' } ]
     *
     * await User.findByFilter({}, { search: { or: conditions } });
     * ```
     */
    public static conditionsFrom(
        filters: Record<string, any>,
        operator: "equals" | "like" | "startsWith" | "endsWith" = "equals"
    ): Search.Condition[] {
        return Object.entries(filters)
            .filter(([, value]) => typeof value === "string" && value.trim() !== "")
            .map(([field, value]) => ({ field, [operator]: value }) as Search.Condition);
    }
}