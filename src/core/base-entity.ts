import { IBaseEntity } from "./structures/interfaces/base-entity.interface";
import { FindByFilterOptions } from "./structures/types/search.types";
import DataUtils from "./data-utils";
import ModelUtils from "./model-utils";
import { logError } from "./utils/error-utils";
import { hasChanges as compareHasChanges } from "./utils/comparison-utils";
import BaseEntityBatch from "./base-entity-batch";
import BaseEntityQuery from "./base-entity-query";
import BaseEntityHelpers from "./base-entity-helpers";

export default abstract class BaseEntity<TModel extends object = Record<string, unknown>> implements IBaseEntity<TModel> {
    static readonly model: unknown;
    static readonly BATCH_SIZE = 1500; // Default for SQL databases
    static readonly MONGODB_TRANSACTION_BATCH_SIZE = 100; // MongoDB transaction limit
    public readonly id?: number | string;

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
        const decoratedProperties = (this.constructor as { _decoratedProperties?: Set<string> })._decoratedProperties;

        Object.keys(data).forEach((key) => {
            const value = (data as Record<string, unknown>)[key];

            if (key === 'id') {
                // Special case: id is always assigned directly
                // Type guard: ensure value is number or string
                if (typeof value === 'number' || typeof value === 'string') {
                    (this as Record<string, unknown>).id = value;
                }
            } else {
                // Check if property is decorated with @Property()
                const isDecorated = decoratedProperties?.has(key);

                if (isDecorated) {
                    // For decorated properties, use the setter (which handles _key internally)
                    (this as Record<string, unknown>)[key] = value;
                } else {
                    // Check if property has a getter or setter in the prototype chain
                    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), key);
                    const hasGetterOrSetter = descriptor && (descriptor.get || descriptor.set);

                    if (hasGetterOrSetter) {
                        // Has manual getter/setter: assign to private _key
                        const privateKey = `_${key}`;
                        (this as Record<string, unknown>)[privateKey] = value;
                    } else {
                        // Try to assign directly first (for public properties)
                        // This will create the property if it doesn't exist
                        (this as Record<string, unknown>)[key] = value;
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
    public static async findByFilter<T extends object = Record<string, unknown>>(
        this: { new (...args: any[]): BaseEntity<T>; model: any; getModelInformation: () => any },
        filter: Partial<T>,
        options: FindByFilterOptions.Options = FindByFilterOptions.defaultOptions
    ): Promise<
        | FindByFilterOptions.PaginatedResponse<T>
        | T[]
        | T
        | null
    > {
        const entityModel = this.model;
        const getModelInformation = () => this.getModelInformation();
        
        return BaseEntityQuery.findByFilter<T>(
            entityModel,
            getModelInformation,
            filter,
            options
        );
    }

    /**
     * Counts the number of records matching the given filter
     * @param filter - Filter criteria
     * @returns Promise<number> - The count of matching records
     */
    public static async countByFilter<T extends object = Record<string, unknown>>(
        this: { new (...args: any[]): BaseEntity<T>; model: any; getModelInformation: () => any },
        filter: Partial<T>
    ): Promise<number> {
        const entityModel = this.model;
        const getModelInformation = () => this.getModelInformation();
        
        return BaseEntityQuery.countByFilter<T>(
            entityModel,
            getModelInformation,
            filter
        );
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
        return (this.constructor as any).findByFilter(filter, options) as Promise<
            | FindByFilterOptions.PaginatedResponse<TModel>
            | TModel[]
            | TModel
            | null
        >;
    }

    /**
     * Gets model information from Prisma runtime data model
     * Uses ModelUtils for cached access to model metadata
     * 
     * @param modelName - Optional model name (defaults to the entity's model name)
     * @returns Model information from Prisma runtime
     * @throws Error if model is not defined or not found
     * 
     * @example
     * ```typescript
     * const modelInfo = User.getModelInformation();
     * const fields = modelInfo.fields;
     * ```
     */
    public static getModelInformation(
        this: { model: any },
        modelName?: string
    ): ReturnType<typeof ModelUtils.getModelInformationCached> {
        const modelData = this.model;
        
        // Type guard: check if modelData has a name property
        let modelNameToUse = modelName;
        if (!modelNameToUse && typeof modelData === 'object' && modelData !== null && 'name' in modelData) {
            const name = (modelData as { name: unknown }).name;
            if (typeof name === 'string') {
                modelNameToUse = name;
            }
        }
        
        if (!modelNameToUse) {
            throw new Error("The model is not defined or does not have a name.");
        }

        // Extract Prisma instance from model.$parent if available
        // This ensures we use the correct Prisma instance with the runtime data model
        const prismaInstance = (modelData && typeof modelData === 'object' && '$parent' in modelData) 
            ? (modelData as any).$parent 
            : undefined;

        // Use ModelUtils for cached model information access
        return ModelUtils.getModelInformationCached(modelNameToUse, prismaInstance);
    }



    /**
     * Creates a new entity in the database
     * Sanitizes keys, processes relations, and validates data before creation
     * 
     * @returns The created entity
     * @throws Error if model is not defined or no data provided
     * 
     * @example
     * ```typescript
     * const user = new User({ name: 'John', email: 'john@example.com' });
     * const created = await user.create();
     * ```
     */
    async create(): Promise<TModel> {
        const { model } = this.constructor as { model?: unknown };
        
        // Type guard: check if model has create method
        if (typeof model !== 'object' || model === null || !('create' in model) || typeof (model as { create: unknown }).create !== 'function') {
            throw new Error("Model is not defined in the BaseEntity class.");
        }
        
        const typedModel = model as { create: (args: { data: Record<string, unknown> }) => Promise<TModel> };

        // Get model information for relation processing
        let modelInfo: ReturnType<typeof ModelUtils.getModelInformationCached> | null = null;
        try {
            modelInfo = (this.constructor as any).getModelInformation();
        } catch (error) {
            // Model info not available, continue without it
        }

        // Sanitize and process data using helper methods
        const rawData = BaseEntityHelpers.sanitizeKeysRecursive(this);
        const data = DataUtils.processRelations(rawData, modelInfo);
        
        if (!data || Object.keys(data).length === 0) {
            throw new Error("Cannot create: no data provided.");
        }

        // Create entity and update instance properties
        const created = await typedModel.create({ data });
        this.assignProperties(created);
        return created;
    }

    public static async createMany<T extends object = Record<string, unknown>>(
        this: { new (...args: any[]): BaseEntity<T>; model: any; getModelInformation: () => any },
        items: Partial<T>[],
        skipDuplicates = false,
        keyTransformTemplate: (relationName: string) => string = (key) => `${key}Id`,
        options?: {
            parallel?: boolean;
            concurrency?: number;
            handleRelations?: boolean;
        }
    ): Promise<number> {
        const entityModel = this.model;
        const getModelInformation = () => this.getModelInformation();
        
        return BaseEntityBatch.createMany<T>(
            entityModel,
            getModelInformation,
            items,
            skipDuplicates,
            keyTransformTemplate,
            options
        );
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
    public static async upsert<T extends object = Record<string, unknown>>(
        this: { new (...args: any[]): BaseEntity<T>; model: any; getModelInformation: () => any },
        data: Partial<T>,
        keyTransformTemplate: (relationName: string) => string = (key) => `${key}Id`
    ): Promise<T> {
        const entityModel = this.model;
        
        // Type guard: check if model has required methods
        if (typeof entityModel !== 'object' || entityModel === null) {
            throw new Error("Model is not defined in the BaseEntity class.");
        }
        
        const model = entityModel as Record<string, unknown>;
        if (typeof model.name !== 'string' ||
            typeof model.findFirst !== 'function' ||
            typeof model.update !== 'function' ||
            typeof model.create !== 'function') {
            throw new Error("Model is not defined in the BaseEntity class.");
        }
        
        const typedModel = entityModel as { 
            name: string;
            findFirst: (args: { where: Record<string, unknown> }) => Promise<unknown>;
            update: (args: { where: { id: number | string }; data: Record<string, unknown> }) => Promise<T>;
            create: (args: { data: Record<string, unknown> }) => Promise<T>;
        };

        const modelName = typedModel.name;
        
        // Use ModelUtils to get unique constraints
        const uniqueConstraints = ModelUtils.getUniqueConstraints(modelName);
        if (!uniqueConstraints || uniqueConstraints.length === 0) {
            throw new Error(`No unique constraints found for model ${modelName}. Cannot perform upsert.`);
        }

        // Get model information for relation processing
        let modelInfo: ReturnType<typeof ModelUtils.getModelInformationCached> | null = null;
        try {
            modelInfo = this.getModelInformation();
        } catch (error) {
            // Model info not available, continue without it
        }

        // Process data through helper methods pipeline
        const clean = BaseEntityHelpers.sanitizeKeysRecursive(data);
        const processed = DataUtils.processRelations(clean, modelInfo);
        const normalized = DataUtils.normalizeRelationsToFK(processed, keyTransformTemplate);

        // Try to find existing record using unique constraints
        const existingRecord = await BaseEntity.findExistingByUniqueConstraints<T>(
            typedModel,
            normalized,
            uniqueConstraints
        );

        if (existingRecord) {
            // Use comparison-utils to check for changes
            const hasChanges = compareHasChanges(normalized, existingRecord as Record<string, unknown>);

            if (!hasChanges) {
                // No changes, return existing record
                return existingRecord as T;
            }

            // Type guard: ensure existingRecord has valid id
            const record = existingRecord as Record<string, unknown>;
            const recordId = record.id;
            if (typeof recordId !== 'number' && typeof recordId !== 'string') {
                throw new Error("Existing record does not have a valid id");
            }

            // Has changes, perform update
            const updated = await typedModel.update({
                where: { id: recordId },
                data: normalized
            });
            return updated as T;
        }

        // Record doesn't exist, create new
        const created = await typedModel.create({ data: normalized });
        return created;
    }

    /**
     * Helper method to find existing record by unique constraints
     * Tries each unique constraint until a match is found
     * 
     * @private
     */
    private static async findExistingByUniqueConstraints<T extends object = Record<string, unknown>>(
        entityModel: { 
            name: string;
            findFirst: (args: { where: Record<string, unknown> }) => Promise<unknown>;
            update: (args: { where: { id: number | string }; data: Record<string, unknown> }) => Promise<T>;
            create: (args: { data: Record<string, unknown> }) => Promise<T>;
        },
        normalized: Record<string, unknown>,
        uniqueConstraints: string[][]
    ): Promise<T | null> {
        for (const constraint of uniqueConstraints) {
            const whereClause: Record<string, unknown> = {};
            let hasAllFields = true;

            // Build where clause from constraint fields
            for (const field of constraint) {
                if (normalized[field] !== undefined && normalized[field] !== null) {
                    whereClause[field] = normalized[field];
                } else {
                    hasAllFields = false;
                    break;
                }
            }

            // Try to find record if all constraint fields are present
            if (hasAllFields && Object.keys(whereClause).length > 0) {
                try {
                    const existingRecord = await entityModel.findFirst({ where: whereClause });
                    // Type guard: check if record has id property
                    if (existingRecord && typeof existingRecord === 'object' && 'id' in existingRecord) {
                        const record = existingRecord as Record<string, unknown>;
                        if (typeof record.id === 'number' || typeof record.id === 'string') {
                            return existingRecord as T;
                        }
                    }
                } catch (error) {
                    // Continue to next constraint if this one fails
                    continue;
                }
            }
        }

        return null;
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
    public static async upsertMany<T extends object = Record<string, unknown>>(
        this: { new (...args: any[]): BaseEntity<T>; model: any; getModelInformation: () => any; updateManyById: (dataList: Array<Partial<T>>, opts?: any) => Promise<number> },
        items: Partial<T>[],
        keyTransformTemplate: (relationName: string) => string = (key) => `${key}Id`,
        options?: {
            parallel?: boolean;
            concurrency?: number;
            handleRelations?: boolean;
        }
    ): Promise<{ created: number; updated: number; unchanged: number; total: number }> {
        const entityModel = this.model;
        const getModelInformation = () => this.getModelInformation();
        const updateManyByIdFn = (dataList: Array<Partial<T>>, opts?: { parallel?: boolean; concurrency?: number }) => 
            this.updateManyById(dataList, opts);
        
        return BaseEntityBatch.upsertMany<T>(
            entityModel,
            getModelInformation,
            updateManyByIdFn,
            items,
            keyTransformTemplate,
            options
        );
    }

    /**
     * Checks if there are changes between new data and existing data.
     * Delegates to comparison-utils for consistent change detection logic
     * 
     * @param newData - New data to compare
     * @param existingData - Existing data to compare against
     * @param ignoreFields - Additional fields to ignore beyond defaults (id, createdAt, updatedAt)
     * @returns true if any changes detected, false otherwise
     * 
     * @example
     * ```typescript
     * const hasChanges = User.hasChanges(
     *   { name: 'John Doe', email: 'john@example.com' },
     *   { name: 'John', email: 'john@example.com' }
     * ); // true
     * ```
     */
    protected static hasChanges<T extends object = Record<string, unknown>>(
        newData: T,
        existingData: T,
        ignoreFields: string[] = []
    ): boolean {
        // Delegate to comparison-utils for consistent change detection
        return compareHasChanges(newData, existingData, ignoreFields);
    }

    /**
     * Updates the entity in the database
     * Sanitizes keys, processes relations, normalizes FKs, and prunes non-updateable fields
     * 
     * @returns The updated entity
     * @throws Error if id is missing or model is not defined
     * 
     * @example
     * ```typescript
     * const user = await User.findByFilter({ id: 1 }, { onlyOne: true });
     * user.name = 'Jane Doe';
     * await user.update();
     * ```
     */
    async update(): Promise<TModel> {
        const thisRecord = this as Record<string, unknown>;
        const id = thisRecord.id;
        
        // Type guard: ensure id is number or string
        if (typeof id !== 'number' && typeof id !== 'string') {
            throw new Error("Cannot update: Missing primary key (id)");
        }

        const { id: _id, ...data } = thisRecord;
        const { model } = this.constructor as { model?: unknown };

        // Type guard: check if model has update method
        if (typeof model !== 'object' || model === null || !('update' in model) || typeof (model as { update: unknown }).update !== 'function') {
            throw new Error("Model is not defined in the BaseEntity class.");
        }
        
        const typedModel = model as { update: (args: { where: { id: number | string }; data: Record<string, unknown> }) => Promise<TModel> };

        // Get model information for relation processing
        let modelInfo: ReturnType<typeof ModelUtils.getModelInformationCached> | null = null;
        try {
            modelInfo = (this.constructor as any).getModelInformation();
        } catch (error) {
            // Model info not available, continue without it
        }

        // Process data through helper methods pipeline
        const cleanData = BaseEntityHelpers.sanitizeKeysRecursive(data);
        const processedData = DataUtils.processRelations(cleanData, modelInfo);
        const normalized = DataUtils.normalizeRelationsToFK(processedData, (k) => `${k}Id`);
        const pruned = BaseEntityHelpers.pruneUpdatePayload(normalized);

        // Update entity and refresh instance properties
        const updatedEntity = await typedModel.update({ where: { id }, data: pruned });
        this.assignProperties(updatedEntity);
        return updatedEntity;
    }





    public static async updateManyById<T extends object = Record<string, unknown>>(
        this: { new (...args: any[]): BaseEntity<T>; model: any; getModelInformation: () => any },
        dataList: Array<Partial<T>>,
        options?: {
            parallel?: boolean;
            concurrency?: number;
        }
    ): Promise<number> {
        const entityModel = this.model;
        const getModelInformation = () => this.getModelInformation();
        
        return BaseEntityBatch.updateManyById(
            entityModel,
            getModelInformation,
            BaseEntityHelpers.buildUpdateQuery.bind(BaseEntityHelpers),
            BaseEntityHelpers.prepareUpdateList.bind(BaseEntityHelpers),
            dataList,
            options
        );
    }



    /**
     * Deletes the entity from the database
     * 
     * @returns The id of the deleted entity, or 0 if deletion failed
     * @throws Error if id is missing or model is not defined
     * 
     * @example
     * ```typescript
     * const user = await User.findByFilter({ id: 1 }, { onlyOne: true });
     * await user.delete();
     * ```
     */
    async delete(): Promise<number | string> {
        // Type guard: ensure id is number or string
        if (typeof this.id !== 'number' && typeof this.id !== 'string') {
            throw new Error("Cannot delete: Missing primary key (id)");
        }

        const { model } = this.constructor as { model?: unknown };
        
        // Type guard: check if model has delete method
        if (typeof model !== 'object' || model === null || !('delete' in model) || typeof (model as { delete: unknown }).delete !== 'function') {
            throw new Error("The model is not defined in the child class of BaseEntity.");
        }
        
        const typedModel = model as { delete: (args: { where: { id: number | string } }) => Promise<unknown> };

        try {
            await typedModel.delete({ where: { id: this.id } });
            return this.id;
        } catch (error) {
            logError('delete', error as Error, { entityId: this.id });
            return 0;
        }
    }

    public static async deleteByFilter<T extends object = Record<string, unknown>>(
        this: { new (...args: any[]): BaseEntity<T>; model: any; getModelInformation: () => any },
        filter: Partial<T>,
        options?: FindByFilterOptions.Options
    ): Promise<number> {
        const entityModel = this.model;
        const getModelInformation = () => this.getModelInformation();
        
        return BaseEntityQuery.deleteByFilter<T>(
            entityModel,
            getModelInformation,
            filter,
            options
        );
    }

    /**
     * Delete multiple entities by their IDs in parallel batches
     * 
     * @param ids - Array of IDs to delete
     * @param options - Parallel execution options
     * @returns Number of deleted records
     * 
     * @example
     * ```typescript
     * const deleted = await User.deleteByIds([1, 2, 3, 4, 5], { parallel: true });
     * console.log(`Deleted ${deleted} users`);
     * ```
     */
    public static async deleteByIds<T extends object = Record<string, unknown>>(
        this: { new (...args: any[]): BaseEntity<T>; model: any },
        ids: (number | string)[],
        options?: {
            parallel?: boolean;
            concurrency?: number;
        }
    ): Promise<number> {
        const entityModel = this.model;
        
        return BaseEntityBatch.deleteByIds(
            entityModel,
            ids,
            options
        );
    }

    toJson(): string {
        return JSON.stringify(BaseEntityHelpers.sanitizeKeysRecursive(this), null, 2);
    }

    toObject(): TModel {
        return BaseEntityHelpers.sanitizeKeysRecursive(this) as TModel;
    }

    private assignProperties(data: Partial<TModel>): void {
        Object.keys(data).forEach((key) => {
            (this as Record<string, unknown>)[key] = (data as Record<string, unknown>)[key];
        });
    }
}

