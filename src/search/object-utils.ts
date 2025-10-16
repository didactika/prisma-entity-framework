/**
 * ObjectUtils class for nested object manipulation
 * Provides utilities for working with deeply nested object structures
 * 
 * @class ObjectUtils
 */
export default class ObjectUtils {
    /**
     * Assigns a value to a nested path in an object, creating intermediate objects as needed
     * 
     * @param target - The object to modify
     * @param path - Dot-separated path to the property (e.g., 'user.profile.name')
     * @param value - The value to assign
     * @param modelInfo - Optional Prisma model information for relation-aware structure creation
     * 
     * @remarks
     * - Creates intermediate objects if they don't exist
     * - With modelInfo: wraps new relations with 'is'/'some' based on field type
     * - Without modelInfo: creates plain nested objects
     * - Intelligently merges with existing Prisma filter structures (is/some)
     * - Preserves existing sibling properties
     * - Handles nested Prisma relation filters correctly
     * 
     * @example
     * ```typescript
     * const obj = {};
     * ObjectUtils.assign(obj, 'user.profile.name', 'John');
     * // obj is now: { user: { profile: { name: 'John' } } }
     * 
     * // With existing Prisma filter structure:
     * const filter = { group: { is: { id: 1 } } };
     * ObjectUtils.assign(filter, 'group.course.name', 'Math');
     * // filter is now: { group: { is: { id: 1, course: { name: 'Math' } } } }
     * 
     * // With modelInfo (creates proper Prisma structures):
     * const filter = {};
     * ObjectUtils.assign(filter, 'posts.author.name', { contains: 'John' }, modelInfo);
     * // filter is now: { posts: { some: { author: { is: { name: { contains: 'John' } } } } } }
     * ```
     */
    public static assign(target: Record<string, any>, path: string, value: any, modelInfo?: any): void {
        const keys = path.split(".");
        let current = target;
        let currentModelInfo = modelInfo;

        for (let index = 0; index < keys.length; index++) {
            const key = keys[index];
            
            if (index === keys.length - 1) {
                current[key] = value;
            } else if (current[key] && typeof current[key] === "object") {
                const result = this.navigateIntoExisting(current[key], key, currentModelInfo);
                current = result.target;
                currentModelInfo = result.modelInfo;
            } else {
                const result = this.createNewStructure(current, key, currentModelInfo);
                current = result.target;
                currentModelInfo = result.modelInfo;
            }
        }
    }

    /**
     * Navigates into an existing object structure, detecting Prisma wrappers
     * @private
     */
    private static navigateIntoExisting(obj: any, key: string, modelInfo: any): { target: any; modelInfo: any } {
        let target = obj;
        
        // Check for Prisma wrappers
        if ('is' in obj && typeof obj.is === 'object') {
            target = obj.is;
        } else if ('some' in obj && typeof obj.some === 'object') {
            target = obj.some;
        }
        
        return {
            target,
            modelInfo: this.getNextModelInfo(key, modelInfo)
        };
    }

    /**
     * Creates a new structure for a key, with Prisma awareness if modelInfo provided
     * @private
     */
    private static createNewStructure(parent: any, key: string, modelInfo: any): { target: any; modelInfo: any } {
        if (!modelInfo) {
            parent[key] = {};
            return { target: parent[key], modelInfo: null };
        }

        const field = modelInfo?.fields?.find((f: any) => f.name === key);
        
        if (field && field.kind === 'object') {
            // It's a relation - create with wrapper
            const wrapper = field.isList ? 'some' : 'is';
            parent[key] = { [wrapper]: {} };
            return {
                target: parent[key][wrapper],
                modelInfo: this.getNextModelInfo(key, modelInfo)
            };
        }
        
        // Not a relation - create plain object
        parent[key] = {};
        return { target: parent[key], modelInfo: null };
    }

