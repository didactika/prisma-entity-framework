import { IBaseEntity } from "./interfaces/base-entity.interface";
import { FindByFilterOptions } from "./types/search.types";
import DataUtils from "./data-utils";
import ModelUtils from "./model-utils";
import { getPrismaInstance } from './config';
import SearchUtils from "./search/search-utils";
import { PrismaClient } from "@prisma/client";
import { quoteIdentifier, formatBoolean, getDatabaseProvider } from "./database-utils";
import { getOptimalBatchSize, getOptimalOrBatchSize, isOrQuerySafe } from "./performance-utils";

export default abstract class BaseEntity<TModel extends Record<string, any>> implements IBaseEntity<TModel> {
    static readonly model: any;
    static readonly BATCH_SIZE = 1500; // Default for SQL databases
    static readonly MONGODB_TRANSACTION_BATCH_SIZE = 100; // MongoDB transaction limit
    public readonly id?: number | string;

    /**
     * Get optimal batch size for current database and operation
     * @param operation - Type of operation (createMany, updateMany, transaction)
     * @returns Optimal batch size
     */
    protected static getOptimalBatchSize(operation: 'createMany' | 'updateMany' | 'transaction' = 'createMany'): number {
        try {
            return getOptimalBatchSize(operation);
        } catch {
            return BaseEntity.BATCH_SIZE;
        }
    }

    constructor(data?: Partial<TModel>) {
        this.initializeProperties(data);
    }

