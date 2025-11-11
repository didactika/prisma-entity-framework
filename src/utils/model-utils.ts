import { getPrismaInstance } from '../config';
import { FindByFilterOptions } from "../types/search.types";
import { logError } from './error-utils';

/**
 * Join table information for explicit many-to-many relationships
 */
export interface JoinTableInfo {
    joinTableName: string;
    sourceField: string;
    targetField: string;
    additionalFields?: string[];
}

/**
 * Prisma field information from runtime data model
 */
interface PrismaRuntimeField {
    name: string;
    kind: 'scalar' | 'object' | 'enum';
    type: string;
    isList?: boolean;
    isUnique?: boolean;
    relationName?: string;
    relationFromFields?: string[];
}

/**
 * Prisma model information from runtime data model
 */
interface PrismaRuntimeModel {
    name?: string;
    dbName?: string;
    schema?: string;
    fields: PrismaRuntimeField[];
    uniqueIndexes?: Array<{ fields: string[] }>;
    primaryKey?: { fields: string[] };
}

/**
 * Prisma DMMF model structure
 */
interface PrismaDMMFModel {
    name: string;
    fields: Array<{
        name: string;
        kind: 'scalar' | 'object' | 'enum';
        type: string;
        isList?: boolean;
        relationName?: string;
        relationFromFields?: string[];
    }>;
}

/**
 * Type guard for Prisma runtime model
 */
function isPrismaRuntimeModel(value: unknown): value is PrismaRuntimeModel {
    if (!value || typeof value !== 'object') return false;
    const obj = value as Record<string, unknown>;
    // Model is valid if it has fields array
    // name and dbName can be null/undefined in some Prisma versions
    return Array.isArray(obj.fields);
}

/**
 * Cache entry for model information
 */
interface ModelInfoCacheEntry {
    modelInfo: PrismaRuntimeModel;
    jsonFields: Set<string>;
    scalarArrayFields: Set<string>;
    uniqueConstraints: string[][];
    relationTypes: Map<string, 'explicit' | 'implicit'>;
    joinTableInfo: Map<string, JoinTableInfo | null>;
    timestamp: number;
}

/**
 * Utility class for working with Prisma model metadata and relationships.
 * 
 * Provides caching and helper methods for:
 * - Model information and field metadata
 * - Relationship detection and traversal
 * - Dependency analysis
 * - Join table information for explicit many-to-many relations
 * 
 * All methods use caching to minimize expensive runtime data model lookups.
 * 
 * @example
 * ```typescript
 * // Get model information with caching
 * const modelInfo = ModelUtils.getModelInformationCached('User');
 * 
 * // Detect relation type
 * const relationType = ModelUtils.detectRelationType('Subject', 'areas');
 * 
 * // Get join table info for explicit many-to-many
 * const joinInfo = ModelUtils.getJoinTableInfo('Subject', 'areas');
 * ```
 */
export default class ModelUtils {
    private static readonly MAX_DEPTH = 3;
    
    /**
     * Cache for model information to avoid repeated runtime data model lookups
     */
    private static modelInfoCache: Map<string, ModelInfoCacheEntry> = new Map();

    /**
     * Gets the dependency tree for models based on their relationships.
     * 
     * Analyzes model relationships to determine dependencies.
     * Returns models with their direct dependencies (non-list relations).
     * 
     * @param modelNames - Array of model names to analyze
     * @returns Array of models with their dependencies
     * 
     * @example
     * ```typescript
     * const deps = ModelUtils.getModelDependencyTree(['User', 'Post', 'Comment']);
     * // Result: [
     * //   { name: 'User', dependencies: [] },
     * //   { name: 'Post', dependencies: ['User'] },
     * //   { name: 'Comment', dependencies: ['User', 'Post'] }
     * // ]
     * ```
     */
    public static getModelDependencyTree(
        modelNames: string[]
    ): Array<{ name: string; dependencies: string[] }> {
        const prisma = getPrismaInstance();
        const runtimeDataModel = (prisma as Record<string, any>)._runtimeDataModel;
        const modelDeps: Array<{ name: string; dependencies: string[] }> = [];

        for (const modelName of modelNames) {
            const modelMeta = runtimeDataModel.models[modelName] as PrismaRuntimeModel | undefined;
            if (!modelMeta) {
                throw new Error(`Model "${modelName}" not found in runtime data model.`);
            }

            const dependencies: string[] = [];

            const relationFields = modelMeta.fields
                .filter((field) =>
                    field.kind === "object" &&
                    field.relationName &&
                    !field.isList
                );

            for (const field of relationFields) {
                const relatedModel = field.type;
                if (modelNames.includes(relatedModel) && relatedModel !== modelName) {
                    dependencies.push(relatedModel);
                }
            }

            modelDeps.push({
                name: modelName,
                dependencies: dependencies
            });
        }

        return modelDeps;
    }

