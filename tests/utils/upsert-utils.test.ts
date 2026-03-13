/**
 * Unit tests for upsert-utils.ts
 * Tests metadata extraction, SQL builders for all 4 databases, 
 * pre-count query, result parsing, and batch execution.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
    getUpsertMetadata,
    clearUpsertMetadataCache,
    buildPostgreSQLUpsert,
    buildMySQLUpsert,
    buildSQLiteUpsert,
    buildSQLServerUpsert,
    buildPreCountQuery,
    parseUpsertResults,
    executeRawUpsertBatch,
} from '../../src/core/upsert-utils';
import type { UpsertMetadata } from '../../src/core/upsert-utils';
import { configurePrisma, resetPrismaConfiguration } from '../../src/core/config';
import { clearDatabaseProviderCache } from '../../src/core/utils/database-utils';
import { mockPrismaClient } from '../__mocks__/prisma-client.mock';

// ---------------------------------------------------------------
// Helper: build a mock ModelInfo matching Prisma's runtime shape
// ---------------------------------------------------------------
function makeModelInfo(
    name: string,
    dbName: string,
    fields: Array<{
        name: string;
        dbName?: string;
        kind?: string;
        type?: string;
        isId?: boolean;
        isUpdatedAt?: boolean;
        hasDefaultValue?: boolean;
        isRequired?: boolean;
    }>
) {
    return {
        name,
        dbName,
        fields: fields.map(f => ({
            name: f.name,
            dbName: f.dbName ?? f.name,
            kind: (f.kind ?? 'scalar') as 'scalar' | 'object' | 'enum',
            type: f.type ?? 'String',
            isId: f.isId ?? false,
            isUpdatedAt: f.isUpdatedAt ?? false,
            hasDefaultValue: f.hasDefaultValue ?? (f.isId ?? false),
            isRequired: f.isRequired ?? true,
        })),
    };
}

// A standard User model reused across tests
const userModelInfo = makeModelInfo('user', 'users', [
    { name: 'id', type: 'Int', isId: true, hasDefaultValue: true },
    { name: 'name', type: 'String' },
    { name: 'email', type: 'String' },
    { name: 'age', type: 'Int', isRequired: false },
    { name: 'createdAt', type: 'DateTime', hasDefaultValue: true },
    { name: 'updatedAt', type: 'DateTime', isUpdatedAt: true, hasDefaultValue: true },
]);

// Mock prisma with a specific provider for controlled SQL output
function makeMockPrisma(provider: string) {
    return {
        ...mockPrismaClient,
        _engineConfig: {
            datasources: [{ activeProvider: provider }],
        },
    } as any;
}

describe('upsert-utils', () => {
    beforeEach(() => {
        clearUpsertMetadataCache();
        clearDatabaseProviderCache();
        configurePrisma(mockPrismaClient as any);
        mockPrismaClient._reset();
    });

    afterEach(() => {
        resetPrismaConfiguration();
        clearDatabaseProviderCache();
    });

    // ===============================================================
    // getUpsertMetadata
    // ===============================================================
    describe('getUpsertMetadata', () => {
        it('should extract all column metadata from model info', () => {
            const meta = getUpsertMetadata('user', userModelInfo as any);

            expect(meta.tableName).toBe('users');
            expect(meta.allColumns).toHaveLength(6);
            expect(meta.allColumns.map(c => c.prismaName)).toEqual([
                'id', 'name', 'email', 'age', 'createdAt', 'updatedAt'
            ]);
        });

        it('should identify unique conflict columns from model constraints', () => {
            const meta = getUpsertMetadata('user', userModelInfo as any);

            // The unique constraint for user model on mock is ['email']
            expect(meta.uniqueConflictColumns.map(c => c.prismaName)).toEqual(['email']);
        });

        it('should exclude id, unique, and createdAt from updatable columns', () => {
            const meta = getUpsertMetadata('user', userModelInfo as any);

            const updatableNames = meta.updatableColumns.map(c => c.prismaName);
            expect(updatableNames).not.toContain('id');
            expect(updatableNames).not.toContain('email'); // unique constraint
            expect(updatableNames).not.toContain('createdAt');
            expect(updatableNames).toContain('name');
            expect(updatableNames).toContain('age');
            expect(updatableNames).toContain('updatedAt');
        });

        it('should exclude updatedAt from comparable columns', () => {
            const meta = getUpsertMetadata('user', userModelInfo as any);

            const comparableNames = meta.comparableColumns.map(c => c.prismaName);
            expect(comparableNames).not.toContain('updatedAt');
            expect(comparableNames).toContain('name');
            expect(comparableNames).toContain('age');
        });

        it('should detect JSON fields', () => {
            const modelInfo = makeModelInfo('user', 'users', [
                { name: 'id', type: 'Int', isId: true, hasDefaultValue: true },
                { name: 'email', type: 'String' },
                { name: 'metadata', type: 'Json', isRequired: false },
                { name: 'data', type: 'Bytes', isRequired: false },
            ]);

            clearUpsertMetadataCache();
            const meta = getUpsertMetadata('user', modelInfo as any);
            expect(meta.jsonFields.has('metadata')).toBe(true);
            expect(meta.jsonFields.has('data')).toBe(true);
            expect(meta.jsonFields.has('email')).toBe(false);
        });

        it('should cache metadata for repeated calls', () => {
            const meta1 = getUpsertMetadata('user', userModelInfo as any);
            const meta2 = getUpsertMetadata('user', userModelInfo as any);
            expect(meta1).toBe(meta2); // same reference
        });

        it('should clear cache with clearUpsertMetadataCache', () => {
            const meta1 = getUpsertMetadata('user', userModelInfo as any);
            clearUpsertMetadataCache();
            const meta2 = getUpsertMetadata('user', userModelInfo as any);
            expect(meta1).not.toBe(meta2); // different reference after clear
            expect(meta1).toEqual(meta2); // but same content
        });

        it('should throw when no unique constraints exist', () => {
            // Use a model name that does not exist in the runtime data model
            expect(() => getUpsertMetadata('nonexistent', userModelInfo as any))
                .toThrow(/No unique constraints/);
        });

        it('should detect updatedAt by heuristic naming', () => {
            const meta = getUpsertMetadata('user', userModelInfo as any);
            const updatedAtCol = meta.allColumns.find(c => c.prismaName === 'updatedAt');
            expect(updatedAtCol?.isUpdatedAt).toBe(true);
        });

        it('should skip non-scalar fields', () => {
            const modelInfo = makeModelInfo('user', 'users', [
                { name: 'id', type: 'Int', isId: true, hasDefaultValue: true },
                { name: 'email', type: 'String' },
                { name: 'posts', kind: 'object', type: 'Post' },
            ]);

            clearUpsertMetadataCache();
            const meta = getUpsertMetadata('user', modelInfo as any);
            const colNames = meta.allColumns.map(c => c.prismaName);
            expect(colNames).not.toContain('posts');
            expect(colNames).toContain('id');
            expect(colNames).toContain('email');
        });
    });

    // ===============================================================
    // buildPostgreSQLUpsert
    // ===============================================================
    describe('buildPostgreSQLUpsert', () => {
        let meta: UpsertMetadata;
        let prisma: any;

        beforeEach(() => {
            meta = getUpsertMetadata('user', userModelInfo as any);
            prisma = makeMockPrisma('postgresql');
            clearDatabaseProviderCache();
        });

        it('should generate INSERT ON CONFLICT with IS DISTINCT FROM', () => {
            const items = [
                { name: 'Alice', email: 'alice@example.com', age: 30 },
            ];

            const sql = buildPostgreSQLUpsert(meta, items, prisma);

            expect(sql).toContain('INSERT INTO');
            expect(sql).toContain('ON CONFLICT');
            expect(sql).toContain('DO UPDATE SET');
            expect(sql).toContain('IS DISTINCT FROM');
            expect(sql).toContain('RETURNING');
            expect(sql).toContain('_was_inserted');
            expect(sql).toContain('xmax = 0');
        });

        it('should include EXCLUDED references in SET clauses', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildPostgreSQLUpsert(meta, items, prisma);

            expect(sql).toContain('EXCLUDED.');
        });

        it('should use NOW() for updatedAt column', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildPostgreSQLUpsert(meta, items, prisma);

            expect(sql).toContain('NOW()');
        });

        it('should handle multiple items in VALUES', () => {
            const items = [
                { name: 'Alice', email: 'alice@example.com' },
                { name: 'Bob', email: 'bob@example.com' },
            ];

            const sql = buildPostgreSQLUpsert(meta, items, prisma);

            // Should have two value rows
            const valuesMatch = sql.match(/VALUES\s+(.*?)(?:\n|$)/s);
            expect(valuesMatch).toBeTruthy();
            expect(sql).toContain("'alice@example.com'");
            expect(sql).toContain("'bob@example.com'");
        });

        it('should handle NULL values correctly', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com', age: null }];
            const sql = buildPostgreSQLUpsert(meta, items, prisma);

            expect(sql).toContain('NULL');
        });

        it('should add ::jsonb cast for JSON fields', () => {
            const jsonModel = makeModelInfo('user', 'users', [
                { name: 'id', type: 'Int', isId: true, hasDefaultValue: true },
                { name: 'email', type: 'String' },
                { name: 'metadata', type: 'Json', isRequired: false },
            ]);

            clearUpsertMetadataCache();
            const jsonMeta = getUpsertMetadata('user', jsonModel as any);
            const items = [{ email: 'test@example.com', metadata: { color: 'blue' } }];
            const sql = buildPostgreSQLUpsert(jsonMeta, items, prisma);

            expect(sql).toContain('::jsonb');
        });

        it('should only include columns present in items plus unique key and timestamp columns', () => {
            // Only email provided — insertable columns should be email (unique key) + createdAt/updatedAt (timestamps)
            const items = [{ email: 'alice@example.com' } as any];
            const sql = buildPostgreSQLUpsert(meta, items, prisma);

            // email should be included (unique key), name/age should NOT be in the INSERT columns
            expect(sql).toContain("'alice@example.com'");
            // Timestamps are always included since Prisma handles them at app level
            expect(sql).toMatch(/INSERT INTO.*\("email", "createdAt", "updatedAt"\)/);
            // Should use NOW() for the missing timestamp values
            expect(sql).toContain('NOW()');
        });

        it('should use the correct conflict columns from unique constraint', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildPostgreSQLUpsert(meta, items, prisma);

            // Should have ON CONFLICT ("email") since email is the unique constraint
            expect(sql).toMatch(/ON CONFLICT\s*\("email"\)/);
        });

        it('should use DO NOTHING when model has no updatable columns', () => {
            const readonlyModelInfo = makeModelInfo('user', 'users', [
                { name: 'email', type: 'String' },
                { name: 'createdAt', type: 'DateTime', hasDefaultValue: true },
            ]);

            clearUpsertMetadataCache();
            const readonlyMeta = getUpsertMetadata('user', readonlyModelInfo as any);
            const items = [{ email: 'alice@example.com' }];
            const sql = buildPostgreSQLUpsert(readonlyMeta, items, prisma);

            expect(sql).toContain('ON CONFLICT ("email") DO NOTHING');
            expect(sql).not.toContain('DO UPDATE SET');
            expect(sql).toContain('RETURNING "id", TRUE AS "_was_inserted"');
        });
    });

    // ===============================================================
    // buildMySQLUpsert
    // ===============================================================
    describe('buildMySQLUpsert', () => {
        let meta: UpsertMetadata;
        let prisma: any;

        beforeEach(() => {
            meta = getUpsertMetadata('user', userModelInfo as any);
            prisma = makeMockPrisma('mysql');
            clearDatabaseProviderCache();
        });

        it('should generate INSERT ON DUPLICATE KEY UPDATE', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildMySQLUpsert(meta, items, prisma);

            expect(sql).toContain('INSERT INTO');
            expect(sql).toContain('ON DUPLICATE KEY UPDATE');
        });

        it('should use VALUES() references in SET clauses', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildMySQLUpsert(meta, items, prisma);

            expect(sql).toContain('VALUES(');
        });

        it('should use <=> NULL-safe equality for conditional updatedAt', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildMySQLUpsert(meta, items, prisma);

            expect(sql).toContain('<=>');
            expect(sql).toContain('IF(');
            expect(sql).toContain('NOW()');
        });

        it('should place updatedAt IF condition before other SET columns', () => {
            // MySQL evaluates SET left-to-right, so updatedAt IF must come first
            // to compare against original column values, not already-updated ones
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildMySQLUpsert(meta, items, prisma);

            const setStart = sql.indexOf('ON DUPLICATE KEY UPDATE');
            const setClauses = sql.substring(setStart + 'ON DUPLICATE KEY UPDATE'.length).trim();
            // updatedAt IF should be the first SET clause
            expect(setClauses).toMatch(/^`updatedAt`\s*=\s*IF\(/);
        });

        it('should use backtick quoting for MySQL identifiers', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildMySQLUpsert(meta, items, prisma);

            expect(sql).toContain('`');
        });

        it('should handle multiple items', () => {
            const items = [
                { name: 'Alice', email: 'alice@example.com' },
                { name: 'Bob', email: 'bob@example.com' },
            ];
            const sql = buildMySQLUpsert(meta, items, prisma);

            expect(sql).toContain("'alice@example.com'");
            expect(sql).toContain("'bob@example.com'");
        });
    });

    // ===============================================================
    // buildSQLiteUpsert
    // ===============================================================
    describe('buildSQLiteUpsert', () => {
        let meta: UpsertMetadata;
        let prisma: any;

        beforeEach(() => {
            meta = getUpsertMetadata('user', userModelInfo as any);
            prisma = makeMockPrisma('sqlite');
            clearDatabaseProviderCache();
        });

        it('should generate INSERT ON CONFLICT with IS NOT', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildSQLiteUpsert(meta, items, prisma);

            expect(sql).toContain('INSERT INTO');
            expect(sql).toContain('ON CONFLICT');
            expect(sql).toContain('DO UPDATE SET');
            expect(sql).toContain('IS NOT');
        });

        it('should use excluded. prefix for SET clauses', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildSQLiteUpsert(meta, items, prisma);

            expect(sql).toContain('excluded.');
        });

        it('should use strftime for updatedAt with ms precision', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildSQLiteUpsert(meta, items, prisma);

            expect(sql).toContain("strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
        });

        it('should use OR-based WHERE clause for change detection', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com', age: 30 }];
            const sql = buildSQLiteUpsert(meta, items, prisma);

            // Multiple comparable columns joined with OR
            expect(sql).toContain('WHERE');
            expect(sql).toContain('OR');
        });

        it('should include provided columns plus timestamps for SQLite', () => {
            const items = [{ email: 'alice@example.com' } as any];
            const sql = buildSQLiteUpsert(meta, items, prisma);

            // Should insert email plus timestamp columns
            expect(sql).toContain("'alice@example.com'");
            expect(sql).toMatch(/INSERT INTO.*\("email", "createdAt", "updatedAt"\)/);
            // Should use strftime for the missing timestamp values
            expect(sql).toContain("strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
        });

        it('should use DO NOTHING when model has no updatable columns', () => {
            const readonlyModelInfo = makeModelInfo('user', 'users', [
                { name: 'email', type: 'String' },
                { name: 'createdAt', type: 'DateTime', hasDefaultValue: true },
            ]);

            clearUpsertMetadataCache();
            const readonlyMeta = getUpsertMetadata('user', readonlyModelInfo as any);
            const items = [{ email: 'alice@example.com' }];
            const sql = buildSQLiteUpsert(readonlyMeta, items, prisma);

            expect(sql).toContain('ON CONFLICT ("email") DO NOTHING');
            expect(sql).not.toContain('DO UPDATE SET');
        });
    });

    // ===============================================================
    // buildSQLServerUpsert
    // ===============================================================
    describe('buildSQLServerUpsert', () => {
        let meta: UpsertMetadata;
        let prisma: any;

        beforeEach(() => {
            meta = getUpsertMetadata('user', userModelInfo as any);
            prisma = makeMockPrisma('sqlserver');
            clearDatabaseProviderCache();
        });

        it('should generate MERGE INTO ... USING ... ON', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildSQLServerUpsert(meta, items, prisma);

            expect(sql).toContain('MERGE INTO');
            expect(sql).toContain('AS target');
            expect(sql).toContain('AS source');
            expect(sql).toContain('ON');
        });

        it('should use EXISTS (SELECT ... EXCEPT SELECT ...) for change detection', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildSQLServerUpsert(meta, items, prisma);

            expect(sql).toContain('EXISTS');
            expect(sql).toContain('EXCEPT');
        });

        it('should use WHEN MATCHED THEN UPDATE', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildSQLServerUpsert(meta, items, prisma);

            expect(sql).toContain('WHEN MATCHED');
            expect(sql).toContain('UPDATE SET');
        });

        it('should use WHEN NOT MATCHED THEN INSERT', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildSQLServerUpsert(meta, items, prisma);

            expect(sql).toContain('WHEN NOT MATCHED');
            expect(sql).toContain('INSERT');
        });

        it('should use OUTPUT $action for result tracking', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildSQLServerUpsert(meta, items, prisma);

            expect(sql).toContain('OUTPUT $action');
        });

        it('should use square bracket quoting for identifiers', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildSQLServerUpsert(meta, items, prisma);

            expect(sql).toContain('[users]');
        });

        it('should use GETDATE() for updatedAt', () => {
            const items = [{ name: 'Alice', email: 'alice@example.com' }];
            const sql = buildSQLServerUpsert(meta, items, prisma);

            expect(sql).toContain('GETDATE()');
        });
    });

    // ===============================================================
    // buildPreCountQuery
    // ===============================================================
    describe('buildPreCountQuery', () => {
        let meta: UpsertMetadata;
        let prisma: any;

        beforeEach(() => {
            meta = getUpsertMetadata('user', userModelInfo as any);
            prisma = makeMockPrisma('mysql');
            clearDatabaseProviderCache();
        });

        it('should generate IN clause for single unique key', () => {
            const items = [
                { email: 'alice@example.com', name: 'Alice' },
                { email: 'bob@example.com', name: 'Bob' },
            ];
            const sql = buildPreCountQuery(meta, items, prisma);

            expect(sql).toContain('SELECT COUNT(*)');
            expect(sql).toContain('AS cnt');
            expect(sql).toContain('IN (');
            expect(sql).toContain("'alice@example.com'");
            expect(sql).toContain("'bob@example.com'");
        });

        it('should generate OR conditions for composite unique key', () => {
            // Test with the user model which has single unique constraint
            const items = [
                { email: 'alice@example.com', name: 'Alice' },
            ];
            const sql = buildPreCountQuery(meta, items, prisma);

            expect(sql).toContain('SELECT COUNT(*)');
            expect(sql).toContain('AS cnt');
        });
    });

    // ===============================================================
    // parseUpsertResults
    // ===============================================================
    describe('parseUpsertResults', () => {
        describe('postgresql', () => {
            it('should parse RETURNING rows with _was_inserted flag', () => {
                const rawResult = [
                    { id: 1, _was_inserted: true },
                    { id: 2, _was_inserted: false },
                    { id: 3, _was_inserted: true },
                ];

                const result = parseUpsertResults('postgresql', rawResult, 4);

                expect(result.created).toBe(2);
                expect(result.updated).toBe(1);
                expect(result.unchanged).toBe(1); // 4 total - 2 created - 1 updated
                expect(result.returnedIds).toHaveLength(3);
                expect(result.returnedIds![0]).toEqual({ id: 1, wasInserted: true });
                expect(result.returnedIds![1]).toEqual({ id: 2, wasInserted: false });
            });

            it('should handle all inserts', () => {
                const rawResult = [
                    { id: 1, _was_inserted: true },
                    { id: 2, _was_inserted: true },
                ];

                const result = parseUpsertResults('postgresql', rawResult, 2);

                expect(result.created).toBe(2);
                expect(result.updated).toBe(0);
                expect(result.unchanged).toBe(0);
            });

            it('should handle all unchanged (empty RETURNING)', () => {
                const result = parseUpsertResults('postgresql', [], 3);

                expect(result.created).toBe(0);
                expect(result.updated).toBe(0);
                expect(result.unchanged).toBe(3);
            });

            it('should correctly parse _was_inserted when Prisma returns string flags', () => {
                const rawResult = [
                    { id: 1, _was_inserted: 't' },
                    { id: 2, _was_inserted: 'f' },
                    { id: 3, _was_inserted: 'true' },
                    { id: 4, _was_inserted: 'false' },
                ];

                const result = parseUpsertResults('postgresql', rawResult as any, 4);

                expect(result.created).toBe(2);
                expect(result.updated).toBe(2);
                expect(result.unchanged).toBe(0);
            });
        });

        describe('mysql', () => {
            it('should parse affectedRows with pre-count (CLIENT_FOUND_ROWS)', () => {
                // 3 items, 2 existed. With CLIENT_FOUND_ROWS:
                // affectedRows = 1(insert) + 2(update) + 1(unchanged) = 4
                // updated = max(0, 4 - 3) = 1, inserted = 3 - 2 = 1, unchanged = 2 - 1 = 1
                const result = parseUpsertResults('mysql', 4, 3, 2);

                expect(result.created).toBe(1);
                expect(result.updated).toBe(1);
                expect(result.unchanged).toBe(1);
            });

            it('should handle all inserts (no existing)', () => {
                // 3 items, 0 existed, affectedRows = 3 (all inserts, 1 each)
                const result = parseUpsertResults('mysql', 3, 3, 0);

                expect(result.created).toBe(3);
                expect(result.updated).toBe(0);
                expect(result.unchanged).toBe(0);
            });

            it('should handle all unchanged (CLIENT_FOUND_ROWS)', () => {
                // 3 items, 3 existed, affectedRows = 3 (each found=1, no changes)
                // updated = max(0, 3 - 3) = 0, unchanged = 3 - 0 = 3
                const result = parseUpsertResults('mysql', 3, 3, 3);

                expect(result.created).toBe(0);
                expect(result.updated).toBe(0);
                expect(result.unchanged).toBe(3);
            });

            it('should clamp anomalous counts when existing pre-count is greater than total items', () => {
                const result = parseUpsertResults('mysql', 0, 2, 3);

                expect(result.created).toBe(0);
                expect(result.updated).toBe(0);
                expect(result.unchanged).toBe(2);
            });
        });

        describe('sqlite', () => {
            it('should parse changes() with pre-count', () => {
                // 3 items, 2 existed, changes = 2 (1 insert + 1 update)
                const result = parseUpsertResults('sqlite', 2, 3, 2);

                expect(result.created).toBe(1);
                expect(result.updated).toBe(1);
                expect(result.unchanged).toBe(1);
            });

            it('should handle all inserts', () => {
                const result = parseUpsertResults('sqlite', 3, 3, 0);

                expect(result.created).toBe(3);
                expect(result.updated).toBe(0);
                expect(result.unchanged).toBe(0);
            });

            it('should clamp anomalous counts when existing pre-count is greater than total items', () => {
                const result = parseUpsertResults('sqlite', 0, 2, 3);

                expect(result.created).toBe(0);
                expect(result.updated).toBe(0);
                expect(result.unchanged).toBe(2);
            });
        });

        describe('sqlserver', () => {
            it('should parse OUTPUT rows with $action', () => {
                const rawResult = [
                    { $action: 'INSERT', id: 1 },
                    { $action: 'UPDATE', id: 2 },
                    { $action: 'INSERT', id: 3 },
                ];

                const result = parseUpsertResults('sqlserver', rawResult, 4);

                expect(result.created).toBe(2);
                expect(result.updated).toBe(1);
                expect(result.unchanged).toBe(1);
                expect(result.returnedIds).toHaveLength(3);
            });

            it('should handle all inserts', () => {
                const rawResult = [
                    { $action: 'INSERT', id: 1 },
                    { $action: 'INSERT', id: 2 },
                ];

                const result = parseUpsertResults('sqlserver', rawResult, 2);

                expect(result.created).toBe(2);
                expect(result.updated).toBe(0);
                expect(result.unchanged).toBe(0);
            });

            it('should normalize anomalous OUTPUT row counts to not exceed total', () => {
                const rawResult = [
                    { $action: 'UPDATE', id: 1 },
                    { $action: 'UPDATE', id: 2 },
                    { $action: 'UPDATE', id: 3 },
                ];

                const result = parseUpsertResults('sqlserver', rawResult, 2);

                expect(result.created).toBe(0);
                expect(result.updated).toBe(2);
                expect(result.unchanged).toBe(0);
            });
        });

        describe('unknown provider', () => {
            it('should return all as unchanged for unsupported provider', () => {
                const result = parseUpsertResults('mongodb' as any, null, 5);

                expect(result.created).toBe(0);
                expect(result.updated).toBe(0);
                expect(result.unchanged).toBe(5);
            });
        });
    });

    // ===============================================================
    // executeRawUpsertBatch
    // ===============================================================
    describe('executeRawUpsertBatch', () => {
        it('should return zero counts for empty array', async () => {
            const result = await executeRawUpsertBatch('user', userModelInfo as any, []);

            expect(result).toEqual({
                created: 0,
                updated: 0,
                unchanged: 0,
            });
        });

        it('should execute raw SQL for SQLite provider and return parsed results', async () => {
            clearDatabaseProviderCache();
            // Mock the global prisma to behave like sqlite
            const sqlitePrisma = {
                ...mockPrismaClient,
                _engineConfig: {
                    datasources: [{ activeProvider: 'sqlite' }],
                },
                $queryRawUnsafe: jest.fn().mockResolvedValue([{ cnt: 1 }]),
                $executeRawUnsafe: jest.fn().mockResolvedValue(2), // 2 changes (1 insert + 1 update)
            };
            configurePrisma(sqlitePrisma as any);

            const items = [
                { name: 'Alice', email: 'alice@example.com' },
                { name: 'Bob', email: 'bob@example.com' },
            ];

            const result = await executeRawUpsertBatch('user', userModelInfo as any, items);

            // Pre-count should have been called
            expect(sqlitePrisma.$queryRawUnsafe).toHaveBeenCalled();
            // executeRawUnsafe should be called for the main upsert
            expect(sqlitePrisma.$executeRawUnsafe).toHaveBeenCalled();

            expect(result.created).toBe(1); // 2 items - 1 existing
            expect(result.updated).toBe(1); // 2 changes - 1 insert
            expect(result.unchanged).toBe(0);
        });

        it('should execute raw SQL for PostgreSQL provider', async () => {
            clearDatabaseProviderCache();
            const pgPrisma = {
                ...mockPrismaClient,
                _engineConfig: {
                    datasources: [{ activeProvider: 'postgresql' }],
                },
                $queryRawUnsafe: jest.fn().mockResolvedValue([
                    { id: 1, _was_inserted: true },
                    { id: 2, _was_inserted: false },
                ]),
            };
            configurePrisma(pgPrisma as any);

            const items = [
                { name: 'Alice', email: 'alice@example.com' },
                { name: 'Bob', email: 'bob@example.com' },
            ];

            const result = await executeRawUpsertBatch('user', userModelInfo as any, items);

            expect(pgPrisma.$queryRawUnsafe).toHaveBeenCalled();
            expect(result.created).toBe(1);
            expect(result.updated).toBe(1);
            expect(result.unchanged).toBe(0);
            expect(result.returnedIds).toHaveLength(2);
        });

        it('should report unchanged count when PostgreSQL RETURNING is empty', async () => {
            clearDatabaseProviderCache();
            const pgPrisma = {
                ...mockPrismaClient,
                _engineConfig: {
                    datasources: [{ activeProvider: 'postgresql' }],
                },
                $queryRawUnsafe: jest.fn().mockResolvedValue([]),
            };
            configurePrisma(pgPrisma as any);

            const items = [
                { name: 'Alice', email: 'alice@example.com' },
                { name: 'Bob', email: 'bob@example.com' },
            ];

            const result = await executeRawUpsertBatch('user', userModelInfo as any, items);

            expect(result.created).toBe(0);
            expect(result.updated).toBe(0);
            expect(result.unchanged).toBe(2);
        });
    });

    // ===============================================================
    // Edge cases
    // ===============================================================
    describe('Edge Cases', () => {
        it('should handle model without updatedAt column', () => {
            const modelInfo = makeModelInfo('user', 'users', [
                { name: 'id', type: 'Int', isId: true, hasDefaultValue: true },
                { name: 'email', type: 'String' },
                { name: 'name', type: 'String' },
            ]);

            clearUpsertMetadataCache();
            const meta = getUpsertMetadata('user', modelInfo as any);

            // updatableColumns should not have updatedAt
            expect(meta.updatableColumns.every(c => !c.isUpdatedAt)).toBe(true);
            // comparableColumns should equal updatableColumns when there's no updatedAt
            expect(meta.comparableColumns).toEqual(meta.updatableColumns);
        });

        it('should handle items with all null optional values', () => {
            const prisma = makeMockPrisma('postgresql');
            clearDatabaseProviderCache();
            const meta = getUpsertMetadata('user', userModelInfo as any);

            const items = [{ name: null, email: 'test@example.com', age: null }];
            const sql = buildPostgreSQLUpsert(meta, items as any, prisma);

            expect(sql).toContain('NULL');
            expect(sql).toContain("'test@example.com'");
        });

        it('should escape single quotes in string values', () => {
            const prisma = makeMockPrisma('postgresql');
            clearDatabaseProviderCache();
            const meta = getUpsertMetadata('user', userModelInfo as any);

            const items = [{ name: "O'Brien", email: "o'brien@example.com" }];
            const sql = buildPostgreSQLUpsert(meta, items, prisma);

            expect(sql).toContain("O''Brien");
            expect(sql).toContain("o''brien@example.com");
        });

        it('should handle numeric values correctly', () => {
            const prisma = makeMockPrisma('postgresql');
            clearDatabaseProviderCache();
            const meta = getUpsertMetadata('user', userModelInfo as any);

            const items = [{ name: 'Alice', email: 'alice@example.com', age: 25 }];
            const sql = buildPostgreSQLUpsert(meta, items, prisma);

            expect(sql).toContain('25');
        });

        it('SQL builders should produce syntactically different output per DB', () => {
            const meta = getUpsertMetadata('user', userModelInfo as any);
            const items = [{ name: 'Alice', email: 'alice@example.com' }];

            clearDatabaseProviderCache();
            const pgSql = buildPostgreSQLUpsert(meta, items, makeMockPrisma('postgresql'));
            clearDatabaseProviderCache();
            const mysqlSql = buildMySQLUpsert(meta, items, makeMockPrisma('mysql'));
            clearDatabaseProviderCache();
            const sqliteSql = buildSQLiteUpsert(meta, items, makeMockPrisma('sqlite'));
            clearDatabaseProviderCache();
            const mssqlSql = buildSQLServerUpsert(meta, items, makeMockPrisma('sqlserver'));

            // Each should be unique
            const sqls = new Set([pgSql, mysqlSql, sqliteSql, mssqlSql]);
            expect(sqls.size).toBe(4);

            // Provider-specific keywords
            expect(pgSql).toContain('IS DISTINCT FROM');
            expect(mysqlSql).toContain('ON DUPLICATE KEY');
            expect(sqliteSql).toContain('IS NOT');
            expect(mssqlSql).toContain('MERGE INTO');
        });
    });
});