    /**
     * Builds a nested object from a path and value
     * 
     * @param path - Dot-separated path (e.g., 'user.profile.name')
     * @param value - The value to place at the end of the path
     * @returns A nested object with the value at the specified path
     * 
     * @remarks
     * Constructs the object from the inside out, starting with the value
     * and wrapping it in nested objects according to the path
     * 
     * @example
     * ```typescript
     * ObjectUtils.build('user.profile.name', 'John')
     * // Returns: { user: { profile: { name: 'John' } } }
     * 
     * ObjectUtils.build('status', 'active')
     * // Returns: { status: 'active' }
     * ```
     */
    public static build(path: string, value: any): Record<string, any> {
        return path.split(".").reverse().reduce((acc, key) => ({ [key]: acc }), value);
    }

    /**
     * Builds a nested object from a path and value with Prisma relation awareness
     * Wraps array relations with 'some' and single relations with 'is'
     * 
     * @param path - Dot-separated path (e.g., 'group.groupMembers.user.idNumber')
     * @param value - The value to place at the end of the path
     * @param modelInfo - Optional Prisma model information for relation detection
     * @returns A nested object with proper Prisma filter wrappers
     * 
     * @remarks
     * - Without modelInfo, behaves like build() (no wrappers)
     * - With modelInfo, detects relation types for each path segment
     * - Array relations (list: true) are wrapped with { some: {...} }
     * - Single relations are wrapped with { is: {...} }
     * - Final field (not a relation) is assigned the value directly
     * - Uses getPrismaInstance to resolve nested model info
     * 
     * @example
     * ```typescript
     * // Without modelInfo (no wrappers):
     * ObjectUtils.buildWithRelations('group.name', { contains: 'A' })
     * // Returns: { group: { name: { contains: 'A' } } }
     * 
     * // With modelInfo (array relation 'groupMembers' + single relation 'user'):
     * ObjectUtils.buildWithRelations('group.groupMembers.user.idNumber', { endsWith: '123' }, modelInfo)
     * // Returns: { group: { groupMembers: { some: { user: { is: { idNumber: { endsWith: '123' } } } } } } }
     * ```
     */
    public static buildWithRelations(path: string, value: any, modelInfo?: any): Record<string, any> {
        if (!modelInfo) {
            return this.build(path, value);
        }

        const keys = path.split(".");
        
        // First pass: build map of modelInfo for each key (left to right)
        const modelInfoMap: Record<number, any> = { 0: modelInfo };
        let currentModelInfo = modelInfo;
        
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            const nextModelInfo = this.getNextModelInfo(key, currentModelInfo);
            modelInfoMap[i + 1] = nextModelInfo;
            currentModelInfo = nextModelInfo;
        }

        // Second pass: build structure from right to left using the map
        let result: any = value;
        
        for (let i = keys.length - 1; i >= 0; i--) {
            const key = keys[i];
            const fieldModelInfo = modelInfoMap[i];
            result = this.wrapFieldWithRelation(key, result, fieldModelInfo);
        }