    /**
     * Sorts models in topological order based on their dependencies.
     * 
     * Ensures that models are ordered so dependencies come before dependents.
     * Useful for seeding databases or performing cascading operations.
     * 
     * @param models - Array of models with their dependencies
     * @returns Array of model names in topological order
     * @throws Error if circular dependency is detected
     * 
     * @example
     * ```typescript
     * const deps = [
     *   { name: 'User', dependencies: [] },
     *   { name: 'Post', dependencies: ['User'] },
     *   { name: 'Comment', dependencies: ['User', 'Post'] }
     * ];
     * 
     * const sorted = ModelUtils.sortModelsByDependencies(deps);
     * // Result: ['User', 'Post', 'Comment']
     * ```
     */
    public static sortModelsByDependencies(
        models: Array<{ name: string; dependencies: string[] }>
    ): string[] {
        const visited = new Set<string>();
        const sorted: string[] = [];

        function visit(modelName: string, visiting = new Set<string>()) {
            if (visited.has(modelName)) return;

            if (visiting.has(modelName)) {
                throw new Error(`Circular dependency detected involving model: ${modelName}`);
            }

            visiting.add(modelName);

            const model = models.find(m => m.name === modelName);
            if (model) {
                for (const dep of model.dependencies) {
                    visit(dep, visiting);
                }
            }

            visiting.delete(modelName);
            visited.add(modelName);
            sorted.push(modelName);
        }

        for (const model of models) {
            visit(model.name);
        }

        return sorted;
    }

    /**
     * Finds the path from a child model to a parent model through relationships.
     * 
     * Uses breadth-first search to find the shortest relationship path.
     * Useful for building nested filters or includes.
     * 
     * @param fromModel - Starting model name
     * @param toModel - Target model name
     * @param maxDepth - Maximum depth to search (default: 5)
     * @returns Dot-separated path string or null if no path found
     * 
     * @example
     * ```typescript
     * const path = ModelUtils.findPathToParentModel('Comment', 'User');
     * // Result: 'post.author' (Comment -> Post -> User)
     * 
     * const directPath = ModelUtils.findPathToParentModel('Post', 'User');
     * // Result: 'author' (Post -> User)
     * ```
     */
    public static findPathToParentModel(
        fromModel: string,
        toModel: string,
        maxDepth: number = 5
    ): string | null {
        const prisma = getPrismaInstance();
        const runtimeDataModel = (prisma as Record<string, any>)._runtimeDataModel;

        if (!runtimeDataModel?.models[fromModel]) {
            throw new Error(`Model "${fromModel}" not found in runtime data model.`);
        }

        if (!runtimeDataModel?.models[toModel]) {
            throw new Error(`Model "${toModel}" not found in runtime data model.`);
        }

        const queue: Array<{ model: string; path: string[] }> = [
            { model: fromModel, path: [] }
        ];
        const visited = new Set<string>();

        while (queue.length > 0) {
            const current = queue.shift()!;

            if (current.path.length >= maxDepth) continue;
            if (visited.has(current.model)) continue;
            visited.add(current.model);

            const modelMeta = runtimeDataModel.models[current.model] as PrismaRuntimeModel | undefined;
            if (!modelMeta) continue;

            const relationFields = modelMeta.fields
                .filter((field) =>
                    field.kind === "object" &&
                    field.relationName &&
                    !field.isList
                )
                .map((field) => ({
                    name: field.name,
                    type: field.type
                }));

            for (const field of relationFields) {
                const newPath = [...current.path, field.name];

                if (field.type === toModel) {
                    return newPath.join('.');
                }

                queue.push({
                    model: field.type,
                    path: newPath
                });
            }
        }

        return null;
    }

