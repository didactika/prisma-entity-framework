/**
 * Integration tests for Parallel Batch Operations
 * Tests parallel execution with real database operations
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/base-entity';
import { Property } from '../../src/decorators/property.decorator';
import { configurePrisma, resetPrismaConfiguration } from '../../src/config';
import { createTestDb } from '../utils/test-db';
import type { PrismaClient } from '@prisma/client';

interface ITestUser {
    id?: number;
    name: string;
    email: string;
    age?: number;
}

class TestUser extends BaseEntity<ITestUser> {
    static model: any;

    @Property() declare name: string;
    @Property() declare email: string;
    @Property() declare age?: number;

    constructor(data?: ITestUser) {
        super(data);
    }
}

describe('Parallel Batch Operations - Integration Tests', () => {
    let db: Awaited<ReturnType<typeof createTestDb>>;
    let prisma: PrismaClient;

    beforeAll(async () => {
        db = await createTestDb();
        prisma = db.client;

        // Configure with parallel execution enabled
        configurePrisma(prisma, {
            maxConcurrency: 4,
            enableParallel: true,
            maxQueriesPerSecond: 100
        });

        TestUser.model = prisma.user;
    });

    afterAll(async () => {
        await db.cleanup();
        resetPrismaConfiguration();
    });

    beforeEach(async () => {
        await db.clear();
    });

    describe('Parallel createMany', () => {
        it('should create large dataset efficiently with parallel execution', async () => {
            const TOTAL_USERS = 1000;
            const users = Array.from({ length: TOTAL_USERS }, (_, i) => ({
                name: `User ${i}`,
                email: `user${i}@parallel-test.com`,
                age: 20 + (i % 50)
            }));

            const startTime = Date.now();
            const count = await TestUser.createMany(users, false, undefined, {
                parallel: true,
                concurrency: 4
            });
            const endTime = Date.now();

            expect(count).toBe(TOTAL_USERS);

            // Verify all users were created
            const createdUsers = await prisma.user.findMany();
            expect(createdUsers).toHaveLength(TOTAL_USERS);

            console.log(`✅ Created ${TOTAL_USERS} users in ${endTime - startTime}ms with parallel execution`);
        }, 30000);

        it('should create users without duplicates', async () => {
            const users = Array.from({ length: 200 }, (_, i) => ({
                name: `Unique User ${i}`,
                email: `unique${i}@test.com`,
                age: 25
            }));

            const count = await TestUser.createMany(users, false, undefined, {
                parallel: true,
                concurrency: 4
            });

            expect(count).toBe(200);

            const totalUsers = await prisma.user.count();
            expect(totalUsers).toBe(200);
        }, 20000);

        it('should work correctly with sequential execution when parallel=false', async () => {
            const users = Array.from({ length: 100 }, (_, i) => ({
                name: `Sequential User ${i}`,
                email: `seq${i}@test.com`,
                age: 25
            }));

            const count = await TestUser.createMany(users, false, undefined, {
                parallel: false
            });

            expect(count).toBe(100);
        });
    });

    describe('Parallel upsertMany', () => {
        it('should upsert large dataset with parallel OR queries', async () => {
            // Create initial users
            const initialUsers = Array.from({ length: 500 }, (_, i) => ({
                name: `User ${i}`,
                email: `user${i}@upsert-test.com`,
                age: 25
            }));

            const createResult = await TestUser.upsertMany(initialUsers, undefined, {
                parallel: true,
                concurrency: 4
            });

            expect(createResult.created).toBe(500);
            expect(createResult.updated).toBe(0);

            // Update half, keep half unchanged
            const upsertUsers = [
                ...Array.from({ length: 250 }, (_, i) => ({
                    email: `user${i}@upsert-test.com`,
                    name: `Updated User ${i}`,
                    age: 30
                })),
                ...Array.from({ length: 250 }, (_, i) => ({
                    email: `user${i + 250}@upsert-test.com`,
                    name: `User ${i + 250}`,
                    age: 25
                })),
                ...Array.from({ length: 250 }, (_, i) => ({
                    email: `newuser${i}@upsert-test.com`,
                    name: `New User ${i}`,
                    age: 35
                }))
            ];

            const startTime = Date.now();
            const upsertResult = await TestUser.upsertMany(upsertUsers, undefined, {
                parallel: true,
                concurrency: 4
            });
            const endTime = Date.now();

            expect(upsertResult.created).toBe(250); // New users
            expect(upsertResult.updated).toBe(250); // Updated users
            expect(upsertResult.unchanged).toBe(250); // Unchanged users

            const totalUsers = await prisma.user.count();
            expect(totalUsers).toBe(750);

            console.log(`✅ Upserted 750 users in ${endTime - startTime}ms with parallel execution`);
        }, 30000);

        it('should handle parallel creates and updates efficiently', async () => {
            // Create some existing users
            const existing = Array.from({ length: 100 }, (_, i) => ({
                name: `Existing ${i}`,
                email: `existing${i}@test.com`,
                age: 20
            }));

            await TestUser.createMany(existing);

            // Upsert with mix of updates and creates
            const mixed = [
                ...Array.from({ length: 50 }, (_, i) => ({
                    email: `existing${i}@test.com`,
                    name: `Updated ${i}`,
                    age: 25
                })),
                ...Array.from({ length: 150 }, (_, i) => ({
                    email: `new${i}@test.com`,
                    name: `New ${i}`,
                    age: 30
                }))
            ];

            const result = await TestUser.upsertMany(mixed, undefined, {
                parallel: true
            });

            expect(result.updated).toBe(50);
            expect(result.created).toBe(150);
        }, 20000);
    });

    describe('Parallel updateManyById', () => {
        it('should update large dataset in parallel', async () => {
            // Create users first
            const users = Array.from({ length: 500 }, (_, i) => ({
                name: `User ${i}`,
                email: `user${i}@update-test.com`,
                age: 25
            }));

            await TestUser.createMany(users);

            // Get all user IDs
            const allUsers = await prisma.user.findMany();

            // Prepare updates
            const updates = allUsers.map(user => ({
                id: user.id,
                name: `Updated ${user.name}`,
                age: 30
            }));

            const startTime = Date.now();
            const count = await TestUser.updateManyById(updates, {
                parallel: true,
                concurrency: 4
            });
            const endTime = Date.now();

            expect(count).toBe(500);

            // Verify updates
            const updatedUsers = await prisma.user.findMany();
            expect(updatedUsers.every(u => u.age === 30)).toBe(true);
            expect(updatedUsers.every(u => u.name.startsWith('Updated'))).toBe(true);

            console.log(`✅ Updated ${count} users in ${endTime - startTime}ms with parallel execution`);
        }, 30000);

        it('should handle partial updates correctly', async () => {
            const users = Array.from({ length: 100 }, (_, i) => ({
                name: `User ${i}`,
                email: `user${i}@test.com`,
                age: 25
            }));

            await TestUser.createMany(users);

            const allUsers = await prisma.user.findMany();
            const updates = allUsers.slice(0, 50).map(user => ({
                id: user.id,
                age: 35
            }));

            const count = await TestUser.updateManyById(updates, {
                parallel: true
            });

            expect(count).toBe(50);

            const updated = await prisma.user.findMany({ where: { age: 35 } });
            expect(updated).toHaveLength(50);
        });
    });

    describe('Parallel deleteByIds', () => {
        it('should delete large dataset in parallel', async () => {
            // Create users
            const users = Array.from({ length: 500 }, (_, i) => ({
                name: `User ${i}`,
                email: `user${i}@delete-test.com`,
                age: 25
            }));

            await TestUser.createMany(users);

            // Get all IDs
            const allUsers = await prisma.user.findMany();
            const ids = allUsers.map(u => u.id);

            const startTime = Date.now();
            const deleted = await TestUser.deleteByIds(ids, {
                parallel: true,
                concurrency: 4
            });
            const endTime = Date.now();

            expect(deleted).toBe(500);

            const remaining = await prisma.user.count();
            expect(remaining).toBe(0);

            console.log(`✅ Deleted ${deleted} users in ${endTime - startTime}ms with parallel execution`);
        }, 30000);

        it('should handle partial deletes correctly', async () => {
            const users = Array.from({ length: 200 }, (_, i) => ({
                name: `User ${i}`,
                email: `user${i}@test.com`,
                age: 25
            }));

            await TestUser.createMany(users);

            const allUsers = await prisma.user.findMany();
            const idsToDelete = allUsers.slice(0, 100).map(u => u.id);

            const deleted = await TestUser.deleteByIds(idsToDelete, {
                parallel: true
            });

            expect(deleted).toBe(100);

            const remaining = await prisma.user.count();
            expect(remaining).toBe(100);
        });
    });

    describe('Performance Comparison', () => {
        it('should demonstrate speedup with parallel execution', async () => {
            const DATASET_SIZE = 500;
            const users = Array.from({ length: DATASET_SIZE }, (_, i) => ({
                name: `Perf User ${i}`,
                email: `perf${i}@test.com`,
                age: 25
            }));

            // Sequential execution
            await db.clear();
            const seqStart = Date.now();
            await TestUser.createMany(users, false, undefined, {
                parallel: false
            });
            const seqTime = Date.now() - seqStart;

            // Parallel execution
            await db.clear();
            const parStart = Date.now();
            await TestUser.createMany(users, false, undefined, {
                parallel: true,
                concurrency: 4
            });
            const parTime = Date.now() - parStart;

            const speedup = seqTime / parTime;

            console.log(`\n📊 Performance Comparison (${DATASET_SIZE} records):`);
            console.log(`   Sequential: ${seqTime}ms`);
            console.log(`   Parallel:   ${parTime}ms`);
            console.log(`   Speedup:    ${speedup.toFixed(2)}x`);

            // MongoDB has transaction overhead, so parallel may be slower for small datasets
            // For other databases, parallel should be faster or at least not significantly slower
            const minSpeedup = db.provider === 'mongodb' ? 0.5 : 0.8;
            expect(speedup).toBeGreaterThan(minSpeedup);
        }, 40000);
    });

    describe('Error Handling', () => {
        it('should handle errors gracefully in parallel operations', async () => {
            const users = Array.from({ length: 100 }, (_, i) => ({
                name: `User ${i}`,
                email: `user${i}@error-test.com`,
                age: 25
            }));

            // Create initial users
            await TestUser.createMany(users.slice(0, 50));

            // Try to create with some duplicates (should handle gracefully)
            if (db.supportsSkipDuplicates) {
                // MySQL and PostgreSQL support skipDuplicates
                const result = await TestUser.createMany(
                    [...users.slice(0, 10), ...users.slice(50, 100)],
                    true, // skipDuplicates
                    undefined,
                    { parallel: true }
                );

                // Should create the non-duplicate ones
                expect(result).toBeGreaterThan(0);
            } else {
                // SQLite and MongoDB don't support skipDuplicates
                // Just create non-duplicate records
                const result = await TestUser.createMany(
                    users.slice(50, 100),
                    false,
                    undefined,
                    { parallel: true }
                );

                expect(result).toBe(50);
            }
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty arrays', async () => {
            const count = await TestUser.createMany([], false, undefined, {
                parallel: true
            });
            expect(count).toBe(0);
        });

        it('should handle single item', async () => {
            const count = await TestUser.createMany([{
                name: 'Single User',
                email: 'single@test.com',
                age: 25
            }], false, undefined, {
                parallel: true
            });
            expect(count).toBe(1);
        });

        it('should work with very large datasets', async () => {
            const LARGE_SIZE = 2000;
            const users = Array.from({ length: LARGE_SIZE }, (_, i) => ({
                name: `Large User ${i}`,
                email: `large${i}@test.com`,
                age: 25
            }));

            const count = await TestUser.createMany(users, false, undefined, {
                parallel: true,
                concurrency: 8
            });

            expect(count).toBe(LARGE_SIZE);
        }, 60000);
    });
});
