import { PrismaClient } from "@prisma/client";
import DataUtils from "./data-utils";
import ModelUtils from "./model-utils";
import { getPrismaInstance, isParallelEnabled } from "./config";
import { getDatabaseProviderCached } from "./utils/database-utils";
import { executeInParallel } from "./utils/parallel-utils";
import { isNonEmptyArray } from "./utils/validation-utils";
import { getOptimalBatchSize, processBatches } from "./utils/batch-utils";
import { logError, handleUniqueConstraintError, withErrorHandling } from "./utils/error-utils";
import { executeWithOrBatching } from "./query-utils";
import { hasChanges as compareHasChanges } from "./utils/comparison-utils";
import BaseEntityHelpers from "./base-entity-helpers";
import { EntityPrismaModel } from "./structures/interfaces/entity.interface";

type ModelInfo = ReturnType<typeof ModelUtils.getModelInformationCached>;

/**
 * BaseEntityBatch - Helper class for batch operations.
 * 
 * Provides optimized batch operations for creating, updating, upserting, and deleting multiple entities.
 * Extracted from BaseEntity to improve code organization and maintainability.
 * 
 * Features:
 * - Automatic batching based on database provider
 * - Parallel execution support
 * - Many-to-many relation handling
 * - Deduplication based on unique constraints
 * - Database-specific optimizations (MongoDB transactions, SQL batch updates)
 * 
 * @example
 * ```typescript
 * // Create multiple users in batch
 * const count = await BaseEntityBatch.createMany(
 *   User.model,
 *   () => User.getModelInformation(),
 *   users,
 *   {
 *     skipDuplicates: true,
 *     keyTransformTemplate: (key) => `${key}Id`,
 *     parallel: true,
 *     concurrency: 4
 *   }
 * );
 * ```
 */
export default class BaseEntityBatch {
    static readonly MONGODB_TRANSACTION_BATCH_SIZE = 100;

