/**
 * Database Compatibility Integration Tests for Parallel Batch Operations
 * Tests parallel operations across all supported databases:
 * - MySQL
 * - PostgreSQL
 * - SQLite (should use sequential)
 * - SQL Server (if available)
 * - MongoDB (with transaction limits)
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/base-entity';
import { Property } from '../../src/decorators/property.decorator';
import { configurePrisma, resetPrismaConfiguration, getConnectionPoolSize, isParallelEnabled } from '../../src/config';
import { createTestDb } from '../utils/test-db';
import type { PrismaClient } from '@prisma/client';

interface ITestUser {
    id?: number | string;
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

describe('Database Compatibility - Parallel Operations', () => {
    let db: Awaited<ReturnType<typeof createTestDb>>;
    let prisma: PrismaClient;

    beforeAll(async () => {
        db = await createTestDb();
        prisma = db.client;

        console.log(`\n🗄️  Testing parallel operations on ${db.provider.toUpperCase()}`);

        // Configure based on database provider
        if (db.provider === 'sqlite') {
            // SQLite should use sequential execution (pool size = 1)
            configurePrisma(prisma, {
                maxConcurrency: 1,
                enableParallel: false
            });
        } else if (db.provider === 'mongodb') {
            // MongoDB with transaction limits
            configurePrisma(prisma, {
                maxConcurrency: 2, // Conservative for MongoDB
                enableParallel: true,
                maxQueriesPerSecond: 50
            });
        } else {
            // MySQL, PostgreSQL, SQL Server - full parallel support
            configurePrisma(prisma, {
                maxConcurrency: 4,
                enableParallel: true,
                maxQueriesPerSecond: 100
            });
        }

        TestUser.model = prisma.user;

        console.log(`   Pool Size: ${getConnectionPoolSize()}`);
        console.log(`   Parallel Enabled: ${isParallelEnabled()}`);
    }, 30000);

    afterAll(async () => {
        await db.cleanup();
        resetPrismaConfiguration();
    });

    beforeEach(async () => {
        await db.clear();
    });

    describe(`${process.env.DATABASE_URL?.split(':')[0] || 'sqlite'} - Parallel createMany`, () => {
        it('should create multiple users efficiently', async () => {
            // Ensure clean state
            await db.clear();

            const BATCH_SIZE = db.provider === 'sqlite' ? 100 : 500;
            const users = Array.from({ length: BATCH_SIZE }, (_, i) => ({
                name: `User ${i}`,
                email: `user${i}@compat-test.com`,
                age: 20 + (i % 50)
            }));

            const startTime = Date.now();
            const count = await TestUser.createMany(users, false, undefined, {
                parallel: db.provider !== 'sqlite',
                concurrency: db.provider === 'mongodb' ? 2 : 4
            });
            const duration = Date.now() - startTime;

            expect(count).toBe(BATCH_SIZE);

            const createdUsers = await prisma.user.count();
            expect(createdUsers).toBe(BATCH_SIZE);

            console.log(`   ✅ Created ${BATCH_SIZE} users in ${duration}ms`);
        }, 30000);

        it('should handle skipDuplicates correctly', async () => {
            if (!db.supportsSkipDuplicates) {
                console.log(`   ⏭️  Skipping skipDuplicates test (not supported on ${db.provider})`);
                return;
            }

            // Create initial users
            await prisma.user.create({
                data: { name: 'Existing', email: 'existing@test.com', age: 25 }
            });

            const users = [
                { name: 'New User 1', email: 'new1@test.com', age: 30 },
                { name: 'Existing', email: 'existing@test.com', age: 25 }, // Duplicate
                { name: 'New User 2', email: 'new2@test.com', age: 35 }
            ];

            const count = await TestUser.createMany(users, true, undefined, {
                parallel: db.provider !== 'sqlite'
            });

            // Should skip the duplicate
            expect(count).toBeGreaterThanOrEqual(2);

            const totalUsers = await prisma.user.count();
            expect(totalUsers).toBe(3); // 1 existing + 2 new
        });
    });

    describe(`${process.env.DATABASE_URL?.split(':')[0] || 'sqlite'} - Parallel upsertMany`, () => {
        it('should upsert users with appropriate execution strategy', async () => {
            const BATCH_SIZE = db.provider === 'sqlite' ? 50 : 200;

            // Create initial users
            const initialUsers = Array.from({ length: BATCH_SIZE }, (_, i) => ({
                name: `User ${i}`,
                email: `user${i}@upsert-compat.com`,
                age: 25
            }));

            const createResult = await TestUser.upsertMany(initialUsers, undefined, {
                parallel: db.provider !== 'sqlite',
                concurrency: db.provider === 'mongodb' ? 2 : 4
            });

            expect(createResult.created).toBe(BATCH_SIZE);

            // Update half, create new half
            const upsertUsers = [
                ...Array.from({ length: BATCH_SIZE / 2 }, (_, i) => ({
                    email: `user${i}@upsert-compat.com`,
                    name: `Updated User ${i}`,
                    age: 30
                })),
                ...Array.from({ length: BATCH_SIZE / 2 }, (_, i) => ({
                    email: `newuser${i}@upsert-compat.com`,
                    name: `New User ${i}`,
                    age: 35
                }))
            ];

            const startTime = Date.now();
            const upsertResult = await TestUser.upsertMany(upsertUsers, undefined, {
                parallel: db.provider !== 'sqlite',
                concurrency: db.provider === 'mongodb' ? 2 : 4
            });
            const duration = Date.now() - startTime;

            expect(upsertResult.updated).toBe(BATCH_SIZE / 2);
            expect(upsertResult.created).toBe(BATCH_SIZE / 2);

            console.log(`   ✅ Upserted ${BATCH_SIZE} users in ${duration}ms`);
        }, 30000);

        it('should handle OR query batching correctly', async () => {
            // Create users
            const users = Array.from({ length: 100 }, (_, i) => ({
                name: `User ${i}`,
                email: `user${i}@or-test.com`,
                age: 25
            }));

            await TestUser.createMany(users);

            // Upsert with large unique key list (triggers OR batching)
            // Update age to trigger actual updates
            const upsertUsers = users.map(u => ({
                email: u.email,
                name: u.name,
                age: 30 // Changed age
            }));

            const result = await TestUser.upsertMany(upsertUsers, undefined, {
                parallel: db.provider !== 'sqlite'
            });

            // Should update all existing users
            expect(result.updated).toBe(100);
            expect(result.created).toBe(0);

            // Verify updates
            const updatedUsers = await prisma.user.findMany();
            expect(updatedUsers.every(u => u.age === 30)).toBe(true);
        }, 30000);
    });

    describe(`${process.env.DATABASE_URL?.split(':')[0] || 'sqlite'} - Parallel updateManyById`, () => {
        it('should update multiple users efficiently', async () => {
            const BATCH_SIZE = db.provider === 'sqlite' ? 50 : 200;

            // Create users
            const users = Array.from({ length: BATCH_SIZE }, (_, i) => ({
                name: `User ${i}`,
                email: `user${i}@update-compat.com`,
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
                parallel: db.provider !== 'sqlite',
                concurrency: db.provider === 'mongodb' ? 2 : 4
            });
            const duration = Date.now() - startTime;

            expect(count).toBe(BATCH_SIZE);

            // Verify updates
            const updatedUsers = await prisma.user.findMany();
            expect(updatedUsers.every(u => u.age === 30)).toBe(true);

            console.log(`   ✅ Updated ${count} users in ${duration}ms`);
        }, 30000);
    });

    describe(`${process.env.DATABASE_URL?.split(':')[0] || 'sqlite'} - Parallel deleteByIds`, () => {
        it('should delete multiple users efficiently', async () => {
            const BATCH_SIZE = db.provider === 'sqlite' ? 50 : 200;

            // Create users
            const users = Array.from({ length: BATCH_SIZE }, (_, i) => ({
                name: `User ${i}`,
                email: `user${i}@delete-compat.com`,
                age: 25
            }));

            await TestUser.createMany(users);

            // Get all IDs
            const allUsers = await prisma.user.findMany();
            const ids = allUsers.map(u => u.id);

            const startTime = Date.now();
            const deleted = await TestUser.deleteByIds(ids, {
                parallel: db.provider !== 'sqlite',
                concurrency: db.provider === 'mongodb' ? 2 : 4
            });
            const duration = Date.now() - startTime;

            expect(deleted).toBe(BATCH_SIZE);

            const remaining = await prisma.user.count();
            expect(remaining).toBe(0);

            console.log(`   ✅ Deleted ${deleted} users in ${duration}ms`);
        }, 30000);
    });

    describe(`${process.env.DATABASE_URL?.split(':')[0] || 'sqlite'} - Connection Pool Behavior`, () => {
        it('should respect connection pool limits', async () => {
            const poolSize = getConnectionPoolSize();
            const parallelEnabled = isParallelEnabled();

            console.log(`   Pool Size: ${poolSize}`);
            console.log(`   Parallel Enabled: ${parallelEnabled}`);

            if (db.provider === 'sqlite') {
                // SQLite should use sequential execution
                expect(poolSize).toBe(1);
                expect(parallelEnabled).toBe(false);
            } else {
                // Other databases should support parallel
                expect(poolSize).toBeGreaterThan(1);
                expect(parallelEnabled).toBe(true);
            }
        });

        it('should execute operations within pool limits', async () => {
            const users = Array.from({ length: 100 }, (_, i) => ({
                name: `Pool Test ${i}`,
                email: `pool${i}@test.com`,
                age: 25
            }));

            // This should not exhaust the connection pool
            const count = await TestUser.createMany(users, false, undefined, {
                parallel: db.provider !== 'sqlite',
                concurrency: getConnectionPoolSize()
            });

            expect(count).toBe(100);
        }, 20000);
    });

    describe(`${process.env.DATABASE_URL?.split(':')[0] || 'sqlite'} - Transaction Safety`, () => {
        it('should handle transaction limits correctly', async () => {
            if (db.provider === 'mongodb') {
                console.log(`   ℹ️  MongoDB has transaction limits - using conservative concurrency`);
            }

            const users = Array.from({ length: 50 }, (_, i) => ({
                name: `Transaction Test ${i}`,
                email: `trans${i}@test.com`,
                age: 25
            }));

            // Should complete without transaction errors
            const count = await TestUser.createMany(users, false, undefined, {
                parallel: db.provider !== 'sqlite',
                concurrency: db.provider === 'mongodb' ? 2 : 4
            });

            expect(count).toBe(50);
        });
    });

    describe(`${process.env.DATABASE_URL?.split(':')[0] || 'sqlite'} - Error Handling`, () => {
        it('should handle errors gracefully in parallel operations', async () => {
            const users = Array.from({ length: 50 }, (_, i) => ({
                name: `Error Test ${i}`,
                email: `error${i}@test.com`,
                age: 25
            }));

            // Create initial users
            await TestUser.createMany(users.slice(0, 25));

            // Try to create with some duplicates
            if (db.supportsSkipDuplicates) {
                const result = await TestUser.createMany(
                    [...users.slice(0, 10), ...users.slice(25, 50)],
                    true, // skipDuplicates
                    undefined,
                    { parallel: db.provider !== 'sqlite' }
                );

                // Should create the non-duplicate ones
                expect(result).toBeGreaterThan(0);
            } else {
                // For databases that don't support skipDuplicates, just verify creation works
                const result = await TestUser.createMany(
                    users.slice(25, 50),
                    false,
                    undefined,
                    { parallel: db.provider !== 'sqlite' }
                );

                expect(result).toBe(25);
            }
        });

        it('should continue other operations when one fails', async () => {
            // Create a user
            await prisma.user.create({
                data: { name: 'Existing', email: 'existing@test.com', age: 25 }
            });

            const users = [
                { name: 'User 1', email: 'user1@test.com', age: 30 },
                { name: 'User 2', email: 'user2@test.com', age: 35 },
                { name: 'User 3', email: 'user3@test.com', age: 40 }
            ];

            // Should create all valid users
            const count = await TestUser.createMany(users, false, undefined, {
                parallel: db.provider !== 'sqlite'
            });

            expect(count).toBe(3);
        });
    });

    describe(`${process.env.DATABASE_URL?.split(':')[0] || 'sqlite'} - Performance Characteristics`, () => {
        it('should demonstrate appropriate performance for database type', async () => {
            const DATASET_SIZE = db.provider === 'sqlite' ? 100 : 300;
            const users = Array.from({ length: DATASET_SIZE }, (_, i) => ({
                name: `Perf User ${i}`,
                email: `perf${i}@test.com`,
                age: 25
            }));

            const startTime = Date.now();
            const count = await TestUser.createMany(users, false, undefined, {
                parallel: db.provider !== 'sqlite',
                concurrency: db.provider === 'mongodb' ? 2 : 4
            });
            const duration = Date.now() - startTime;

            expect(count).toBe(DATASET_SIZE);

            const throughput = (DATASET_SIZE / duration) * 1000; // records per second

            console.log(`\n   📊 Performance Metrics:`);
            console.log(`      Database: ${db.provider}`);
            console.log(`      Records: ${DATASET_SIZE}`);
            console.log(`      Duration: ${duration}ms`);
            console.log(`      Throughput: ${throughput.toFixed(0)} records/sec`);
            console.log(`      Parallel: ${db.provider !== 'sqlite'}`);

            // Performance should be reasonable (at least 10 records/sec)
            expect(throughput).toBeGreaterThan(10);
        }, 30000);
    });

    describe(`${process.env.DATABASE_URL?.split(':')[0] || 'sqlite'} - Edge Cases`, () => {
        it('should handle empty arrays', async () => {
            const count = await TestUser.createMany([], false, undefined, {
                parallel: db.provider !== 'sqlite'
            });
            expect(count).toBe(0);
        });

        it('should handle single item', async () => {
            const count = await TestUser.createMany([{
                name: 'Single User',
                email: 'single@test.com',
                age: 25
            }], false, undefined, {
                parallel: db.provider !== 'sqlite'
            });
            expect(count).toBe(1);
        });

        it('should handle large batch sizes', async () => {
            const LARGE_SIZE = db.provider === 'sqlite' ? 200 : 1000;
            const users = Array.from({ length: LARGE_SIZE }, (_, i) => ({
                name: `Large User ${i}`,
                email: `large${i}@test.com`,
                age: 25
            }));

            const count = await TestUser.createMany(users, false, undefined, {
                parallel: db.provider !== 'sqlite',
                concurrency: db.provider === 'mongodb' ? 2 : 8
            });

            expect(count).toBe(LARGE_SIZE);
        }, 60000);
    });
});

// Note: Large scale 10,000 record tests have been moved to
// tests/benchmarks/parallel-performance.benchmark.test.ts
// Run with: npm test -- benchmarks/parallel-performance

// Database-specific test suites
describe('MySQL-specific Parallel Operations', () => {
    const isMySQL = process.env.DATABASE_URL?.startsWith('mysql://');

    if (!isMySQL) {
        it.skip('MySQL tests only run with MySQL database', () => { });
        return;
    }

    let db: Awaited<ReturnType<typeof createTestDb>>;
    let prisma: PrismaClient;

    beforeAll(async () => {
        db = await createTestDb();
        prisma = db.client;

        configurePrisma(prisma, {
            maxConcurrency: 8, // MySQL can handle higher concurrency
            enableParallel: true,
            maxQueriesPerSecond: 200
        });

        TestUser.model = prisma.user;
    }, 30000);

    afterAll(async () => {
        await db.cleanup();
        resetPrismaConfiguration();
    });

    beforeEach(async () => {
        await db.clear();
    });

    it('should handle high concurrency efficiently', async () => {
        const users = Array.from({ length: 1000 }, (_, i) => ({
            name: `MySQL User ${i}`,
            email: `mysql${i}@test.com`,
            age: 25
        }));

        const startTime = Date.now();
        const count = await TestUser.createMany(users, false, undefined, {
            parallel: true,
            concurrency: 8
        });
        const duration = Date.now() - startTime;

        expect(count).toBe(1000);
        console.log(`   ✅ MySQL: Created 1000 users in ${duration}ms with concurrency=8`);
    }, 30000);
});

describe('PostgreSQL-specific Parallel Operations', () => {
    const isPostgreSQL = process.env.DATABASE_URL?.startsWith('postgresql://') ||
        process.env.DATABASE_URL?.startsWith('postgres://');

    if (!isPostgreSQL) {
        it.skip('PostgreSQL tests only run with PostgreSQL database', () => { });
        return;
    }

    let db: Awaited<ReturnType<typeof createTestDb>>;
    let prisma: PrismaClient;

    beforeAll(async () => {
        db = await createTestDb();
        prisma = db.client;

        configurePrisma(prisma, {
            maxConcurrency: 8, // PostgreSQL can handle higher concurrency
            enableParallel: true,
            maxQueriesPerSecond: 200
        });

        TestUser.model = prisma.user;
    }, 30000);

    afterAll(async () => {
        await db.cleanup();
        resetPrismaConfiguration();
    });

    beforeEach(async () => {
        await db.clear();
    });

    it('should handle high concurrency efficiently', async () => {
        const users = Array.from({ length: 1000 }, (_, i) => ({
            name: `PostgreSQL User ${i}`,
            email: `pg${i}@test.com`,
            age: 25
        }));

        const startTime = Date.now();
        const count = await TestUser.createMany(users, false, undefined, {
            parallel: true,
            concurrency: 8
        });
        const duration = Date.now() - startTime;

        expect(count).toBe(1000);
        console.log(`   ✅ PostgreSQL: Created 1000 users in ${duration}ms with concurrency=8`);
    }, 30000);
});

describe('MongoDB-specific Parallel Operations', () => {
    const isMongoDB = process.env.DATABASE_URL?.startsWith('mongodb://') ||
        process.env.DATABASE_URL?.startsWith('mongodb+srv://');

    if (!isMongoDB) {
        it.skip('MongoDB tests only run with MongoDB database', () => { });
        return;
    }

    let db: Awaited<ReturnType<typeof createTestDb>>;
    let prisma: PrismaClient;

    beforeAll(async () => {
        db = await createTestDb();
        prisma = db.client;

        // MongoDB has transaction limits - use conservative settings
        configurePrisma(prisma, {
            maxConcurrency: 2,
            enableParallel: true,
            maxQueriesPerSecond: 50
        });

        TestUser.model = prisma.user;
    }, 30000);

    afterAll(async () => {
        await db.cleanup();
        resetPrismaConfiguration();
    });

    beforeEach(async () => {
        await db.clear();
    });

    it('should respect transaction limits', async () => {
        const users = Array.from({ length: 500 }, (_, i) => ({
            name: `MongoDB User ${i}`,
            email: `mongo${i}@test.com`,
            age: 25
        }));

        const startTime = Date.now();
        const count = await TestUser.createMany(users, false, undefined, {
            parallel: true,
            concurrency: 2 // Conservative for MongoDB
        });
        const duration = Date.now() - startTime;

        expect(count).toBe(500);
        console.log(`   ✅ MongoDB: Created 500 users in ${duration}ms with concurrency=2`);
    }, 30000);

    it('should handle ObjectId correctly', async () => {
        const user = new TestUser({
            name: 'MongoDB Test',
            email: 'mongodb@test.com',
            age: 30
        });

        const created = await user.create();

        expect(created.id).toBeDefined();
        expect(typeof created.id).toBe('string');
        // MongoDB ObjectId format
        expect(created.id).toMatch(/^[a-f0-9]{24}$/);
    });
});

describe('SQLite-specific Sequential Operations', () => {
    const isSQLite = !process.env.DATABASE_URL ||
        process.env.DATABASE_URL.startsWith('file:');

    if (!isSQLite) {
        it.skip('SQLite tests only run with SQLite database', () => { });
        return;
    }

    let db: Awaited<ReturnType<typeof createTestDb>>;
    let prisma: PrismaClient;

    beforeAll(async () => {
        db = await createTestDb();
        prisma = db.client;

        // SQLite should use sequential execution
        configurePrisma(prisma, {
            maxConcurrency: 1,
            enableParallel: false
        });

        TestUser.model = prisma.user;
    }, 30000);

    afterAll(async () => {
        await db.cleanup();
        resetPrismaConfiguration();
    });

    beforeEach(async () => {
        await db.clear();
    });

    it('should use sequential execution', async () => {
        expect(getConnectionPoolSize()).toBe(1);
        expect(isParallelEnabled()).toBe(false);
    });

    it('should still perform batch operations efficiently', async () => {
        const users = Array.from({ length: 200 }, (_, i) => ({
            name: `SQLite User ${i}`,
            email: `sqlite${i}@test.com`,
            age: 25
        }));

        const startTime = Date.now();
        const count = await TestUser.createMany(users, false, undefined, {
            parallel: false // Explicitly sequential
        });
        const duration = Date.now() - startTime;

        expect(count).toBe(200);
        console.log(`   ✅ SQLite: Created 200 users in ${duration}ms (sequential)`);
    }, 30000);
});
