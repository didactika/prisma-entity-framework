import { PrismaClient } from "@prisma/client";
import DataUtils from "./data-utils";
import ModelUtils from "./model-utils";
import { getPrismaInstance } from './config';
import { quoteIdentifier, formatBoolean, getDatabaseProviderCached } from "./utils/database-utils";
import { isObject, shouldSkipField as validationShouldSkipField } from "./utils/validation-utils";

/**
 * BaseEntityHelpers - Internal helper methods for BaseEntity operations.
 * 
 * Provides utility methods for data sanitization, validation, and SQL query building.
 * Extracted from BaseEntity to improve code organization and maintainability.
 * 
 * Features:
 * - Key sanitization (removing leading underscores)
 * - Deduplication based on unique constraints
 * - Update payload pruning
 * - Optimized SQL query building with CASE WHEN
 * - Database-specific value escaping
 * - JSON field handling
 * 
 * @example
 * ```typescript
 * // Sanitize keys before database operation
 * const clean = BaseEntityHelpers.sanitizeKeysRecursive(userData);
 * 
 * // Build optimized batch update query
 * const { query } = BaseEntityHelpers.buildUpdateQuery(
 *   updates,
 *   'users',
 *   modelInfo
 * );
 * ```
 */
export default class BaseEntityHelpers {
    /**
     * Recursively sanitizes object keys by removing leading underscores.
     * 
     * Used to clean up internal property names before database operations.
     * Handles nested objects and arrays recursively.
     * 
     * @param obj - Object, array, or primitive value to sanitize
     * @returns Sanitized copy of the input
     * 
     * @example
     * ```typescript
     * const data = {
     *   _name: 'Alice',
     *   __email: 'alice@example.com',
     *   profile: { _bio: 'Developer' }
     * };
     * 
     * const clean = BaseEntityHelpers.sanitizeKeysRecursive(data);
     * // Result: { name: 'Alice', email: 'alice@example.com', profile: { bio: 'Developer' } }
     * ```
     */
    public static sanitizeKeysRecursive(obj: any): any {
        if (Array.isArray(obj)) {
            return obj.map((item) => this.sanitizeKeysRecursive(item));
        } else if (obj instanceof Date) {
            // Preserve Date objects as-is (they pass isObject check but shouldn't be iterated)
            return obj;
        } else if (isObject(obj)) {
            // Use validation-utils.isObject
            return Object.keys(obj).reduce((acc, key) => {
                const sanitizedKey = key.replace(/^_+/, "");
                acc[sanitizedKey] = this.sanitizeKeysRecursive(obj[key]);
                return acc;
            }, {} as any);
        }
        return obj;
    }

    /**
     * Deduplicates data based on unique constraints defined in the model.
     * 
     * Keeps the first occurrence of each unique record based on model's unique constraints.
     * Useful for preventing duplicate key errors in batch operations.
     * 
     * @param data - Array of data to deduplicate
     * @param modelName - Name of the Prisma model
     * @returns Deduplicated array
     * 
     * @example
     * ```typescript
     * const users = [
     *   { email: 'alice@example.com', name: 'Alice' },
     *   { email: 'bob@example.com', name: 'Bob' },
     *   { email: 'alice@example.com', name: 'Alice Duplicate' } // Will be removed
     * ];
     * 
     * const deduplicated = BaseEntityHelpers.deduplicateByUniqueConstraints(users, 'User');
     * // Result: First two users only (assuming email is unique)
     * ```
     */
    public static deduplicateByUniqueConstraints<T extends Record<string, any>>(
        data: T[],
        modelName: string
    ): T[] {
        const constraints = ModelUtils.getUniqueConstraints(modelName);

        if (!constraints || constraints.length === 0) {
            return data;
        }

        const seen = new Set<string>();
        // Pre-allocate array with estimated size for better performance
        const deduplicated: T[] = [];

        for (const item of data) {
            let isDuplicate = false;
            // Cache constraint keys to avoid repeated string operations
            const constraintKeys: string[] = [];

            for (const constraintFields of constraints) {
                // Build key using array join (more efficient than repeated concatenation)
                const keyParts: string[] = new Array(constraintFields.length);
                for (let i = 0; i < constraintFields.length; i++) {
                    keyParts[i] = `${constraintFields[i]}:${item[constraintFields[i]]}`;
                }
                const key = keyParts.join('|');

                if (seen.has(key)) {
                    isDuplicate = true;
                    break;
                }
                constraintKeys.push(key);
            }

            if (!isDuplicate) {
                // Add all constraint keys to seen set
                for (const key of constraintKeys) {
                    seen.add(key);
                }
                deduplicated.push(item);
            }
        }

        return deduplicated;
    }