    /**
     * Create multiple entities in batch.
     * 
     * Supports parallel execution, automatic deduplication, and many-to-many relation handling.
     * Automatically extracts many-to-many relations and applies them after entity creation.
     * 
     * @template T - The entity type
     * @param entityModel - The Prisma model to use for creation
     * @param getModelInformation - Function to get model information
     * @param items - Array of items to create
     * @param options - Batch operation options (skipDuplicates, keyTransformTemplate, parallel, concurrency, handleRelations)
     * @returns Promise<number> - Number of entities created
     */
    public static async createMany<T extends Record<string, unknown> = Record<string, unknown>>(
        entityModel: EntityPrismaModel<T>,
        getModelInformation: () => ModelInfo,
        items: Partial<T>[],
        options?: {
            skipDuplicates?: boolean;
            keyTransformTemplate?: (relationName: string) => string;
            parallel?: boolean;
            concurrency?: number;
            handleRelations?: boolean;
        }
    ): Promise<number> {
        if (!entityModel) throw new Error("Model is not defined in the BaseEntity class.");
        if (!isNonEmptyArray(items)) return 0;

        const prisma = getPrismaInstance();
        const provider = getDatabaseProviderCached(prisma);
        const supportsSkipDuplicates =
            provider !== "sqlite" && provider !== "mongodb" && provider !== "sqlserver";

        const skipDuplicates = options?.skipDuplicates ?? false;
        const keyTransformTemplate =
            options?.keyTransformTemplate ?? ((key: string) => `${key}Id`);

        let modelInfo: ModelInfo | null = null;
        try {
            modelInfo = getModelInformation();
        } catch {
        }

        const handleRelations = options?.handleRelations !== false;
        const {
            cleanedItems: itemsToProcess,
            relations,
            relationTypes
        } = handleRelations
            ? DataUtils.extractManyToManyRelations(items, modelInfo)
            : {
                  cleanedItems: items,
                  relations: new Map<number, Record<string, unknown[]>>(),
                  relationTypes: new Map<string, "explicit" | "implicit">()
              };

        const processedData = itemsToProcess.map(item => {
            const clean = BaseEntityHelpers.sanitizeKeysRecursive(item);
            const processed = DataUtils.processRelations(clean, modelInfo);
            return DataUtils.normalizeRelationsToFK(processed, keyTransformTemplate);
        });

        const deduplicatedData = BaseEntityHelpers.deduplicateByUniqueConstraints(
            processedData,
            entityModel.name
        );

        if (deduplicatedData.length < processedData.length) {
            logError(
                "createMany - deduplication",
                new Error("Duplicate records removed from batch"),
                {
                    modelName: entityModel.name,
                    removed: processedData.length - deduplicatedData.length,
                    original: processedData.length,
                    deduplicated: deduplicatedData.length
                }
            );
        }

        const batchSize = getOptimalBatchSize("createMany", provider);
        const useParallel = options?.parallel !== false && isParallelEnabled();

        const result = await processBatches(
            deduplicatedData,
            batchSize,
            async batch => {
                const createOptions: { data: Record<string, unknown>[]; skipDuplicates?: boolean } = {
                    data: batch
                };
                if (skipDuplicates && supportsSkipDuplicates) {
                    createOptions.skipDuplicates = true;
                }

                if (!skipDuplicates && supportsSkipDuplicates) {
                    return await handleUniqueConstraintError(
                        async () => {
                            const createResult = await entityModel.createMany(createOptions);
                            return createResult.count;
                        },
                        async () => {
                            const retryResult = await entityModel.createMany({
                                data: batch,
                                skipDuplicates: true
                            });
                            return retryResult.count;
                        },
                        "createMany batch"
                    );
                } else {
                    const createResult = await entityModel.createMany(createOptions);
                    return createResult.count;
                }
            },
            {
                parallel: useParallel,
                concurrency: options?.concurrency
            }
        );

        const totalCreated = result.results.reduce((sum, count) => sum + count, 0);

        if (result.errors.length > 0) {
            logError(
                "createMany - parallel batches",
                new Error(`${result.errors.length} batches failed`),
                { failedCount: result.errors.length }
            );
        }

        if (handleRelations && relations.size > 0 && totalCreated > 0) {
            const uniqueConstraints = ModelUtils.getUniqueConstraints(entityModel.name);

            if (uniqueConstraints.length > 0) {
                const orConditions = deduplicatedData
                    .map(item => {
                        for (const constraint of uniqueConstraints) {
                            const constraintCondition: Record<string, unknown> = {};
                            let hasAllFields = true;

                            for (const field of constraint) {
                                const value = item[field];
                                if (value !== undefined && value !== null) {
                                    constraintCondition[field] = value;
                                } else {
                                    hasAllFields = false;
                                    break;
                                }
                            }

                            if (hasAllFields && Object.keys(constraintCondition).length > 0) {
                                return constraintCondition;
                            }
                        }
                        return null;
                    })
                    .filter(Boolean) as Record<string, unknown>[];

                if (orConditions.length > 0) {
                    try {
                        const createdRecords = await entityModel.findMany({
                            where: { OR: orConditions }
                        });

                        const recordMap = new Map<string, T & { id: number | string }>();
                        for (const record of createdRecords) {
                            for (const constraint of uniqueConstraints) {
                                const keyParts: string[] = [];
                                let hasAllFields = true;

                                for (const field of constraint) {
                                    const value = (record as Record<string, unknown>)[field];
                                    if (value !== undefined && value !== null) {
                                        keyParts.push(`${field}:${value}`);
                                    } else {
                                        hasAllFields = false;
                                        break;
                                    }
                                }

                                if (hasAllFields) {
                                    const key = keyParts.join("|");
                                    recordMap.set(key, record);
                                    break;
                                }
                            }
                        }

                        const fetchedIds: (number | string)[] = [];
                        for (let i = 0; i < itemsToProcess.length; i++) {
                            const item = itemsToProcess[i] as Record<string, unknown>;

                            if (!relations.has(i)) {
                                continue;
                            }

                            for (const constraint of uniqueConstraints) {
                                const keyParts: string[] = [];
                                let hasAllFields = true;

                                for (const field of constraint) {
                                    const value = item[field];
                                    if (value !== undefined && value !== null) {
                                        keyParts.push(`${field}:${value}`);
                                    } else {
                                        hasAllFields = false;
                                        break;
                                    }
                                }

                                if (hasAllFields) {
                                    const key = keyParts.join("|");
                                    const record = recordMap.get(key);
                                    if (record) {
                                        fetchedIds.push(record.id);
                                        break;
                                    }
                                }
                            }
                        }

                        if (fetchedIds.length > 0) {
                            const relationResult = await DataUtils.applyManyToManyRelations(
                                fetchedIds,
                                relations,
                                entityModel.name,
                                modelInfo,
                                relationTypes,
                                {
                                    parallel: options?.parallel,
                                    concurrency: options?.concurrency
                                }
                            );

                            if (relationResult.failed > 0) {
                                logError(
                                    "createMany - apply relations",
                                    new Error("Failed to apply many-to-many relations"),
                                    {
                                        failedCount: relationResult.failed,
                                        successCount: relationResult.success
                                    }
                                );
                            }
                        }
                    } catch (error) {
                        logError(
                            "createMany - apply relations",
                            error as Error,
                            { modelName: entityModel.name }
                        );
                    }
                }
            }
        }

        return totalCreated;
    }