    /**
     * Builds a nested filter object to search by a field in a parent model.
     * 
     * Creates Prisma-compatible nested where clauses for filtering by parent model fields.
     * 
     * @param fromModel - Starting model name
     * @param toModel - Target parent model name
     * @param fieldName - Field name in the parent model to filter by
     * @param value - Value to filter for
     * @returns Nested filter object for Prisma where clause
     * 
     * @example
     * ```typescript
     * // Find comments by user email
     * const filter = ModelUtils.buildNestedFilterToParent(
     *   'Comment',
     *   'User',
     *   'email',
     *   'user@example.com'
     * );
     * // Result: { post: { author: { email: 'user@example.com' } } }
     * 
     * const comments = await prisma.comment.findMany({ where: filter });
     * ```
     */
    public static buildNestedFilterToParent(
        fromModel: string,
        toModel: string,
        fieldName: string,
        value: unknown
    ): Record<string, unknown> {
        const path = this.findPathToParentModel(fromModel, toModel);

        if (!path) {
            const directField = toModel.toLowerCase() + 'Id';
            return { [directField]: value };
        }

        const pathParts = path.split('.');
        const filter: Record<string, unknown> = {};

        let current: Record<string, unknown> = filter;
        for (let i = 0; i < pathParts.length; i++) {
            const part = pathParts[i];
            if (i === pathParts.length - 1) {
                current[part] = { [fieldName]: value };
            } else {
                current[part] = {};
                current = current[part] as Record<string, unknown>;
            }
        }

        return filter;
    }

    /**
     * Builds include tree for nested relations based on provided configuration.
     * 
     * Recursively builds Prisma include objects for nested relation loading.
     * Supports wildcard (*) for all first-level relations and nested configurations.
     * 
     * @param modelName - Name of the model
     * @param relationsToInclude - Relations configuration (array of objects or "*")
     * @param currentDepth - Current recursion depth (internal use)
     * @returns Prisma include object
     * 
     * @example
     * ```typescript
     * // Include all first-level relations
     * const include = await ModelUtils.getIncludesTree('User', '*');
     * // Result: { posts: true, profile: true, comments: true }
     * 
     * // Include nested relations
     * const nestedInclude = await ModelUtils.getIncludesTree('User', [
     *   { posts: [{ comments: '*' }] },
     *   { profile: '*' }
     * ]);
     * // Result: { 
     * //   posts: { include: { comments: true } },
     * //   profile: true
     * // }
     * ```
     */
    public static async getIncludesTree(
        modelName: string,
        relationsToInclude: FindByFilterOptions.NestedRelations = [],
        currentDepth: number = 0,
        prismaInstance?: any
    ): Promise<Record<string, unknown>> {
        const prisma = prismaInstance || getPrismaInstance();
        const runtimeDataModel = (prisma as Record<string, any>)._runtimeDataModel;

        const getRelationalFields = (model: string): Array<{ name: string; type: string }> => {
            const modelMeta = runtimeDataModel.models[model] as PrismaRuntimeModel | undefined;
            if (!modelMeta) throw new Error(`Model "${model}" not found in runtime data model.`);

            return modelMeta.fields
                .filter((field) => field.kind === "object" && field.relationName)
                .map((field) => ({
                    name: field.name,
                    type: field.type,
                }));
        };

        const isValidField = (fields: { name: string; type: string }[], name: string) =>
            fields.find((f) => f.name === name);

        const buildSubInclude = async (
            type: string,
            subTree: FindByFilterOptions.NestedRelations,
            depth: number
        ) => {
            if (depth >= this.MAX_DEPTH) {
                return true;
            }

            const subInclude = await this.getIncludesTree(type, subTree, depth + 1, prisma);
            return Object.keys(subInclude).length > 0
                ? { include: subInclude }
                : true;
        };

        const buildInclude = async (
            model: string,
            tree: FindByFilterOptions.NestedRelations,
            depth: number
        ): Promise<Record<string, unknown>> => {
            const include: Record<string, unknown> = {};
            const fields = getRelationalFields(model);

            const processField = async (name: string, subTree: FindByFilterOptions.NestedRelations) => {
                const field = isValidField(fields, name);
                if (!field) return;

                include[name] = await buildSubInclude(field.type, subTree, depth);
            };

            if (tree === "*") {
                // When using "*", include all first-level relations but don't go deeper
                for (const field of fields) {
                    include[field.name] = true;
                }
            } else if (Array.isArray(tree)) {
                for (const node of tree) {
                    for (const [relation, subTree] of Object.entries(node)) {
                        await processField(relation, subTree);
                    }
                }
            }

            return include;
        };

        return await buildInclude(modelName, relationsToInclude, currentDepth);
    }