    /**
     * Prunes update payload by removing fields that should not be updated.
     * 
     * Removes fields like 'id', 'createdAt', and relation objects if their FK field exists.
     * Ensures only valid update fields are included in the payload.
     * 
     * @param obj - Object to prune
     * @returns Pruned object with only updateable fields
     * 
     * @example
     * ```typescript
     * const updateData = {
     *   id: 1,
     *   name: 'Alice',
     *   createdAt: new Date(),
     *   userId: 5,
     *   user: { id: 5, name: 'User' } // Will be removed (FK exists)
     * };
     * 
     * const pruned = BaseEntityHelpers.pruneUpdatePayload(updateData);
     * // Result: { name: 'Alice', userId: 5 }
     * ```
     */
    public static pruneUpdatePayload(obj: Record<string, any>): Record<string, any> {
        const out: Record<string, any> = {};

        for (const [k, v] of Object.entries(obj)) {
            if (this.shouldSkipField(k, v)) continue;
            out[k] = v;
        }

        // Remove relation objects if their FK field exists
        this.removeRelationObjectsWithFK(out);

        return out;
    }

    /**
     * Determines if a field should be skipped during update operations.
     * 
     * Skips fields like 'id', 'createdAt', undefined values, and relation objects.
     * 
     * @param key - Field name
     * @param value - Field value
     * @returns true if field should be skipped, false otherwise
     * 
     * @example
     * ```typescript
     * BaseEntityHelpers.shouldSkipField('id', 1); // true
     * BaseEntityHelpers.shouldSkipField('createdAt', new Date()); // true
     * BaseEntityHelpers.shouldSkipField('name', 'Alice'); // false
     * ```
     */
    public static shouldSkipField(key: string, value: any): boolean {
        // Use validation-utils.shouldSkipField
        return validationShouldSkipField(key, value);
    }

    /**
     * Removes relation objects from payload if their foreign key field exists.
     * 
     * For example, if 'userId' exists, removes 'user' object to avoid conflicts.
     * Modifies the object in place.
     * 
     * @param obj - Object to modify (modified in place)
     * 
     * @example
     * ```typescript
     * const data = {
     *   name: 'Post',
     *   authorId: 5,
     *   author: { id: 5, name: 'Alice' }
     * };
     * 
     * BaseEntityHelpers.removeRelationObjectsWithFK(data);
     * // Result: { name: 'Post', authorId: 5 } (author object removed)
     * ```
     */
    public static removeRelationObjectsWithFK(obj: Record<string, any>): void {
        for (const key of Object.keys(obj)) {
            if (key.endsWith('Id')) {
                const rel = key.slice(0, -2);
                if (rel in obj) {
                    delete obj[rel];
                }
            }
        }
    }

