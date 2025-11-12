import { PrismaClient } from "@prisma/client";
import DataUtils from "./data-utils";
import ModelUtils from "./model-utils";
import { getPrismaInstance } from '../config';
import { getDatabaseProviderCached } from "./database-utils";
import { executeInParallel } from "./parallel-utils";
import { isParallelEnabled } from "../config";
import { isNonEmptyArray } from "./validation-utils";
import { getOptimalBatchSize, processBatches } from "./batch-utils";
import { logError, handleUniqueConstraintError, withErrorHandling } from "./error-utils";
import { executeWithOrBatching } from "./query-utils";
import { hasChanges as compareHasChanges } from "./comparison-utils";
import BaseEntityHelpers from "./base-entity-helpers";

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
 *   true, // skipDuplicates
 *   (key) => `${key}Id`,
 *   { parallel: true, concurrency: 4 }
 * );
 * ```
 */
export default class BaseEntityBatch {
    static readonly MONGODB_TRANSACTION_BATCH_SIZE = 100; // MongoDB transaction limit



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
     * @param skipDuplicates - Whether to skip duplicate records (database-dependent)
     * @param keyTransformTemplate - Function to transform relation names to FK field names
     * @param options - Batch operation options (parallel, concurrency, handleRelations)
     * @returns Promise<number> - Number of entities created
     * 
     * @example
     * ```typescript
     * const users = [
     *   { name: 'Alice', email: 'alice@example.com', roles: [{ id: 1 }, { id: 2 }] },
     *   { name: 'Bob', email: 'bob@example.com', roles: [{ id: 2 }] }
     * ];
     * 
     * const count = await BaseEntityBatch.createMany(
     *   User.model,
     *   () => User.getModelInformation(),
     *   users,
     *   true,
     *   (key) => `${key}Id`,
     *   { parallel: true, concurrency: 4, handleRelations: true }
     * );
     * 
     * console.log(`Created ${count} users with their roles`);
     * ```
     */
    public static async createMany<T extends object = Record<string, any>>(
        entityModel: any,
        getModelInformation: () => any,
        items: Partial<T>[],
        skipDuplicates = false,
        keyTransformTemplate: (relationName: string) => string = (key) => `${key}Id`,
        options?: {
            parallel?: boolean;
            concurrency?: number;
            handleRelations?: boolean;
        }
    ): Promise<number> {
        if (!entityModel) throw new Error("Model is not defined in the BaseEntity class.");
        if (!isNonEmptyArray(items)) return 0;

        const prisma = getPrismaInstance();
        const provider = getDatabaseProviderCached(prisma);
        const supportsSkipDuplicates = provider !== 'sqlite' && provider !== 'mongodb' && provider != 'sqlserver';

        let modelInfo: any = null;
        try {
            modelInfo = getModelInformation();
        } catch (error) {
            // Model info not available, continue without it
        }

        // Extract many-to-many relations if handleRelations is enabled
        const handleRelations = options?.handleRelations !== false;
        const { cleanedItems: itemsToProcess, relations, relationTypes } = handleRelations
            ? DataUtils.extractManyToManyRelations(items, modelInfo)
            : { cleanedItems: items, relations: new Map(), relationTypes: new Map() };

        // Process and deduplicate data
        const processedData = itemsToProcess.map(item => {
            const clean = BaseEntityHelpers.sanitizeKeysRecursive(item);
            const processed = DataUtils.processRelations(clean, modelInfo);
            return DataUtils.normalizeRelationsToFK(processed, keyTransformTemplate);
        });

        const deduplicatedData = BaseEntityHelpers.deduplicateByUniqueConstraints(processedData, entityModel.name);

        if (deduplicatedData.length < processedData.length) {
            logError('createMany - deduplication', new Error('Duplicate records removed from batch'), { 
                modelName: entityModel.name,
                removed: processedData.length - deduplicatedData.length,
                original: processedData.length,
                deduplicated: deduplicatedData.length
            });
        }

        const batchSize = getOptimalBatchSize('createMany', provider);
        const useParallel = options?.parallel !== false && isParallelEnabled();

        const result = await processBatches(
            deduplicatedData,
            batchSize,
            async (batch) => {
                const createOptions: any = { data: batch };
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
                        `createMany batch`
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
            logError('createMany - parallel batches', new Error(`${result.errors.length} batches failed`), { failedCount: result.errors.length });
        }

        // Apply many-to-many relations if we have any
        if (handleRelations && relations.size > 0 && totalCreated > 0) {
            const uniqueConstraints = ModelUtils.getUniqueConstraints(entityModel.name);

            if (uniqueConstraints.length > 0) {
                const orConditions = deduplicatedData.map(item => {
                    for (const constraint of uniqueConstraints) {
                        const constraintCondition: Record<string, any> = {};
                        let hasAllFields = true;

                        for (const field of constraint) {
                            if (item[field] !== undefined && item[field] !== null) {
                                constraintCondition[field] = item[field];
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
                }).filter(Boolean);

                if (orConditions.length > 0) {
                    try {
                        // Fetch records with full data to match them back to original items
                        const createdRecords = await entityModel.findMany({
                            where: { OR: orConditions }
                        });

                        // Build a map of unique constraint values to record IDs
                        // This ensures we match the correct ID to each item in the original order
                        const recordMap = new Map<string, any>();
                        for (const record of createdRecords) {
                            for (const constraint of uniqueConstraints) {
                                const keyParts: string[] = [];
                                let hasAllFields = true;
                                
                                for (const field of constraint) {
                                    if (record[field] !== undefined && record[field] !== null) {
                                        keyParts.push(`${field}:${record[field]}`);
                                    } else {
                                        hasAllFields = false;
                                        break;
                                    }
                                }
                                
                                if (hasAllFields) {
                                    const key = keyParts.join('|');
                                    recordMap.set(key, record);
                                    break;
                                }
                            }
                        }

                        // Match fetched records to ORIGINAL items (not deduplicated) to preserve index mapping
                        // The relations Map uses indices from the original items array
                        const fetchedIds: (number | string)[] = [];
                        for (let i = 0; i < itemsToProcess.length; i++) {
                            const item = itemsToProcess[i] as Record<string, any>;
                            
                            // Only process items that have relations
                            if (!relations.has(i)) {
                                continue;
                            }
                            
                            for (const constraint of uniqueConstraints) {
                                const keyParts: string[] = [];
                                let hasAllFields = true;
                                
                                for (const field of constraint) {
                                    if (item[field] !== undefined && item[field] !== null) {
                                        keyParts.push(`${field}:${item[field]}`);
                                    } else {
                                        hasAllFields = false;
                                        break;
                                    }
                                }
                                
                                if (hasAllFields) {
                                    const key = keyParts.join('|');
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
                                logError('createMany - apply relations', new Error('Failed to apply many-to-many relations'), { 
                                    failedCount: relationResult.failed,
                                    successCount: relationResult.success
                                });
                            }
                        }
                    } catch (error) {
                        logError('createMany - apply relations', error as Error, { modelName: entityModel.name });
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
     * @param keyTransformTemplate - Function to transform relation names to FK field names
     * @param options - Batch operation options (parallel, concurrency, handleRelations)
     * @returns Promise with created, updated, unchanged, and total counts
     * 
     * @example
     * ```typescript
     * const users = [
     *   { email: 'alice@example.com', name: 'Alice Updated' },
     *   { email: 'charlie@example.com', name: 'Charlie New' }
     * ];
     * 
     * const result = await BaseEntityBatch.upsertMany(
     *   User.model,
     *   () => User.getModelInformation(),
     *   (data, opts) => User.updateManyById(data, opts),
     *   users,
     *   (key) => `${key}Id`,
     *   { parallel: true }
     * );
     * 
     * console.log(`Created: ${result.created}, Updated: ${result.updated}, Unchanged: ${result.unchanged}`);
     * ```
     */
    public static async upsertMany<T extends object = Record<string, any>>(
        entityModel: any,
        getModelInformation: () => any,
        updateManyByIdFn: (dataList: Array<Partial<any>>, options?: any) => Promise<number>,
        items: Partial<T>[],
        keyTransformTemplate: (relationName: string) => string = (key) => `${key}Id`,
        options?: {
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
            throw new Error(`No unique constraints found for model ${modelName}. Cannot perform upsert.`);
        }

        let modelInfo: any = null;
        try {
            modelInfo = getModelInformation();
        } catch (error) {
            // Model info not available, continue without it
        }

        // Extract many-to-many relations if handleRelations is enabled
        const handleRelations = options?.handleRelations !== false;
        const { cleanedItems: itemsToProcess, relations, relationTypes } = handleRelations
            ? DataUtils.extractManyToManyRelations(items, modelInfo)
            : { cleanedItems: items, relations: new Map(), relationTypes: new Map() };

        // Process and normalize all items
        const normalizedItems = itemsToProcess.map(item => {
            const clean = BaseEntityHelpers.sanitizeKeysRecursive(item);
            const processed = DataUtils.processRelations(clean, modelInfo);
            return DataUtils.normalizeRelationsToFK(processed, keyTransformTemplate);
        });

        // Build batch query to fetch all existing records
        // Pre-allocate arrays for better performance
        const orConditions: any[] = [];
        const itemConstraintMap = new Map<number, any[]>();

        for (let index = 0; index < normalizedItems.length; index++) {
            const normalized = normalizedItems[index];
            
            for (const constraint of uniqueConstraints) {
                const whereClause: Record<string, any> = {};
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

        // Fetch all existing records using query-utils.executeWithOrBatching
        let existingRecords: T[] = [];
        if (orConditions.length > 0) {
            try {
                const fieldsPerCondition = uniqueConstraints[0]?.length || 1;
                existingRecords = await executeWithOrBatching<T & { id: any }>(
                    entityModel,
                    orConditions,
                    {
                        parallel: options?.parallel,
                        concurrency: options?.concurrency,
                        fieldsPerCondition
                    }
                ) as T[];
            } catch (error) {
                logError('upsertMany - fetch existing records', error as Error);
            }
        }

        // Create a map for quick lookup of existing records
        // Use Map for O(1) lookups
        const existingMap = new Map<string, T>();
        for (const record of existingRecords) {
            for (const constraint of uniqueConstraints) {
                // Optimize key building with array join
                const keyParts: string[] = new Array(constraint.length);
                for (let i = 0; i < constraint.length; i++) {
                    keyParts[i] = `${constraint[i]}:${(record as any)[constraint[i]]}`;
                }
                const key = keyParts.join('|');
                existingMap.set(key, record);
            }
        }

        // Categorize items: to create, to update, unchanged
        // Track original indices for relation mapping
        const toCreate: any[] = [];
        const toCreateIndices: number[] = []; // Track original indices
        const toUpdate: Array<{ id: number; data: any; originalIndex: number }> = [];
        let unchanged = 0;

        for (let index = 0; index < normalizedItems.length; index++) {
            const normalized = normalizedItems[index];
            const constraints = itemConstraintMap.get(index);
            let existingRecord: T | undefined;

            if (constraints) {
                for (const constraint of constraints) {
                    // Optimize key building with array operations
                    const constraintKeys = Object.keys(constraint);
                    const keyParts: string[] = new Array(constraintKeys.length);
                    for (let i = 0; i < constraintKeys.length; i++) {
                        const field = constraintKeys[i];
                        keyParts[i] = `${field}:${constraint[field]}`;
                    }
                    const key = keyParts.join('|');
                    existingRecord = existingMap.get(key);
                    if (existingRecord) break;
                }
            }

            if (existingRecord) {
                if (compareHasChanges(normalized, existingRecord as Record<string, unknown>)) {
                    toUpdate.push({
                        id: (existingRecord as any).id,
                        data: normalized,
                        originalIndex: index
                    });
                } else {
                    unchanged++;
                }
            } else {
                toCreate.push(normalized);
                toCreateIndices.push(index); // Track original index
            }
        }

        // Execute batch operations
        let created = 0;
        let updated = 0;

        const useParallel = options?.parallel !== false &&
            isParallelEnabled() &&
            (toCreate.length > 0 && toUpdate.length > 0);

        if (useParallel) {
            const operations: Array<() => Promise<number>> = [];

            if (toCreate.length > 0) {
                operations.push(async () => {
                    const prisma = getPrismaInstance();
                    const provider = getDatabaseProviderCached(prisma);
                    const supportsSkipDuplicates = provider !== 'sqlite' && provider !== 'mongodb';

                    return await withErrorHandling(
                        async () => {
                            const createOptions: any = { data: toCreate };
                            if (supportsSkipDuplicates) {
                                createOptions.skipDuplicates = true;
                            }
                            const result = await entityModel.createMany(createOptions);
                            return result.count;
                        },
                        'batch create',
                        async () => {
                            let count = 0;
                            for (const data of toCreate) {
                                try {
                                    await entityModel.create({ data });
                                    count++;
                                } catch (err) {
                                    logError('individual create', err as Error);
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
                            const updateData = toUpdate.map(({ id, data }) => ({ id, ...data }));
                            return await updateManyByIdFn(updateData, { parallel: false });
                        },
                        'batch update',
                        async () => {
                            let count = 0;
                            for (const { id, data } of toUpdate) {
                                try {
                                    await entityModel.update({ where: { id }, data });
                                    count++;
                                } catch (err) {
                                    logError('individual update', err as Error);
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
                logError('upsertMany - parallel operations', new Error(`${result.errors.length} operations failed`), { failedCount: result.errors.length });
            }
        } else {
            // Execute sequentially
            if (toCreate.length > 0) {
                const prisma = getPrismaInstance();
                const provider = getDatabaseProviderCached(prisma);
                const supportsSkipDuplicates = provider !== 'sqlite' && provider !== 'mongodb';

                created = await withErrorHandling(
                    async () => {
                        const createOptions: any = { data: toCreate };
                        if (supportsSkipDuplicates) {
                            createOptions.skipDuplicates = true;
                        }
                        const result = await entityModel.createMany(createOptions);
                        return result.count;
                    },
                    'batch create',
                    async () => {
                        let count = 0;
                        for (const data of toCreate) {
                            try {
                                await entityModel.create({ data });
                                count++;
                            } catch (err) {
                                logError('individual create', err as Error);
                            }
                        }
                        return count;
                    }
                );
            }

            if (toUpdate.length > 0) {
                updated = await withErrorHandling(
                    async () => {
                        const updateData = toUpdate.map(({ id, data }) => ({ id, ...data }));
                        return await updateManyByIdFn(updateData, { parallel: false });
                    },
                    'batch update',
                    async () => {
                        let count = 0;
                        for (const { id, data } of toUpdate) {
                            try {
                                await entityModel.update({ where: { id }, data });
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

        // Apply many-to-many relations if we have any
        if (handleRelations && relations.size > 0 && (created > 0 || updated > 0)) {
            // Build a map of entity IDs to original indices for relation mapping
            const entityIdToIndexMap = new Map<number | string, number>();

            if (created > 0 && toCreate.length > 0) {
                const createdOrConditions = toCreate.map(item => {
                    for (const constraint of uniqueConstraints) {
                        const whereClause: Record<string, any> = {};
                        let hasAllFields = true;

                        for (const field of constraint) {
                            if (item[field] !== undefined && item[field] !== null) {
                                whereClause[field] = item[field];
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
                }).filter(Boolean);

                if (createdOrConditions.length > 0) {
                    try {
                        const createdRecords = await entityModel.findMany({
                            where: { OR: createdOrConditions }
                        });
                        
                        // Match created records back to original indices
                        for (let i = 0; i < toCreate.length; i++) {
                            const item = toCreate[i];
                            const originalIndex = toCreateIndices[i];
                            
                            // Only process if this item has relations
                            if (!relations.has(originalIndex)) {
                                continue;
                            }
                            
                            // Find the matching record
                            for (const record of createdRecords) {
                                let matches = true;
                                for (const constraint of uniqueConstraints) {
                                    for (const field of constraint) {
                                        if (item[field] !== record[field]) {
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
                        logError('upsertMany - fetch created IDs', error as Error);
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

            // Build arrays for applyManyToManyRelations
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
                        logError('upsertMany - apply relations', new Error('Failed to apply many-to-many relations'), { 
                            failedCount: relationResult.failed,
                            successCount: relationResult.success
                        });
                    }
                } catch (error) {
                    logError('upsertMany - apply relations', error as Error);
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
     * 
     * @example
     * ```typescript
     * const updates = [
     *   { id: 1, name: 'Alice Updated', status: 'active' },
     *   { id: 2, name: 'Bob Updated', status: 'inactive' }
     * ];
     * 
     * const count = await BaseEntityBatch.updateManyById(
     *   User.model,
     *   () => User.getModelInformation(),
     *   BaseEntityHelpers.buildUpdateQuery,
     *   BaseEntityHelpers.prepareUpdateList,
     *   updates,
     *   { parallel: true, concurrency: 4 }
     * );
     * 
     * console.log(`Updated ${count} users`);
     * ```
     */
    public static async updateManyById(
        entityModel: any,
        getModelInformation: () => any,
        buildUpdateQueryFn: (batch: Array<Record<string, any>>, tableName: string, modelInfo?: any) => { query: string | null; idsInBatch: Set<number> },
        prepareUpdateListFn: (dataList: Array<Partial<any>>, modelInfo?: any) => Array<Record<string, any>>,
        dataList: Array<Partial<any>>,
        options?: {
            parallel?: boolean;
            concurrency?: number;
        }
    ): Promise<number> {
        if (!isNonEmptyArray(dataList)) return 0;

        const prisma = getPrismaInstance();
        const provider = getDatabaseProviderCached(prisma);
        const modelInfo = getModelInformation();
        const tableName = modelInfo.dbName || modelInfo.name || entityModel?.name;

        if (!tableName) {
            throw new Error("Could not determine table name for updateManyById");
        }

        const formattedList = prepareUpdateListFn(dataList, modelInfo);

        // MongoDB: Use optimized batch transactions
        if (provider === 'mongodb') {
            return await this.updateManyByIdMongoDB(formattedList, entityModel, prisma);
        }

        // SQL databases use optimized batch update query
        const batchSize = getOptimalBatchSize('updateMany', provider);
        const useParallel = options?.parallel !== false && isParallelEnabled();

        const result = await processBatches(
            formattedList,
            batchSize,
            async (batch) => {
                const { query } = buildUpdateQueryFn(batch, tableName, modelInfo);
                if (!query) return 0;

                return await withErrorHandling(
                    async () => {
                        const updateResult = await (prisma as unknown as PrismaClient).$executeRawUnsafe(query);
                        return updateResult as number;
                    },
                    'batch update'
                );
            },
            {
                parallel: useParallel,
                concurrency: options?.concurrency
            }
        );

        const totalUpdated = result.results.reduce((sum, count) => sum + count, 0);

        if (result.errors.length > 0) {
            logError('updateManyById - parallel batches', new Error(`${result.errors.length} batches failed`), { failedCount: result.errors.length });
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
     * @private
     * @internal
     */
    public static async updateManyByIdMongoDB(
        formattedList: Array<Record<string, any>>,
        entityModel: any,
        prisma: PrismaClient
    ): Promise<number> {
        let totalUpdated = 0;
        const batchSize = this.MONGODB_TRANSACTION_BATCH_SIZE;

        for (let i = 0; i < formattedList.length; i += batchSize) {
            const batch = formattedList.slice(i, i + batchSize);

            try {
                const results = await (prisma as any).$transaction(
                    batch.map(item => {
                        const { id, ...data } = item;
                        return entityModel.update({ where: { id }, data });
                    }),
                    {
                        maxWait: 5000,
                        timeout: 10000,
                    }
                );
                totalUpdated += results.length;
            } catch (error) {
                logError('updateManyByIdMongoDB - batch update', error as Error, { 
                    batchStart: i + 1,
                    batchEnd: Math.min(i + batch.length, formattedList.length)
                });

                // Fallback to individual updates for this batch
                for (const item of batch) {
                    const { id, ...data } = item;
                    try {
                        await entityModel.update({ where: { id }, data });
                        totalUpdated++;
                    } catch (itemError) {
                        logError('updateManyByIdMongoDB - individual update', itemError as Error, { recordId: id });
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
     * 
     * @example
     * ```typescript
     * const idsToDelete = [1, 2, 3, 4, 5];
     * 
     * const count = await BaseEntityBatch.deleteByIds(
     *   User.model,
     *   idsToDelete,
     *   { parallel: true, concurrency: 4 }
     * );
     * 
     * console.log(`Deleted ${count} users`);
     * ```
     */
    public static async deleteByIds(
        entityModel: any,
        ids: any[],
        options?: {
            parallel?: boolean;
            concurrency?: number;
        }
    ): Promise<number> {
        if (!entityModel) throw new Error("The model is not defined in the BaseEntity class.");
        if (!isNonEmptyArray(ids)) return 0;

        const batchSize = getOptimalBatchSize('delete');
        const useParallel = options?.parallel !== false && isParallelEnabled();

        const result = await processBatches(
            ids,
            batchSize,
            async (batch) => {
                try {
                    const deleteResult = await entityModel.deleteMany({
                        where: { id: { in: batch } }
                    });
                    return deleteResult.count || 0;
                } catch (error) {
                    logError('deleteByIds', error as Error, { batchSize: batch.length });
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
            logError('deleteByIds - parallel batches', new Error(`${result.errors.length} batches failed`), { failedCount: result.errors.length });
        }

        return totalDeleted;
    }
}