    /**
     * Upsert multiple entities in batch (update if exists, create otherwise).
     * 
     * Optimized version that fetches all existing records in batch and compares changes efficiently.
     * Only updates records that have actual changes, skipping unchanged records.
     * Handles many-to-many relations for both created and updated entities.
     * 
     * @template T - The entity type
     * @param entityModel - The Prisma model to use
     * @param getModelInformation - Function to get model information
     * @param updateManyByIdFn - Function to perform batch updates
     * @param items - Array of items to upsert
     * @param options - Batch operation options (keyTransformTemplate, parallel, concurrency, handleRelations)
     * @returns Promise with created, updated, unchanged, and total counts
     */
    public static async upsertMany<T extends Record<string, unknown> = Record<string, unknown>>(
        entityModel: EntityPrismaModel<T>,
        getModelInformation: () => ModelInfo,
        updateManyByIdFn: (
            dataList: Array<Partial<T> & { id: number | string }>,
            options?: { parallel?: boolean; concurrency?: number }
        ) => Promise<number>,
        items: Partial<T>[],
        options?: {
            keyTransformTemplate?: (relationName: string) => string;
            parallel?: boolean;
            concurrency?: number;
            handleRelations?: boolean;
        }
    ): Promise<{ created: number; updated: number; unchanged: number; total: number }> {
        if (!entityModel) throw new Error("Model is not defined in the BaseEntity class.");
        if (!isNonEmptyArray(items)) {
            return { created: 0, updated: 0, unchanged: 0, total: 0 };
        }

        const modelName = entityModel.name;
        const uniqueConstraints = ModelUtils.getUniqueConstraints(modelName);

        if (!uniqueConstraints || uniqueConstraints.length === 0) {
            throw new Error(
                `No unique constraints found for model ${modelName}. Cannot perform upsert.`
            );
        }

        const keyTransformTemplate =
            options?.keyTransformTemplate ?? ((key: string) => `${key}Id`);

        let modelInfo: ModelInfo | null = null;
        try {
            modelInfo = getModelInformation();
        } catch {
        }

        const handleRelations = options?.handleRelations !== false;
        const {
            cleanedItems: itemsToProcess,
            relations,
            relationTypes
        } = handleRelations
            ? DataUtils.extractManyToManyRelations(items, modelInfo)
            : {
                  cleanedItems: items,
                  relations: new Map<number, Record<string, unknown[]>>(),
                  relationTypes: new Map<string, "explicit" | "implicit">()
              };

        const normalizedItems = itemsToProcess.map(item => {
            const clean = BaseEntityHelpers.sanitizeKeysRecursive(item);
            const processed = DataUtils.processRelations(clean, modelInfo);
            return DataUtils.normalizeRelationsToFK(processed, keyTransformTemplate);
        });

        const orConditions: Record<string, unknown>[] = [];
        const itemConstraintMap = new Map<number, Record<string, unknown>[]>();

        for (let index = 0; index < normalizedItems.length; index++) {
            const normalized = normalizedItems[index];

            for (const constraint of uniqueConstraints) {
                const whereClause: Record<string, unknown> = {};
                let hasAllFields = true;

                for (const field of constraint) {
                    const value = normalized[field];
                    if (value !== undefined && value !== null) {
                        whereClause[field] = value;
                    } else {
                        hasAllFields = false;
                        break;
                    }
                }

                if (hasAllFields && Object.keys(whereClause).length > 0) {
                    orConditions.push(whereClause);
                    let constraints = itemConstraintMap.get(index);
                    if (!constraints) {
                        constraints = [];
                        itemConstraintMap.set(index, constraints);
                    }
                    constraints.push(whereClause);
                    break;
                }
            }
        }

        let existingRecords: Array<T & { id: number | string }> = [];
        if (orConditions.length > 0) {
            try {
                const fieldsPerCondition = uniqueConstraints[0]?.length || 1;
                existingRecords = await executeWithOrBatching<T & { id: number | string }>(
                    entityModel,
                    orConditions,
                    {
                        parallel: options?.parallel,
                        concurrency: options?.concurrency,
                        fieldsPerCondition
                    }
                );
            } catch (error) {
                logError("upsertMany - fetch existing records", error as Error);
            }
        }

        const existingMap = new Map<string, T & { id: number | string }>();
        for (const record of existingRecords) {
            for (const constraint of uniqueConstraints) {
                const keyParts: string[] = new Array(constraint.length);
                for (let i = 0; i < constraint.length; i++) {
                    const field = constraint[i];
                    keyParts[i] = `${field}:${(record as Record<string, unknown>)[field]}`;
                }
                const key = keyParts.join("|");
                existingMap.set(key, record);
            }
        }

        const toCreate: Record<string, unknown>[] = [];
        const toCreateIndices: number[] = [];
        const toUpdate: Array<{
            id: number | string;
            data: Record<string, unknown>;
            originalIndex: number;
        }> = [];
        let unchanged = 0;

        for (let index = 0; index < normalizedItems.length; index++) {
            const normalized = normalizedItems[index];
            const constraints = itemConstraintMap.get(index);
            let existingRecord: (T & { id: number | string }) | undefined;

            if (constraints) {
                for (const constraint of constraints) {
                    const constraintKeys = Object.keys(constraint);
                    const keyParts: string[] = new Array(constraintKeys.length);
                    for (let i = 0; i < constraintKeys.length; i++) {
                        const field = constraintKeys[i];
                        keyParts[i] = `${field}:${constraint[field]}`;
                    }
                    const key = keyParts.join("|");
                    existingRecord = existingMap.get(key);
                    if (existingRecord) break;
                }
            }

            if (existingRecord) {
                if (
                    compareHasChanges(
                        normalized as Record<string, unknown>,
                        existingRecord as Record<string, unknown>
                    )
                ) {
                    toUpdate.push({
                        id: existingRecord.id,
                        data: normalized,
                        originalIndex: index
                    });
                } else {
                    unchanged++;
                }
            } else {
                toCreate.push(normalized);
                toCreateIndices.push(index);
            }
        }

        let created = 0;
        let updated = 0;

        const useParallel =
            options?.parallel !== false &&
            isParallelEnabled() &&
            (toCreate.length > 0 && toUpdate.length > 0);

        if (useParallel) {
            const operations: Array<() => Promise<number>> = [];

            if (toCreate.length > 0) {
                operations.push(async () => {
                    const prisma = getPrismaInstance();
                    const provider = getDatabaseProviderCached(prisma);
                    const supportsSkipDuplicates = provider !== "sqlite" && provider !== "mongodb";

                    return await withErrorHandling(
                        async () => {
                            const createOptions: {
                                data: Record<string, unknown>[];
                                skipDuplicates?: boolean;
                            } = { data: toCreate };
                            if (supportsSkipDuplicates) {
                                createOptions.skipDuplicates = true;
                            }
                            const result = await entityModel.createMany(createOptions);
                            return result.count;
                        },
                        "batch create",
                        async () => {
                            let count = 0;
                            for (const data of toCreate) {
                                try {
                                    await entityModel.create({ data });
                                    count++;
                                } catch (err) {
                                    logError("individual create", err as Error);
                                }
                            }
                            return count;
                        }
                    );
                });
            }

            if (toUpdate.length > 0) {
                operations.push(async () => {
                    return await withErrorHandling(
                        async () => {
                            const updateData: Array<Partial<T> & { id: number | string }> =
                                toUpdate.map(({ id, data }) => ({ id, ...(data as T) }));
                            return await updateManyByIdFn(updateData, { parallel: false });
                        },
                        "batch update",
                        async () => {
                            let count = 0;
                            for (const { id, data } of toUpdate) {
                                try {
                                    await entityModel.update({
                                        where: { id },
                                        data
                                    });
                                    count++;
                                } catch (err) {
                                    logError("individual update", err as Error);
                                }
                            }
                            return count;
                        }
                    );
                });
            }

            const result = await executeInParallel(operations, {
                concurrency: options?.concurrency
            });

            let resultIndex = 0;
            if (toCreate.length > 0) {
                created = result.results[resultIndex++] || 0;
            }
            if (toUpdate.length > 0) {
                updated = result.results[resultIndex++] || 0;
            }

            if (result.errors.length > 0) {
                logError(
                    "upsertMany - parallel operations",
                    new Error(`${result.errors.length} operations failed`),
                    { failedCount: result.errors.length }
                );
            }
        } else {
            if (toCreate.length > 0) {
                const prisma = getPrismaInstance();
                const provider = getDatabaseProviderCached(prisma);
                const supportsSkipDuplicates = provider !== "sqlite" && provider !== "mongodb";

                created = await withErrorHandling(
                    async () => {
                        const createOptions: {
                            data: Record<string, unknown>[];
                            skipDuplicates?: boolean;
                        } = { data: toCreate };
                        if (supportsSkipDuplicates) {
                            createOptions.skipDuplicates = true;
                        }
                        const result = await entityModel.createMany(createOptions);
                        return result.count;
                    },
                    "batch create",
                    async () => {
                        let count = 0;
                        for (const data of toCreate) {
                            try {
                                await entityModel.create({ data });
                                count++;
                            } catch (err) {
                                logError("individual create", err as Error);
                            }
                        }
                        return count;
                    }
                );
            }

            if (toUpdate.length > 0) {
                updated = await withErrorHandling(
                    async () => {
                        const updateData: Array<Partial<T> & { id: number | string }> =
                            toUpdate.map(({ id, data }) => ({ id, ...(data as T) }));
                        return await updateManyByIdFn(updateData, { parallel: false });
                    },
                    "batch update",
                    async () => {
                        let count = 0;
                        for (const { id, data } of toUpdate) {
                            try {
                                await entityModel.update({
                                    where: { id },
                                    data
                                });
                                count++;
                            } catch (err) {
                                logError(`individual update for record ${id}`, err as Error);
                            }
                        }
                        return count;
                    }
                );
            }
        }

        if (handleRelations && relations.size > 0 && (created > 0 || updated > 0)) {
            const entityIdToIndexMap = new Map<number | string, number>();

            if (created > 0 && toCreate.length > 0) {
                const createdOrConditions = toCreate
                    .map(item => {
                        for (const constraint of uniqueConstraints) {
                            const whereClause: Record<string, unknown> = {};
                            let hasAllFields = true;

                            for (const field of constraint) {
                                const value = item[field];
                                if (value !== undefined && value !== null) {
                                    whereClause[field] = value;
                                } else {
                                    hasAllFields = false;
                                    break;
                                }
                            }

                            if (hasAllFields && Object.keys(whereClause).length > 0) {
                                return whereClause;
                            }
                        }
                        return null;
                    })
                    .filter(Boolean) as Record<string, unknown>[];

                if (createdOrConditions.length > 0) {
                    try {
                        const createdRecords = await entityModel.findMany({
                            where: { OR: createdOrConditions }
                        });

                        for (let i = 0; i < toCreate.length; i++) {
                            const item = toCreate[i];
                            const originalIndex = toCreateIndices[i];

                            if (!relations.has(originalIndex)) {
                                continue;
                            }

                            for (const record of createdRecords) {
                                let matches = true;
                                for (const constraint of uniqueConstraints) {
                                    for (const field of constraint) {
                                        if (
                                            item[field] !==
                                            (record as Record<string, unknown>)[field]
                                        ) {
                                            matches = false;
                                            break;
                                        }
                                    }
                                    if (matches) break;
                                }

                                if (matches) {
                                    entityIdToIndexMap.set(record.id, originalIndex);
                                    break;
                                }
                            }
                        }
                    } catch (error) {
                        logError("upsertMany - fetch created IDs", error as Error);
                    }
                }
            }

            if (updated > 0 && toUpdate.length > 0) {
                for (const item of toUpdate) {
                    if (relations.has(item.originalIndex)) {
                        entityIdToIndexMap.set(item.id, item.originalIndex);
                    }
                }
            }

            const allEntityIds: (number | string)[] = [];
            const remappedRelations = new Map<number, Record<string, unknown[]>>();

            let newIndex = 0;
            for (const [entityId, originalIndex] of entityIdToIndexMap.entries()) {
                allEntityIds.push(entityId);
                const relationData = relations.get(originalIndex);
                if (relationData) {
                    remappedRelations.set(newIndex, relationData);
                }
                newIndex++;
            }

            if (allEntityIds.length > 0 && remappedRelations.size > 0) {
                try {
                    const relationResult = await DataUtils.applyManyToManyRelations(
                        allEntityIds,
                        remappedRelations,
                        entityModel.name,
                        modelInfo,
                        relationTypes,
                        {
                            parallel: options?.parallel,
                            concurrency: options?.concurrency
                        }
                    );

                    if (relationResult.failed > 0) {
                        logError(
                            "upsertMany - apply relations",
                            new Error("Failed to apply many-to-many relations"),
                            {
                                failedCount: relationResult.failed,
                                successCount: relationResult.success
                            }
                        );
                    }
                } catch (error) {
                    logError("upsertMany - apply relations", error as Error);
                }
            }
        }

        return {
            created,
            updated,
            unchanged,
            total: items.length
        };
    }

