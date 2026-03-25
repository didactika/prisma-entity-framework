import { PrismaClient } from "@prisma/client";
import DataUtils from "./data-utils";
import ModelUtils from "./model-utils";
import {
    getConfig,
    getPrismaInstance,
    isParallelEnabled,
    type UpsertManyAfterHookPayload,
    type UpsertManyBeforeHookPayload,
    type UpsertManyHooks,
    type UpsertManyResultSummary
} from "./config";
import { getDatabaseProviderCached, quoteIdentifier } from "./utils/database-utils";
import { isNonEmptyArray } from "./utils/validation-utils";
import { getOptimalBatchSize, processBatches } from "./utils/batch-utils";
import { logError, handleUniqueConstraintError, withErrorHandling } from "./utils/error-utils";
import { executeWithOrBatching } from "./query-utils";
import { hasChanges as compareHasChanges } from "./utils/comparison-utils";
import BaseEntityHelpers from "./base-entity-helpers";
import { EntityPrismaModel } from "./structures/interfaces/entity.interface";
import {
    executeMassivePostgresUpsert,
    executeRawUpsertBatch,
    getUpsertMetadata,
    type UpsertDetailedResult
} from "./upsert-utils";

type ModelInfo = ReturnType<typeof ModelUtils.getModelInformationCached>;
type EntityId = number | string;

export type UpsertManyResult = UpsertDetailedResult;

type UpsertManyRelationsContext<TModel extends object> = {
    entityModel: EntityPrismaModel<TModel>;
    modelInfo: ModelInfo | null;
    normalizedItems: Record<string, unknown>[];
    uniqueConstraints: string[][];
    relations: Map<number, Record<string, unknown[]>>;
    relationTypes: Map<string, "explicit" | "implicit">;
    options?: { parallel?: boolean; concurrency?: number };
    targetEntityIds?: Array<EntityId>;
};

