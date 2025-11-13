import { FindByFilterOptions } from "./structures/types/search.types";
import ModelUtils from "./model-utils";
import SearchUtils from "./search-utils";
import { isNonEmptyArray } from "./utils/validation-utils";
import { logError } from "./utils/error-utils";
import { executeWithOrBatching, deduplicateResults } from "./query-utils";
import { executeInParallel } from "./utils/parallel-utils";
import { isParallelEnabled } from "./config";

/**
 * BaseEntityQuery - Helper class for query operations.
 * 
 * Provides optimized query methods for finding, counting, and deleting entities.
 * Extracted from BaseEntity to improve code organization and maintainability.
 * 
 * Features:
 * - Advanced filtering with search criteria
 * - Pagination support
 * - Nested relation includes
 * - Automatic chunking for large list searches (>10k items)
 * - Parallel execution for improved performance
 * - Optimized OR batching for large condition sets
 * 
 * @example
 * ```typescript
 * // Find users with complex filters
 * const users = await BaseEntityQuery.findByFilter(
 *   User.model,
 *   () => User.getModelInformation(),
 *   { status: 'active' },
 *   { 
 *     search: { textSearch: 'john', fields: ['name', 'email'] },
 *     pagination: { page: 1, pageSize: 10 },
 *     relationsToInclude: ['posts', 'profile'],
 *     orderBy: { createdAt: 'desc' }
 *   }
 * );
 * ```
 */
