import { getPrismaInstance, isParallelEnabled } from './config';
import { executeInParallel } from './utils/parallel-utils';
import { getDatabaseProviderCached } from './utils/database-utils';
import { isObject, isNonEmptyArray } from './utils/validation-utils';
import { logError } from './utils/error-utils';
import type { PrismaClient } from '@prisma/client';

import ModelUtils from './model-utils';
import type { JoinTableInfo } from './model-utils';

/**
 * Prisma model field information
 */
interface PrismaFieldInfo {
    name: string;
    kind: 'scalar' | 'object' | 'enum';
    type: string;
    isList?: boolean;
    isUnique?: boolean;
    relationName?: string;
}

/**
 * Prisma model information structure
 */
interface PrismaModelInfo {
    name: string;
    fields: PrismaFieldInfo[];
    uniqueIndexes?: Array<{ fields: string[] }>;
    primaryKey?: { fields: string[] };
}

/**
 * Type guard to check if value is a valid PrismaModelInfo
 */
function isPrismaModelInfo(value: unknown): value is PrismaModelInfo {
    if (!value || typeof value !== 'object') return false;
    const obj = value as Record<string, unknown>;
    return (
        Array.isArray(obj.fields) &&
        (obj.name === undefined || typeof obj.name === 'string')
    );
}

/**
 * Relation item with ID
 */
interface RelationItem {
    id: number | string;
    [key: string]: unknown;
}

/**
 * Type guard to check if value has an id property
 */
function hasId(value: unknown): value is RelationItem {
    return (
        value !== null &&
        typeof value === 'object' &&
        'id' in value &&
        (typeof (value as RelationItem).id === 'number' || typeof (value as RelationItem).id === 'string')
    );
}

/**
 * Utility class for processing relational data structures.
 * 
 * Provides methods for handling Prisma relations, including:
 * - Processing nested relations into Prisma-compatible formats
 * - Extracting and applying many-to-many relations
 * - Normalizing relation objects to foreign keys
 * 
 * @example
 * ```typescript
 * // Process relations in data object
 * const processedData = DataUtils.processRelations(userData, modelInfo);
 * 
 * // Extract many-to-many relations for batch operations
 * const { cleanedItems, relations } = DataUtils.extractManyToManyRelations(users, modelInfo);
 * ```
 */
export default class DataUtils {

    /**
     * Detects if a many-to-many relation is explicit or implicit
     * Explicit many-to-many: field type is a join table model (e.g., AreasOnSubjects)
     * Implicit many-to-many: field type is the target entity directly (e.g., Area)
     * 
     * @param modelInfo - Prisma model information
     * @param fieldName - Name of the relation field
     * @returns 'explicit' | 'implicit' | null
     * 
     * @private
     * @internal Delegates to ModelUtils.detectRelationType for caching
     */
    private static detectRelationType(
        modelInfo: PrismaModelInfo | unknown,
        fieldName: string
    ): 'explicit' | 'implicit' | null {
        if (!isPrismaModelInfo(modelInfo)) {
            return null;
        }

        // Delegate to ModelUtils which handles caching
        return ModelUtils.detectRelationType(modelInfo.name, fieldName);
    }

    /**
     * Gets join table information for explicit many-to-many relationships
     * 
     * @param modelName - Name of the source model
     * @param fieldName - Name of the relation field
     * @param _modelInfo - Prisma model information (not used, kept for backward compatibility)
     * @returns Join table metadata or null
     * 
     * @private
     * @internal Delegates to ModelUtils.getJoinTableInfo for caching
     */
    private static getJoinTableInfo(
        modelName: string,
        fieldName: string,
        _modelInfo: PrismaModelInfo | unknown
    ): JoinTableInfo | null {
        // Delegate to ModelUtils which handles caching
        return ModelUtils.getJoinTableInfo(modelName, fieldName);
    }