    /**
     * Update multiple entities by ID in batch.
     * 
     * Supports parallel execution and database-specific optimizations.
     * Uses optimized SQL CASE WHEN statements for SQL databases and transactions for MongoDB.
     * 
     * @param entityModel - The Prisma model to use
     * @param getModelInformation - Function to get model information
     * @param buildUpdateQueryFn - Function to build optimized SQL update query
     * @param prepareUpdateListFn - Function to prepare data for update
     * @param dataList - Array of data to update (must include id field)
     * @param options - Batch operation options (parallel, concurrency)
     * @returns Promise<number> - Number of entities updated
     */
    public static async updateManyById(
        entityModel: EntityPrismaModel<Record<string, unknown>>,
        getModelInformation: () => ModelInfo,
        buildUpdateQueryFn: (
            batch: Array<Record<string, unknown>>,
            tableName: string,
            modelInfo?: ModelInfo
        ) => { query: string | null; idsInBatch: Set<number> },
        prepareUpdateListFn: (
            dataList: Array<Partial<Record<string, unknown>>>,
            modelInfo?: ModelInfo
        ) => Array<Record<string, unknown>>,
        dataList: Array<Partial<Record<string, unknown>>>,
        options?: {
            parallel?: boolean;
            concurrency?: number;
        }
    ): Promise<number> {
        if (!isNonEmptyArray(dataList)) return 0;

        const prisma = getPrismaInstance();
        const provider = getDatabaseProviderCached(prisma);
        const modelInfo = getModelInformation();
        const tableName = (modelInfo as any).dbName || modelInfo.name || entityModel?.name;

        if (!tableName) {
            throw new Error("Could not determine table name for updateManyById");
        }

        const formattedList = prepareUpdateListFn(dataList, modelInfo);

        if (provider === "mongodb") {
            return await this.updateManyByIdMongoDB(formattedList, entityModel, prisma);
        }

        const batchSize = getOptimalBatchSize("updateMany", provider);
        const useParallel = options?.parallel !== false && isParallelEnabled();

        const result = await processBatches(
            formattedList,
            batchSize,
            async batch => {
                const { query } = buildUpdateQueryFn(batch, tableName, modelInfo);
                if (!query) return 0;

                return await withErrorHandling(
                    async () => {
                        const updateResult = await (prisma as unknown as PrismaClient).$executeRawUnsafe(
                            query
                        );
                        return updateResult as number;
                    },
                    "batch update"
                );
            },
            {
                parallel: useParallel,
                concurrency: options?.concurrency
            }
        );

        const totalUpdated = result.results.reduce((sum, count) => sum + count, 0);

        if (result.errors.length > 0) {
            logError(
                "updateManyById - parallel batches",
                new Error(`${result.errors.length} batches failed`),
                { failedCount: result.errors.length }
            );
        }

        return totalUpdated;
    }

