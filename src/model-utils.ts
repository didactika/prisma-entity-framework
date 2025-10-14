import { getPrismaInstance } from './config';
import { FindByFilterOptions } from "./types/search.types";

export default class ModelUtils {
    private static readonly MAX_DEPTH = 3;

    /**
     * Gets the dependency tree for models based on their relationships
     * Returns models in topological order (dependencies first)
     */
    public static getModelDependencyTree(
        modelNames: string[]
    ): Array<{ name: string; dependencies: string[] }> {
        const prisma = getPrismaInstance();
        const runtimeDataModel = (prisma as any)._runtimeDataModel;
        const modelDeps: Array<{ name: string; dependencies: string[] }> = [];

        for (const modelName of modelNames) {
            const modelMeta = runtimeDataModel.models[modelName];
            if (!modelMeta) {
                throw new Error(`Model "${modelName}" not found in runtime data model.`);
            }

            const dependencies: string[] = [];

            const relationFields = Object.values(modelMeta.fields)
                .filter((field: any) =>
                    field.kind === "object" &&
                    field.relationName &&
                    !field.isList
                );

            for (const field of relationFields) {
                const relatedModel = (field as any).type;
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
     * Sorts models in topological order based on their dependencies
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
     * Finds the path from a child model to a parent model through relationships
     */
    public static findPathToParentModel(
        fromModel: string,
        toModel: string,
        maxDepth: number = 5
    ): string | null {
        const prisma = getPrismaInstance();
        const runtimeDataModel = (prisma as any)._runtimeDataModel;

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

            const modelMeta = runtimeDataModel.models[current.model];
            if (!modelMeta) continue;

            const relationFields = Object.values(modelMeta.fields)
                .filter((field: any) =>
                    field.kind === "object" &&
                    field.relationName &&
                    !field.isList
                )
                .map((field: any) => ({
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
     * Builds a nested filter object to search by a field in a parent model
     */
    public static buildNestedFilterToParent(
        fromModel: string,
        toModel: string,
        fieldName: string,
        value: any
    ): Record<string, any> {
        const path = this.findPathToParentModel(fromModel, toModel);

        if (!path) {
            const directField = toModel.toLowerCase() + 'Id';
            return { [directField]: value };
        }

        const pathParts = path.split('.');
        const filter: Record<string, any> = {};

        let current = filter;
        for (let i = 0; i < pathParts.length; i++) {
            const part = pathParts[i];
            if (i === pathParts.length - 1) {
                current[part] = { [fieldName]: value };
            } else {
                current[part] = {};
                current = current[part];
            }
        }

        return filter;
    }

    /**
     * Builds include tree for nested relations based on provided configuration
     */
    public static async getIncludesTree(
        modelName: string,
        relationsToInclude: FindByFilterOptions.NestedRelations = [],
        currentDepth: number = 0
    ): Promise<Record<string, any>> {
        const prisma = getPrismaInstance();
        const runtimeDataModel = (prisma as any)._runtimeDataModel;

        const getRelationalFields = (model: string): Array<{ name: string; type: string }> => {
            const modelMeta = runtimeDataModel.models[model];
            if (!modelMeta) throw new Error(`Model "${model}" not found in runtime data model.`);

            return Object.values(modelMeta.fields)
                .filter((field: any) => field.kind === "object" && field.relationName)
                .map((field: any) => ({
                    name: field.name,
                    type: field.type,
                }));
        };

        const isValidField = (fields: { name: string }[], name: string) =>
            fields.find((f) => f.name === name);

        const buildSubInclude = async (
            type: string,
            subTree: FindByFilterOptions.NestedRelations,
            depth: number
        ) => {
            if (depth >= this.MAX_DEPTH) {
                return true;
            }

            const subInclude = await this.getIncludesTree(type, subTree, depth + 1);
            return Object.keys(subInclude).length > 0
                ? { include: subInclude }
                : true;
        };

        const buildInclude = async (
            model: string,
            tree: FindByFilterOptions.NestedRelations,
            depth: number
        ): Promise<Record<string, any>> => {
            const include: Record<string, any> = {};
            const fields = getRelationalFields(model);

            const processField = async (name: string, subTree: FindByFilterOptions.NestedRelations) => {
                const field = isValidField(fields, name);
                if (!field) return;

                include[name] = await buildSubInclude((field as any).type, subTree, depth);
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
     * Gets all model names from Prisma runtime
     */
    public static getAllModelNames(): string[] {
        const prisma = getPrismaInstance();
        const runtimeDataModel = (prisma as any)._runtimeDataModel;
        return Object.keys(runtimeDataModel.models);
    }

    /**
     * Extracts unique constraints from a model using Prisma runtime
     * Returns an array of field name arrays that form unique constraints
     */
    public static getUniqueConstraints(modelName: string): string[][] {
        const prisma = getPrismaInstance();
        const runtimeDataModel = (prisma as any)._runtimeDataModel;
        const modelMeta = runtimeDataModel?.models[modelName];

        if (!modelMeta) {
            console.warn(`Model "${modelName}" not found in runtime data model.`);
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
            for (const field of Object.values(modelMeta.fields) as any[]) {
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
}