    /**
     * Processes relational data by transforming nested objects and arrays into Prisma-compatible formats.
     * 
     * Converts objects into `connect` or `create` structures for relational integrity.
     * JSON fields and scalar arrays are preserved as-is without wrapping in connect/create.
     * 
     * @param data - The original data object containing relations
     * @param modelInfo - Optional model information to detect JSON fields and scalar arrays
     * @returns A transformed object formatted for Prisma operations
     * 
     * @example
     * ```typescript
     * const userData = {
     *   name: 'John',
     *   profile: { id: 1 },  // Will become { connect: { id: 1 } }
     *   posts: [{ id: 1 }, { id: 2 }],  // Will become { connect: [{ id: 1 }, { id: 2 }] }
     *   metadata: { key: 'value' }  // JSON field, preserved as-is
     * };
     * 
     * const processed = DataUtils.processRelations(userData, modelInfo);
     * ```
     */
    public static processRelations(data: Record<string, unknown>, modelInfo?: PrismaModelInfo | unknown): Record<string, unknown> {
        const processedData = { ...data };

        // Build sets for quick lookup
        const jsonFields = new Set<string>();
        const scalarArrayFields = new Set<string>();

        if (isPrismaModelInfo(modelInfo)) {
            for (const field of modelInfo.fields) {
                // Track JSON/Bytes fields
                if (field.kind === 'scalar' && (field.type === 'Json' || field.type === 'Bytes')) {
                    jsonFields.add(field.name);
                }
                // Track scalar arrays (String[], Int[], etc.) - these should not be processed as relations
                if (field.kind === 'scalar' && field.isList === true) {
                    scalarArrayFields.add(field.name);
                }
            }
        }

        for (const key of Object.keys(data)) {
            const value = data[key];

            // Skip processing if this is a JSON field (check BEFORE type checks)
            if (jsonFields.has(key)) {
                // Keep JSON fields as-is
                processedData[key] = value;
                continue;
            }

            // Skip processing if this is a scalar array (e.g., String[], Int[])
            if (scalarArrayFields.has(key)) {
                // Keep scalar arrays as-is
                processedData[key] = value;
                continue;
            }

            // Skip non-objects and non-arrays (use validation-utils.isObject for objects, but also check arrays)
            if (!isObject(value) && !Array.isArray(value)) continue;

            // Skip native object types that should not be treated as relations
            // Date, RegExp, Map, Set, etc. are objects but not relation candidates
            if (value instanceof Date) continue;

            if (Array.isArray(value)) {
                const relationArray = this.processRelationArray(value);
                if (relationArray.length > 0) {
                    processedData[key] = { connect: relationArray };
                }
            } else {
                processedData[key] = this.processRelationObject(value);
            }
        }

        return processedData;
    }

    private static processRelationArray<T extends RelationItem>(array: unknown[]): Array<{ id: number | string }> {
        return array
            .filter((item): item is T => hasId(item))
            .map((item) => ({ id: item.id }));
    }

    private static processRelationObject(obj: unknown): { connect: { id: number | string } } | { create: Record<string, unknown> } {
        if (hasId(obj)) {
            return { connect: { id: obj.id } };
        }
        if (obj && typeof obj === 'object') {
            return { create: { ...obj as Record<string, unknown> } };
        }
        return { create: {} };
    }


    /**
     * Normalizes relation objects to foreign key fields.
     * 
     * Converts `{ relation: { connect: { id: 1 } } }` to `{ relationId: 1 }`.
     * Useful for flattening data before database operations.
     * 
     * @param data - Data object with relation objects
     * @param keyTransformTemplate - Function to transform relation name to FK field name (default: adds 'Id' suffix)
     * @returns Data object with relations converted to foreign keys
     * 
     * @example
     * ```typescript
     * const data = {
     *   name: 'Post',
     *   author: { connect: { id: 5 } }
     * };
     * 
     * const normalized = DataUtils.normalizeRelationsToFK(data);
     * // Result: { name: 'Post', authorId: 5 }
     * 
     * // Custom FK naming
     * const customNormalized = DataUtils.normalizeRelationsToFK(
     *   data,
     *   (key) => `fk_${key}`
     * );
     * // Result: { name: 'Post', fk_author: 5 }
     * ```
     */
    public static normalizeRelationsToFK(
        data: Record<string, unknown>,
        keyTransformTemplate: (relationName: string) => string = (key) => `${key}Id`
    ): Record<string, unknown> {
        const flatData = { ...data };

        for (const [key, value] of Object.entries(flatData)) {
            if (
                typeof value === 'object' &&
                value !== null &&
                'connect' in value &&
                value.connect &&
                typeof value.connect === 'object' &&
                'id' in value.connect
            ) {
                const newKey = keyTransformTemplate(key);
                // Only set the FK if it doesn't already exist (FK takes precedence)
                if (!(newKey in flatData)) {
                    flatData[newKey] = value.connect.id;
                }
                delete flatData[key];
            }
        }

        return flatData;
    }