    /**
     * Optimized MongoDB batch update using transactions.
     * 
     * Uses MongoDB transactions to batch updates efficiently.
     * Falls back to individual updates if transaction fails.
     * 
     * @param formattedList - Array of formatted update data
     * @param entityModel - The Prisma model to use
     * @param prisma - Prisma client instance
     * @returns Promise<number> - Number of entities updated
     * 
     * @internal
     */
    public static async updateManyByIdMongoDB(
        formattedList: Array<Record<string, unknown>>,
        entityModel: EntityPrismaModel<Record<string, unknown>>,
        prisma: PrismaClient
    ): Promise<number> {
        let totalUpdated = 0;
        const batchSize = this.MONGODB_TRANSACTION_BATCH_SIZE;

        for (let i = 0; i < formattedList.length; i += batchSize) {
            const batch = formattedList.slice(i, i + batchSize);

            try {
                const results = await (prisma as any).$transaction(
                    batch.map(item => {
                        const { id, ...data } = item as { id: number | string } & Record<
                            string,
                            unknown
                        >;
                        return entityModel.update({ where: { id }, data });
                    }),
                    {
                        maxWait: 5000,
                        timeout: 10000
                    }
                );
                totalUpdated += results.length;
            } catch (error) {
                logError(
                    "updateManyByIdMongoDB - batch update",
                    error as Error,
                    {
                        batchStart: i + 1,
                        batchEnd: Math.min(i + batch.length, formattedList.length)
                    }
                );

                for (const item of batch) {
                    const { id, ...data } = item as { id: number | string } & Record<
                        string,
                        unknown
                    >;
                    try {
                        await entityModel.update({ where: { id }, data });
                        totalUpdated++;
                    } catch (itemError) {
                        logError(
                            "updateManyByIdMongoDB - individual update",
                            itemError as Error,
                            { recordId: id }
                        );
                    }
                }
            }
        }

        return totalUpdated;
    }

