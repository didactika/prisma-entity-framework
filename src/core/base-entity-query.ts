import { FindByFilterOptions } from "./structures/types/search.types";
import ModelUtils from "./model-utils";
import SearchUtils from "./search-utils";
import SearchResolver from "./search-resolver";
import { isNonEmptyArray } from "./utils/validation-utils";
import { logError } from "./utils/error-utils";
import { executeWithOrBatching, deduplicateResults } from "./query-utils";
import { executeInParallel } from "./utils/parallel-utils";
import { isParallelEnabled } from "./config";
import { EntityPrismaModel } from "./structures/interfaces/entity.interface";
import { shouldDisableParallel } from "./utils/transaction-utils";

type ModelInfo = ReturnType<typeof ModelUtils.getModelInformationCached>;

const CHUNK_SIZE = 10000;

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
 * - Automatic chunking for large list conditions (>10k items)
 * - Parallel execution for improved performance
 * - Optimized OR batching for large condition sets
 */
export default class BaseEntityQuery {
    /**
     * Finds entities by applying filters, search criteria, pagination, and ordering.
     * 
     * Supports relation includes, boolean search trees, and automatic chunking for large list
     * conditions (>10k values). Automatically optimizes queries with large OR conditions using batching.
     *
     * @param filter - Plain equality filter, ANDed with the search tree
     */
    public static async findByFilter<TModel extends object>(
        entityModel: EntityPrismaModel<TModel>,
        getModelInformation: () => ModelInfo,
        filter: Partial<TModel>,
        options: FindByFilterOptions.Options = FindByFilterOptions.defaultOptions
    ): Promise<
        | FindByFilterOptions.PaginatedResponse<TModel>
        | TModel[]
        | TModel
        | null
    > {
        if (!entityModel) throw new Error("The model is not defined in the BaseEntity class.");

        let modelInfo: ModelInfo | null = null;
        try {
            modelInfo = getModelInformation();
        } catch (error) {
            logError("findByFilter - getModelInformation", error as Error, {
                modelName: entityModel.name
            });
        }

        let include: Record<string, unknown> | undefined;
        if (options.relationsToInclude) {
            if (options.relationsToInclude === "*" || isNonEmptyArray(options.relationsToInclude)) {
                const prismaInstance = entityModel.$parent;
                include = await ModelUtils.getIncludesTree(
                    entityModel.name!,
                    options.relationsToInclude,
                    0,
                    prismaInstance
                );
            }
        }

        const whereClauseBase = SearchUtils.applyDefaultFilters(
            filter as Record<string, unknown>,
            modelInfo
        ) as Record<string, unknown>;

        // A condition carrying more values than the database can take in a single IN list is
        // split into one query per chunk, and the results merged.
        const chunkedSearches = options.search
            ? SearchResolver.chunkLargeLists(options.search, CHUNK_SIZE)
            : null;

        if (chunkedSearches === null) {
            let whereClause: Record<string, unknown> = whereClauseBase;
            if (options.search) {
                whereClause = SearchUtils.applySearchFilter(
                    whereClause,
                    options.search,
                    modelInfo
                ) as Record<string, unknown>;
            }

            const take: number | undefined = options.pagination?.take;
            const skip: number | undefined = options.pagination?.skip;
            const orderBy = options.orderBy;

            const whereKeys = Object.keys(whereClause);
            const hasOnlyOr = whereKeys.length === 1 && whereKeys[0] === "OR";

            let data: TModel[];
            let total = 0;

            if (
                hasOnlyOr &&
                Array.isArray((whereClause as any).OR) &&
                (whereClause as any).OR.length > 0
            ) {
                data = (await executeWithOrBatching<TModel & { id: unknown }>(
                    entityModel,
                    (whereClause as any).OR,
                    {
                        include,
                        parallel: options.parallel,
                        concurrency: options.concurrency
                    }
                )) as TModel[];

                const sorted = BaseEntityQuery.sortResults(data, orderBy);

                if (take !== undefined || skip !== undefined) {
                    total = sorted.length;
                    const startIndex = skip || 0;
                    const endIndex = take !== undefined ? startIndex + take : undefined;
                    data = sorted.slice(startIndex, endIndex);
                } else {
                    data = sorted;
                    total = data.length;
                }
            } else {
                const findManyQuery = entityModel.findMany({
                    where: whereClause,
                    include,
                    take,
                    skip,
                    orderBy
                });

                const countQuery =
                    take && skip !== undefined
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
                } as FindByFilterOptions.PaginatedResponse<TModel>;
            }

            return data;
        } else {
            const chunkWhereClauses = chunkedSearches.map(
                chunkSearch =>
                    SearchUtils.applySearchFilter(
                        whereClauseBase,
                        chunkSearch,
                        modelInfo
                    ) as Record<string, unknown>
            );

            const useParallel =
                options.parallel !== false &&
                isParallelEnabled() &&
                chunkWhereClauses.length > 1 &&
                !shouldDisableParallel();

            let allResults: TModel[][];

            if (useParallel) {
                const operations = chunkWhereClauses.map(
                    whereClause => () => entityModel.findMany({ where: whereClause, include })
                );

                const result = await executeInParallel(operations, {
                    concurrency: options.concurrency,
                    rateLimit: options.rateLimit
                });

                allResults = result.results as TModel[][];

                if (result.errors.length > 0) {
                    logError(
                        "findByFilter - parallel chunks",
                        new Error(`${result.errors.length} chunks failed`),
                        { failedCount: result.errors.length }
                    );
                }
            } else {
                const queryPromises = chunkWhereClauses.map(
                    whereClause => entityModel.findMany({ where: whereClause, include })
                );

                allResults = (await Promise.all(queryPromises)) as TModel[][];
            }

            const flattened = ([] as TModel[]).concat(...allResults);
            const deduplicated = deduplicateResults(
                flattened as (TModel & { id: unknown })[]
            ) as TModel[];

            const finalResults = BaseEntityQuery.sortResults(deduplicated, options.orderBy);

            if (options.onlyOne) return finalResults[0] ?? null;

            return finalResults;
        }
    }

    /**
     * Counts the number of records matching the given filter
     * 
     * @template T - The entity type
     * @param entityModel - The Prisma model (delegate) to query
     * @param getModelInformation - Function to get model information
     * @param filter - Filter criteria
     * @returns Promise<number> - The count of matching records
     */
    public static async countByFilter<TModel extends object>(
        entityModel: EntityPrismaModel<TModel>,
        getModelInformation: () => ModelInfo,
        filter: Partial<TModel>
    ): Promise<number> {
        if (!entityModel) throw new Error("The model is not defined in the BaseEntity class.");

        let modelInfo: ModelInfo | null = null;
        try {
            modelInfo = getModelInformation();
        } catch (error) {
            logError("countByFilter - getModelInformation", error as Error, {
                modelName: entityModel.name
            });
        }

        const whereClause = SearchUtils.applyDefaultFilters(
            filter,
            modelInfo
        ) as Record<string, unknown>;

        return entityModel.count({ where: whereClause });
    }

    /**
     * Deletes entities matching the given filter
     * 
     * @template T - The entity type
     * @param entityModel - The Prisma model (delegate) to query
     * @param getModelInformation - Function to get model information
     * @param filter - Filter criteria
     * @param options - Query options (search)
     * @returns Promise<number> - The number of deleted records
     */
    public static async deleteByFilter<TModel extends object>(
        entityModel: EntityPrismaModel<TModel>,
        getModelInformation: () => ModelInfo,
        filter: Partial<TModel>,
        options?: FindByFilterOptions.Options
    ): Promise<number> {
        if (!entityModel) throw new Error("The model is not defined in the BaseEntity class.");

        let modelInfo: ModelInfo | null = null;
        try {
            modelInfo = getModelInformation();
        } catch (error) {
            logError("deleteByFilter - getModelInformation", error as Error, {
                modelName: entityModel.name
            });
        }

        let whereClause = SearchUtils.applyDefaultFilters(
            filter,
            modelInfo
        ) as Record<string, unknown>;
        if (options?.search) {
            whereClause = SearchUtils.applySearchFilter(
                whereClause,
                options.search,
                modelInfo
            ) as Record<string, unknown>;
        }

        try {
            const result = await entityModel.deleteMany({
                where: whereClause
            });
            return result.count || 0;
        } catch (error) {
            logError("deleteByFilter", error as Error, { modelName: entityModel.name });
            return 0;
        }
    }

    private static sortResults<TModel extends object>(
        data: TModel[],
        orderBy?: FindByFilterOptions.OrderBy
    ): TModel[] {
        if (!orderBy) return data;

        // Normalize orderBy to always be an array of OrderByItem
        const orderByArray: FindByFilterOptions.OrderByItem[] = Array.isArray(orderBy) 
            ? orderBy 
            : [orderBy];

        return [...data].sort((a, b) => {
            for (const orderByItem of orderByArray) {
                const [orderByKey, orderByDirection] = Object.entries(orderByItem)[0] as [
                    string,
                    "asc" | "desc"
                ];

                const aVal = (a as Record<string, unknown>)[orderByKey] as unknown;
                const bVal = (b as Record<string, unknown>)[orderByKey] as unknown;

                if (aVal == null && bVal == null) continue;
                if (aVal == null) return orderByDirection === "asc" ? -1 : 1;
                if (bVal == null) return orderByDirection === "asc" ? 1 : -1;

                if (aVal < bVal) return orderByDirection === "asc" ? -1 : 1;
                if (aVal > bVal) return orderByDirection === "asc" ? 1 : -1;
            }
            return 0;
        });
    }
}