type UpsertManyOptions = {
    keyTransformTemplate?: (relationName: string) => string;
    parallel?: boolean;
    concurrency?: number;
    handleRelations?: boolean;
    useRawQuery?: boolean;
    hooks?: UpsertManyHooks;
};

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

    private static createEmptyUpsertManyResult(total: number): UpsertManyResult {
        return {
            counts: { created: 0, updated: 0, unchanged: 0, total },
            items: { createdIds: [], updatedIds: [], unchangedIds: [] }
        };
    }

    private static createUpsertManyResult(
        counts: { created: number; updated: number; unchanged: number; total: number },
        items: {
            createdIds: Array<EntityId>;
            updatedIds: Array<EntityId>;
            unchangedIds: Array<EntityId>;
        }
    ): UpsertManyResult {
        return { counts, items };
    }

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
    public static async createMany<TModel extends object>(
        entityModel: EntityPrismaModel<TModel>,
        getModelInformation: () => ModelInfo,
        items: Partial<TModel>[],
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
            entityModel.name!
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
            const uniqueConstraints = ModelUtils.getUniqueConstraints(entityModel.name!);

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

                        const recordMap = new Map<string, TModel & { id: number | string }>();
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
                                entityModel.name!,
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
    public static async upsertMany<TModel extends object>(
        entityModel: EntityPrismaModel<TModel>,
        getModelInformation: () => ModelInfo,
        updateManyByIdFn: (
            dataList: Array<Partial<TModel> & { id: number | string }>,
            options?: { parallel?: boolean; concurrency?: number }
        ) => Promise<number>,
        items: Partial<TModel>[],
        options?: UpsertManyOptions
    ): Promise<UpsertManyResult> {
        if (!entityModel) throw new Error("Model is not defined in the BaseEntity class.");
        if (!isNonEmptyArray(items)) {
            return this.createEmptyUpsertManyResult(0);
        }

        const modelName = entityModel.name;
        const uniqueConstraints = ModelUtils.getUniqueConstraints(modelName!);

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

        const hasSparseShape = (() => {
            if (normalizedItems.length <= 1) return false;

            const fieldCounts = new Map<string, number>();
            for (const item of normalizedItems) {
                for (const key of Object.keys(item)) {
                    fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1);
                }
            }

            for (const count of fieldCounts.values()) {
                if (count > 0 && count < normalizedItems.length) {
                    return true;
                }
            }

            return false;
        })();

        const prisma = getPrismaInstance();
        const provider = getDatabaseProviderCached(prisma);
        const config = getConfig();
        const resolvedUseRawQuery = options?.useRawQuery ?? config.upsertManyUseRawQuery ?? true;

        if (provider === 'postgresql' && modelInfo && resolvedUseRawQuery && !hasSparseShape) {
            const beforeHookPayload: UpsertManyBeforeHookPayload = {
                modelName: modelName!,
                provider,
                useRawQuery: true,
                totalItems: items.length,
                originalItems: items as Array<Record<string, unknown>>,
                normalizedItems
            };

            await this.runBeforeUpsertManyHooks(config.upsertManyHooks, options?.hooks, beforeHookPayload);

            const meta = getUpsertMetadata(modelName!, modelInfo);
            const result = await executeMassivePostgresUpsert(meta, normalizedItems, prisma);

            if (handleRelations && relations.size > 0 && (result.counts.created > 0 || result.counts.updated > 0)) {
                await this.applyUpsertManyRelations(
                    {
                        entityModel,
                        modelInfo,
                        normalizedItems,
                        uniqueConstraints,
                        relations,
                        relationTypes,
                        options,
                        targetEntityIds: [...result.items.createdIds, ...result.items.updatedIds]
                    }
                );
            }

            const afterHookPayload: UpsertManyAfterHookPayload = {
                modelName: modelName!,
                provider,
                useRawQuery: true,
                totalItems: items.length,
                result: {
                    created: {
                        count: result.counts.created,
                        items: result.items.createdIds
                    },
                    updated: {
                        count: result.counts.updated,
                        items: result.items.updatedIds
                    },
                    unchanged: {
                        count: result.counts.unchanged,
                        items: result.items.unchangedIds
                    },
                    total: result.counts.total
                }
            };

            await this.runAfterUpsertManyHooks(config.upsertManyHooks, options?.hooks, afterHookPayload);
            return result;
        }

        // ------------------------------------------------------------------
        // Route: Raw SQL upsert for SQL databases, legacy path for MongoDB
        // ------------------------------------------------------------------
        const hasAfterHook = Boolean(config.upsertManyHooks?.after || options?.hooks?.after);
        let effectiveUseRawQuery = provider !== "mongodb" && resolvedUseRawQuery;
        let rawEligibleItems = normalizedItems;
        let preProcessedCreated = 0;
        let preProcessedUpdated = 0;
        let preProcessedUnchanged = 0;
        const createdItemIds: Array<EntityId> = [];
        const updatedItemIds: Array<EntityId> = [];
        const unchangedItemIds: Array<EntityId> = [];

        if (provider !== "mongodb" && resolvedUseRawQuery && modelInfo) {
            const missingRequiredFields = Array.from(new Set(this.getMissingRequiredRawInsertFields(modelInfo, normalizedItems)));
            if (missingRequiredFields.length > 0) {
                const missingFieldSet = new Set(missingRequiredFields);
                const missingRequiredItems: Record<string, unknown>[] = [];
                const eligibleForRaw: Record<string, unknown>[] = [];

                for (const item of normalizedItems) {
                    const hasMissingRequired = Array.from(missingFieldSet).some(fieldName => {
                        const value = item[fieldName];
                        return value === undefined || value === null;
                    });

                    if (hasMissingRequired) {
                        missingRequiredItems.push(item);
                    } else {
                        eligibleForRaw.push(item);
                    }
                }

                const updateOnlyResult = await this.processMissingRequiredItemsAsUpdateOnlyRaw(
                    prisma,
                    modelInfo,
                    missingRequiredItems,
                    uniqueConstraints,
                    true
                );

                preProcessedUpdated += updateOnlyResult.updated;
                preProcessedUnchanged += updateOnlyResult.unchanged;
                updatedItemIds.push(...updateOnlyResult.updatedItemIds);
                unchangedItemIds.push(...updateOnlyResult.unchangedItemIds);

                if (updateOnlyResult.unresolved.length > 0) {
                    throw new Error(
                        `Raw upsert cannot process ${updateOnlyResult.unresolved.length} item(s) with missing required fields because no existing row matched their unique keys.`
                    );
                }

                rawEligibleItems = eligibleForRaw;
                effectiveUseRawQuery = rawEligibleItems.length > 0;
            }
        }

        const beforeHookPayload: UpsertManyBeforeHookPayload = {
            modelName: modelName!,
            provider,
            useRawQuery: effectiveUseRawQuery,
            totalItems: items.length,
            originalItems: items as Array<Record<string, unknown>>,
            normalizedItems
        };

        await this.runBeforeUpsertManyHooks(config.upsertManyHooks, options?.hooks, beforeHookPayload);

        let created = 0;
        let updated = 0;
        let unchanged = 0;
        const rawHandledAllPreprocessed = provider !== "mongodb" && resolvedUseRawQuery && rawEligibleItems.length === 0;

        if (provider === 'mongodb') {
            // --- MongoDB: keep legacy multi-query approach ---
            const legacyResult = await this.upsertManyLegacy(
                entityModel,
                updateManyByIdFn,
                normalizedItems,
                uniqueConstraints,
                options,
                false,
                true
            );
            created = legacyResult.created;
            updated = legacyResult.updated;
            unchanged = legacyResult.unchanged;
            createdItemIds.push(...legacyResult.createdItemIds);
            updatedItemIds.push(...legacyResult.updatedItemIds);
            unchangedItemIds.push(...legacyResult.unchangedItemIds);
        } else if (rawHandledAllPreprocessed) {
            // All rows were handled by raw update-only preprocessing.
        } else if (effectiveUseRawQuery) {
            // --- SQL databases: single-statement raw upsert ---
            if (!modelInfo) {
                throw new Error(`Model information is required for raw upsert on ${provider}.`);
            }

            if (rawEligibleItems.length > 0) {
                const rawBuckets = await this.classifyRawEligibleItems(
                    entityModel,
                    rawEligibleItems,
                    uniqueConstraints,
                    options
                );

                const rawResult = await executeRawUpsertBatch(
                    modelName!,
                    modelInfo,
                    rawEligibleItems,
                    {
                        parallel: options?.parallel,
                        concurrency: options?.concurrency
                    }
                );

                created = rawResult.created;
                updated = rawResult.updated;
                unchanged = rawResult.unchanged;

                createdItemIds.push(...rawBuckets.createdItemIds);
                if (rawBuckets.createdWhereClauses.length > 0) {
                    const resolvedCreatedIds = await this.resolveIdsFromWhereClauses(
                        entityModel,
                        rawBuckets.createdWhereClauses,
                        uniqueConstraints,
                        options
                    );
                    createdItemIds.push(...resolvedCreatedIds);
                }
                updatedItemIds.push(...rawBuckets.updatedItemIds);
                unchangedItemIds.push(...rawBuckets.unchangedItemIds);
            }
        } else {
            // --- SQL databases with Prisma operations (middleware/extensions compatible) ---
            const prismaOpsResult = await this.upsertManyLegacy(
                entityModel,
                updateManyByIdFn,
                normalizedItems,
                uniqueConstraints,
                options,
                true,
                true
            );
            created = prismaOpsResult.created;
            updated = prismaOpsResult.updated;
            unchanged = prismaOpsResult.unchanged;
            createdItemIds.push(...prismaOpsResult.createdItemIds);
            updatedItemIds.push(...prismaOpsResult.updatedItemIds);
            unchangedItemIds.push(...prismaOpsResult.unchangedItemIds);
        }

        created += preProcessedCreated;
        updated += preProcessedUpdated;
        unchanged += preProcessedUnchanged;

        if (handleRelations && relations.size > 0 && (created > 0 || updated > 0) && provider !== 'mongodb') {
            await this.applyUpsertManyRelations(
                {
                    entityModel,
                    modelInfo,
                    normalizedItems,
                    uniqueConstraints,
                    relations,
                    relationTypes,
                    options
                }
            );
        }

        if (hasAfterHook) {
            const summary: UpsertManyResultSummary = {
                created: {
                    count: created,
                    items: createdItemIds
                },
                updated: {
                    count: updated,
                    items: updatedItemIds
                },
                unchanged: {
                    count: unchanged,
                    items: unchangedItemIds
                },
                total: items.length
            };

            const afterHookPayload: UpsertManyAfterHookPayload = {
                modelName: modelName!,
                provider,
                useRawQuery: effectiveUseRawQuery,
                totalItems: items.length,
                result: summary
            };

            await this.runAfterUpsertManyHooks(config.upsertManyHooks, options?.hooks, afterHookPayload);
        }

        return this.createUpsertManyResult(
            {
                created,
                updated,
                unchanged,
                total: items.length
            },
            {
                createdIds: createdItemIds,
                updatedIds: updatedItemIds,
                unchangedIds: unchangedItemIds
            }
        );
    }

    private static async applyUpsertManyRelations<TModel extends object>(
        context: UpsertManyRelationsContext<TModel>
    ): Promise<void> {
        const {
            entityModel,
            modelInfo,
            normalizedItems,
            uniqueConstraints,
            relations,
            relationTypes,
            options,
            targetEntityIds
        } = context;
        const entityIdToIndexMap = new Map<number | string, number>();
        const allowedEntityIds = targetEntityIds ? new Set(targetEntityIds) : null;

        const orConditionsForM2M: Record<string, unknown>[] = [];
        const indexMap = new Map<string, number>();

        for (let i = 0; i < normalizedItems.length; i++) {
            if (!relations.has(i)) continue;
            const item = normalizedItems[i];
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
                    orConditionsForM2M.push(whereClause);
                    const keyParts = constraint.map(f => `${f}:${item[f]}`);
                    indexMap.set(keyParts.join('|'), i);
                    break;
                }
            }
        }

        if (orConditionsForM2M.length > 0) {
            try {
                const records = await entityModel.findMany({
                    where: { OR: orConditionsForM2M }
                });
                for (const record of records) {
                    if (allowedEntityIds && !allowedEntityIds.has(record.id)) {
                        continue;
                    }

                    for (const constraint of uniqueConstraints) {
                        const keyParts = constraint.map(f =>
                            `${f}:${(record as Record<string, unknown>)[f]}`
                        );
                        const origIdx = indexMap.get(keyParts.join('|'));
                        if (origIdx !== undefined) {
                            entityIdToIndexMap.set(record.id, origIdx);
                            break;
                        }
                    }
                }
            } catch (error) {
                logError("upsertMany - fetch IDs for M2M", error as Error);
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
                    entityModel.name!,
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

    private static async runBeforeUpsertManyHooks(
        globalHooks: UpsertManyHooks | undefined,
        localHooks: UpsertManyHooks | undefined,
        payload: UpsertManyBeforeHookPayload
    ): Promise<void> {
        const hooks = [globalHooks?.before, localHooks?.before];
        for (const hook of hooks) {
            if (!hook) continue;
            await hook(payload);
        }
    }

    private static async runAfterUpsertManyHooks(
        globalHooks: UpsertManyHooks | undefined,
        localHooks: UpsertManyHooks | undefined,
        payload: UpsertManyAfterHookPayload
    ): Promise<void> {
        const hooks = [globalHooks?.after, localHooks?.after];
        for (const hook of hooks) {
            if (!hook) continue;
            await hook(payload);
        }
    }

    private static getMissingRequiredRawInsertFields(
        modelInfo: ModelInfo,
        items: Record<string, unknown>[]
    ): string[] {
        const requiredNoDefaultFields = (modelInfo.fields || [])
            .filter((field: any) => field.kind === 'scalar' || field.kind === 'enum')
            .filter((field: any) => {
                const name = String(field.name ?? '');
                const lowerName = name.toLowerCase();
                const isId = Boolean(field.isId) || name === 'id';
                const isCreatedAtLike = lowerName === 'createdat' || lowerName === 'created_at';
                const isUpdatedAtLike = lowerName === 'updatedat' || lowerName === 'updated_at';
                const isManagedTimestamp = Boolean(field.isUpdatedAt) || isCreatedAtLike || isUpdatedAtLike;
                const hasRuntimeDefault = field.default !== undefined && field.default !== null;
                const hasDefault = Boolean(field.hasDefaultValue) || hasRuntimeDefault || isId || isCreatedAtLike;
                const isRequired = field.isRequired === true;

                return !isId && isRequired && !hasDefault && !isManagedTimestamp;
            })
            .map((field: any) => String(field.name));

        if (requiredNoDefaultFields.length === 0) {
            return [];
        }

        const missing: string[] = [];
        for (const item of items) {
            for (const fieldName of requiredNoDefaultFields) {
                if (item[fieldName] === undefined || item[fieldName] === null) {
                    missing.push(fieldName);
                }
            }
        }

        return missing;
    }

    private static async processMissingRequiredItemsAsUpdateOnlyRaw(
        prisma: PrismaClient,
        modelInfo: ModelInfo,
        items: Record<string, unknown>[],
        uniqueConstraints: string[][],
        collectItems: boolean
    ): Promise<{
        updated: number;
        unchanged: number;
        updatedItemIds: Array<EntityId>;
        unchangedItemIds: Array<EntityId>;
        unresolved: Record<string, unknown>[];
    }> {
        if (!isNonEmptyArray(items)) {
            return { updated: 0, unchanged: 0, updatedItemIds: [], unchangedItemIds: [], unresolved: [] };
        }

        const matchableClauses: Record<string, unknown>[] = [];
        const keyToItem = new Map<string, Record<string, unknown>>();
        const unresolved: Record<string, unknown>[] = [];

        for (const item of items) {
            let hasMatchableUnique = false;
            for (const constraint of uniqueConstraints) {
                const whereClause: Record<string, unknown> = {};
                let hasAllUniqueValues = true;
                for (const field of constraint) {
                    const value = item[field];
                    if (value === undefined || value === null) {
                        hasAllUniqueValues = false;
                        break;
                    }
                    whereClause[field] = value;
                }

                if (hasAllUniqueValues && Object.keys(whereClause).length > 0) {
                    matchableClauses.push(whereClause);
                    const keyParts = constraint.map(field => `${field}:${item[field]}`);
                    keyToItem.set(keyParts.join('|'), item);
                    hasMatchableUnique = true;
                    break;
                }
            }

            if (!hasMatchableUnique) {
                unresolved.push(item);
            }
        }

        if (matchableClauses.length === 0) {
            return { updated: 0, unchanged: 0, updatedItemIds: [], unchangedItemIds: [], unresolved };
        }

        let existingList: Array<Record<string, unknown> & { id: number | string }> = [];
        if (matchableClauses.length > 0) {
            try {
                const fieldMap = new Map<string, string>();
                for (const field of modelInfo.fields) {
                    fieldMap.set(String((field as any).name), String((field as any).dbName || (field as any).name));
                }

                const selectableFields = new Set<string>(['id']);
                for (const item of items) {
                    for (const key of Object.keys(item)) selectableFields.add(key);
                }
                for (const constraint of uniqueConstraints) {
                    for (const field of constraint) selectableFields.add(field);
                }

                const selectColumns = Array.from(selectableFields).map(field => {
                    const dbName = fieldMap.get(field) || field;
                    return `${quoteIdentifier(dbName, prisma)} AS ${quoteIdentifier(field, prisma)}`;
                }).join(', ');

                const whereChunks = matchableClauses.map(clause => {
                    const parts = Object.entries(clause).map(([field, value]) => {
                        const dbName = fieldMap.get(field) || field;
                        const escaped = BaseEntityHelpers.escapeValue(value, prisma, false);
                        return `${quoteIdentifier(dbName, prisma)} = ${escaped}`;
                    });
                    return `(${parts.join(' AND ')})`;
                });

                const tableName = quoteIdentifier((modelInfo as any).dbName || (modelInfo as any).name, prisma);
                const sql = `SELECT ${selectColumns} FROM ${tableName} WHERE ${whereChunks.join(' OR ')}`;
                const existing = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql);
                existingList = Array.isArray(existing)
                    ? existing.filter((row): row is Record<string, unknown> & { id: number | string } =>
                        row !== null && typeof row === 'object' && row.id !== undefined)
                    : [];
            } catch (error) {
                logError("upsertMany - fetch existing for missing-required update-only", error as Error);
                for (const item of keyToItem.values()) {
                    unresolved.push(item);
                }
                return { updated: 0, unchanged: 0, updatedItemIds: [], unchangedItemIds: [], unresolved };
            }
        }

        const existingMap = new Map<string, Record<string, unknown> & { id: number | string }>();
        for (const record of existingList) {
            for (const constraint of uniqueConstraints) {
                const keyParts: string[] = [];
                let complete = true;
                for (const field of constraint) {
                    const value = (record as Record<string, unknown>)[field];
                    if (value === undefined || value === null) {
                        complete = false;
                        break;
                    }
                    keyParts.push(`${field}:${value}`);
                }
                if (complete && keyParts.length > 0) {
                    existingMap.set(keyParts.join('|'), record);
                }
            }
        }

        let updated = 0;
        let unchanged = 0;
        const updatedItemIds: Array<EntityId> = [];
        const unchangedItemIds: Array<EntityId> = [];
        const toUpdate: Array<{ id: number | string; data: Record<string, unknown> }> = [];

        for (const [key, item] of keyToItem.entries()) {
            const existingRecord = existingMap.get(key);
            if (!existingRecord) {
                unresolved.push(item);
                continue;
            }

            if (!compareHasChanges(item, existingRecord as Record<string, unknown>)) {
                unchanged++;
                if (collectItems) unchangedItemIds.push(existingRecord.id);
                continue;
            }

            toUpdate.push({ id: existingRecord.id, data: item });
        }

        if (toUpdate.length > 0) {
            const fieldMap = new Map<string, string>();
            for (const field of modelInfo.fields) {
                fieldMap.set(String((field as any).name), String((field as any).dbName || (field as any).name));
            }
            const tableName = quoteIdentifier((modelInfo as any).dbName || (modelInfo as any).name, prisma);
            const qId = quoteIdentifier('id', prisma);

            try {
                for (const row of toUpdate) {
                    const setClauses: string[] = [];
                    for (const [field, value] of Object.entries(row.data)) {
                        if (field === 'id' || value === undefined) continue;
                        const dbName = fieldMap.get(field) || field;
                        const escaped = BaseEntityHelpers.escapeValue(value, prisma, false);
                        setClauses.push(`${quoteIdentifier(dbName, prisma)} = ${escaped}`);
                    }

                    if (setClauses.length === 0) {
                        unchanged++;
                        continue;
                    }

                    const escapedId = BaseEntityHelpers.escapeValue(row.id, prisma, false);
                    const sql = `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE ${qId} = ${escapedId}`;
                    const result = await prisma.$executeRawUnsafe(sql);
                    const affected = Number(result);
                    if (Number.isFinite(affected) && affected > 0) {
                        updated++;
                        if (collectItems) updatedItemIds.push(row.id);
                    } else {
                        unresolved.push(row.data);
                    }
                }
            } catch (error) {
                logError("upsertMany - raw update existing missing-required items", error as Error);
                for (const updateItem of toUpdate) {
                    unresolved.push(updateItem.data);
                }
                updated = 0;
            }
        }

        return {
            updated,
            unchanged,
            updatedItemIds,
            unchangedItemIds,
            unresolved
        };
    }

    private static async classifyRawEligibleItems<TModel extends object>(
        entityModel: EntityPrismaModel<TModel>,
        items: Record<string, unknown>[],
        uniqueConstraints: string[][],
        options?: { parallel?: boolean; concurrency?: number }
    ): Promise<{
        createdItemIds: Array<EntityId>;
        updatedItemIds: Array<EntityId>;
        unchangedItemIds: Array<EntityId>;
        createdWhereClauses: Array<Record<string, unknown>>;
    }> {
        if (!isNonEmptyArray(items)) {
            return { createdItemIds: [], updatedItemIds: [], unchangedItemIds: [], createdWhereClauses: [] };
        }

        // Deduplicate by first fully-matchable unique constraint (last-write-wins),
        // while tracking removed duplicates as unchanged (same behavior as raw upsert counters).
        const dedupMap = new Map<string, Record<string, unknown>>();
        const duplicateItems: Array<Record<string, unknown>> = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            let dedupKey: string | null = null;

            for (const constraint of uniqueConstraints) {
                const keyParts: string[] = [];
                let hasAllUnique = true;

                for (const field of constraint) {
                    const value = item[field];
                    if (value === undefined || value === null) {
                        hasAllUnique = false;
                        break;
                    }
                    keyParts.push(`${field}:${String(value)}`);
                }

                if (hasAllUnique && keyParts.length > 0) {
                    dedupKey = keyParts.join('|');
                    break;
                }
            }

            if (!dedupKey) {
                dedupKey = `__row_${i}`;
            }

            if (dedupMap.has(dedupKey)) {
                duplicateItems.push(dedupMap.get(dedupKey) as Record<string, unknown>);
            }
            dedupMap.set(dedupKey, item);
        }

        const dedupedItems = Array.from(dedupMap.values());
        const createdItemIds: Array<EntityId> = [];
        const updatedItemIds: Array<EntityId> = [];
        const unchangedItemIds: Array<EntityId> = [];
        const createdWhereClauses: Array<Record<string, unknown>> = [];

        const orConditions: Record<string, unknown>[] = [];
        const itemConstraintMap = new Map<number, Record<string, unknown>[]>();

        for (let index = 0; index < dedupedItems.length; index++) {
            const normalized = dedupedItems[index];
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

        let existingRecords: Array<TModel & { id: number | string }> = [];
        if (orConditions.length > 0) {
            try {
                const fieldsPerCondition = uniqueConstraints[0]?.length || 1;
                const fetched = await executeWithOrBatching<TModel & { id: number | string }>(
                    entityModel,
                    orConditions,
                    {
                        parallel: options?.parallel,
                        concurrency: options?.concurrency,
                        fieldsPerCondition
                    }
                );
                existingRecords = Array.isArray(fetched) ? fetched : [];
            } catch (error) {
                logError("upsertMany - classify raw items", error as Error);
            }
        }

        const existingMap = new Map<string, TModel & { id: number | string }>();
        for (const record of existingRecords) {
            for (const constraint of uniqueConstraints) {
                const keyParts: string[] = [];
                let complete = true;
                for (const field of constraint) {
                    const value = (record as Record<string, unknown>)[field];
                    if (value === undefined || value === null) {
                        complete = false;
                        break;
                    }
                    keyParts.push(`${field}:${String(value)}`);
                }
                if (complete && keyParts.length > 0) {
                    existingMap.set(keyParts.join('|'), record);
                }
            }
        }

        for (let index = 0; index < dedupedItems.length; index++) {
            const item = dedupedItems[index];
            const constraints = itemConstraintMap.get(index);
            let existingRecord: (TModel & { id: number | string }) | undefined;

            if (constraints) {
                for (const constraint of constraints) {
                    const keys = Object.keys(constraint);
                    const keyParts: string[] = [];
                    for (const key of keys) {
                        keyParts.push(`${key}:${String(constraint[key])}`);
                    }
                    existingRecord = existingMap.get(keyParts.join('|'));
                    if (existingRecord) break;
                }
            }

            if (!existingRecord) {
                if (constraints && constraints.length > 0) {
                    createdWhereClauses.push(constraints[0]);
                } else {
                    const itemId = item.id;
                    if (itemId !== undefined && itemId !== null) {
                        createdItemIds.push(itemId as EntityId);
                    }
                }
                continue;
            }

            if (compareHasChanges(item, existingRecord as Record<string, unknown>)) {
                updatedItemIds.push(existingRecord.id);
            } else {
                unchangedItemIds.push(existingRecord.id);
            }
        }

        for (const duplicate of duplicateItems) {
            for (const constraint of uniqueConstraints) {
                const keyParts: string[] = [];
                let hasAllUnique = true;
                for (const field of constraint) {
                    const value = duplicate[field];
                    if (value === undefined || value === null) {
                        hasAllUnique = false;
                        break;
                    }
                    keyParts.push(`${field}:${String(value)}`);
                }
                if (!hasAllUnique || keyParts.length === 0) continue;
                const existingRecord = existingMap.get(keyParts.join('|'));
                if (existingRecord) {
                    unchangedItemIds.push(existingRecord.id);
                }
                break;
            }
        }

        return { createdItemIds, updatedItemIds, unchangedItemIds, createdWhereClauses };
    }

    private static async resolveIdsFromWhereClauses<TModel extends object>(
        entityModel: EntityPrismaModel<TModel>,
        whereClauses: Array<Record<string, unknown>>,
        uniqueConstraints: string[][],
        options?: { parallel?: boolean; concurrency?: number }
    ): Promise<Array<EntityId>> {
        if (!isNonEmptyArray(whereClauses)) {
            return [];
        }

        try {
            const fieldsPerCondition = uniqueConstraints[0]?.length || 1;
            const fetched = await executeWithOrBatching<TModel & { id: EntityId }>(
                entityModel,
                whereClauses,
                {
                    parallel: options?.parallel,
                    concurrency: options?.concurrency,
                    fieldsPerCondition
                }
            );

            if (!Array.isArray(fetched)) {
                return [];
            }

            const ids: Array<EntityId> = [];
            for (const row of fetched) {
                if (row && row.id !== undefined && row.id !== null) {
                    ids.push(row.id);
                }
            }
            return ids;
        } catch (error) {
            logError("upsertMany - resolve created ids", error as Error);
            return [];
        }
    }

    /**
     * Legacy upsert flow for MongoDB (no raw SQL).
     * Uses findMany + compareHasChanges + createMany + updateManyById.
     * @internal
     */
    private static async upsertManyLegacy<TModel extends object>(
        entityModel: EntityPrismaModel<TModel>,
        updateManyByIdFn: (
            dataList: Array<Partial<TModel> & { id: number | string }>,
            options?: { parallel?: boolean; concurrency?: number }
        ) => Promise<number>,
        normalizedItems: Record<string, unknown>[],
        uniqueConstraints: string[][],
        options?: { parallel?: boolean; concurrency?: number },
        forcePrismaOperations: boolean = false,
        collectItems: boolean = false
    ): Promise<{
        created: number;
        updated: number;
        unchanged: number;
        createdItemIds: Array<EntityId>;
        updatedItemIds: Array<EntityId>;
        unchangedItemIds: Array<EntityId>;
    }> {
        // Deduplicate items by unique key (last-write-wins) to prevent
        // double-processing when the same unique key appears multiple times.
        const dedupMap = new Map<string, { index: number; item: Record<string, unknown> }>();
        for (let i = 0; i < normalizedItems.length; i++) {
            const item = normalizedItems[i];
            for (const constraint of uniqueConstraints) {
                let hasAll = true;
                const keyParts: string[] = [];
                for (const field of constraint) {
                    const val = item[field];
                    if (val !== undefined && val !== null) {
                        keyParts.push(`${field}:${val}`);
                    } else {
                        hasAll = false;
                        break;
                    }
                }
                if (hasAll && keyParts.length > 0) {
                    dedupMap.set(keyParts.join('|'), { index: i, item });
                    break;
                }
            }
        }
        const dedupedItems = Array.from(dedupMap.values()).map(v => v.item);
        const duplicatesRemoved = normalizedItems.length - dedupedItems.length;

        const orConditions: Record<string, unknown>[] = [];
        const itemConstraintMap = new Map<number, Record<string, unknown>[]>();

        for (let index = 0; index < dedupedItems.length; index++) {
            const normalized = dedupedItems[index];
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

        let existingRecords: Array<TModel & { id: number | string }> = [];
        if (orConditions.length > 0) {
            try {
                const fieldsPerCondition = uniqueConstraints[0]?.length || 1;
                const fetched = await executeWithOrBatching<TModel & { id: number | string }>(
                    entityModel,
                    orConditions,
                    {
                        parallel: options?.parallel,
                        concurrency: options?.concurrency,
                        fieldsPerCondition
                    }
                );

                existingRecords = Array.isArray(fetched)
                    ? fetched
                    : [];

                if (!Array.isArray(fetched)) {
                    logError(
                        "upsertManyLegacy - fetch existing records",
                        new Error("Expected array of existing records"),
                        { receivedType: typeof fetched }
                    );
                }
            } catch (error) {
                logError("upsertManyLegacy - fetch existing records", error as Error);
            }
        }

        const existingMap = new Map<string, TModel & { id: number | string }>();
        for (const record of existingRecords) {
            for (const constraint of uniqueConstraints) {
                const keyParts: string[] = new Array(constraint.length);
                for (let i = 0; i < constraint.length; i++) {
                    const field = constraint[i];
                    keyParts[i] = `${field}:${(record as Record<string, unknown>)[field]}`;
                }
                existingMap.set(keyParts.join("|"), record);
            }
        }

        const toCreate: Record<string, unknown>[] = [];
        const toUpdate: Array<{ id: number | string; data: Record<string, unknown> }> = [];
        const unchangedItemIds: Array<EntityId> = [];
        let unchanged = 0;

        for (let index = 0; index < dedupedItems.length; index++) {
            const normalized = dedupedItems[index];
            const constraints = itemConstraintMap.get(index);
            let existingRecord: (TModel & { id: number | string }) | undefined;
            if (constraints) {
                for (const constraint of constraints) {
                    const constraintKeys = Object.keys(constraint);
                    const keyParts: string[] = new Array(constraintKeys.length);
                    for (let i = 0; i < constraintKeys.length; i++) {
                        const field = constraintKeys[i];
                        keyParts[i] = `${field}:${constraint[field]}`;
                    }
                    existingRecord = existingMap.get(keyParts.join("|"));
                    if (existingRecord) break;
                }
            }
            if (existingRecord) {
                if (compareHasChanges(normalized, existingRecord as Record<string, unknown>)) {
                    toUpdate.push({ id: existingRecord.id, data: normalized });
                } else {
                    unchanged++;
                    if (collectItems) unchangedItemIds.push(existingRecord.id);
                }
            } else {
                toCreate.push(normalized);
            }
        }

        let created = 0;
        let updated = 0;
        const createdItemIds: Array<EntityId> = [];
        const updatedItemIds: Array<EntityId> = [];

        if (toUpdate.length > 0) {
            if (forcePrismaOperations || collectItems) {
                updated = await withErrorHandling(
                    async () => {
                        let count = 0;
                        for (const { id, data } of toUpdate) {
                            await entityModel.update({ where: { id }, data });
                            count++;
                            if (collectItems) updatedItemIds.push(id);
                        }
                        return count;
                    },
                    "legacy individual update"
                );
            } else {
                updated = await withErrorHandling(
                    async () => {
                        const updateData: Array<Partial<TModel> & { id: number | string }> =
                            toUpdate.map(({ id, data }) => ({ id, ...(data as TModel) }));
                        return await updateManyByIdFn(updateData, { parallel: false });
                    },
                    "legacy batch update",
                    async () => {
                        let count = 0;
                        for (const { id, data } of toUpdate) {
                            try {
                                await entityModel.update({ where: { id }, data });
                                count++;
                                if (collectItems) updatedItemIds.push(id);
                            } catch (err) {
                                logError(`individual update for record ${id}`, err as Error);
                            }
                        }
                        return count;
                    }
                );
            }
        }

        if (toCreate.length > 0) {
            if (forcePrismaOperations || collectItems) {
                created = await withErrorHandling(
                    async () => {
                        let count = 0;
                        for (const data of toCreate) {
                            const createdRecord = await entityModel.create({ data });
                            count++;
                            if (collectItems && createdRecord?.id !== undefined && createdRecord?.id !== null) {
                                createdItemIds.push(createdRecord.id);
                            }
                        }
                        return count;
                    },
                    "legacy individual create"
                );
            } else {
                created = await withErrorHandling(
                    async () => {
                        const result = await entityModel.createMany({ data: toCreate });
                        return result.count;
                    },
                    "legacy batch create",
                    async () => {
                        let count = 0;
                        for (const data of toCreate) {
                            try {
                                const createdRecord = await entityModel.create({ data });
                                count++;
                                if (collectItems && createdRecord?.id !== undefined && createdRecord?.id !== null) {
                                    createdItemIds.push(createdRecord.id);
                                }
                            } catch (err) {
                                logError("individual create", err as Error);
                            }
                        }
                        return count;
                    }
                );
            }
        }

        return {
            created,
            updated,
            unchanged: unchanged + duplicatesRemoved,
            createdItemIds,
            updatedItemIds,
            unchangedItemIds
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
    public static async updateManyById<TModel extends object>(
        entityModel: EntityPrismaModel<TModel>,
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
    public static async updateManyByIdMongoDB<TModel extends object>(
        formattedList: Array<Record<string, unknown>>,
        entityModel: EntityPrismaModel<TModel>,
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
    public static async deleteByIds<TModel extends object>(
        entityModel: Pick<EntityPrismaModel<TModel>, "deleteMany">,
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