    /**
     * Prepares a list of data for batch update operations.
     * 
     * Sanitizes keys, processes relations, and filters out non-scalar fields.
     * Preserves JSON fields while removing relation objects.
     * 
     * @param dataList - Array of data to prepare
     * @param modelInfo - Model information from Prisma
     * @returns Prepared array ready for batch update
     * 
     * @example
     * ```typescript
     * const updates = [
     *   { id: 1, name: 'Alice', profile: { id: 1 } },
     *   { id: 2, name: 'Bob', metadata: { key: 'value' } }
     * ];
     * 
     * const prepared = BaseEntityHelpers.prepareUpdateList(updates, modelInfo);
     * // Result: [
     * //   { id: 1, name: 'Alice', profileId: 1 },
     * //   { id: 2, name: 'Bob', metadata: { key: 'value' } }
     * // ]
     * ```
     */
    public static prepareUpdateList(dataList: Array<Partial<any>>, modelInfo?: any): Array<Record<string, any>> {
        // Build a set of JSON field names for quick lookup
        const jsonFields = new Set<string>();
        if (modelInfo?.fields) {
            for (const field of modelInfo.fields) {
                if (field.kind === 'scalar' && (field.type === 'Json' || field.type === 'Bytes')) {
                    jsonFields.add(field.name);
                }
            }
        }

        return this.sanitizeKeysRecursive(dataList)
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

    /**
     * Builds an optimized SQL UPDATE query for batch updates.
     * 
     * Uses CASE WHEN statements for efficient multi-row updates in a single query.
     * Handles database-specific quoting and JSON field casting.
     * 
     * @param batch - Array of records to update (must include id field)
     * @param tableName - Name of the database table
     * @param modelInfo - Model information from Prisma
     * @returns Object with query string and set of IDs in batch
     * 
     * @example
     * ```typescript
     * const updates = [
     *   { id: 1, name: 'Alice', status: 'active' },
     *   { id: 2, name: 'Bob', status: 'inactive' }
     * ];
     * 
     * const { query, idsInBatch } = BaseEntityHelpers.buildUpdateQuery(
     *   updates,
     *   'users',
     *   modelInfo
     * );
     * 
     * // Generated SQL:
     * // UPDATE "users"
     * // SET "name" = CASE "id"
     * //     WHEN 1 THEN 'Alice'
     * //     WHEN 2 THEN 'Bob'
     * //     ELSE "name"
     * // END,
     * // "status" = CASE "id"
     * //     WHEN 1 THEN 'active'
     * //     WHEN 2 THEN 'inactive'
     * //     ELSE "status"
     * // END
     * // WHERE "id" IN (1, 2);
     * ```
     */
    public static buildUpdateQuery(
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

        const provider = getDatabaseProviderCached(prisma);

        // Pre-allocate array for better performance
        const setClauses: string[] = new Array(fieldsToUpdate.size);
        let clauseIndex = 0;

        // Cache quoted identifiers to avoid repeated calls
        const quotedId = quoteIdentifier('id', prisma);

        for (const field of fieldsToUpdate) {
            const fieldUpdates = updates[field];
            const isJsonField = jsonFields.has(field);

            // Use array and join instead of repeated string concatenation
            const whenClauses: string[] = [];
            for (const [id, value] of Object.entries(fieldUpdates)) {
                let escapedValue = this.escapeValue(value, prisma, isJsonField);
                // For PostgreSQL JSON fields, cast the value to JSONB
                if (isJsonField && provider === 'postgresql') {
                    escapedValue = `${escapedValue}::jsonb`;
                }
                whenClauses.push(`        WHEN ${id} THEN ${escapedValue}`);
            }

            // Use the mapped database column name
            const dbColumnName = fieldMap[field] || field;
            const quotedColumn = quoteIdentifier(dbColumnName, prisma);
            setClauses[clauseIndex++] = `    ${quotedColumn} = CASE ${quotedId}\n${whenClauses.join('\n')}\n        ELSE ${quotedColumn}\n    END`;
        }

        const idList = Array.from(ids).join(', ');
        const quotedTableName = quoteIdentifier(tableName, prisma);

        const query = `UPDATE ${quotedTableName}
                       SET ${setClauses.join(',\n')}
                       WHERE ${quotedId} IN (${idList});`;

        return { query, idsInBatch: ids };
    }

    /**
     * Escapes a value for use in raw SQL queries.
     * 
     * Handles strings, numbers, booleans, dates, arrays, and JSON objects.
     * Uses database-specific escaping rules to prevent SQL injection.
     * 
     * @param value - Value to escape
     * @param prisma - Prisma client instance (for database-specific escaping)
     * @param isJsonField - Whether this is a JSON field (requires special handling)
     * @returns Escaped SQL string
     * 
     * @example
     * ```typescript
     * BaseEntityHelpers.escapeValue("O'Brien"); // "'O''Brien'"
     * BaseEntityHelpers.escapeValue(42); // "42"
     * BaseEntityHelpers.escapeValue(true, prisma); // "1" or "TRUE" (database-specific)
     * BaseEntityHelpers.escapeValue({ key: 'value' }, prisma, true); // '{"key":"value"}'
     * ```
     */
    public static escapeValue(value: any, prisma?: PrismaClient, isJsonField: boolean = false): string {
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
            // If it's a JSON field with an array, treat as JSON
            if (isJsonField) {
                return this.escapeJsonValue(value, prisma);
            }

            // Otherwise, treat as scalar array (PostgreSQL, etc.)
            const provider = prisma ? getDatabaseProviderCached(prisma) : 'sqlite';

            if (provider === 'postgresql') {
                // PostgreSQL native arrays use ARRAY constructor or array literal syntax
                // For string arrays: ARRAY['value1', 'value2']
                if (value.length === 0) return "ARRAY[]::text[]";

                const escapedElements = value.map((v) => {
                    if (typeof v === 'string') {
                        // Only escape single quotes for PostgreSQL array elements
                        return `'${v.replace(/'/g, "''")}'`;
                    }
                    return String(v);
                });
                return `ARRAY[${escapedElements.join(', ')}]`;
            }

            // For other databases (MySQL stores arrays as JSON)
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
            return this.escapeJsonValue(value, prisma);
        }

        return `'${String(value).replace(/'/g, "''").replace(/\\/g, '\\\\')}'`;
    }