    /**
     * Delete multiple entities by their IDs in parallel batches.
     * 
     * Automatically batches delete operations based on database provider.
     * Supports parallel execution for improved performance.
     * 
     * @param entityModel - The Prisma model to use
     * @param ids - Array of entity IDs to delete
     * @param options - Batch operation options (parallel, concurrency)
     * @returns Promise<number> - Number of entities deleted
     */
    public static async deleteByIds(
        entityModel: Pick<EntityPrismaModel<Record<string, unknown>>, "deleteMany">,
        ids: Array<number | string>,
        options?: {
            parallel?: boolean;
            concurrency?: number;
        }
    ): Promise<number> {
        if (!entityModel) throw new Error("The model is not defined in the BaseEntity class.");
        if (!isNonEmptyArray(ids)) return 0;

        const batchSize = getOptimalBatchSize("delete");
        const useParallel = options?.parallel !== false && isParallelEnabled();

        const result = await processBatches(
            ids,
            batchSize,
            async batch => {
                try {
                    const deleteResult = await entityModel.deleteMany({
                        where: { id: { in: batch } }
                    });
                    return deleteResult.count || 0;
                } catch (error) {
                    logError("deleteByIds", error as Error, { batchSize: batch.length });
                    throw error;
                }
            },
            {
                parallel: useParallel,
                concurrency: options?.concurrency
            }
        );

        const totalDeleted = result.results.reduce((sum, count) => sum + count, 0);

        if (result.errors.length > 0) {
            logError(
                "deleteByIds - parallel batches",
                new Error(`${result.errors.length} batches failed`),
                { failedCount: result.errors.length }
            );
        }

        return totalDeleted;
    }
}
