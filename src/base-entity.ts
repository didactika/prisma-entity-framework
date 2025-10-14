import { IBaseEntity } from "./interfaces/base-entity.interface";
import { FindByFilterOptions } from "./types/search.types";
import DataUtils from "./data-utils";
import ModelUtils from "./model-utils";
import { getPrismaInstance } from './config';
import SearchUtils from "./search/search-utils";
import { PrismaClient } from "@prisma/client";
import { quoteIdentifier, formatBoolean, getDatabaseProvider } from "./database-utils";

export default abstract class BaseEntity<TModel extends Record<string, any>> implements IBaseEntity<TModel> {
    static readonly model: any;
    static readonly BATCH_SIZE = 1500;
    public readonly id?: number;

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
            if (options.search) whereClause = SearchUtils.applySearchFilter(whereClause, options.search);

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
                const whereClause = searchClone ? SearchUtils.applySearchFilter(whereClauseBase, searchClone) : whereClauseBase;
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
        const rawData = BaseEntity.sanitizeKeysRecursive(this);
        const data = DataUtils.processRelations(rawData);
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

        // Check if database supports skipDuplicates (SQLite doesn't)
        const prisma = getPrismaInstance();
        const provider = getDatabaseProvider(prisma);
        const supportsSkipDuplicates = provider !== 'sqlite';

        let totalCreated = 0;
        const processedData = items.map(item => {
            const clean = BaseEntity.sanitizeKeysRecursive(item);
            const processed = DataUtils.processRelations(clean);
            return DataUtils.normalizeRelationsToFK(processed, keyTransformTemplate);
        });

        // Deduplicate data within the batch to avoid constraint errors
        const deduplicatedData = BaseEntity.deduplicateByUniqueConstraints(processedData, entityModel.name);

        if (deduplicatedData.length < processedData.length) {
            console.warn(`⚠️  [${entityModel.name}] Removed ${processedData.length - deduplicatedData.length} duplicate records from batch`);
        }

        for (let i = 0; i < deduplicatedData.length; i += BaseEntity.BATCH_SIZE) {
            const batch = deduplicatedData.slice(i, i + BaseEntity.BATCH_SIZE);
            try {
                const options: any = { data: batch };
                if (skipDuplicates && supportsSkipDuplicates) {
                    options.skipDuplicates = true;
                }

                const result = await entityModel.createMany(options);
                totalCreated += result.count;
            } catch (error) {
                const errorMsg = (error as Error).message;
                console.error(`❌ Error in createMany batch for ${entityModel.name} (index ${i}): ${errorMsg}`);

                // If it's a unique constraint error and skipDuplicates is false, try with skipDuplicates=true
                if (errorMsg.includes('Unique constraint failed') && !skipDuplicates && supportsSkipDuplicates) {
                    console.log(`🔄 Retrying batch ${i} with skipDuplicates=true...`);
                    try {
                        const retryResult = await entityModel.createMany({
                            data: batch,
                            skipDuplicates: true
                        });
                        totalCreated += retryResult.count;
                        console.log(`✅ Retry successful: ${retryResult.count} records created`);
                    } catch (retryError) {
                        throw retryError;
                    }
                } else {
                    throw error;
                }
            }
        }
        return totalCreated;
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
        const cleanData = BaseEntity.sanitizeKeysRecursive(data);
        const processedData = DataUtils.processRelations(cleanData);
        const updatedEntity = await model.update({ where: { id }, data: processedData });
        this.assignProperties(updatedEntity);
        return updatedEntity;
    }

    public static async updateManyById(
        this: new (data: any) => BaseEntity<any>,
        dataList: Array<Partial<any>>,
    ): Promise<number> {
        if (!Array.isArray(dataList) || dataList.length === 0) return 0;
        const prisma = getPrismaInstance();
        const modelInfo = (this as any).getModelInformation();
        const tableName = modelInfo.dbName;
        const formattedList = BaseEntity.prepareUpdateList(dataList);
        let totalUpdated = 0;
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

    private static prepareUpdateList(dataList: Array<Partial<any>>): Array<Record<string, any>> {
        return BaseEntity.sanitizeKeysRecursive(dataList)
            .filter((item: any) => item.id !== undefined && item.id !== null)
            .map((item: any) => {
                const processed = DataUtils.processRelations(item);
                return Object.fromEntries(
                    Object.entries(processed).filter(([key, val]) => {
                        if (key === 'id') return true;
                        if (val === undefined) return false;
                        if (val === null) return true;
                        if (Array.isArray(val)) return true;
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
        if (modelInfo?.fields) {
            modelInfo.fields.forEach((field: any) => {
                const fieldName = field.name;
                fieldMap[fieldName] = field.dbName || fieldName;
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

        const setClauses = Array.from(fieldsToUpdate).map((field) => {
            const fieldUpdates = updates[field];
            const whenClauses = Object.entries(fieldUpdates)
                .map(([id, value]) => `        WHEN ${id} THEN ${this.escapeValue(value, prisma)}`)
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

    async delete(): Promise<number> {
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
        if (options?.search) whereClause = SearchUtils.applySearchFilter(whereClause, options.search);
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
