import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
    clearUpsertMetadataCache,
    executeMassivePostgresUpsert,
    getUpsertMetadata,
} from '../../src/core/upsert-utils';
import { configurePrisma, resetPrismaConfiguration } from '../../src/core/config';
import { clearDatabaseProviderCache } from '../../src/core/utils/database-utils';
import ModelUtils from '../../src/core/model-utils';
import { mockPrismaClient } from '../__mocks__/prisma-client.mock';

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

const originalDatabaseUrl = process.env.DATABASE_URL;

describe('executeMassivePostgresUpsert', () => {
    beforeEach(() => {
        process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
        configurePrisma(mockPrismaClient as any);
        mockPrismaClient._reset();
        clearDatabaseProviderCache();
        clearUpsertMetadataCache();
    });

    afterEach(() => {
        resetPrismaConfiguration();
        clearDatabaseProviderCache();
        jest.restoreAllMocks();
        if (originalDatabaseUrl === undefined) {
            delete process.env.DATABASE_URL;
        } else {
            process.env.DATABASE_URL = originalDatabaseUrl;
        }
    });

    it('should return zero counts for empty input', async () => {
        const meta = getUpsertMetadata('user', makeModelInfo('user', 'users', [
            { name: 'id', type: 'Int', isId: true, hasDefaultValue: true },
            { name: 'email', type: 'String' },
            { name: 'name', type: 'String' },
        ]) as any);

        const result = await executeMassivePostgresUpsert(meta, [], mockPrismaClient as any);

        expect(result).toEqual({
            counts: { created: 0, updated: 0, unchanged: 0, total: 0 },
            items: { createdIds: [], updatedIds: [], unchangedIds: [] }
        });
    });

    it('should execute the staging table flow and parse returned ids', async () => {
        const meta = getUpsertMetadata('user', makeModelInfo('user', 'users', [
            { name: 'id', type: 'Int', isId: true, hasDefaultValue: true },
            { name: 'email', type: 'String' },
            { name: 'name', type: 'String' },
            { name: 'updatedAt', type: 'DateTime', isUpdatedAt: true, hasDefaultValue: true },
        ]) as any);

        jest.spyOn(mockPrismaClient, '$queryRawUnsafe' as any).mockResolvedValue([
            {
                unchanged_ids: [20],
                updated_ids: [10],
                inserted_ids: [30]
            }
        ]);

        const result = await executeMassivePostgresUpsert(meta, [
            { email: 'update@example.com', name: 'Updated' },
            { email: 'same@example.com', name: 'Same' },
            { email: 'new@example.com', name: 'New' },
        ], mockPrismaClient as any);

        const executeCalls = mockPrismaClient.$executeRawUnsafe.mock.calls.map((call: unknown[]) => String(call[0]));

        expect(mockPrismaClient.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ timeout: 300000 }));
        expect(executeCalls.some((sql: string) => sql.includes('CREATE TEMP TABLE'))).toBe(true);
        expect(executeCalls.some((sql: string) => sql.includes('CREATE UNIQUE INDEX'))).toBe(true);
        expect(executeCalls.some((sql: string) => sql.includes('ANALYZE'))).toBe(true);
        expect(executeCalls.some((sql: string) => sql.includes('DROP TABLE IF EXISTS'))).toBe(true);
        expect(result).toEqual({
            counts: { created: 1, updated: 1, unchanged: 1, total: 3 },
            items: { createdIds: [30], updatedIds: [10], unchangedIds: [20] }
        });
    });

    it('should use the no-update branch for pivot-like tables', async () => {
        const uniqueSpy = jest.spyOn(ModelUtils, 'getUniqueConstraints').mockReturnValue([['userId', 'groupId']]);

        try {
            const meta = getUpsertMetadata('membership', makeModelInfo('membership', 'memberships', [
                { name: 'userId', type: 'Int' },
                { name: 'groupId', type: 'Int' },
            ]) as any);

            jest.spyOn(mockPrismaClient, '$queryRawUnsafe' as any).mockResolvedValue([
                {
                    unchanged_ids: [1],
                    updated_ids: [],
                    inserted_ids: [2]
                }
            ]);

            const result = await executeMassivePostgresUpsert(meta, [
                { userId: 10, groupId: 20 },
                { userId: 10, groupId: 30 },
            ], mockPrismaClient as any);

            const query = String((mockPrismaClient.$queryRawUnsafe as any).mock.calls.at(-1)?.[0] ?? '');
            expect(query).not.toContain('updated_records AS');
            expect(result.counts).toEqual({ created: 1, updated: 0, unchanged: 1, total: 2 });
        } finally {
            uniqueSpy.mockRestore();
        }
    });

    it('should insert staging rows in multiple chunks when items exceed 5000', async () => {
        const meta = getUpsertMetadata('user', makeModelInfo('user', 'users', [
            { name: 'id', type: 'Int', isId: true, hasDefaultValue: true },
            { name: 'email', type: 'String' },
            { name: 'name', type: 'String' },
        ]) as any);

        jest.spyOn(mockPrismaClient, '$queryRawUnsafe' as any).mockResolvedValue([
            {
                unchanged_ids: [],
                updated_ids: [],
                inserted_ids: []
            }
        ]);

        const items = Array.from({ length: 5001 }, (_, index) => ({
            email: `user-${index}@example.com`,
            name: `User ${index}`
        }));

        await executeMassivePostgresUpsert(meta, items, mockPrismaClient as any);

        const insertCalls = mockPrismaClient.$executeRawUnsafe.mock.calls
            .map((call: unknown[]) => String(call[0]))
            .filter((sql: string) => sql.includes('INSERT INTO') && sql.includes('temp_staging_'));

        expect(insertCalls).toHaveLength(2);
    });
});