export default class BaseEntityQuery {
    /**
     * Finds entities by applying filters, search criteria, pagination, and ordering.
     * 
     * Supports relation includes, complex searches, and automatic chunking for large list searches (>10k items).
     * Automatically optimizes queries with large OR conditions using batching.
     * 
     * @template T - The entity type
     * @param entityModel - The Prisma model to query
     * @param getModelInformation - Function to get model information
     * @param filter - Base filter object with entity properties to match
     * @param options - Query options (search, pagination, relationsToInclude, orderBy, onlyOne)
     * @returns PaginatedResponse<T> if paginated, T if onlyOne, T[] otherwise, or null if no results
     * @throws Error if model is not defined
     * 
     * @example
     * ```typescript
     * // Paginated results with relations and ordering
     * const result = await BaseEntityQuery.findByFilter(
     *   User.model,
     *   () => User.getModelInformation(),
     *   { status: 'active' },
     *   { 
     *     pagination: { page: 1, pageSize: 10, take: 10, skip: 0 },
     *     relationsToInclude: ['posts', 'profile'],
     *     orderBy: { createdAt: 'desc' }
     *   }
     * );
     * 
     * // Search with large list (automatically chunked)
     * const users = await BaseEntityQuery.findByFilter(
     *   User.model,
     *   () => User.getModelInformation(),
     *   {},
     *   {
     *     search: {
     *       listSearch: [{ field: 'id', values: largeIdArray }] // >10k items
     *     }
     *   }
     * );
     * ```
     */
    public static async findByFilter<T extends object = Record<string, any>>(
        entityModel: any,
        getModelInformation: () => any,
        filter: Partial<T>,
        options: FindByFilterOptions.Options = FindByFilterOptions.defaultOptions
    ): Promise<
        | FindByFilterOptions.PaginatedResponse<T>
        | T[]
        | T
        | null
    > {
        if (!entityModel) throw new Error("The model is not defined in the BaseEntity class.");

        let modelInfo: any = null;
        try {
            modelInfo = getModelInformation();
        } catch (error) {
            logError('findByFilter - getModelInformation', error as Error, { modelName: entityModel.name });
        }

        let include = undefined;
        if (options.relationsToInclude) {
            // Use validation-utils for array check
            if (options.relationsToInclude === "*" || isNonEmptyArray(options.relationsToInclude)) {
                // Extract Prisma instance from entityModel.$parent if available
                const prismaInstance = entityModel?.$parent;
                include = await ModelUtils.getIncludesTree(entityModel.name, options.relationsToInclude, 0, prismaInstance);
            }
        }

        let whereClauseBase = SearchUtils.applyDefaultFilters(filter, modelInfo);

        const CHUNK_SIZE = 10000;

        const listSearch = options.search?.listSearch || [];
        const longIndex = listSearch.findIndex(ls => Array.isArray(ls.values) && ls.values.length > CHUNK_SIZE);

        if (longIndex === -1) {
            let whereClause = whereClauseBase;
            if (options.search) whereClause = SearchUtils.applySearchFilter(whereClause, options.search, modelInfo);

            let take: number | undefined = options.pagination?.take;
            let skip: number | undefined = options.pagination?.skip;
            let orderBy: any = options.orderBy || undefined;

            // Check if we need to use OR batching for large OR conditions
            // Only apply batching if whereClause consists solely of OR conditions
            const whereKeys = Object.keys(whereClause);
            const hasOnlyOr = whereKeys.length === 1 && whereKeys[0] === 'OR';

            let data: T[];
            let total = 0;

            if (hasOnlyOr && Array.isArray(whereClause.OR) && whereClause.OR.length > 0) {
                // Use query-utils.executeWithOrBatching for large OR conditions
                data = await executeWithOrBatching<T & { id: any }>(
                    entityModel,
                    whereClause.OR,
                    {
                        include,
                        parallel: options.parallel,
                        concurrency: options.concurrency
                    }
                ) as T[];

                // Apply ordering if specified (client-side since we bypassed Prisma's orderBy)
                if (orderBy) {
                    const orderByKey = Object.keys(orderBy)[0];
                    const orderByDirection = orderBy[orderByKey];
                    data = data.sort((a, b) => {
                        const aVal = (a as any)[orderByKey];
                        const bVal = (b as any)[orderByKey];
                        if (aVal < bVal) return orderByDirection === 'asc' ? -1 : 1;
                        if (aVal > bVal) return orderByDirection === 'asc' ? 1 : -1;
                        return 0;
                    });
                }

                // Apply pagination if specified (client-side)
                if (take !== undefined || skip !== undefined) {
                    total = data.length; // Total before pagination
                    const startIndex = skip || 0;
                    const endIndex = take !== undefined ? startIndex + take : undefined;
                    data = data.slice(startIndex, endIndex);
                } else {
                    total = data.length;
                }
            } else {
                // Normal query path - let Prisma handle it
                const findManyQuery = entityModel.findMany({
                    where: whereClause,
                    include,
                    take,
                    skip,
                    orderBy
                }) as Promise<T[]>;

                const countQuery = take && skip !== undefined
                    ? entityModel.count({ where: whereClause })
                    : Promise.resolve(0);

                [data, total] = await Promise.all([findManyQuery, countQuery]);
            }

            if (options.onlyOne) return data[0] ?? null;

            if (take && skip !== undefined && options.pagination) {
                const { page, pageSize } = options.pagination;
                return {
                    total,
                    page,
                    pageSize,
                    data
                } as FindByFilterOptions.PaginatedResponse<T>;
            }

            return data;
        } else {
            // Large list search - chunk and execute queries
            const longValues = listSearch[longIndex].values;
            const chunks: any[][] = [];
            for (let i = 0; i < longValues.length; i += CHUNK_SIZE) {
                chunks.push(longValues.slice(i, i + CHUNK_SIZE));
            }

            // Determine if we should use parallel execution
            const useParallel = options.parallel !== false &&
                isParallelEnabled() &&
                chunks.length > 1;

            let allResults: T[][];

            if (useParallel) {
                // Execute chunks in parallel
                const operations = chunks.map(chunkValues =>
                    () => {
                        const searchClone = options.search ? JSON.parse(JSON.stringify(options.search)) : undefined;
                        if (searchClone?.listSearch?.[longIndex]) {
                            searchClone.listSearch[longIndex].values = chunkValues;
                        }
                        const whereClause = searchClone ? SearchUtils.applySearchFilter(whereClauseBase, searchClone, modelInfo) : whereClauseBase;
                        return entityModel.findMany({ where: whereClause, include }) as Promise<T[]>;
                    }
                );

                const result = await executeInParallel(operations, {
                    concurrency: options.concurrency,
                    rateLimit: options.rateLimit
                });

                allResults = result.results as T[][];

                if (result.errors.length > 0) {
                    logError('findByFilter - parallel chunks', new Error(`${result.errors.length} chunks failed`), { failedCount: result.errors.length });
                }
            } else {
                // Execute chunks sequentially
                const queryPromises = chunks.map(chunkValues => {
                    const searchClone = options.search ? JSON.parse(JSON.stringify(options.search)) : undefined;
                    if (searchClone?.listSearch?.[longIndex]) {
                        searchClone.listSearch[longIndex].values = chunkValues;
                    }
                    const whereClause = searchClone ? SearchUtils.applySearchFilter(whereClauseBase, searchClone, modelInfo) : whereClauseBase;
                    return entityModel.findMany({ where: whereClause, include }) as Promise<T[]>;
                });

                allResults = await Promise.all(queryPromises);
            }

            // Flatten and deduplicate results using query-utils.deduplicateResults
            const flattened = ([] as T[]).concat(...allResults);
            const deduplicated = deduplicateResults(flattened as (T & { id: any })[]) as T[];

            // Apply orderBy if specified
            let finalResults = deduplicated;
            if (options.orderBy) {
                const orderByKey = Object.keys(options.orderBy)[0];
                const orderByDirection = options.orderBy[orderByKey];
                finalResults = deduplicated.sort((a, b) => {
                    const aVal = (a as any)[orderByKey];
                    const bVal = (b as any)[orderByKey];
                    if (aVal < bVal) return orderByDirection === 'asc' ? -1 : 1;
                    if (aVal > bVal) return orderByDirection === 'asc' ? 1 : -1;
                    return 0;
                });
            }

            if (options.onlyOne) return finalResults[0] ?? null;

            return finalResults;
        }
    }

