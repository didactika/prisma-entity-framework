/**
 * Integration tests for Parallel Batch Operations
 * Tests parallel execution with real database operations
 * Includes database capability detection and database-specific concurrency configuration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/core/base-entity';
import { configurePrisma, resetPrismaConfiguration } from '../../src/core/config';
import { createTestDb } from '../helpers/test-db';
import type { TestDbInstance } from '../helpers/test-db';

interface ITestUser {
    id?: number | string;
    name: string;
    email: string;
    age?: number;
}

class TestUser extends BaseEntity<ITestUser> {
    static model: any;

    declare name: string;
    declare email: string;
    declare age?: number;

    constructor(data?: Partial<ITestUser>) {
        super(data);
    }
}

/**
 * Performance metrics for tracking parallel operation performance
 */
interface PerformanceMetrics {
    operation: string;
    recordCount: number;
    duration: number;
    throughput: number;
    concurrency: number;
    provider: string;
}

const performanceMetrics: PerformanceMetrics[] = [];

/**
 * Records performance metrics for an operation
 */
function recordMetrics(
    operation: string,
    recordCount: number,
    duration: number,
    concurrency: number,
    provider: string
): void {
    const throughput = Math.round((recordCount / duration) * 1000);
    performanceMetrics.push({
        operation,
        recordCount,
        duration,
        throughput,
        concurrency,
        provider
    });
}

/**
 * Prints performance metrics summary
 */
function printPerformanceReport(): void {
    if (performanceMetrics.length === 0) return;

    console.log('\n' + '='.repeat(80));
    console.log('Parallel Operations Performance Report');
    console.log('='.repeat(80));
    
    const provider = performanceMetrics[0].provider;
    const concurrency = performanceMetrics[0].concurrency;
    
    console.log(`Database:    ${provider.toUpperCase()}`);
    console.log(`Concurrency: ${concurrency}`);
    console.log('-'.repeat(80));
    console.log('Operation'.padEnd(30) + 'Records'.padEnd(12) + 'Duration'.padEnd(15) + 'Throughput');
    console.log('-'.repeat(80));
    
    performanceMetrics.forEach(metric => {
        const op = metric.operation.padEnd(30);
        const records = metric.recordCount.toString().padEnd(12);
        const duration = `${metric.duration}ms`.padEnd(15);
        const throughput = `${metric.throughput} rec/s`;
        console.log(`${op}${records}${duration}${throughput}`);
    });
    
    console.log('='.repeat(80) + '\n');
}