    /**
     * Gets all model names from Prisma runtime.
     * 
     * @returns Array of all model names defined in the Prisma schema
     * 
     * @example
     * ```typescript
     * const models = ModelUtils.getAllModelNames();
     * // Result: ['User', 'Post', 'Comment', 'Profile', ...]
     * ```
     */
    public static getAllModelNames(): string[] {
        const prisma = getPrismaInstance();
        const runtimeDataModel = (prisma as Record<string, any>)._runtimeDataModel;
        return Object.keys(runtimeDataModel.models);
    }

    /**
     * Extracts unique constraints from a model using Prisma runtime.
     * 
     * Returns an array of field name arrays that form unique constraints.
     * Includes unique indexes, unique fields, and composite primary keys.
     * 
     * @param modelName - Name of the model
     * @returns Array of unique constraint field arrays
     * 
     * @example
     * ```typescript
     * const constraints = ModelUtils.getUniqueConstraints('User');
     * // Result: [['email'], ['username'], ['firstName', 'lastName']]
     * // Means: email is unique, username is unique, and (firstName + lastName) is unique
     * ```
     */
    public static getUniqueConstraints(modelName: string): string[][] {
        // Check cache first
        const cached = this.modelInfoCache.get(modelName);
        if (cached) {
            return cached.uniqueConstraints;
        }

        const prisma = getPrismaInstance();
        const runtimeDataModel = (prisma as Record<string, any>)._runtimeDataModel;
        const modelMeta = runtimeDataModel?.models[modelName] as PrismaRuntimeModel | undefined;

        if (!modelMeta) {
            logError('getUniqueConstraints', new Error(`Model "${modelName}" not found in runtime data model`), { modelName });
            return [];
        }

        const uniqueConstraints: string[][] = [];

        // Get unique indexes from the model
        if (modelMeta.uniqueIndexes && Array.isArray(modelMeta.uniqueIndexes)) {
            for (const index of modelMeta.uniqueIndexes) {
                if (index.fields && Array.isArray(index.fields)) {
                    uniqueConstraints.push(index.fields);
                }
            }
        }

        if (modelMeta.fields) {
            for (const field of modelMeta.fields) {
                if (field.isUnique && field.name && field.name !== 'id') {
                    uniqueConstraints.push([field.name]);
                }
            }
        }

        if (modelMeta.primaryKey?.fields &&
            Array.isArray(modelMeta.primaryKey.fields) &&
            modelMeta.primaryKey.fields.length > 0) {
            const pkFields = modelMeta.primaryKey.fields;
            if (!(pkFields.length === 1 && pkFields[0] === 'id')) {
                uniqueConstraints.push(pkFields);
            }
        }

        return uniqueConstraints;
    }