    /**
     * Extracts many-to-many relation data from items and returns cleaned items.
     * 
     * Separates many-to-many relation arrays from the main data objects,
     * allowing batch operations to process entities and relations separately.
     * 
     * @param items - Array of items with potential many-to-many relations
     * @param modelInfo - Prisma model information
     * @returns Object with cleaned items, extracted relations, and relation types
     * 
     * @example
     * ```typescript
     * const users = [
     *   { name: 'Alice', roles: [{ id: 1 }, { id: 2 }] },
     *   { name: 'Bob', roles: [{ id: 2 }] }
     * ];
     * 
     * const { cleanedItems, relations, relationTypes } = 
     *   DataUtils.extractManyToManyRelations(users, modelInfo);
     * 
     * // cleanedItems: [{ name: 'Alice' }, { name: 'Bob' }]
     * // relations: Map { 0 => { roles: [{ id: 1 }, { id: 2 }] }, 1 => { roles: [{ id: 2 }] } }
     * // relationTypes: Map { 'roles' => 'implicit' }
     * ```
     */
    public static extractManyToManyRelations<T extends object>(
        items: T[],
        modelInfo?: PrismaModelInfo | unknown
    ): {
        cleanedItems: T[];
        relations: Map<number, Record<string, unknown[]>>;
        relationTypes: Map<string, 'explicit' | 'implicit'>;
    } {
        if (!isPrismaModelInfo(modelInfo)) {
            return { cleanedItems: items, relations: new Map(), relationTypes: new Map() };
        }

        // Find all many-to-many relation fields
        const manyToManyFields = modelInfo.fields.filter(
            (field) => field.kind === 'object' && field.isList === true
        );

        if (manyToManyFields.length === 0) {
            return { cleanedItems: items, relations: new Map(), relationTypes: new Map() };
        }

        const relations = new Map<number, Record<string, any[]>>();
        const relationTypes = new Map<string, 'explicit' | 'implicit'>();

        // Detect relation types for all many-to-many fields
        for (const field of manyToManyFields) {
            const fieldName = field.name;
            const relationType = this.detectRelationType(modelInfo, fieldName);
            if (relationType) {
                relationTypes.set(fieldName, relationType);
            }
        }

        const cleanedItems = items.map((item, index) => {
            const cleaned = { ...item };
            const itemRelations: Record<string, unknown[]> = {};
            const itemRecord = item as Record<string, unknown>;

            for (const field of manyToManyFields) {
                const fieldName = field.name;
                if (fieldName in item) {
                    const value = itemRecord[fieldName];

                    // Extract relation data using validation-utils
                    if (isNonEmptyArray(value)) {
                        itemRelations[fieldName] = value as unknown[];
                    } else if (isObject(value) && 'connect' in value) {
                        // Handle { connect: [...] } format
                        const connectValue = (value as Record<string, unknown>).connect;
                        itemRelations[fieldName] = Array.isArray(connectValue)
                            ? connectValue
                            : [connectValue];
                    }

                    // Remove from main item
                    delete (cleaned as Record<string, unknown>)[fieldName];
                }
            }

            if (Object.keys(itemRelations).length > 0) {
                relations.set(index, itemRelations);
            }

            return cleaned;
        });

        return { cleanedItems, relations, relationTypes };
    }