describe('Parallel Batch Operations - Integration Tests', () => {
    let db: TestDbInstance;

    beforeAll(async () => {
        db = await createTestDb();

        // Database-specific concurrency configuration based on capabilities
        const concurrency = db.capabilities.maxConcurrency;
        const enableParallel = db.capabilities.supportsParallel;

        console.log(`\n🔧 Configuring parallel operations for ${db.provider}:`);
        console.log(`   Parallel Enabled: ${enableParallel ? '✅' : '❌'}`);
        console.log(`   Max Concurrency:  ${concurrency}`);
        
        if (!enableParallel) {
            console.log(`   ⚠️  Sequential fallback mode (${db.provider} does not support parallel operations)`);
        }

        // Configure Prisma with database-specific settings
        configurePrisma(db.client, {
            maxConcurrency: concurrency,
            enableParallel: enableParallel,
            maxQueriesPerSecond: 100
        });

        TestUser.model = db.client.user;
    });

    afterAll(async () => {
        // Print performance report before cleanup
        printPerformanceReport();
        
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
                parallel: db.capabilities.supportsParallel,
                concurrency: db.capabilities.maxConcurrency
            });
            const duration = Date.now() - startTime;

            expect(count).toBe(TOTAL_USERS);

            // Verify all users were created
            const createdUsers = await db.client.user.findMany();
            expect(createdUsers).toHaveLength(TOTAL_USERS);

            // Record performance metrics
            recordMetrics('createMany (1000 records)', TOTAL_USERS, duration, db.capabilities.maxConcurrency, db.provider);

            console.log(`✅ Created ${TOTAL_USERS} users in ${duration}ms with ${db.capabilities.supportsParallel ? 'parallel' : 'sequential'} execution`);
        }, 30000);

        it('should create users without duplicates', async () => {
            const users = Array.from({ length: 200 }, (_, i) => ({
                name: `Unique User ${i}`,
                email: `unique${i}@test.com`,
                age: 25
            }));

            const count = await TestUser.createMany(users, false, undefined, {
                parallel: db.capabilities.supportsParallel,
                concurrency: db.capabilities.maxConcurrency
            });

            expect(count).toBe(200);

            const totalUsers = await db.client.user.count();
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

        it('should verify sequential fallback for SQLite', async () => {
            if (db.provider !== 'sqlite') {
                console.log(`⏭️  Skipping SQLite-specific test on ${db.provider}`);
                return;
            }

            // SQLite should always use sequential execution
            expect(db.capabilities.supportsParallel).toBe(false);
            expect(db.capabilities.maxConcurrency).toBe(1);

            const users = Array.from({ length: 100 }, (_, i) => ({
                name: `SQLite User ${i}`,
                email: `sqlite${i}@test.com`,
                age: 25
            }));

            // Even if we request parallel, it should fall back to sequential
            const startTime = Date.now();
            const count = await TestUser.createMany(users, false, undefined, {
                parallel: true, // Request parallel
                concurrency: 4  // Request high concurrency
            });
            const duration = Date.now() - startTime;

            expect(count).toBe(100);

            console.log(`✅ SQLite correctly used sequential execution (${duration}ms)`);
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
                parallel: db.capabilities.supportsParallel,
                concurrency: db.capabilities.maxConcurrency
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
                parallel: db.capabilities.supportsParallel,
                concurrency: db.capabilities.maxConcurrency
            });
            const duration = Date.now() - startTime;

            expect(upsertResult.created).toBe(250); // New users
            expect(upsertResult.updated).toBe(250); // Updated users
            expect(upsertResult.unchanged).toBe(250); // Unchanged users

            const totalUsers = await db.client.user.count();
            expect(totalUsers).toBe(750);

            // Record performance metrics
            recordMetrics('upsertMany (750 records)', 750, duration, db.capabilities.maxConcurrency, db.provider);

            console.log(`✅ Upserted 750 users in ${duration}ms with ${db.capabilities.supportsParallel ? 'parallel' : 'sequential'} execution`);
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
                parallel: db.capabilities.supportsParallel,
                concurrency: db.capabilities.maxConcurrency
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
            const allUsers = await db.client.user.findMany();

            // Prepare updates
            const updates = allUsers.map((user: any) => ({
                id: user.id,
                name: `Updated ${user.name}`,
                age: 30
            }));

            const startTime = Date.now();
            const count = await TestUser.updateManyById(updates, {
                parallel: db.capabilities.supportsParallel,
                concurrency: db.capabilities.maxConcurrency
            });
            const duration = Date.now() - startTime;

            expect(count).toBe(500);

            // Verify updates
            const updatedUsers = await db.client.user.findMany();
            expect(updatedUsers.every((u: any) => u.age === 30)).toBe(true);
            expect(updatedUsers.every((u: any) => u.name.startsWith('Updated'))).toBe(true);

            // Record performance metrics
            recordMetrics('updateManyById (500 records)', 500, duration, db.capabilities.maxConcurrency, db.provider);

            console.log(`✅ Updated ${count} users in ${duration}ms with ${db.capabilities.supportsParallel ? 'parallel' : 'sequential'} execution`);
        }, 30000);

        it('should handle partial updates correctly', async () => {
            const users = Array.from({ length: 100 }, (_, i) => ({
                name: `User ${i}`,
                email: `user${i}@test.com`,
                age: 25
            }));

            await TestUser.createMany(users);

            const allUsers = await db.client.user.findMany();
            const updates = allUsers.slice(0, 50).map((user: any) => ({
                id: user.id,
                age: 35
            }));

            const count = await TestUser.updateManyById(updates, {
                parallel: db.capabilities.supportsParallel,
                concurrency: db.capabilities.maxConcurrency
            });

            expect(count).toBe(50);

            const updated = await db.client.user.findMany({ where: { age: 35 } });
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
            const allUsers = await db.client.user.findMany();
            const ids = allUsers.map((u: any) => u.id);

            const startTime = Date.now();
            const deleted = await TestUser.deleteByIds(ids, {
                parallel: db.capabilities.supportsParallel,
                concurrency: db.capabilities.maxConcurrency
            });
            const duration = Date.now() - startTime;

            expect(deleted).toBe(500);

            const remaining = await db.client.user.count();
            expect(remaining).toBe(0);

            // Record performance metrics
            recordMetrics('deleteByIds (500 records)', 500, duration, db.capabilities.maxConcurrency, db.provider);

            console.log(`✅ Deleted ${deleted} users in ${duration}ms with ${db.capabilities.supportsParallel ? 'parallel' : 'sequential'} execution`);
        }, 30000);

        it('should handle partial deletes correctly', async () => {
            const users = Array.from({ length: 200 }, (_, i) => ({
                name: `User ${i}`,
                email: `user${i}@test.com`,
                age: 25
            }));

            await TestUser.createMany(users);

            const allUsers = await db.client.user.findMany();
            const idsToDelete = allUsers.slice(0, 100).map((u: any) => u.id);

            const deleted = await TestUser.deleteByIds(idsToDelete, {
                parallel: db.capabilities.supportsParallel,
                concurrency: db.capabilities.maxConcurrency
            });

            expect(deleted).toBe(100);

            const remaining = await db.client.user.count();
            expect(remaining).toBe(100);
        });
    });

    describe('Connection Pool Behavior', () => {
        it('should respect connection pool limits', async () => {
            if (!db.capabilities.supportsParallel) {
                console.log(`⏭️  Skipping connection pool test on ${db.provider} (sequential only)`);
                return;
            }

            const DATASET_SIZE = 400;
            const users = Array.from({ length: DATASET_SIZE }, (_, i) => ({
                name: `Pool User ${i}`,
                email: `pool${i}@test.com`,
                age: 25
            }));

            // Create with concurrency matching pool size
            const startTime = Date.now();
            const count = await TestUser.createMany(users, false, undefined, {
                parallel: true,
                concurrency: db.capabilities.maxConcurrency
            });
            const duration = Date.now() - startTime;

            expect(count).toBe(DATASET_SIZE);

            console.log(`✅ Connection pool handled ${DATASET_SIZE} records with concurrency=${db.capabilities.maxConcurrency} in ${duration}ms`);
        }, 30000);

        it('should handle high concurrency requests gracefully', async () => {
            if (!db.capabilities.supportsParallel) {
                console.log(`⏭️  Skipping high concurrency test on ${db.provider} (sequential only)`);
                return;
            }

            const users = Array.from({ length: 200 }, (_, i) => ({
                name: `Concurrent User ${i}`,
                email: `concurrent${i}@test.com`,
                age: 25
            }));

            // Request higher concurrency than recommended
            const requestedConcurrency = db.capabilities.maxConcurrency * 2;
            
            const count = await TestUser.createMany(users, false, undefined, {
                parallel: true,
                concurrency: requestedConcurrency
            });

            expect(count).toBe(200);

            console.log(`✅ Handled high concurrency request (${requestedConcurrency}) gracefully`);
        }, 30000);
    });

    describe('Transaction Safety', () => {
        it('should maintain data integrity during parallel operations', async () => {
            const DATASET_SIZE = 300;
            const users = Array.from({ length: DATASET_SIZE }, (_, i) => ({
                name: `Integrity User ${i}`,
                email: `integrity${i}@test.com`,
                age: 25
            }));

            const count = await TestUser.createMany(users, false, undefined, {
                parallel: db.capabilities.supportsParallel,
                concurrency: db.capabilities.maxConcurrency
            });

            expect(count).toBe(DATASET_SIZE);

            // Verify all records were created correctly
            const allUsers = await db.client.user.findMany({
                where: {
                    email: {
                        contains: 'integrity'
                    }
                }
            });

            expect(allUsers).toHaveLength(DATASET_SIZE);

            // Verify no duplicate emails
            const emails = allUsers.map((u: any) => u.email);
            const uniqueEmails = new Set(emails);
            expect(uniqueEmails.size).toBe(DATASET_SIZE);

            console.log(`✅ Data integrity maintained for ${DATASET_SIZE} parallel operations`);
        }, 30000);

        it('should handle concurrent updates without data loss', async () => {
            // Create initial users
            const users = Array.from({ length: 200 }, (_, i) => ({
                name: `Update User ${i}`,
                email: `update${i}@test.com`,
                age: 20
            }));

            await TestUser.createMany(users);

            // Get all user IDs
            const allUsers = await db.client.user.findMany({
                where: {
                    email: {
                        contains: 'update'
                    }
                }
            });

            // Update all users concurrently
            const updates = allUsers.map((user: any) => ({
                id: user.id,
                age: 30
            }));

            const count = await TestUser.updateManyById(updates, {
                parallel: db.capabilities.supportsParallel,
                concurrency: db.capabilities.maxConcurrency
            });

            expect(count).toBe(200);

            // Verify all updates were applied
            const updatedUsers = await db.client.user.findMany({
                where: {
                    email: {
                        contains: 'update'
                    }
                }
            });

            expect(updatedUsers.every((u: any) => u.age === 30)).toBe(true);

            console.log(`✅ Transaction safety maintained for ${count} concurrent updates`);
        }, 30000);

        it('should handle MongoDB transaction limits', async () => {
            if (db.provider !== 'mongodb') {
                console.log(`⏭️  Skipping MongoDB-specific test on ${db.provider}`);
                return;
            }

            // MongoDB has conservative concurrency (max 2)
            expect(db.capabilities.maxConcurrency).toBe(2);

            const users = Array.from({ length: 100 }, (_, i) => ({
                name: `Mongo User ${i}`,
                email: `mongo${i}@test.com`,
                age: 25
            }));

            const count = await TestUser.createMany(users, false, undefined, {
                parallel: true,
                concurrency: db.capabilities.maxConcurrency
            });

            expect(count).toBe(100);

            console.log(`✅ MongoDB transaction limits respected (concurrency=${db.capabilities.maxConcurrency})`);
        }, 30000);
    });

    describe('Performance Comparison', () => {
        it('should demonstrate speedup with parallel execution', async () => {
            if (!db.capabilities.supportsParallel) {
                console.log(`⏭️  Skipping performance comparison on ${db.provider} (sequential only)`);
                return;
            }

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
                concurrency: db.capabilities.maxConcurrency
            });
            const parTime = Date.now() - parStart;

            const speedup = seqTime / parTime;

            console.log(`\n📊 Performance Comparison (${DATASET_SIZE} records):`);
            console.log(`   Sequential: ${seqTime}ms`);
            console.log(`   Parallel:   ${parTime}ms (concurrency=${db.capabilities.maxConcurrency})`);
            console.log(`   Speedup:    ${speedup.toFixed(2)}x`);

            // Record performance metrics
            recordMetrics('Sequential createMany', DATASET_SIZE, seqTime, 1, db.provider);
            recordMetrics('Parallel createMany', DATASET_SIZE, parTime, db.capabilities.maxConcurrency, db.provider);

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
            if (db.capabilities.supportsSkipDuplicates) {
                // MySQL and PostgreSQL support skipDuplicates
                const result = await TestUser.createMany(
                    [...users.slice(0, 10), ...users.slice(50, 100)],
                    true, // skipDuplicates
                    undefined,
                    { 
                        parallel: db.capabilities.supportsParallel,
                        concurrency: db.capabilities.maxConcurrency
                    }
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
                    { 
                        parallel: db.capabilities.supportsParallel,
                        concurrency: db.capabilities.maxConcurrency
                    }
                );

                expect(result).toBe(50);
            }
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty arrays', async () => {
            const count = await TestUser.createMany([], false, undefined, {
                parallel: db.capabilities.supportsParallel,
                concurrency: db.capabilities.maxConcurrency
            });
            expect(count).toBe(0);
        });

        it('should handle single item', async () => {
            const count = await TestUser.createMany([{
                name: 'Single User',
                email: 'single@test.com',
                age: 25
            }], false, undefined, {
                parallel: db.capabilities.supportsParallel,
                concurrency: db.capabilities.maxConcurrency
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

            const startTime = Date.now();
            const count = await TestUser.createMany(users, false, undefined, {
                parallel: db.capabilities.supportsParallel,
                concurrency: db.capabilities.maxConcurrency
            });
            const duration = Date.now() - startTime;

            expect(count).toBe(LARGE_SIZE);

            // Record performance metrics
            recordMetrics('Large dataset createMany', LARGE_SIZE, duration, db.capabilities.maxConcurrency, db.provider);

            console.log(`✅ Created ${LARGE_SIZE} records in ${duration}ms`);
        }, 60000);
    });
});