    /**
     * Gets model information with caching to avoid repeated runtime data model lookups.
     * 
     * Retrieves comprehensive model metadata including fields, types, and constraints.
     * Results are cached for performance.
     * 
     * @param modelName - The name of the model
     * @param prismaInstance - Optional Prisma instance to use (if not provided, uses getPrismaInstance())
     * @returns Model information from Prisma runtime data model
     * @throws Error if model is not found
     * 
     * @example
     * ```typescript
     * const userModel = ModelUtils.getModelInformationCached('User');
     * // Access fields
     * for (const field of userModel.fields) {
     *   console.log(`${field.name}: ${field.type} (${field.kind})`);
     * }
     * ```
     */
    public static getModelInformationCached(modelName: string, prismaInstance?: any): PrismaRuntimeModel {
        // Check cache first
        const cached = this.modelInfoCache.get(modelName);
        if (cached) {
            return cached.modelInfo;
        }

        // Get model info from Prisma runtime
        // Use provided instance or fall back to global instance
        const prisma = prismaInstance || getPrismaInstance();
        const runtimeDataModel = (prisma as Record<string, any>)._runtimeDataModel;
        const modelInfo = runtimeDataModel?.models[modelName] as PrismaRuntimeModel | undefined;

        if (!modelInfo || !isPrismaRuntimeModel(modelInfo)) {
            throw new Error(`Model "${modelName}" not found in runtime data model.`);
        }

        // Ensure the model has a name property (some Prisma versions only have dbName)
        if (!modelInfo.name) {
            (modelInfo as any).name = modelName;
        }

        // Build cache entry with all derived information
        const jsonFields = new Set<string>();
        const scalarArrayFields = new Set<string>();

        if (modelInfo.fields) {
            for (const field of modelInfo.fields) {
                // Track JSON/Bytes fields
                if (field.kind === 'scalar' && (field.type === 'Json' || field.type === 'Bytes')) {
                    jsonFields.add(field.name);
                }
                // Track scalar arrays (String[], Int[], etc.)
                if (field.kind === 'scalar' && field.isList === true) {
                    scalarArrayFields.add(field.name);
                }
            }
        }

        // Get unique constraints
        const uniqueConstraints = this.getUniqueConstraints(modelName);

        // Cache the entry
        const cacheEntry: ModelInfoCacheEntry = {
            modelInfo,
            jsonFields,
            scalarArrayFields,
            uniqueConstraints,
            relationTypes: new Map(),
            joinTableInfo: new Map(),
            timestamp: Date.now()
        };

        this.modelInfoCache.set(modelName, cacheEntry);

        return modelInfo;
    }

    /**
     * Gets JSON fields for a model (cached).
     * 
     * Identifies fields with JSON or Bytes type that should not be processed as relations.
     * 
     * @param modelName - The name of the model
     * @returns Set of field names that are JSON or Bytes type
     * 
     * @example
     * ```typescript
     * const jsonFields = ModelUtils.getJsonFields('User');
     * // Result: Set(['metadata', 'settings'])
     * 
     * // Use to skip relation processing
     * if (!jsonFields.has(fieldName)) {
     *   // Process as relation
     * }
     * ```
     */
    public static getJsonFields(modelName: string): Set<string> {
        // Ensure model info is cached
        if (!this.modelInfoCache.has(modelName)) {
            this.getModelInformationCached(modelName);
        }

        const cached = this.modelInfoCache.get(modelName);
        return cached ? cached.jsonFields : new Set();
    }

    /**
     * Gets scalar array fields for a model (cached).
     * 
     * Identifies fields that are scalar arrays (String[], Int[], etc.) which should not be processed as relations.
     * 
     * @param modelName - The name of the model
     * @returns Set of field names that are scalar arrays
     * 
     * @example
     * ```typescript
     * const scalarArrays = ModelUtils.getScalarArrayFields('User');
     * // Result: Set(['tags', 'permissions'])
     * 
     * // Use to skip relation processing
     * if (!scalarArrays.has(fieldName)) {
     *   // Process as relation
     * }
     * ```
     */
    public static getScalarArrayFields(modelName: string): Set<string> {
        // Ensure model info is cached
        if (!this.modelInfoCache.has(modelName)) {
            this.getModelInformationCached(modelName);
        }

        const cached = this.modelInfoCache.get(modelName);
        return cached ? cached.scalarArrayFields : new Set();
    }