    /**
     * Applies many-to-many relations after entities have been created/updated.
     * 
     * Optimized version that batches relation updates and branches by relation type.
     * Handles both implicit (Prisma-managed join tables) and explicit (custom join tables) relations.
     * 
     * @param entityIds - Array of entity IDs (in same order as original items)
     * @param relations - Map of item index to relation data
     * @param modelName - Name of the model
     * @param modelInfo - Prisma model information for relation metadata
     * @param relationTypes - Map of field names to relation types (explicit/implicit)
     * @param options - Parallel execution options
     * @returns Object with success and failed counts
     * 
     * @example
     * ```typescript
     * // After creating users
     * const userIds = [1, 2, 3];
     * const relations = new Map([
     *   [0, { roles: [{ id: 1 }, { id: 2 }] }],
     *   [1, { roles: [{ id: 2 }] }]
     * ]);
     * 
     * const result = await DataUtils.applyManyToManyRelations(
     *   userIds,
     *   relations,
     *   'User',
     *   modelInfo,
     *   relationTypes,
     *   { parallel: true, concurrency: 4 }
     * );
     * 
     * console.log(`Created ${result.success} relations, ${result.failed} failed`);
     * ```
     */
    public static async applyManyToManyRelations(
        entityIds: (number | string)[],
        relations: Map<number, Record<string, unknown[]>>,
        modelName: string,
        modelInfo?: PrismaModelInfo | unknown,
        relationTypes?: Map<string, 'explicit' | 'implicit'>,
        options?: {
            parallel?: boolean;
            concurrency?: number;
        }
    ): Promise<{ success: number; failed: number }> {
        if (relations.size === 0) {
            return { success: 0, failed: 0 };
        }

        const prisma = getPrismaInstance();

        // Group relations by field for batch processing
        // Use Map for O(1) lookups
        const relationsByField = new Map<string, Array<{ entityId: number | string; relatedIds: (number | string)[] }>>();

        for (const [index, relationData] of relations.entries()) {
            const entityId = entityIds[index];
            if (!entityId) continue;

            for (const [fieldName, relatedItems] of Object.entries(relationData)) {
                // Extract IDs from related items - optimize by pre-allocating array
                const relatedIds: (number | string)[] = [];

                for (const item of relatedItems) {
                    if (hasId(item)) {
                        relatedIds.push(item.id);
                    } else if (typeof item === 'number' || typeof item === 'string') {
                        relatedIds.push(item);
                    }
                }

                if (relatedIds.length === 0) continue;

                let fieldRelations = relationsByField.get(fieldName);
                if (!fieldRelations) {
                    fieldRelations = [];
                    relationsByField.set(fieldName, fieldRelations);
                }

                fieldRelations.push({ entityId, relatedIds });
            }
        }

        if (relationsByField.size === 0) {
            return { success: 0, failed: 0 };
        }

        // Group relations by type (explicit vs implicit)
        const explicitRelations = new Map<string, Array<{ entityId: number | string; relatedIds: (number | string)[] }>>();
        const implicitRelations = new Map<string, Array<{ entityId: number | string; relatedIds: (number | string)[] }>>();

        for (const [fieldName, entityRelations] of relationsByField.entries()) {
            const relationType = relationTypes?.get(fieldName);

            if (relationType === 'explicit') {
                explicitRelations.set(fieldName, entityRelations);
            } else {
                // Default to implicit if not specified or if type is implicit
                implicitRelations.set(fieldName, entityRelations);
            }
        }

        let totalSuccess = 0;
        let totalFailed = 0;

        // Process implicit relations using existing Prisma update operations
        if (implicitRelations.size > 0) {
            const implicitResult = await this.applyManyToManyRelationsPrisma(
                implicitRelations,
                modelName,
                prisma,
                options
            );
            totalSuccess += implicitResult.success;
            totalFailed += implicitResult.failed;
        }

        // Process explicit relations using join table inserts
        if (explicitRelations.size > 0) {
            const explicitResult = await this.applyExplicitManyToManyRelations(
                explicitRelations,
                modelName,
                modelInfo,
                prisma,
                options
            );
            totalSuccess += explicitResult.success;
            totalFailed += explicitResult.failed;
        }

        return { success: totalSuccess, failed: totalFailed };
    }