        return result;
    }

    /**
     * Wraps a field value with Prisma relation operators if it's a relation
     * 
     * @param key - Field name
     * @param value - Value to wrap
     * @param modelInfo - Current model information
     * @returns Wrapped value or plain object
     * @private
     */
    private static wrapFieldWithRelation(key: string, value: any, modelInfo: any): Record<string, any> {
        const field = modelInfo?.fields?.find((f: any) => f.name === key);
        
        if (!field || field.kind !== 'object') {
            return { [key]: value };
        }

        // It's a relation - wrap with 'some' for arrays or 'is' for single
        return field.isList
            ? { [key]: { some: value } }
            : { [key]: { is: value } };
    }

    /**
     * Gets the model info for a related model
     * 
     * @param fieldName - Name of the relation field
     * @param modelInfo - Current model information
     * @returns Model info for the related model or null
     * @private
     */
    private static getNextModelInfo(fieldName: string, modelInfo: any): any {
        if (!modelInfo?.fields) return null;

        const field = modelInfo.fields.find((f: any) => f.name === fieldName);
        if (!field || field.kind !== 'object') return null;

        try {
            const { getPrismaInstance } = require('../config');
            const prisma = getPrismaInstance();
            const runtimeDataModel = prisma._runtimeDataModel;
            const relatedModelName = field.type;
            
            return runtimeDataModel?.models?.[relatedModelName] || null;
        } catch {
            return null;
        }
    }

    /**
     * Gets a value from a nested object using a dot-separated path
     * 
     * @param obj - The object to read from
     * @param path - Dot-separated path to the property (e.g., 'user.profile.name')
     * @returns The value at the specified path, or undefined if not found
     * 
     * @remarks
     * - Returns undefined if any part of the path doesn't exist
     * - Handles null/undefined values gracefully in the path
     * 
     * @example
     * ```typescript
     * const obj = { user: { profile: { name: 'John' } } };
     * ObjectUtils.get(obj, 'user.profile.name') // 'John'
     * ObjectUtils.get(obj, 'user.age')          // undefined
     * ```
     */
    public static get(obj: Record<string, any>, path: string): any {
        return path.split(".").reduce((acc, key) => acc?.[key], obj);
    }

    /**
     * Removes properties at specified paths and cleans up empty parent objects
     * 
     * @param filter - The object to modify
     * @param paths - Set of dot-separated paths to remove
     * 
     * @remarks
     * - Removes the property at each specified path
     * - Recursively removes parent objects that become empty after deletion
     * - Leaves non-empty parent objects intact
     * - Handles non-existent paths gracefully
     * 
     * @example
     * ```typescript
     * const obj = { user: { name: 'John', age: 30 }, status: 'active' };
     * ObjectUtils.clean(obj, new Set(['user.age']));
     * // obj is now: { user: { name: 'John' }, status: 'active' }
     * 
     * const obj2 = { user: { name: 'John' } };
     * ObjectUtils.clean(obj2, new Set(['user.name']));
     * // obj2 is now: {} (empty parent removed)
     * ```
     */
    public static clean(filter: Record<string, any>, paths: Set<string>): void {
        for (const fullPath of paths) {
            const { parent, lastKey } = this.getParentAndKey(filter, fullPath);
            if (!parent || !(lastKey in parent)) continue;

            delete parent[lastKey];
            this.cleanEmptyAncestors(filter, fullPath);
        }
    }

    /**
     * Gets the parent object and key for a given path
     * 
     * @param obj - The object to traverse
     * @param path - Dot-separated path to navigate
     * @returns Object containing the parent object and the last key, or undefined parent if path invalid
     * @private
     * 
     * @remarks
     * Used internally by clean() to locate the parent of a property to be deleted
     */
    private static getParentAndKey(obj: Record<string, any>, path: string): { parent?: Record<string, any>, lastKey: string } {
        const keys = path.split(".");
        const lastKey = keys.at(-1)!;
        let current = obj;

        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (typeof current[key] !== "object") {
                return { parent: undefined, lastKey };
            }
            current = current[key];
        }

        return { parent: current, lastKey };
    }

    /**
     * Recursively removes empty ancestor objects after a property deletion
     * 
     * @param obj - The root object
     * @param path - The path where deletion occurred
     * @private
     * 
     * @remarks
     * Walks up the path hierarchy, removing objects that have become empty
     * Stops when it encounters a non-empty object or reaches the root
     */
    private static cleanEmptyAncestors(obj: Record<string, any>, path: string): void {
        const keys = path.split(".");
        
        for (let depth = keys.length - 1; depth > 0; depth--) {
            const currentPath = keys.slice(0, depth).join(".");
            const currentKey = keys[depth - 1];
            const currentObj = currentPath.includes('.') ? this.get(obj, currentPath.split('.').slice(0, -1).join('.')) : obj;
            
            if (!currentObj) break;
            
            const targetObj = currentObj[currentKey];
            

            if (targetObj && typeof targetObj === "object" && !Array.isArray(targetObj) && Object.keys(targetObj).length === 0) {
                delete currentObj[currentKey];
            } else {
                break;
            }
        }
    }

}