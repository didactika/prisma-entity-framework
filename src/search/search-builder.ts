import {FindByFilterOptions} from "../types/search.types";
import ConditionUtils from "./condition-utils";
import ObjectUtils from "./object-utils";

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
        options: FindByFilterOptions.SearchOptions
    ): Record<string, any> {
        const filter = { ...baseFilter };

        if (options.stringSearch) this.apply(filter, options.stringSearch, ConditionUtils.string);
        if (options.rangeSearch) this.apply(filter, options.rangeSearch, ConditionUtils.range);
        if (options.listSearch) this.apply(filter, options.listSearch, ConditionUtils.list);

        return filter;
    }

    /**
     * Applies a specific type of search condition to the filter
     * Handles both AND and OR grouping of conditions
     * 
     * @template T - Type of search condition with optional keys and grouping
     * @param filter - The filter object to modify
     * @param conditions - Array of search conditions to apply
     * @param buildCondition - Function to build the condition object from the search option
     * @private
     * 
     * @remarks
     * - Skips invalid conditions using ConditionUtils.isValid()
     * - For OR grouping: adds conditions to filter.OR array and tracks paths for cleanup
     * - For AND grouping: assigns conditions directly to filter using ObjectUtils.assign()
     * - Cleans up duplicate paths that appear in OR conditions
     */
    private static apply<T extends { keys?: string[]; grouping?: "and" | "or" }>(
        filter: Record<string, any>,
        conditions: T[],
        buildCondition: (opt: T) => any
    ): void {
        const orPaths = new Set<string>();

        for (const option of conditions) {
            const keys = option.keys ?? [];
            const grouping = option.grouping ?? "and";
            const condition = buildCondition(option);

            if (!ConditionUtils.isValid(condition)) continue;

            if (grouping === "or") {
                filter.OR = filter.OR ?? [];

                for (const path of keys) {
                    filter.OR.push(ObjectUtils.build(path, condition));
                    orPaths.add(path);
                }
            } else {
                for (const path of keys) {
                    ObjectUtils.assign(filter, path, condition);
                }
            }
        }

        ObjectUtils.clean(filter, orPaths);
    }
}