    /**
     * Detects if a many-to-many relation is explicit or implicit
     * Explicit many-to-many: field type is a join table model (e.g., AreasOnSubjects)
     * Implicit many-to-many: field type is the target entity directly (e.g., Area)
     * 
     * @param modelName - Name of the source model
     * @param fieldName - Name of the relation field
     * @returns 'explicit' | 'implicit' | null
     * 
     * @example
     * ```typescript
     * const relationType = ModelUtils.detectRelationType('Subject', 'areas');
     * // Returns: 'explicit' if using join table, 'implicit' if direct relation
     * ```
     */
    public static detectRelationType(
        modelName: string,
        fieldName: string
    ): 'explicit' | 'implicit' | null {
        // Ensure model info is cached
        if (!this.modelInfoCache.has(modelName)) {
            try {
                this.getModelInformationCached(modelName);
            } catch (error) {
                // Prisma not configured or model not found
                return null;
            }
        }

        const cached = this.modelInfoCache.get(modelName);
        if (!cached) return null;

        // Check cache first
        const cacheKey = fieldName;
        if (cached.relationTypes.has(cacheKey)) {
            return cached.relationTypes.get(cacheKey)!;
        }

        const modelInfo = cached.modelInfo;
        if (!modelInfo?.fields) {
            return null;
        }

        // Find the field in model info
        const field = modelInfo.fields.find((f) => f.name === fieldName);
        
        if (!field || field.kind !== 'object' || !field.isList) {
            return null;
        }

        // Get the Prisma DMMF to check if the field type is a join table
        const prisma = getPrismaInstance();
        const prismaAny = prisma as Record<string, any>;
        const dmmf = prismaAny._baseDmmf || prismaAny._dmmf;
        const runtimeDataModel = prismaAny._runtimeDataModel;
        
        // Try to use runtimeDataModel if DMMF is not available
        const models: PrismaDMMFModel[] | Record<string, PrismaRuntimeModel> | undefined = 
            dmmf?.datamodel?.models || runtimeDataModel?.models;
        
        if (!models) {
            // Fallback: if we can't access models, assume implicit
            cached.relationTypes.set(cacheKey, 'implicit');
            return 'implicit';
        }

        // Find the target model (field.type)
        // Handle both array format (DMMF) and object format (runtimeDataModel)
        let targetModel: PrismaDMMFModel | PrismaRuntimeModel | undefined;
        if (Array.isArray(models)) {
            targetModel = models.find((m) => m.name === field.type);
        } else {
            targetModel = models[field.type];
        }

        if (!targetModel) {
            cached.relationTypes.set(cacheKey, 'implicit');
            return 'implicit';
        }

        // Check if the target model is a join table
        // A join table typically has:
        // 1. Two or more relation fields (foreign keys to other models)
        // 2. Composite primary key or unique constraint on the foreign keys
        const relationFields = targetModel.fields.filter(
            (f) => f.kind === 'object' && !f.isList
        );

        // If the target model has 2+ relation fields, it's likely a join table (explicit)
        // If it has 0-1 relation fields, it's the actual target entity (implicit)
        const relationType = relationFields.length >= 2 ? 'explicit' : 'implicit';

        // Cache the result
        cached.relationTypes.set(cacheKey, relationType);

        return relationType;
    }