    /**
     * Counts the number of records matching the given filter
     * 
     * @template T - The entity type
     * @param entityModel - The Prisma model to query
     * @param getModelInformation - Function to get model information
     * @param filter - Filter criteria
     * @returns Promise<number> - The count of matching records
     * 
     * @example
     * ```typescript
     * const count = await BaseEntityQuery.countByFilter(
     *   User.model,
     *   () => User.getModelInformation(),
     *   { status: 'active' }
     * );
     * ```
     */
    public static async countByFilter<T extends object = Record<string, any>>(
        entityModel: any,
        getModelInformation: () => any,
        filter: Partial<T>
    ): Promise<number> {
        if (!entityModel) throw new Error("The model is not defined in the BaseEntity class.");

        // Obtener información del modelo para detectar tipos de relación
        let modelInfo: any = null;
        try {
            modelInfo = getModelInformation();
        } catch (error) {
            logError('countByFilter - getModelInformation', error as Error, { modelName: entityModel.name });
        }

        let whereClause = SearchUtils.applyDefaultFilters(filter, modelInfo);

        return await entityModel.count({ where: whereClause });
    }

    /**
     * Deletes entities matching the given filter
     * 
     * @template T - The entity type
     * @param entityModel - The Prisma model to query
     * @param getModelInformation - Function to get model information
     * @param filter - Filter criteria
     * @param options - Query options (search)
     * @returns Promise<number> - The number of deleted records
     * 
     * @example
     * ```typescript
     * const deleted = await BaseEntityQuery.deleteByFilter(
     *   User.model,
     *   () => User.getModelInformation(),
     *   { status: 'inactive' }
     * );
     * ```
     */
    public static async deleteByFilter<T extends object = Record<string, any>>(
        entityModel: any,
        getModelInformation: () => any,
        filter: Partial<T>,
        options?: FindByFilterOptions.Options
    ): Promise<number> {
        if (!entityModel) throw new Error("The model is not defined in the BaseEntity class.");

        let modelInfo: any = null;
        try {
            modelInfo = getModelInformation();
        } catch (error) {
            logError('deleteByFilter - getModelInformation', error as Error, { modelName: entityModel.name });
        }

        let whereClause = SearchUtils.applyDefaultFilters(filter, modelInfo);
        if (options?.search) whereClause = SearchUtils.applySearchFilter(whereClause, options.search, modelInfo);
        try {
            const result = await entityModel.deleteMany({
                where: whereClause
            });
            return result.count || 0;
        } catch (error) {
            logError('deleteByFilter', error as Error, { modelName: entityModel.name });
            return 0;
        }
    }
}