    /**
     * Automatically initializes entity properties from data object
     * 
     * Supports three property types:
     * 1. Decorated properties with @Property() - Uses the setter created by decorator
     * 2. Properties with manual getters/setters - Assigns to private _property
     * 3. Public properties - Assigns directly to the property
     *
     * @param data - Data object to initialize from
     * @protected
     */
    protected initializeProperties(data?: Partial<TModel>): void {
        if (!data) return;

        // Get decorated properties metadata if available
        const decoratedProperties = (this.constructor as any)._decoratedProperties as Set<string> | undefined;

        Object.keys(data).forEach((key) => {
            const value = (data as any)[key];

            if (key === 'id') {
                // Special case: id is always assigned directly
                (this as any).id = value;
            } else {
                // Check if property is decorated with @Property()
                const isDecorated = decoratedProperties?.has(key);

                if (isDecorated) {
                    // For decorated properties, use the setter (which handles _key internally)
                    (this as any)[key] = value;
                } else {
                    // Check if property has a getter or setter in the prototype chain
                    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), key);
                    const hasGetterOrSetter = descriptor && (descriptor.get || descriptor.set);

                    if (hasGetterOrSetter) {
                        // Has manual getter/setter: assign to private _key
                        const privateKey = `_${key}`;
                        (this as any)[privateKey] = value;
                    } else {
                        // Try to assign directly first (for public properties)
                        // This will create the property if it doesn't exist
                        (this as any)[key] = value;
                    }
                }
            }
        });
    }


    /**
     * Finds entities by applying filters, search criteria, pagination, and ordering.
     * Supports relation includes, complex searches, and automatic chunking for large list searches (>10k items).
     * 
     * @template T - The entity type
     * @param filter - Base filter object with entity properties to match
     * @param options - Query options (search, pagination, relationsToInclude, orderBy, onlyOne)
     * @returns PaginatedResponse<T> if paginated, T if onlyOne, T[] otherwise, or null if no results
     * @throws Error if model is not defined
     * 
     * @example
     * ```typescript
     * // Paginated results with relations and ordering
     * const result = await User.findByFilter(
     *   { status: 'active' },
     *   { 
     *     pagination: { page: 1, pageSize: 10, take: 10, skip: 0 },
     *     relationsToInclude: ['posts', 'profile'],
     *     orderBy: { createdAt: 'desc' }
     *   }
     * );
     * ```
     */
    public static async findByFilter<T extends Record<string, any>>(
        this: new (data: any) => BaseEntity<T>,
        filter: Partial<T>,
        options: FindByFilterOptions.Options = FindByFilterOptions.defaultOptions
    ): Promise<
        | FindByFilterOptions.PaginatedResponse<T>
        | T[]
        | T
        | null
    > {
        const entityModel = (this as any).model;
        if (!entityModel) throw new Error("The model is not defined in the BaseEntity class.");

        let modelInfo: any = null;
        try {
            modelInfo = (this as any).getModelInformation();
        } catch (error) {
            console.warn(`Could not get model info for ${entityModel.name}:`, (error as Error).message);
        }

        let include = undefined;
        if (options.relationsToInclude) {
            if (options.relationsToInclude === "*" ||
                (Array.isArray(options.relationsToInclude) && options.relationsToInclude.length > 0)) {
                include = await ModelUtils.getIncludesTree(entityModel.name, options.relationsToInclude, 0);
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

            const [data, total] = await Promise.all([findManyQuery, countQuery]);

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
            const longValues = listSearch[longIndex].values;
            const chunks: any[][] = [];
            for (let i = 0; i < longValues.length; i += CHUNK_SIZE) {
                chunks.push(longValues.slice(i, i + CHUNK_SIZE));
            }

            const queryPromises = chunks.map(chunkValues => {
                const searchClone = options.search ? JSON.parse(JSON.stringify(options.search)) : undefined;
                if (searchClone?.listSearch?.[longIndex]) {
                    searchClone.listSearch[longIndex].values = chunkValues;
                }
                const whereClause = searchClone ? SearchUtils.applySearchFilter(whereClauseBase, searchClone, modelInfo) : whereClauseBase;
                return entityModel.findMany({ where: whereClause, include }) as Promise<T[]>;
            });

            const allResults = await Promise.all(queryPromises);
            const flattened = ([] as T[]).concat(...allResults);

            if (options.onlyOne) return flattened[0] ?? null;

            return flattened;
        }
    }

    /**
     * Counts the number of records matching the given filter
     * @param filter - Filter criteria
     * @returns Promise<number> - The count of matching records
     */
    public static async countByFilter<T extends Record<string, any>>(
        this: new (data: any) => BaseEntity<T>,
        filter: Partial<T>
    ): Promise<number> {
        const entityModel = (this as any).model;
        if (!entityModel) throw new Error("The model is not defined in the BaseEntity class.");

        // Obtener información del modelo para detectar tipos de relación
        let modelInfo: any = null;
        try {
            modelInfo = (this as any).getModelInformation();
        } catch (error) {
            console.warn(`Could not get model info for ${entityModel.name}:`, (error as Error).message);
        }

        let whereClause = SearchUtils.applyDefaultFilters(filter, modelInfo);

        return await entityModel.count({ where: whereClause });
    }

    public async findByFilter(
        filter: Partial<TModel>,
        options: FindByFilterOptions.Options = FindByFilterOptions.defaultOptions
    ): Promise<
        | FindByFilterOptions.PaginatedResponse<TModel>
        | TModel[]
        | TModel
        | null
    > {
        return (this.constructor as any).findByFilter(filter, options);
    }

    public static getModelInformation(this: new (data: any) => BaseEntity<any>, modelName?: string): any {
        const modelData = (this as any).model;
        const modelNameToUse = modelName ?? modelData?.name;
        if (!modelNameToUse) throw new Error("The model is not defined or does not have a name.");
        const prisma = getPrismaInstance();
        const runtimeDataModel = (prisma as any)._runtimeDataModel;
        if (!runtimeDataModel?.models) throw new Error("No runtime data model found in Prisma client.");
        const modelEntry = Object.entries(runtimeDataModel.models).find(([key]) => key === modelData.name);
        if (!modelEntry) throw new Error(`The model ${modelData.name} was not found in the runtime data model.`);
        return modelEntry[1];
    }

    private static sanitizeKeysRecursive(obj: any): any {
        if (Array.isArray(obj)) {
            return obj.map((item) => this.sanitizeKeysRecursive(item));
        } else if (obj !== null && typeof obj === "object") {
            return Object.keys(obj).reduce((acc, key) => {
                const sanitizedKey = key.replace(/^_+/, "");
                acc[sanitizedKey] = this.sanitizeKeysRecursive(obj[key]);
                return acc;
            }, {} as any);
        }
        return obj;
    }

    async create(): Promise<TModel> {
        const { model } = this.constructor as any;
        if (!model) throw new Error("Model is not defined in the BaseEntity class.");

        let modelInfo: any = null;
        try {
            modelInfo = (this.constructor as any).getModelInformation();
        } catch (error) {
            // Model info not available, continue without it
        }

        const rawData = BaseEntity.sanitizeKeysRecursive(this);
        const data = DataUtils.processRelations(rawData, modelInfo);
        if (!data || Object.keys(data).length === 0)
            throw new Error("Cannot create: no data provided.");
        const created = await model.create({ data });
        this.assignProperties(created);
        return created;
    }

    public static async createMany<T extends Record<string, any>>(
        this: new (data: any) => BaseEntity<T>,
        items: Partial<T>[],
        skipDuplicates = false,
        keyTransformTemplate: (relationName: string) => string = (key) => `${key}Id`
    ): Promise<number> {
        const entityModel = (this as any).model;
        if (!entityModel) throw new Error("Model is not defined in the BaseEntity class.");
        if (!Array.isArray(items) || items.length === 0) return 0;

        const prisma = getPrismaInstance();
        const provider = getDatabaseProvider(prisma);
        const supportsSkipDuplicates = provider !== 'sqlite' && provider !== 'mongodb';

        let modelInfo: any = null;
        try {
            modelInfo = (this as any).getModelInformation();
        } catch (error) {
            // Model info not available, continue without it
        }

        // Process and deduplicate data
        const processedData = items.map(item => {
            const clean = BaseEntity.sanitizeKeysRecursive(item);
            const processed = DataUtils.processRelations(clean, modelInfo);
            return DataUtils.normalizeRelationsToFK(processed, keyTransformTemplate);
        });

        const deduplicatedData = BaseEntity.deduplicateByUniqueConstraints(processedData, entityModel.name);

        if (deduplicatedData.length < processedData.length) {
            console.warn(`⚠️  [${entityModel.name}] Removed ${processedData.length - deduplicatedData.length} duplicate records from batch`);
        }

        let totalCreated = 0;

        // Process in batches
        for (let i = 0; i < deduplicatedData.length; i += BaseEntity.BATCH_SIZE) {
            const batch = deduplicatedData.slice(i, i + BaseEntity.BATCH_SIZE);

            try {
                const options: any = { data: batch };
                // Only add skipDuplicates if supported (not MongoDB or SQLite)
                if (skipDuplicates && supportsSkipDuplicates) {
                    options.skipDuplicates = true;
                }

                const result = await entityModel.createMany(options);
                totalCreated += result.count;
            } catch (error) {
                const errorMsg = (error as Error).message;

                // Handle unique constraint errors with retry logic (only for SQL databases that support it)
                if (errorMsg.includes('Unique constraint') && !skipDuplicates && supportsSkipDuplicates) {
                    console.log(`🔄 Retrying batch ${i} with skipDuplicates=true...`);
                    try {
                        const retryResult = await entityModel.createMany({
                            data: batch,
                            skipDuplicates: true
                        });
                        totalCreated += retryResult.count;
                        console.log(`✅ Retry successful: ${retryResult.count} records created`);
                    } catch (retryError) {
                        console.error(`❌ Retry failed for batch ${i}:`, (retryError as Error).message);
                        throw retryError;
                    }
                } else {
                    console.error(`❌ Error in createMany batch for ${entityModel.name} (index ${i}):`, errorMsg);
                    throw error;
                }
            }
        }

        return totalCreated;
    }

    /**
     * Upsert a single entity (update if exists with same unique fields, create otherwise)
     * Verifies existence using unique constraints, checks for changes before updating
     * 
     * @param data - The entity data to upsert
     * @param keyTransformTemplate - Optional function to transform relation names to FK field names
     * @returns The upserted entity
     * 
     * @example
     * ```typescript
     * const user = await User.upsert({ email: 'john@example.com', name: 'John Doe' });
     * // If user with email exists and has changes -> update
     * // If user with email exists but no changes -> return existing
     * // If user doesn't exist -> create
     * ```
     */
    public static async upsert<T extends Record<string, any>>(
        this: new (data: any) => BaseEntity<T>,
        data: Partial<T>,
        keyTransformTemplate: (relationName: string) => string = (key) => `${key}Id`
    ): Promise<T> {
        const entityModel = (this as any).model;
        if (!entityModel) throw new Error("Model is not defined in the BaseEntity class.");

        const modelName = entityModel.name;
        const uniqueConstraints = ModelUtils.getUniqueConstraints(modelName);

        if (!uniqueConstraints || uniqueConstraints.length === 0) {
            throw new Error(`No unique constraints found for model ${modelName}. Cannot perform upsert.`);
        }

        let modelInfo: any = null;
        try {
            modelInfo = (this as any).getModelInformation();
        } catch (error) {
            // Model info not available, continue without it
        }

        // Process and normalize data
        const clean = BaseEntity.sanitizeKeysRecursive(data);
        const processed = DataUtils.processRelations(clean, modelInfo);
        const normalized = DataUtils.normalizeRelationsToFK(processed, keyTransformTemplate);

        // Try to find existing record using unique constraints
        let existingRecord: any = null;
        for (const constraint of uniqueConstraints) {
            const whereClause: Record<string, any> = {};
            let hasAllFields = true;

            for (const field of constraint) {
                if (normalized[field] !== undefined && normalized[field] !== null) {
                    whereClause[field] = normalized[field];
                } else {
                    hasAllFields = false;
                    break;
                }
            }

            if (hasAllFields && Object.keys(whereClause).length > 0) {
                try {
                    existingRecord = await entityModel.findFirst({ where: whereClause });
                    if (existingRecord) break;
                } catch (error) {
                    // Continue to next constraint if this one fails
                    continue;
                }
            }
        }

        if (existingRecord) {
            // Check if there are any changes
            const hasChanges = Object.keys(normalized).some(key => {
                if (key === 'id') return false;
                return normalized[key] !== existingRecord[key];
            });

            if (!hasChanges) {
                // No changes, return existing record
                return existingRecord;
            }

            // Has changes, perform update
            const updated = await entityModel.update({
                where: { id: existingRecord.id },
                data: normalized
            });
            return updated;
        }

        // Record doesn't exist, create new
        const created = await entityModel.create({ data: normalized });
        return created;
    }

    /**
     * Upsert multiple entities in batch (update if exists, create otherwise)
     * Optimized version that fetches all existing records in batch and compares changes efficiently
     * 
     * @param items - Array of entity data to upsert
     * @param keyTransformTemplate - Optional function to transform relation names to FK field names
     * @returns Object with counts of created, updated, and unchanged records
     * 
     * @example
     * ```typescript
     * const result = await User.upsertMany([
     *   { email: 'john@example.com', name: 'John Doe' },
     *   { email: 'jane@example.com', name: 'Jane Smith' }
     * ]);
     * // Returns: { created: 1, updated: 1, unchanged: 0, total: 2 }
     * ```
     */
    public static async upsertMany<T extends Record<string, any>>(
        this: new (data: any) => BaseEntity<T>,
        items: Partial<T>[],
        keyTransformTemplate: (relationName: string) => string = (key) => `${key}Id`
    ): Promise<{ created: number; updated: number; unchanged: number; total: number }> {
        const entityModel = (this as any).model;
        if (!entityModel) throw new Error("Model is not defined in the BaseEntity class.");
        if (!Array.isArray(items) || items.length === 0) {
            return { created: 0, updated: 0, unchanged: 0, total: 0 };
        }

        const modelName = entityModel.name;
        const uniqueConstraints = ModelUtils.getUniqueConstraints(modelName);

        if (!uniqueConstraints || uniqueConstraints.length === 0) {
            throw new Error(`No unique constraints found for model ${modelName}. Cannot perform upsert.`);
        }

        let modelInfo: any = null;
        try {
            modelInfo = (this as any).getModelInformation();
        } catch (error) {
            // Model info not available, continue without it
        }

        // Process and normalize all items
        const normalizedItems = items.map(item => {
            const clean = BaseEntity.sanitizeKeysRecursive(item);
            const processed = DataUtils.processRelations(clean, modelInfo);
            return DataUtils.normalizeRelationsToFK(processed, keyTransformTemplate);
        });

        // Build batch query to fetch all existing records
        const orConditions: any[] = [];
        const itemConstraintMap = new Map<number, any[]>(); // Maps item index to its constraint values

        normalizedItems.forEach((normalized, index) => {
            for (const constraint of uniqueConstraints) {
                const whereClause: Record<string, any> = {};
                let hasAllFields = true;

                for (const field of constraint) {
                    if (normalized[field] !== undefined && normalized[field] !== null) {
                        whereClause[field] = normalized[field];
                    } else {
                        hasAllFields = false;
                        break;
                    }
                }

                if (hasAllFields && Object.keys(whereClause).length > 0) {
                    orConditions.push(whereClause);
                    if (!itemConstraintMap.has(index)) {
                        itemConstraintMap.set(index, []);
                    }
                    itemConstraintMap.get(index)!.push(whereClause);
                    break; // Use first valid constraint for this item
                }
            }
        });

        // Fetch all existing records in batches to avoid database placeholder limits
        let existingRecords: T[] = [];
        if (orConditions.length > 0) {
            try {
                // Calculate optimal batch size based on database and number of fields per condition
                // Each unique constraint might have multiple fields (e.g., {email, tenantId})
                const fieldsPerCondition = uniqueConstraints[0]?.length || 1;
                
                // Check if we can execute in a single query
                if (isOrQuerySafe(orConditions)) {
                    existingRecords = await entityModel.findMany({
                        where: { OR: orConditions }
                    });
                } else {
                    // Need to batch the query
                    const batchSize = getOptimalOrBatchSize(fieldsPerCondition);
                    
                    for (let i = 0; i < orConditions.length; i += batchSize) {
                        const batch = orConditions.slice(i, i + batchSize);
                        const batchRecords = await entityModel.findMany({
                            where: { OR: batch }
                        });
                        existingRecords.push(...batchRecords);
                    }
                }
            } catch (error) {
                console.warn(`Warning: Could not fetch existing records in batch: ${(error as Error).message}`);
            }
        }

        // Create a map for quick lookup of existing records
        const existingMap = new Map<string, T>();
        existingRecords.forEach(record => {
            for (const constraint of uniqueConstraints) {
                const key = constraint.map(field => `${field}:${(record as any)[field]}`).join('|');
                existingMap.set(key, record);
            }
        });

        // Categorize items: to create, to update, unchanged
        const toCreate: any[] = [];
        const toUpdate: Array<{ id: number; data: any }> = [];
        let unchanged = 0;

        normalizedItems.forEach((normalized, index) => {
            const constraints = itemConstraintMap.get(index);
            let existingRecord: T | undefined;

            // Find matching existing record
            if (constraints) {
                for (const constraint of constraints) {
                    const key = Object.keys(constraint)
                        .map(field => `${field}:${constraint[field]}`)
                        .join('|');
                    existingRecord = existingMap.get(key);
                    if (existingRecord) break;
                }
            }

            if (existingRecord) {
                // Check if there are changes using optimized comparison
                if (BaseEntity.hasChanges(normalized, existingRecord)) {
                    toUpdate.push({
                        id: (existingRecord as any).id,
                        data: normalized
                    });
                } else {
                    unchanged++;
                }
            } else {
                toCreate.push(normalized);
            }
        });

        // Execute batch operations
        let created = 0;
        let updated = 0;

        // Batch create
        if (toCreate.length > 0) {
            // Check if database supports skipDuplicates (SQLite and MongoDB don't)
            const prisma = getPrismaInstance();
            const provider = getDatabaseProvider(prisma);
            const supportsSkipDuplicates = provider !== 'sqlite' && provider !== 'mongodb';

            try {
                const options: any = { data: toCreate };
                // Only add skipDuplicates if the database supports it
                if (supportsSkipDuplicates) {
                    options.skipDuplicates = true;
                }
                const result = await entityModel.createMany(options);
                created = result.count;
            } catch (error) {
                console.error(`Error in batch create: ${(error as Error).message}`);
                // Fallback to individual creates
                for (const data of toCreate) {
                    try {
                        await entityModel.create({ data });
                        created++;
                    } catch (err) {
                        console.error(`Failed to create individual record: ${(err as Error).message}`);
                    }
                }
            }
        }

        // Batch update using updateManyById
        if (toUpdate.length > 0) {
            try {
                const updateData = toUpdate.map(({ id, data }) => ({ id, ...data }));
                updated = await (this as any).updateManyById(updateData);
            } catch (error) {
                console.error(`Error in batch update: ${(error as Error).message}`);
                // Fallback to individual updates
                for (const { id, data } of toUpdate) {
                    try {
                        await entityModel.update({ where: { id }, data });
                        updated++;
                    } catch (err) {
                        console.error(`Failed to update record ${id}: ${(err as Error).message}`);
                    }
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
     * Checks if there are changes between new data and existing data
     * @param newData - new data
     * @param existingData - existing data
     * @returns true if there are changes, false otherwise
     */
    protected static hasChanges<T extends Record<string, any>>(newData: T, existingData: T): boolean {
        return Object.keys(BaseEntity.getChangedFields(newData, existingData)).length > 0;
    }

    /**
     * Returns a partial object with the fields that changed between newData and existingData.
     * Only compares fields that are present in newData (ignores extra fields in existingData)
     * @param newData - new data
     * @param existingData - existing data
     * @returns partial object containing only differing fields (includes id when applicable)
     */
    private static getChangedFields<T extends Record<string, any>>(newData: T, existingData: T): Partial<T> {
        const IGNORED_KEYS = new Set(['id', 'createdAt', 'updatedAt', 'siteUuid']);
        const changed: any = {};

        // Only check keys that exist in newData (ignore extra fields in existingData)
        const keys = Object.keys(newData);

        for (const key of keys) {
            if (IGNORED_KEYS.has(key)) continue;

            const a = BaseEntity.normalizeValue((newData as any)[key]);
            const b = BaseEntity.normalizeValue((existingData as any)[key]);
            const isObjA = typeof a === 'object' && a !== null;
            const isObjB = typeof b === 'object' && b !== null;

            let diff = false;
            if (isObjA || isObjB) {
                diff = JSON.stringify(a) !== JSON.stringify(b);
            } else {
                diff = a !== b;
            }

            if (diff) changed[key] = (newData as any)[key];
        }

        if (Object.keys(changed).length > 0) {
            if ((existingData as any).id !== undefined) changed.id = (existingData as any).id;
        }

        return changed as Partial<T>;
    }

    /**
     * Normalizes a value for comparison (handles null, undefined, empty strings, etc.)
     */
    private static normalizeValue(value: any): any {
        if (value === null || value === undefined || value === '') return null;
        if (typeof value === 'string') return value.trim();
        return value;
    }

    /**
     * Deduplicates data based on known unique constraints for each model
     */
    private static deduplicateByUniqueConstraints<T extends Record<string, any>>(
        data: T[],
        modelName: string
    ): T[] {
        // Get unique constraints dynamically from Prisma runtime
        const constraints = ModelUtils.getUniqueConstraints(modelName);

        if (!constraints || constraints.length === 0) {
            return data; // No constraints found, return as is
        }

        const seen = new Set<string>();
        const deduplicated: T[] = [];

        for (const item of data) {
            // Check all unique constraints
            let isDuplicate = false;
            for (const constraintKeys of constraints) {
                const key = constraintKeys.map(k => `${k}:${item[k]}`).join('|');
                if (seen.has(key)) {
                    isDuplicate = true;
                    break;
                }
            }

            if (!isDuplicate) {
                // Add all constraint combinations to seen set
                for (const constraintKeys of constraints) {
                    const key = constraintKeys.map(k => `${k}:${item[k]}`).join('|');
                    seen.add(key);
                }
                deduplicated.push(item);
            }
        }

        return deduplicated;
    }

    async update(): Promise<TModel> {
        if (!(this as any).id) {
            throw new Error("Cannot update: Missing primary key (id)");
        }
        const { id, ...data } = this as any;
        const { model } = this.constructor as any;

        let modelInfo: any = null;
        try {
            modelInfo = (this.constructor as any).getModelInformation();
        } catch (error) {
            // Model info not available, continue without it
        }

        const cleanData = BaseEntity.sanitizeKeysRecursive(data);
        const processedData = DataUtils.processRelations(cleanData, modelInfo);
        const normalized = DataUtils.normalizeRelationsToFK(processedData, (k) => `${k}Id`);
        const pruned = BaseEntity.pruneUpdatePayload(normalized);
        const updatedEntity = await model.update({ where: { id }, data: pruned });
        this.assignProperties(updatedEntity);
        return updatedEntity;
    }

    private static pruneUpdatePayload(obj: Record<string, any>): Record<string, any> {
        const out: Record<string, any> = {};

        for (const [k, v] of Object.entries(obj)) {
            if (this.shouldSkipField(k, v)) continue;
            out[k] = v;
        }

        // Remove relation objects if their FK field exists
        this.removeRelationObjectsWithFK(out);

        return out;
    }

    private static shouldSkipField(key: string, value: any): boolean {
        // Skip createdAt always
        if (key === 'createdAt') return true;

        // Skip updatedAt if it's undefined or an object (Prisma operation)
        if (key === 'updatedAt' && (value === undefined || typeof value === 'object')) return true;

        // Skip empty objects
        if (this.isEmptyObject(value)) return true;

        // Skip objects that have Prisma operation keys
        if (this.hasPrismaOperations(value)) return true;

        return false;
    }

    private static isEmptyObject(value: any): boolean {
        return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
    }

    private static hasPrismaOperations(value: any): boolean {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

        const prismaOperationKeys = new Set(['connect', 'create', 'update', 'delete', 'disconnect', 'set', 'upsert', 'connectOrCreate']);
        return Object.keys(value).some(key => prismaOperationKeys.has(key));
    }

    private static removeRelationObjectsWithFK(obj: Record<string, any>): void {
        for (const key of Object.keys(obj)) {
            if (key.endsWith('Id')) {
                const rel = key.slice(0, -2);
                if (rel in obj) {
                    delete obj[rel];
                }
            }
        }
    }



    public static async updateManyById(
        this: new (data: any) => BaseEntity<any>,
        dataList: Array<Partial<any>>,
    ): Promise<number> {
        if (!Array.isArray(dataList) || dataList.length === 0) return 0;
        const prisma = getPrismaInstance();
        const provider = getDatabaseProvider(prisma);
        const modelInfo = (this as any).getModelInformation();
        const tableName = modelInfo.dbName || modelInfo.name || (this as any).model?.name;

        if (!tableName) {
            throw new Error("Could not determine table name for updateManyById");
        }

        const formattedList = BaseEntity.prepareUpdateList(dataList, modelInfo);
        let totalUpdated = 0;

        // MongoDB: Use optimized batch transactions
        if (provider === 'mongodb') {
            return await BaseEntity.updateManyByIdMongoDB(formattedList, (this as any).model, prisma);
        }

        // SQL databases use optimized batch update query
        for (let i = 0; i < formattedList.length; i += BaseEntity.BATCH_SIZE) {
            const batch = formattedList.slice(i, i + BaseEntity.BATCH_SIZE);
            const { query } = BaseEntity.buildUpdateQuery(batch, tableName, modelInfo);
            if (!query) continue;
            try {
                const result = await (prisma as unknown as PrismaClient).$executeRawUnsafe(query);
                totalUpdated += result;
            } catch (error) {
                console.error(`❌ Error in batch update (${i + 1} - ${Math.min(i + batch.length, formattedList.length)}):`, (error as Error).message);
                throw new Error(`Error executing batch update query: ${(error as Error).message}`);
            }
        }
        return totalUpdated;
    }

    /**
     * Optimized MongoDB batch update using transactions
     * Uses Prisma's transaction API for atomic batch operations
     * MongoDB has transaction size limits, so we use smaller batches
     * @private
     */
    private static async updateManyByIdMongoDB(
        formattedList: Array<Record<string, any>>,
        entityModel: any,
        prisma: PrismaClient
    ): Promise<number> {
        let totalUpdated = 0;
        const batchSize = BaseEntity.MONGODB_TRANSACTION_BATCH_SIZE;

        // Process in smaller batches for MongoDB transaction limits
        for (let i = 0; i < formattedList.length; i += batchSize) {
            const batch = formattedList.slice(i, i + batchSize);

            try {
                // Use Prisma transaction for atomic batch updates
                const results = await (prisma as any).$transaction(
                    batch.map(item => {
                        const { id, ...data } = item;
                        return entityModel.update({ where: { id }, data });
                    }),
                    {
                        maxWait: 5000, // 5 seconds max wait
                        timeout: 10000, // 10 seconds timeout
                    }
                );
                totalUpdated += results.length;
            } catch (error) {
                const errorMsg = (error as Error).message;
                console.error(`❌ Error in MongoDB batch update (${i + 1} - ${Math.min(i + batch.length, formattedList.length)}):`, errorMsg);

                // Fallback to individual updates if transaction fails
                console.log(`🔄 Falling back to individual updates for batch ${i}...`);
                for (const item of batch) {
                    const { id, ...data } = item;
                    try {
                        await entityModel.update({ where: { id }, data });
                        totalUpdated++;
                    } catch (itemError) {
                        console.error(`❌ Error updating record ${id}:`, (itemError as Error).message);
                    }
                }
            }
        }

        return totalUpdated;
    }

    private static prepareUpdateList(dataList: Array<Partial<any>>, modelInfo?: any): Array<Record<string, any>> {
        // Build a set of JSON field names for quick lookup
        const jsonFields = new Set<string>();
        if (modelInfo?.fields) {
            for (const field of modelInfo.fields) {
                if (field.kind === 'scalar' && (field.type === 'Json' || field.type === 'Bytes')) {
                    jsonFields.add(field.name);
                }
            }
        }

        return BaseEntity.sanitizeKeysRecursive(dataList)
            .filter((item: any) => item.id !== undefined && item.id !== null)
            .map((item: any) => {
                const processed = DataUtils.processRelations(item, modelInfo);
                return Object.fromEntries(
                    Object.entries(processed).filter(([key, val]) => {
                        if (key === 'id') return true;
                        if (val === undefined) return false;
                        if (val === null) return true;
                        if (Array.isArray(val)) return true;
                        // Allow JSON fields (plain objects)
                        if (jsonFields.has(key) && typeof val === 'object') return true;
                        // Filter out other objects (relations)
                        return typeof val !== 'object';
                    })
                );
            });
    }

    private static escapeValue(value: any, prisma?: PrismaClient): string {
        if (value === null || value === undefined) return 'NULL';

        if (typeof value === 'string') {
            const escaped = value.replace(/'/g, "''").replace(/\\/g, '\\\\');
            return `'${escaped}'`;
        }

        if (typeof value === 'boolean') {
            return formatBoolean(value, prisma);
        }

        if (typeof value === 'number') {
            return isNaN(value) ? 'NULL' : String(value);
        }

        if (value instanceof Date) {
            return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
        }

        if (Array.isArray(value)) {
            if (value.length === 0) return "''";
            const escapedElements = value.map((v) => {
                if (typeof v === 'string') {
                    return v.replace(/'/g, "''").replace(/\\/g, '\\\\');
                }
                return String(v);
            });
            return `'${escapedElements.join(',')}'`;
        }

        // Handle JSON objects
        if (typeof value === 'object') {
            const jsonString = JSON.stringify(value);
            const escaped = jsonString.replace(/'/g, "''").replace(/\\/g, '\\\\');
            return `'${escaped}'`;
        }

        return `'${String(value).replace(/'/g, "''").replace(/\\/g, '\\\\')}'`;
    }

    private static buildUpdateQuery(
        batch: Array<Record<string, any>>,
        tableName: string,
        modelInfo?: any
    ): {
        query: string | null;
        idsInBatch: Set<number>;
    } {
        const prisma = getPrismaInstance();
        const updates: Record<string, Record<number, any>> = {};
        const ids = new Set<number>();
        const fieldsToUpdate = new Set<string>();

        const fieldMap: Record<string, string> = {};
        const jsonFields = new Set<string>();
        if (modelInfo?.fields) {
            modelInfo.fields.forEach((field: any) => {
                const fieldName = field.name;
                fieldMap[fieldName] = field.dbName || fieldName;
                // Track JSON fields
                if (field.kind === 'scalar' && (field.type === 'Json' || field.type === 'Bytes')) {
                    jsonFields.add(fieldName);
                }
            });
        }

        for (const item of batch) {
            const itemId = parseInt(String(item.id));
            if (!itemId || isNaN(itemId)) continue;

            ids.add(itemId);

            for (const [key, value] of Object.entries(item)) {
                if (key === 'id' || value === undefined) continue;

                fieldsToUpdate.add(key);
                if (!updates[key]) updates[key] = {};
                updates[key][itemId] = value;
            }
        }

        if (fieldsToUpdate.size === 0 || ids.size === 0) {
            return { query: null, idsInBatch: ids };
        }

        const provider = getDatabaseProvider(prisma);
        const setClauses = Array.from(fieldsToUpdate).map((field) => {
            const fieldUpdates = updates[field];
            const isJsonField = jsonFields.has(field);

            const whenClauses = Object.entries(fieldUpdates)
                .map(([id, value]) => {
                    let escapedValue = this.escapeValue(value, prisma);
                    // For PostgreSQL JSON fields, cast the value to JSONB
                    if (isJsonField && provider === 'postgresql') {
                        escapedValue = `${escapedValue}::jsonb`;
                    }
                    return `        WHEN ${id} THEN ${escapedValue}`;
                })
                .join('\n');

            // Usar el nombre de columna mapeado de la base de datos
            const dbColumnName = fieldMap[field] || field;
            const quotedColumn = quoteIdentifier(dbColumnName, prisma);
            const quotedId = quoteIdentifier('id', prisma);
            return `    ${quotedColumn} = CASE ${quotedId}\n${whenClauses}\n        ELSE ${quotedColumn}\n    END`;
        });

        const idList = Array.from(ids).join(', ');
        const quotedTableName = quoteIdentifier(tableName, prisma);
        const quotedId = quoteIdentifier('id', prisma);

        const query = `UPDATE ${quotedTableName}
                       SET ${setClauses.join(',\n')}
                       WHERE ${quotedId} IN (${idList});`;

        return { query, idsInBatch: ids };
    }

    async delete(): Promise<number | string> {
        if (!this.id) throw new Error("Cannot delete: Missing primary key (id)");
        const { model } = this.constructor as any;
        if (!model) throw new Error("The model is not defined in the child class of BaseEntity.");
        try {
            await model.delete({ where: { id: this.id } });
            return this.id;
        } catch (error) {
            console.error("Error deleting entity:", (error as Error).name);
            return 0;
        }
    }

    public static async deleteByFilter<T extends Record<string, any>>(
        this: new (data: any) => BaseEntity<T>,
        filter: Partial<T>,
        options?: FindByFilterOptions.Options
    ): Promise<number> {
        const entityModel = (this as any).model;
        if (!entityModel) throw new Error("The model is not defined in the BaseEntity class.");

        let modelInfo: any = null;
        try {
            modelInfo = (this as any).getModelInformation();
        } catch (error) {
            console.warn(`Could not get model info for ${entityModel.name}:`, (error as Error).message);
        }

        let whereClause = SearchUtils.applyDefaultFilters(filter, modelInfo);
        if (options?.search) whereClause = SearchUtils.applySearchFilter(whereClause, options.search, modelInfo);
        try {
            const result = await entityModel.deleteMany({
                where: whereClause
            });
            return result.count || 0;
        } catch (error) {
            console.error(`Error deleting entities with filter:`, (error as Error).message);
            return 0;
        }
    }

    toJson(): string {
        return JSON.stringify(BaseEntity.sanitizeKeysRecursive(this), null, 2);
    }

    toObject(): TModel {
        return BaseEntity.sanitizeKeysRecursive(this) as TModel;
    }

    private assignProperties(data: Partial<TModel>): void {
        Object.keys(data).forEach((key) => {
            (this as any)[key] = (data as any)[key];
        });
    }
}
