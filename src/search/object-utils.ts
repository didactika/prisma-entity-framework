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
     * 
     * @remarks
     * - Creates intermediate objects if they don't exist
     * - Overwrites existing values at the target path
     * - Preserves existing sibling properties
     * 
     * @example
     * ```typescript
     * const obj = {};
     * ObjectUtils.assign(obj, 'user.profile.name', 'John');
     * // obj is now: { user: { profile: { name: 'John' } } }
     * ```
     */
    public static assign(target: Record<string, any>, path: string, value: any): void {
        const keys = path.split(".");
        let current = target;

        keys.forEach((key, index) => {
            if (index === keys.length - 1) {
                current[key] = value;
            } else {
                if (!current[key] || typeof current[key] !== "object") {
                    current[key] = {};
                }
                current = current[key];
            }
        });
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