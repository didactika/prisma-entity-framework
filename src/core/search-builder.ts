import {FindByFilterOptions} from "./structures/types/search.types";
import ConditionUtils from "./condition-utils";
import ObjectUtils from "./object-utils";
import { getPrismaInstance } from "./config";

/**
 * SearchBuilder class for constructing complex search filters
 * Combines multiple search conditions into a single filter object
 * 
 * @class SearchBuilder
 */
export default class SearchBuilder {
    /**
     * Builds a complete search filter by applying string, range, and list searches
     * 
     * @param baseFilter - The base filter object to extend
     * @param options - Search options containing string, range, and list searches
     * @param modelInfo - Optional Prisma model information for relation detection
     * @returns Combined filter object with all search conditions applied
     * 
     * @example
     * ```typescript
     * const filter = SearchBuilder.build(
     *   { isActive: true },
     *   {
     *     stringSearch: [{ keys: ['name'], value: 'John', mode: 'LIKE' }],
     *     rangeSearch: [{ keys: ['age'], min: 18, max: 65 }]
     *   }
     * );
     * // Returns: { isActive: true, name: { contains: 'John' }, age: { gte: 18, lte: 65 } }
     * ```
     */
    public static build(
        baseFilter: Record<string, any>,
        options: FindByFilterOptions.SearchOptions,
        modelInfo?: any
    ): Record<string, any> {
        const filter = { ...baseFilter };

        if (options.stringSearch) this.apply(filter, options.stringSearch, ConditionUtils.string, modelInfo);
        if (options.rangeSearch) this.apply(filter, options.rangeSearch, ConditionUtils.range, modelInfo);
        if (options.listSearch) this.apply(filter, options.listSearch, ConditionUtils.list, modelInfo);

        return filter;
    }

    /**
     * Applies a specific type of search condition to the filter
     * Handles both AND and OR grouping of conditions
     * Supports includeNull for range searches to include null values
     * 
     * @template T - Type of search condition with optional keys, grouping, and includeNull
     * @param filter - The filter object to modify
     * @param conditions - Array of search conditions to apply
     * @param buildCondition - Function to build the condition object from the search option
     * @param modelInfo - Optional Prisma model information for relation detection
     * @private
     * 
     * @remarks
     * - Skips invalid conditions using ConditionUtils.isValid()
     * - For includeNull: creates OR with condition and null check
     * - For OR grouping: adds conditions to filter.OR array and tracks paths for cleanup
     * - For AND grouping: assigns conditions directly to filter using ObjectUtils.assign()
     * - Cleans up duplicate paths that appear in OR conditions
     */
    private static apply<T extends { keys?: string[]; grouping?: "and" | "or"; includeNull?: boolean }>(
        filter: Record<string, any>,
        conditions: T[],
        buildCondition: (opt: T) => any,
        modelInfo?: any
    ): void {
        const orPaths = new Set<string>();

        for (const option of conditions) {
            const keys = option.keys ?? [];
            const grouping = option.grouping ?? "and";
            const condition = buildCondition(option);
            const includeNull = option.includeNull ?? false;

            if (!ConditionUtils.isValid(condition)) continue;

            const isRangeCondition = typeof condition === 'object' && condition !== null && (condition.gte !== undefined || condition.lte !== undefined);

            // If includeNull is true, create OR with condition and null
            if (includeNull && keys.length > 0) {
                filter.OR = filter.OR ?? [];
                
                for (const path of keys) {
                    // Add the original condition
                    filter.OR.push(ObjectUtils.buildWithRelations(path, condition, modelInfo));
                    // Add the null condition
                    filter.OR.push(ObjectUtils.buildWithRelations(path, { equals: null }, modelInfo));
                    orPaths.add(path);
                }
            } else if (grouping === "or") {
                filter.OR = filter.OR ?? [];

                for (const path of keys) {
                    const conditionWithNullExclusion = this.buildConditionWithNullExclusion(path, condition, isRangeCondition, includeNull, modelInfo);
                    filter.OR.push(ObjectUtils.buildWithRelations(path, conditionWithNullExclusion, modelInfo));
                    orPaths.add(path);
                }
            } else {
                for (const path of keys) {
                    const conditionWithNullExclusion = this.buildConditionWithNullExclusion(path, condition, isRangeCondition, includeNull, modelInfo);
                    ObjectUtils.assign(filter, path, conditionWithNullExclusion, modelInfo);
                }
            }
        }

        ObjectUtils.clean(filter, orPaths);
    }

    private static buildConditionWithNullExclusion(
        path: string,
        condition: any,
        isRangeCondition: boolean,
        includeNull: boolean,
        modelInfo?: any
    ): any {
        if (!isRangeCondition || includeNull) {
            return condition;
        }

        if (this.shouldExcludeNull(path, modelInfo)) {
            return { ...condition, not: null };
        }

        return condition;
    }

    private static shouldExcludeNull(path: string, modelInfo?: any): boolean {
        if (!modelInfo) {
            return true;
        }

        const fieldInfo = this.getFieldInfoForPath(path, modelInfo);
        if (!fieldInfo) {
            return false;
        }

        return fieldInfo.isRequired === false;
    }

    private static getFieldInfoForPath(path: string, modelInfo: any): any | null {
        const keys = path.split('.');
        let currentModelInfo = modelInfo;

        for (let index = 0; index < keys.length; index++) {
            const key = keys[index];
            const field = currentModelInfo?.fields?.find((f: any) => f.name === key);

            if (!field) {
                return null;
            }

            if (index === keys.length - 1) {
                return field;
            }

            if (field.kind !== 'object') {
                return null;
            }

            currentModelInfo = this.getRelatedModelInfo(field.type);
            if (!currentModelInfo) {
                return null;
            }
        }

        return null;
    }

    private static getRelatedModelInfo(modelName: string): any | null {
        try {
            const prisma = getPrismaInstance() as any;
            return prisma?._runtimeDataModel?.models?.[modelName] ?? null;
        } catch {
            return null;
        }
    }
}