    /**
     * Escapes a JSON value for SQL insertion.
     * 
     * Uses database-specific JSON handling to avoid escaping issues.
     * Handles backslash escaping differently for MySQL vs PostgreSQL.
     * 
     * MySQL JSON escaping rules:
     * - JSON.stringify() produces: {"path":"C:\\test"} (backslash already escaped in JSON)
     * - For SQL string literal, we need: '{"path":"C:\\\\test"}' (escape backslashes for SQL)
     * - MySQL JSON parser then reads: {"path":"C:\\test"} (correct!)
     * 
     * PostgreSQL JSONB escaping rules:
     * - JSON.stringify() produces: {"path":"C:\\test"} (backslash already escaped in JSON)
     * - PostgreSQL JSONB handles JSON natively, only need to escape single quotes for SQL string literal
     * - Result: '{"path":"C:\\test"}' -> PostgreSQL JSONB stores: C:\test (correct!)
     * 
     * @param value - JSON value to escape
     * @param prisma - Prisma client instance
     * @returns Escaped JSON string for SQL
     * 
     * @example
     * ```typescript
     * const data = { path: 'C:\\test', name: "O'Brien" };
     * 
     * // MySQL
     * const escaped = BaseEntityHelpers.escapeJsonValue(data, mysqlPrisma);
     * // Result: '{"path":"C:\\\\test","name":"O''Brien"}'
     * 
     * // PostgreSQL
     * const escaped = BaseEntityHelpers.escapeJsonValue(data, pgPrisma);
     * // Result: '{"path":"C:\\test","name":"O''Brien"}'
     * ```
     */
    public static escapeJsonValue(value: any, prisma?: PrismaClient): string {
        const provider = prisma ? getDatabaseProviderCached(prisma) : 'sqlite';
        const jsonString = JSON.stringify(value);

        if (provider === 'mysql') {
            // For MySQL JSON fields:
            // 1. Escape backslashes for SQL string literal (JSON already has them escaped)
            // 2. Escape single quotes for SQL string literal
            // This ensures: C:\path -> JSON: "C:\\path" -> SQL: 'C:\\\\path' -> MySQL JSON: C:\path
            const escaped = jsonString
                .replace(/\\/g, '\\\\')  // Escape backslashes first
                .replace(/'/g, "''");     // Then escape single quotes
            return `'${escaped}'`;
        }

        if (provider === 'postgresql') {
            // For PostgreSQL JSONB fields:
            // PostgreSQL handles JSON natively, so we only need to escape single quotes
            // JSON.stringify already handles backslash escaping correctly
            // This ensures: C:\path -> JSON: "C:\\path" -> SQL: '{"path":"C:\\path"}' -> PostgreSQL JSONB: C:\path
            const escaped = jsonString.replace(/'/g, "''");
            return `'${escaped}'`;
        }

        // Other databases - escape both quotes and backslashes
        const escaped = jsonString.replace(/'/g, "''").replace(/\\/g, '\\\\');
        return `'${escaped}'`;
    }
}