    /**
     * Gets join table information for explicit many-to-many relationships
     * 
     * @param modelName - Name of the source model
     * @param fieldName - Name of the relation field
     * @returns Join table metadata or null
     * 
     * @example
     * ```typescript
     * const joinInfo = ModelUtils.getJoinTableInfo('Subject', 'areas');
     * // Returns: { joinTableName: 'AreasOnSubjects', sourceField: 'subjectId', targetField: 'areaId' }
     * ```
     */
    public static getJoinTableInfo(
        modelName: string,
        fieldName: string
    ): JoinTableInfo | null {
        // Ensure model info is cached
        if (!this.modelInfoCache.has(modelName)) {
            try {
                this.getModelInformationCached(modelName);
            } catch (error) {
                // Prisma not configured or model not found
                return null;
            }
        }

        const cached = this.modelInfoCache.get(modelName);
        if (!cached) return null;

        // Check cache first
        const cacheKey = fieldName;
        if (cached.joinTableInfo.has(cacheKey)) {
            return cached.joinTableInfo.get(cacheKey)!;
        }

        const modelInfo = cached.modelInfo;
        if (!modelInfo?.fields) {
            cached.joinTableInfo.set(cacheKey, null);
            return null;
        }

        // Find the relation field
        const field = modelInfo.fields.find((f) => f.name === fieldName);
        
        if (!field || field.kind !== 'object' || !field.isList) {
            cached.joinTableInfo.set(cacheKey, null);
            return null;
        }

        // For explicit many-to-many, the field.type is the join table model name
        const joinTableName = field.type;

        // To get the FK field names, we need to look at the join table model
        const prisma = getPrismaInstance();
        const prismaAny = prisma as Record<string, any>;
        const dmmf = prismaAny._baseDmmf || prismaAny._dmmf;
        const runtimeDataModel = prismaAny._runtimeDataModel;
        
        // Try to use runtimeDataModel if DMMF is not available
        const models: PrismaDMMFModel[] | Record<string, PrismaRuntimeModel> | undefined = 
            dmmf?.datamodel?.models || runtimeDataModel?.models;
        
        if (!models) {
            cached.joinTableInfo.set(cacheKey, null);
            return null;
        }

        // Find the join table model
        // Handle both array format (DMMF) and object format (runtimeDataModel)
        let joinTableModel: PrismaDMMFModel | PrismaRuntimeModel | undefined;
        if (Array.isArray(models)) {
            joinTableModel = models.find((m) => m.name === joinTableName);
        } else {
            joinTableModel = models[joinTableName];
        }

        if (!joinTableModel) {
            cached.joinTableInfo.set(cacheKey, null);
            return null;
        }

        // Find the FK fields by looking at relation fields in the join table
        const relationFields = joinTableModel.fields.filter(
            (f) => f.kind === 'object' && !f.isList
        );

        if (relationFields.length < 2) {
            cached.joinTableInfo.set(cacheKey, null);
            return null;
        }

        // Find the source relation field (pointing to our model)
        const sourceRelationField = relationFields.find(
            (f) => f.type === modelName
        );

        // Find the target relation field (pointing to the other model)
        const targetRelationField = relationFields.find(
            (f) => f.type !== modelName
        );

        if (!sourceRelationField || !targetRelationField) {
            cached.joinTableInfo.set(cacheKey, null);
            return null;
        }

        // Get the FK field names from relationFromFields
        const sourceField = sourceRelationField.relationFromFields?.[0];
        const targetField = targetRelationField.relationFromFields?.[0];

        if (!sourceField || !targetField) {
            cached.joinTableInfo.set(cacheKey, null);
            return null;
        }

        // Identify additional fields (fields that are not FKs or relation fields)
        const fkFields = new Set([sourceField, targetField]);
        const relationFieldNames = new Set(relationFields.map((f) => f.name));
        
        const additionalFields = joinTableModel.fields
            .filter((f) => 
                f.kind === 'scalar' && 
                !fkFields.has(f.name) &&
                !relationFieldNames.has(f.name)
            )
            .map((f) => f.name);

        const result: JoinTableInfo = {
            joinTableName,
            sourceField,
            targetField,
            additionalFields: additionalFields.length > 0 ? additionalFields : undefined
        };

        // Cache the result
        cached.joinTableInfo.set(cacheKey, result);

        return result;
    }

    /**
     * Clears all caches including model info, relation types, and join table info.
     * 
     * Useful for testing or when schema changes at runtime.
     * 
     * @example
     * ```typescript
     * // Clear caches after schema migration
     * ModelUtils.clearAllCaches();
     * 
     * // Or in tests
     * afterEach(() => {
     *   ModelUtils.clearAllCaches();
     * });
     * ```
     */
    public static clearAllCaches(): void {
        this.modelInfoCache.clear();
    }

    /**
     * Clears the model information cache.
     * 
     * Useful for testing or when schema changes at runtime.
     * 
     * @deprecated Use clearAllCaches() instead
     * 
     * @example
     * ```typescript
     * ModelUtils.clearModelInfoCache(); // Deprecated
     * ModelUtils.clearAllCaches(); // Use this instead
     * ```
     */
    public static clearModelInfoCache(): void {
        this.clearAllCaches();
    }

    /**
     * Gets the size of the model information cache.
     * 
     * Useful for monitoring cache usage and performance.
     * 
     * @returns Number of cached model entries
     * 
     * @example
     * ```typescript
     * const cacheSize = ModelUtils.getModelInfoCacheSize();
     * console.log(`Cache contains ${cacheSize} models`);
     * ```
     */
    public static getModelInfoCacheSize(): number {
        return this.modelInfoCache.size;
    }
}
