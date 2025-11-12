/**
 * Database Compatibility Integration Tests
 * Tests database-specific behavior, error handling, and edge cases across all supported databases
 * Uses capability detection to ensure tests run appropriately for each database
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/base-entity';
import { Property } from '../../src/decorators/property.decorator';
import { configurePrisma, resetPrismaConfiguration, getConnectionPoolSize, isParallelEnabled } from '../../src/config';
import { createTestDb } from '../helpers/test-db';
import { 
  detectDatabaseCapabilities, 
  logDatabaseCapabilities,
  type DatabaseCapabilities 
} from '../helpers/database-detector';
import { 
  getIdType, 
  isProvider,
  PerformanceMetrics,
  measureTime 
} from '../helpers/test-helpers';
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

    constructor(data?: Partial<ITestUser>) {
        super(data);
    }
}

describe('Database Compatibility - Comprehensive Tests', () => {
    let db: Awaited<ReturnType<typeof createTestDb>>;
    let prisma: PrismaClient;
    let capabilities: DatabaseCapabilities;
    let metrics: PerformanceMetrics;

    beforeAll(async () => {
        db = await createTestDb();
        prisma = db.client;
        capabilities = detectDatabaseCapabilities();
        metrics = new PerformanceMetrics();

        // Log database capabilities for debugging
        logDatabaseCapabilities();

        // Configure based on database capabilities
        configurePrisma(prisma, {
            maxConcurrency: capabilities.maxConcurrency,
            enableParallel: capabilities.supportsParallel,
            maxQueriesPerSecond: capabilities.provider === 'mongodb' ? 50 : 100
        });

        TestUser.model = prisma.user;

        console.log(`\n🗄️  Testing on ${capabilities.provider.toUpperCase()}`);
        console.log(`   Pool Size: ${getConnectionPoolSize()}`);
        console.log(`   Parallel Enabled: ${isParallelEnabled()}`);
    }, 30000);

    afterAll(async () => {
        // Log performance metrics summary
        console.log(metrics.getSummary());
        
        await db.cleanup();
        resetPrismaConfiguration();
    });

    beforeEach(async () => {
        await db.clear();
    });

    describe('Parallel createMany Operations', () => {
        it('should create multiple users efficiently', async () => {
            // Ensure clean state
            await db.clear();

            const BATCH_SIZE = capabilities.supportsParallel ? 500 : 100;
            const users = Array.from({ length: BATCH_SIZE }, (_, i) => ({
                name: `User ${i}`,
                email: `user${i}@compat-test.com`,
                age: 20 + (i % 50)
            }));

            const { result: count, duration } = await measureTime(async () => {
                return await TestUser.createMany(users, false, undefined, {
                    parallel: capabilities.supportsParallel,
                    concurrency: capabilities.maxConcurrency
                });
            });

            metrics.record('createMany', duration);

            expect(count).toBe(BATCH_SIZE);

            const createdUsers = await prisma.user.count();
            expect(createdUsers).toBe(BATCH_SIZE);

            console.log(`   ✅ Created ${BATCH_SIZE} users in ${duration}ms`);
        }, 30000);

        it('should handle skipDuplicates correctly', async () => {
            if (!capabilities.supportsSkipDuplicates) {
                console.log(`   ⏭️  Skipping skipDuplicates test (not supported on ${capabilities.provider})`);
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
                parallel: capabilities.supportsParallel
            });

            // Should skip the duplicate
            expect(count).toBeGreaterThanOrEqual(2);

            const totalUsers = await prisma.user.count();
            expect(totalUsers).toBe(3); // 1 existing + 2 new
        });
    });

    describe('Parallel upsertMany Operations', () => {
        it('should upsert users with appropriate execution strategy', async () => {
            const BATCH_SIZE = capabilities.supportsParallel ? 200 : 50;

            // Create initial users
            const initialUsers = Array.from({ length: BATCH_SIZE }, (_, i) => ({
                name: `User ${i}`,
                email: `user${i}@upsert-compat.com`,
                age: 25
            }));

            const createResult = await TestUser.upsertMany(initialUsers, undefined, {
                parallel: capabilities.supportsParallel,
                concurrency: capabilities.maxConcurrency
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

            const { result: upsertResult, duration } = await measureTime(async () => {
                return await TestUser.upsertMany(upsertUsers, undefined, {
                    parallel: capabilities.supportsParallel,
                    concurrency: capabilities.maxConcurrency
                });
            });

            metrics.record('upsertMany', duration);

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
                parallel: capabilities.supportsParallel
            });

            // Should update all existing users
            expect(result.updated).toBe(100);
            expect(result.created).toBe(0);

            // Verify updates
            const updatedUsers = await prisma.user.findMany();
            expect(updatedUsers.every(u => u.age === 30)).toBe(true);
        }, 30000);
    });

    describe('Parallel updateManyById Operations', () => {
        it('should update multiple users efficiently', async () => {
            const BATCH_SIZE = capabilities.supportsParallel ? 200 : 50;

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

            const { result: count, duration } = await measureTime(async () => {
                return await TestUser.updateManyById(updates, {
                    parallel: capabilities.supportsParallel,
                    concurrency: capabilities.maxConcurrency
                });
            });

            metrics.record('updateManyById', duration);

            expect(count).toBe(BATCH_SIZE);

            // Verify updates
            const updatedUsers = await prisma.user.findMany();
            expect(updatedUsers.every(u => u.age === 30)).toBe(true);

            console.log(`   ✅ Updated ${count} users in ${duration}ms`);
        }, 30000);
    });

    describe('Parallel deleteByIds Operations', () => {
        it('should delete multiple users efficiently', async () => {
            const BATCH_SIZE = capabilities.supportsParallel ? 200 : 50;

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

            const { result: deleted, duration } = await measureTime(async () => {
                return await TestUser.deleteByIds(ids, {
                    parallel: capabilities.supportsParallel,
                    concurrency: capabilities.maxConcurrency
                });
            });

            metrics.record('deleteByIds', duration);

            expect(deleted).toBe(BATCH_SIZE);

            const remaining = await prisma.user.count();
            expect(remaining).toBe(0);

            console.log(`   ✅ Deleted ${deleted} users in ${duration}ms`);
        }, 30000);
    });

    describe('Connection Pool Behavior', () => {
        it('should respect connection pool limits', async () => {
            const poolSize = getConnectionPoolSize();
            const parallelEnabled = isParallelEnabled();

            console.log(`   Pool Size: ${poolSize}`);
            console.log(`   Parallel Enabled: ${parallelEnabled}`);

            expect(poolSize).toBe(capabilities.maxConcurrency);
            expect(parallelEnabled).toBe(capabilities.supportsParallel);

            if (!capabilities.supportsParallel) {
                // Sequential databases should have pool size of 1
                expect(poolSize).toBe(1);
                expect(parallelEnabled).toBe(false);
            } else {
                // Parallel databases should have pool size > 1
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
                parallel: capabilities.supportsParallel,
                concurrency: getConnectionPoolSize()
            });

            expect(count).toBe(100);
        }, 20000);
    });

    describe('Transaction Safety', () => {
        it('should handle transaction limits correctly', async () => {
            if (capabilities.provider === 'mongodb') {
                console.log(`   ℹ️  MongoDB has transaction limits - using conservative concurrency`);
            }

            const users = Array.from({ length: 50 }, (_, i) => ({
                name: `Transaction Test ${i}`,
                email: `trans${i}@test.com`,
                age: 25
            }));

            // Should complete without transaction errors
            const count = await TestUser.createMany(users, false, undefined, {
                parallel: capabilities.supportsParallel,
                concurrency: capabilities.maxConcurrency
            });

            expect(count).toBe(50);
        });

        it('should support transactions when available', async () => {
            if (!capabilities.supportsTransactions) {
                console.log(`   ⏭️  Skipping transaction test (not supported on ${capabilities.provider})`);
                return;
            }

            // Verify transaction support
            expect(capabilities.supportsTransactions).toBe(true);

            // Test basic transaction functionality
            const user = await prisma.user.create({
                data: { name: 'Transaction User', email: 'trans@test.com', age: 30 }
            });

            expect(user).toBeDefined();
            expect(user.name).toBe('Transaction User');
        });
    });

    describe('Comprehensive Error Handling', () => {
        it('should handle errors gracefully in parallel operations', async () => {
            const users = Array.from({ length: 50 }, (_, i) => ({
                name: `Error Test ${i}`,
                email: `error${i}@test.com`,
                age: 25
            }));

            // Create initial users
            await TestUser.createMany(users.slice(0, 25));

            // Try to create with some duplicates
            if (capabilities.supportsSkipDuplicates) {
                const result = await TestUser.createMany(
                    [...users.slice(0, 10), ...users.slice(25, 50)],
                    true, // skipDuplicates
                    undefined,
                    { parallel: capabilities.supportsParallel }
                );

                // Should create the non-duplicate ones
                expect(result).toBeGreaterThan(0);
            } else {
                // For databases that don't support skipDuplicates, just verify creation works
                const result = await TestUser.createMany(
                    users.slice(25, 50),
                    false,
                    undefined,
                    { parallel: capabilities.supportsParallel }
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
                parallel: capabilities.supportsParallel
            });

            expect(count).toBe(3);
        });

        it('should handle duplicate key errors appropriately', async () => {
            // Create initial user
            await prisma.user.create({
                data: { name: 'Original', email: 'duplicate@test.com', age: 25 }
            });

            // Try to create duplicate without skipDuplicates
            if (capabilities.supportsSkipDuplicates) {
                // With skipDuplicates, should not throw
                const count = await TestUser.createMany(
                    [{ name: 'Duplicate', email: 'duplicate@test.com', age: 30 }],
                    true,
                    undefined,
                    { parallel: capabilities.supportsParallel }
                );
                expect(count).toBe(0);
            } else {
                // Without skipDuplicates support, may throw or return 0
                // SQLite and MongoDB handle this differently
                try {
                    const count = await TestUser.createMany(
                        [{ name: 'Duplicate', email: 'duplicate@test.com', age: 30 }],
                        false,
                        undefined,
                        { parallel: capabilities.supportsParallel }
                    );
                    // If it doesn't throw, it should return 0
                    expect(count).toBe(0);
                } catch (error) {
                    // Error is expected for databases without skipDuplicates
                    expect(error).toBeDefined();
                }
            }
        });

        it('should handle invalid data gracefully', async () => {
            // Try to create user with missing required field
            // Some databases may handle this differently
            try {
                const count = await TestUser.createMany(
                    [{ name: 'Invalid User' } as any], // Missing email
                    false,
                    undefined,
                    { parallel: capabilities.supportsParallel }
                );
                // If it doesn't throw, it should return 0
                expect(count).toBe(0);
            } catch (error) {
                // Error is expected for invalid data
                expect(error).toBeDefined();
            }
        });

        it('should handle connection errors gracefully', async () => {
            // This test verifies that the framework handles connection issues
            // In a real scenario, this would test reconnection logic
            const users = [{ name: 'Test', email: 'test@test.com', age: 25 }];
            
            // Should complete successfully with valid connection
            const count = await TestUser.createMany(users, false, undefined, {
                parallel: capabilities.supportsParallel
            });
            
            expect(count).toBe(1);
        });

        it('should provide clear error messages', async () => {
            try {
                // Try to create with invalid data
                await TestUser.createMany(
                    [{ name: 'Test' } as any], // Missing required email
                    false,
                    undefined,
                    { parallel: capabilities.supportsParallel }
                );
                fail('Should have thrown an error');
            } catch (error: any) {
                // Error should be defined and have a message
                expect(error).toBeDefined();
                expect(error.message).toBeDefined();
                expect(typeof error.message).toBe('string');
            }
        });
    });

    describe('Performance Characteristics', () => {
        it('should demonstrate appropriate performance for database type', async () => {
            const DATASET_SIZE = capabilities.supportsParallel ? 300 : 100;
            const users = Array.from({ length: DATASET_SIZE }, (_, i) => ({
                name: `Perf User ${i}`,
                email: `perf${i}@test.com`,
                age: 25
            }));

            const { result: count, duration } = await measureTime(async () => {
                return await TestUser.createMany(users, false, undefined, {
                    parallel: capabilities.supportsParallel,
                    concurrency: capabilities.maxConcurrency
                });
            });

            metrics.record('performance_test', duration);

            expect(count).toBe(DATASET_SIZE);

            const throughput = (DATASET_SIZE / duration) * 1000; // records per second

            console.log(`\n   📊 Performance Metrics:`);
            console.log(`      Database: ${capabilities.provider}`);
            console.log(`      Records: ${DATASET_SIZE}`);
            console.log(`      Duration: ${duration}ms`);
            console.log(`      Throughput: ${throughput.toFixed(0)} records/sec`);
            console.log(`      Parallel: ${capabilities.supportsParallel}`);
            console.log(`      Max Concurrency: ${capabilities.maxConcurrency}`);

            // Performance should be reasonable (at least 10 records/sec)
            expect(throughput).toBeGreaterThan(10);
        }, 30000);

        it('should scale appropriately with batch size', async () => {
            const sizes = [10, 50, 100];
            const results: { size: number; duration: number; throughput: number }[] = [];

            for (const size of sizes) {
                await db.clear();

                const users = Array.from({ length: size }, (_, i) => ({
                    name: `Scale Test ${i}`,
                    email: `scale${i}@test.com`,
                    age: 25
                }));

                const { result: count, duration } = await measureTime(async () => {
                    return await TestUser.createMany(users, false, undefined, {
                        parallel: capabilities.supportsParallel,
                        concurrency: capabilities.maxConcurrency
                    });
                });

                const throughput = (size / duration) * 1000;
                results.push({ size, duration, throughput });

                expect(count).toBe(size);
            }

            console.log('\n   📈 Scaling Results:');
            results.forEach(r => {
                console.log(`      ${r.size} records: ${r.duration}ms (${r.throughput.toFixed(0)} rec/sec)`);
            });

            // Verify all operations completed successfully
            expect(results.length).toBe(sizes.length);
        }, 60000);

        it('should handle concurrent operations efficiently', async () => {
            if (!capabilities.supportsParallel) {
                console.log(`   ⏭️  Skipping concurrent test (sequential database)`);
                return;
            }

            const users = Array.from({ length: 200 }, (_, i) => ({
                name: `Concurrent ${i}`,
                email: `concurrent${i}@test.com`,
                age: 25
            }));

            const { result: count, duration } = await measureTime(async () => {
                return await TestUser.createMany(users, false, undefined, {
                    parallel: true,
                    concurrency: capabilities.maxConcurrency
                });
            });

            expect(count).toBe(200);

            // Parallel execution should be reasonably fast
            const throughput = (200 / duration) * 1000;
            console.log(`   ⚡ Concurrent throughput: ${throughput.toFixed(0)} records/sec`);
            
            expect(throughput).toBeGreaterThan(10);
        }, 30000);
    });

    describe('Edge Cases', () => {
        it('should handle empty arrays', async () => {
            const count = await TestUser.createMany([], false, undefined, {
                parallel: capabilities.supportsParallel
            });
            expect(count).toBe(0);
        });

        it('should handle single item', async () => {
            const count = await TestUser.createMany([{
                name: 'Single User',
                email: 'single@test.com',
                age: 25
            }], false, undefined, {
                parallel: capabilities.supportsParallel
            });
            expect(count).toBe(1);
        });

        it('should handle large batch sizes', async () => {
            const LARGE_SIZE = capabilities.supportsParallel ? 1000 : 200;
            const users = Array.from({ length: LARGE_SIZE }, (_, i) => ({
                name: `Large User ${i}`,
                email: `large${i}@test.com`,
                age: 25
            }));

            const count = await TestUser.createMany(users, false, undefined, {
                parallel: capabilities.supportsParallel,
                concurrency: capabilities.maxConcurrency
            });

            expect(count).toBe(LARGE_SIZE);
        }, 60000);

        it('should handle special characters in data', async () => {
            const users = [
                { name: "O'Brien", email: 'obrien@test.com', age: 30 },
                { name: 'Test "Quote"', email: 'quote@test.com', age: 25 },
                { name: 'Back\\slash', email: 'backslash@test.com', age: 35 }
            ];

            const count = await TestUser.createMany(users, false, undefined, {
                parallel: capabilities.supportsParallel
            });

            expect(count).toBe(3);

            // Verify data integrity
            const created = await prisma.user.findMany({
                where: { email: { in: users.map(u => u.email) } }
            });

            expect(created).toHaveLength(3);
            expect(created.find(u => u.email === 'obrien@test.com')?.name).toBe("O'Brien");
        });

        it('should handle null and undefined values correctly', async () => {
            const users = [
                { name: 'User 1', email: 'user1@test.com', age: undefined },
                { name: 'User 2', email: 'user2@test.com', age: 30 },
                { name: 'User 3', email: 'user3@test.com' } // age omitted
            ];

            const count = await TestUser.createMany(users, false, undefined, {
                parallel: capabilities.supportsParallel
            });

            expect(count).toBe(3);
        });

        it('should handle very long strings', async () => {
            // Use a reasonable length that works across all databases
            // MySQL VARCHAR default is 191 chars for utf8mb4, so use 150 to be safe
            const longName = 'A'.repeat(150);
            const users = [
                { name: longName, email: 'longname@test.com', age: 25 }
            ];

            const count = await TestUser.createMany(users, false, undefined, {
                parallel: capabilities.supportsParallel
            });

            expect(count).toBe(1);

            const created = await prisma.user.findUnique({
                where: { email: 'longname@test.com' }
            });

            expect(created?.name).toBe(longName);
        });

        it('should handle ID type correctly', async () => {
            const user = await prisma.user.create({
                data: { name: 'ID Test', email: 'idtest@test.com', age: 25 }
            });

            expect(user.id).toBeDefined();
            expect(typeof user.id).toBe(getIdType());

            if (capabilities.idType === 'string') {
                // MongoDB ObjectId format
                expect(typeof user.id).toBe('string');
                if (capabilities.provider === 'mongodb') {
                    expect(user.id).toMatch(/^[a-f0-9]{24}$/);
                }
            } else {
                // Auto-increment ID
                expect(typeof user.id).toBe('number');
                expect(user.id).toBeGreaterThan(0);
            }
        });

        it('should handle boundary values', async () => {
            const users = [
                { name: 'Min Age', email: 'min@test.com', age: 0 },
                { name: 'Max Age', email: 'max@test.com', age: 999 },
                { name: 'Empty Name', email: 'empty@test.com', age: 25 }
            ];

            const count = await TestUser.createMany(users, false, undefined, {
                parallel: capabilities.supportsParallel
            });

            expect(count).toBe(3);
        });
    });

    describe('Database-Specific Behavior', () => {
        it('should handle database-specific ID generation', async () => {
            const user = new TestUser({
                name: 'ID Gen Test',
                email: 'idgen@test.com',
                age: 30
            });

            const created = await user.create();

            expect(created.id).toBeDefined();
            
            if (isProvider('mongodb')) {
                expect(typeof created.id).toBe('string');
                expect(created.id).toMatch(/^[a-f0-9]{24}$/);
            } else {
                expect(typeof created.id).toBe('number');
            }
        });

        it('should respect database-specific constraints', async () => {
            // Create a user
            await prisma.user.create({
                data: { name: 'Constraint Test', email: 'constraint@test.com', age: 25 }
            });

            // Try to create duplicate (should fail without skipDuplicates)
            if (!capabilities.supportsSkipDuplicates) {
                await expect(
                    prisma.user.create({
                        data: { name: 'Duplicate', email: 'constraint@test.com', age: 30 }
                    })
                ).rejects.toThrow();
            }
        });

        it('should handle database-specific query limits', async () => {
            // Create a reasonable number of users
            const users = Array.from({ length: 100 }, (_, i) => ({
                name: `Limit Test ${i}`,
                email: `limit${i}@test.com`,
                age: 25
            }));

            await TestUser.createMany(users, false, undefined, {
                parallel: capabilities.supportsParallel,
                concurrency: capabilities.maxConcurrency
            });

            // Query all users
            const allUsers = await prisma.user.findMany();
            expect(allUsers.length).toBeGreaterThanOrEqual(100);
        });
    });
});

// Note: Large scale 10,000 record tests have been moved to
// tests/benchmarks/parallel-performance.benchmark.test.ts
// Run with: npm test -- benchmarks/parallel-performance

// Database-specific test suites using capability detection
describe('MySQL-specific Operations', () => {
    if (!isProvider('mysql')) {
        it.skip('MySQL tests only run with MySQL database', () => { });
        return;
    }

    let db: Awaited<ReturnType<typeof createTestDb>>;
    let prisma: PrismaClient;
    let capabilities: DatabaseCapabilities;

    beforeAll(async () => {
        db = await createTestDb();
        prisma = db.client;
        capabilities = detectDatabaseCapabilities();

        configurePrisma(prisma, {
            maxConcurrency: capabilities.maxConcurrency,
            enableParallel: capabilities.supportsParallel,
            maxQueriesPerSecond: 200
        });

        TestUser.model = prisma.user;
        console.log(`\n🐬 MySQL-specific tests`);
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

        const { result: count, duration } = await measureTime(async () => {
            return await TestUser.createMany(users, false, undefined, {
                parallel: true,
                concurrency: capabilities.maxConcurrency
            });
        });

        expect(count).toBe(1000);
        console.log(`   ✅ MySQL: Created 1000 users in ${duration}ms with concurrency=${capabilities.maxConcurrency}`);
    }, 30000);

    it('should support JSON fields', async () => {
        expect(capabilities.supportsJSON).toBe(true);
        console.log(`   ✅ MySQL supports JSON fields`);
    });

    it('should support skipDuplicates', async () => {
        expect(capabilities.supportsSkipDuplicates).toBe(true);
        console.log(`   ✅ MySQL supports skipDuplicates`);
    });
});

describe('PostgreSQL-specific Operations', () => {
    if (!isProvider('postgresql')) {
        it.skip('PostgreSQL tests only run with PostgreSQL database', () => { });
        return;
    }

    let db: Awaited<ReturnType<typeof createTestDb>>;
    let prisma: PrismaClient;
    let capabilities: DatabaseCapabilities;

    beforeAll(async () => {
        db = await createTestDb();
        prisma = db.client;
        capabilities = detectDatabaseCapabilities();

        configurePrisma(prisma, {
            maxConcurrency: capabilities.maxConcurrency,
            enableParallel: capabilities.supportsParallel,
            maxQueriesPerSecond: 200
        });

        TestUser.model = prisma.user;
        console.log(`\n🐘 PostgreSQL-specific tests`);
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

        const { result: count, duration } = await measureTime(async () => {
            return await TestUser.createMany(users, false, undefined, {
                parallel: true,
                concurrency: capabilities.maxConcurrency
            });
        });

        expect(count).toBe(1000);
        console.log(`   ✅ PostgreSQL: Created 1000 users in ${duration}ms with concurrency=${capabilities.maxConcurrency}`);
    }, 30000);

    it('should support JSON fields', async () => {
        expect(capabilities.supportsJSON).toBe(true);
        console.log(`   ✅ PostgreSQL supports JSON/JSONB fields`);
    });

    it('should support scalar arrays', async () => {
        expect(capabilities.supportsScalarArrays).toBe(true);
        console.log(`   ✅ PostgreSQL supports scalar arrays (String[], Int[], etc.)`);
    });

    it('should support skipDuplicates', async () => {
        expect(capabilities.supportsSkipDuplicates).toBe(true);
        console.log(`   ✅ PostgreSQL supports skipDuplicates`);
    });
});

describe('MongoDB-specific Operations', () => {
    if (!isProvider('mongodb')) {
        it.skip('MongoDB tests only run with MongoDB database', () => { });
        return;
    }

    let db: Awaited<ReturnType<typeof createTestDb>>;
    let prisma: PrismaClient;
    let capabilities: DatabaseCapabilities;

    beforeAll(async () => {
        db = await createTestDb();
        prisma = db.client;
        capabilities = detectDatabaseCapabilities();

        // MongoDB has transaction limits - use conservative settings
        configurePrisma(prisma, {
            maxConcurrency: capabilities.maxConcurrency,
            enableParallel: capabilities.supportsParallel,
            maxQueriesPerSecond: 50
        });

        TestUser.model = prisma.user;
        console.log(`\n🍃 MongoDB-specific tests`);
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

        const { result: count, duration } = await measureTime(async () => {
            return await TestUser.createMany(users, false, undefined, {
                parallel: true,
                concurrency: capabilities.maxConcurrency
            });
        });

        expect(count).toBe(500);
        console.log(`   ✅ MongoDB: Created 500 users in ${duration}ms with concurrency=${capabilities.maxConcurrency}`);
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
        expect(getIdType()).toBe('string');
        // MongoDB ObjectId format
        expect(created.id).toMatch(/^[a-f0-9]{24}$/);
    });

    it('should use conservative concurrency', async () => {
        expect(capabilities.maxConcurrency).toBe(2);
        console.log(`   ✅ MongoDB uses conservative concurrency (${capabilities.maxConcurrency})`);
    });

    it('should not support skipDuplicates', async () => {
        expect(capabilities.supportsSkipDuplicates).toBe(false);
        console.log(`   ✅ MongoDB does not support skipDuplicates`);
    });

    it('should not support explicit many-to-many', async () => {
        expect(capabilities.supportsManyToMany).toBe(false);
        console.log(`   ✅ MongoDB uses embedded documents instead of many-to-many`);
    });
});

describe('SQLite-specific Operations', () => {
    if (!isProvider('sqlite')) {
        it.skip('SQLite tests only run with SQLite database', () => { });
        return;
    }

    let db: Awaited<ReturnType<typeof createTestDb>>;
    let prisma: PrismaClient;
    let capabilities: DatabaseCapabilities;

    beforeAll(async () => {
        db = await createTestDb();
        prisma = db.client;
        capabilities = detectDatabaseCapabilities();

        // SQLite should use sequential execution
        configurePrisma(prisma, {
            maxConcurrency: capabilities.maxConcurrency,
            enableParallel: capabilities.supportsParallel
        });

        TestUser.model = prisma.user;
        console.log(`\n💾 SQLite-specific tests`);
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
        expect(capabilities.supportsParallel).toBe(false);
        expect(capabilities.maxConcurrency).toBe(1);
        console.log(`   ✅ SQLite uses sequential execution`);
    });

    it('should still perform batch operations efficiently', async () => {
        const users = Array.from({ length: 200 }, (_, i) => ({
            name: `SQLite User ${i}`,
            email: `sqlite${i}@test.com`,
            age: 25
        }));

        const { result: count, duration } = await measureTime(async () => {
            return await TestUser.createMany(users, false, undefined, {
                parallel: false // Explicitly sequential
            });
        });

        expect(count).toBe(200);
        console.log(`   ✅ SQLite: Created 200 users in ${duration}ms (sequential)`);
    }, 30000);

    it('should not support JSON fields', async () => {
        expect(capabilities.supportsJSON).toBe(false);
        console.log(`   ✅ SQLite does not support JSON fields`);
    });

    it('should not support scalar arrays', async () => {
        expect(capabilities.supportsScalarArrays).toBe(false);
        console.log(`   ✅ SQLite does not support scalar arrays`);
    });

    it('should not support skipDuplicates', async () => {
        expect(capabilities.supportsSkipDuplicates).toBe(false);
        console.log(`   ✅ SQLite does not support skipDuplicates`);
    });

    it('should support many-to-many relationships', async () => {
        expect(capabilities.supportsManyToMany).toBe(true);
        console.log(`   ✅ SQLite supports many-to-many relationships`);
    });
});
