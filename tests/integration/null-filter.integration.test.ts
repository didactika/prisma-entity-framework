/**
 * Integration tests for null filter behavior in findByFilter, countByFilter and deleteByFilter
 *
 * Verifies that passing `null` as a filter value generates an IS NULL condition
 * instead of being silently ignored.
 *
 * Applies to all supported databases (SQLite, MySQL, PostgreSQL, MongoDB).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/core/base-entity';
import { Property } from '../../src/core/decorators/property.decorator';
import { configurePrisma, resetPrismaConfiguration } from '../../src/core/config';
import { createTestDb } from '../helpers/test-db';
import type { PrismaClient } from '@prisma/client';

interface IUser {
    id?: number | string;
    name: string;
    email: string;
    age?: number | null;
    isActive?: boolean;
}

class User extends BaseEntity<IUser> implements IUser {
    static override readonly model: PrismaClient['user'];

    public declare readonly id?: IUser['id'];

    @Property() declare name: IUser['name'];
    @Property() declare email: IUser['email'];
    @Property() declare age: IUser['age'];
    @Property() declare isActive: IUser['isActive'];

    constructor(data?: Partial<IUser>) {
        super(data);
    }
}

describe('Null Filter - Integration Tests', () => {
    let db: Awaited<ReturnType<typeof createTestDb>>;
    let prisma: PrismaClient;

    beforeAll(async () => {
        db = await createTestDb();
        prisma = db.client;
        (User as any).model = prisma.user;
        configurePrisma(prisma);
        await db.clear();
    });

    afterAll(async () => {
        await db.cleanup();
        resetPrismaConfiguration();
    });

    beforeEach(async () => {
        await db.clear();

        // Seed: 2 users with age, 2 without age (null)
        await prisma.user.createMany({
            data: [
                { name: 'Alice', email: 'alice@null-filter.com', age: 30,   isActive: true  },
                { name: 'Bob',   email: 'bob@null-filter.com',   age: 25,   isActive: true  },
                { name: 'Carol', email: 'carol@null-filter.com', age: null, isActive: false },
                { name: 'Dave',  email: 'dave@null-filter.com',  age: null, isActive: false },
            ],
        });
    });

    // -------------------------------------------------------------------------
    // countByFilter
    // -------------------------------------------------------------------------
    describe('countByFilter with null', () => {
        it('should count records where age IS NULL', async () => {
            const count = await User.countByFilter({ age: null });

            expect(count).toBe(2);
        });

        it('should count records where age IS NOT NULL when filtering by a value', async () => {
            const count = await User.countByFilter({ age: 30 });

            expect(count).toBe(1);
        });

        it('should count all records when filter is empty', async () => {
            const count = await User.countByFilter({});

            expect(count).toBe(4);
        });

        it('should combine null filter with another field', async () => {
            // age IS NULL AND isActive = false → Carol + Dave
            const count = await User.countByFilter({ age: null, isActive: false });

            expect(count).toBe(2);
        });
    });

    // -------------------------------------------------------------------------
    // findByFilter
    // -------------------------------------------------------------------------
    describe('findByFilter with null', () => {
        it('should find records where age IS NULL', async () => {
            const users = await User.findByFilter({ age: null }) as IUser[];

            expect(users).toHaveLength(2);
            const names = users.map(u => u.name).sort();
            expect(names).toEqual(['Carol', 'Dave']);
        });

        it('should return empty array when null filter combined with non-matching condition', async () => {
            // age IS NULL AND isActive = true → no records (null-age users are all inactive)
            const users = await User.findByFilter({ age: null, isActive: true }) as IUser[];

            expect(users).toHaveLength(0);
        });

        it('should combine null filter with another field', async () => {
            // age IS NULL AND isActive = false → Carol + Dave
            const users = await User.findByFilter({ age: null, isActive: false }) as IUser[];

            expect(users).toHaveLength(2);
            expect(users.every(u => u.age === null)).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // deleteByFilter
    // -------------------------------------------------------------------------
    describe('deleteByFilter with null', () => {
        it('should delete records where age IS NULL', async () => {
            const deleted = await User.deleteByFilter({ age: null });

            expect(deleted).toBe(2);

            const remaining = await prisma.user.count();
            expect(remaining).toBe(2);
        });

        it('should not delete anything when no records match combined null filter', async () => {
            // age IS NULL AND isActive = true → no records match (null-age users are all inactive)
            const deleted = await User.deleteByFilter({ age: null, isActive: true });

            expect(deleted).toBe(0);

            const remaining = await prisma.user.count();
            expect(remaining).toBe(4);
        });
    });
});