    /**
     * Apply many-to-many relations using Prisma operations (batched).
     * 
     * Groups multiple relation updates into fewer database calls for better performance.
     * Used for implicit many-to-many relations where Prisma manages the join table.
     * 
     * @param relationsByField - Relations grouped by field name
     * @param modelName - Name of the source model
     * @param prisma - Prisma client instance
     * @param options - Parallel execution options
     * @returns Object with success and failed counts
     * 
     * @private
     * @internal
     */
    private static async applyManyToManyRelationsPrisma(
        relationsByField: Map<string, Array<{ entityId: number | string; relatedIds: (number | string)[] }>>,
        modelName: string,
        prisma: unknown,
        options?: {
            parallel?: boolean;
            concurrency?: number;
        }
    ): Promise<{ success: number; failed: number }> {
        const model = (prisma as any)[modelName.charAt(0).toLowerCase() + modelName.slice(1)];

        if (!model) {
            throw new Error(`Model ${modelName} not found in Prisma client`);
        }

        // Group by entity ID to batch multiple field updates
        // Use Map for O(1) lookups instead of repeated object access
        const updatesByEntity = new Map<number | string, Record<string, (number | string)[]>>();

        for (const [fieldName, entityRelations] of relationsByField.entries()) {
            for (const { entityId, relatedIds } of entityRelations) {
                let entityUpdates = updatesByEntity.get(entityId);
                if (!entityUpdates) {
                    entityUpdates = {};
                    updatesByEntity.set(entityId, entityUpdates);
                }
                entityUpdates[fieldName] = relatedIds;
            }
        }

        // Pre-allocate operations array for better performance
        const operations: Array<() => Promise<number>> = new Array(updatesByEntity.size);
        let opIndex = 0;

        // Create one operation per entity (updating all its relations at once)
        for (const [entityId, fieldsToUpdate] of updatesByEntity.entries()) {
            operations[opIndex++] = async () => {
                const updateData: Record<string, { connect: Array<{ id: number | string }> }> = {};
                let relationCount = 0;

                for (const [fieldName, relatedIds] of Object.entries(fieldsToUpdate)) {
                    updateData[fieldName] = {
                        connect: relatedIds.map((id) => ({ id }))
                    };
                    relationCount += relatedIds.length;
                }

                await model.update({
                    where: { id: entityId },
                    data: updateData
                });

                return relationCount;
            };
        }

        if (operations.length === 0) {
            return { success: 0, failed: 0 };
        }

        // Determine if we should use parallel execution
        const useParallel = options?.parallel !== false &&
            isParallelEnabled() &&
            operations.length > 1;

        if (useParallel) {
            const result = await executeInParallel(operations, {
                concurrency: options?.concurrency
            });

            const successCount = result.results.reduce((sum, count) => sum + (count as number), 0);

            return {
                success: successCount,
                failed: result.errors.length
            };
        } else {
            // Execute sequentially
            let success = 0;
            let failed = 0;

            for (const operation of operations) {
                try {
                    const count = await operation();
                    success += count;
                } catch (error) {
                    // Use error-utils for error handling
                    logError('apply relation', error as Error);
                    failed++;
                }
            }

            return { success, failed };
        }
    }



    /**
     * Apply explicit many-to-many relations by creating join table records.
     * 
     * Directly inserts records into custom join tables for explicit many-to-many relationships.
     * Uses createMany with skipDuplicates to avoid errors on existing relations.
     * 
     * @param relationsByField - Relations grouped by field name
     * @param modelName - Name of the source model
     * @param modelInfo - Prisma model information
     * @param prisma - Prisma client instance
     * @param _options - Parallel execution options (currently unused)
     * @returns Object with success and failed counts
     * 
     * @private
     * @internal
     */
    private static async applyExplicitManyToManyRelations(
        relationsByField: Map<string, Array<{ entityId: number | string; relatedIds: (number | string)[] }>>,
        modelName: string,
        modelInfo: PrismaModelInfo | unknown,
        prisma: unknown,
        _options?: {
            parallel?: boolean;
            concurrency?: number;
        }
    ): Promise<{ success: number; failed: number }> {
        let totalSuccess = 0;
        let totalFailed = 0;

        // Process each relation field
        for (const [fieldName, entityRelations] of relationsByField.entries()) {
            // Get join table information
            const joinTableInfo = this.getJoinTableInfo(modelName, fieldName, modelInfo);

            if (!joinTableInfo) {
                // If we can't get join table info, skip this field
                logError('apply explicit relation', new Error(`Could not get join table info for ${modelName}.${fieldName}`));
                totalFailed += entityRelations.reduce((sum, rel) => sum + rel.relatedIds.length, 0);
                continue;
            }

            const { joinTableName, sourceField, targetField } = joinTableInfo;

            // Get the join table model from Prisma client
            const joinTableModel = (prisma as Record<string, any>)[joinTableName.charAt(0).toLowerCase() + joinTableName.slice(1)];

            if (!joinTableModel) {
                logError('apply explicit relation', new Error(`Join table model ${joinTableName} not found in Prisma client`));
                totalFailed += entityRelations.reduce((sum, rel) => sum + rel.relatedIds.length, 0);
                continue;
            }

            // Build join table records
            const joinRecords: Array<Record<string, number | string>> = [];

            for (const { entityId, relatedIds } of entityRelations) {
                for (const relatedId of relatedIds) {
                    const record: Record<string, number | string> = {
                        [sourceField]: entityId,
                        [targetField]: relatedId
                    };

                    // Add additional fields if they exist (e.g., createdAt, updatedAt)
                    // These will be handled by Prisma's default values
                    joinRecords.push(record);
                }
            }

            if (joinRecords.length === 0) {
                continue;
            }

            try {
                // Check if database supports skipDuplicates
                const provider = getDatabaseProviderCached(prisma as PrismaClient | undefined);
                const supportsSkipDuplicates = provider !== 'sqlite' && provider !== 'mongodb' && provider !== 'sqlserver';

                // Use createMany with skipDuplicates to avoid errors on existing relations
                const createOptions: { data: Array<Record<string, number | string>>; skipDuplicates?: boolean } = {
                    data: joinRecords
                };
                if (supportsSkipDuplicates) {
                    createOptions.skipDuplicates = true;
                }

                const result = await joinTableModel.createMany(createOptions);

                totalSuccess += result.count || joinRecords.length;
            } catch (error) {
                logError('apply explicit relation', error as Error);
                totalFailed += joinRecords.length;
            }
        }

        return { success: totalSuccess, failed: totalFailed };
    }

    /**
     * Gets relation field information for a model.
     * 
     * Identifies all many-to-many relation fields (object type with isList=true).
     * 
     * @param modelInfo - Prisma model information
     * @returns Array of many-to-many relation fields with name and type
     * 
     * @example
     * ```typescript
     * const manyToManyFields = DataUtils.getManyToManyFields(modelInfo);
     * // Result: [{ name: 'roles', type: 'Role' }, { name: 'permissions', type: 'Permission' }]
     * ```
     */
    public static getManyToManyFields(modelInfo?: PrismaModelInfo | unknown): Array<{ name: string; type: string }> {
        if (!isPrismaModelInfo(modelInfo)) {
            return [];
        }

        return modelInfo.fields
            .filter((field) => field.kind === 'object' && field.isList === true)
            .map((field) => ({
                name: field.name,
                type: field.type
            }));
    }

    /**
     * Checks if a model has any many-to-many relations.
     * 
     * @param modelInfo - Prisma model information
     * @returns True if model has many-to-many relations, false otherwise
     * 
     * @example
     * ```typescript
     * if (DataUtils.hasManyToManyRelations(modelInfo)) {
     *   // Handle many-to-many relations separately
     *   const { cleanedItems, relations } = DataUtils.extractManyToManyRelations(items, modelInfo);
     * }
     * ```
     */
    public static hasManyToManyRelations(modelInfo?: PrismaModelInfo | unknown): boolean {
        return this.getManyToManyFields(modelInfo).length > 0;
    }

}

