import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import {
    configurePrisma,
    getConnectionPoolSize,
    getMaxConcurrency,
    isParallelEnabled,
    resetPrismaConfiguration,
    type PrismaConfig
} from '../src/index';

describe('Connection Pool Configuration', () => {
    let originalEnv: string | undefined;
    
    beforeEach(() => {
        // Save original DATABASE_URL
        originalEnv = process.env.DATABASE_URL;
        // Reset configuration before each test
        resetPrismaConfiguration();
    });
    
    afterEach(() => {
        // Restore original DATABASE_URL
        if (originalEnv !== undefined) {
            process.env.DATABASE_URL = originalEnv;
        } else {
            delete process.env.DATABASE_URL;
        }
        // Reset configuration after each test
        resetPrismaConfiguration();
    });
    
    describe('configurePrisma', () => {
        it('should configure Prisma with default settings', () => {
            const prisma = new PrismaClient();
            
            expect(() => configurePrisma(prisma)).not.toThrow();
        });
        
        it('should throw error if prisma is null', () => {
            expect(() => configurePrisma(null as any)).toThrow('Prisma client instance is required');
        });
        
        it('should throw error if prisma is undefined', () => {
            expect(() => configurePrisma(undefined as any)).toThrow('Prisma client instance is required');
        });
        
        it('should accept custom configuration', () => {
            const prisma = new PrismaClient();
            const config: PrismaConfig = {
                maxConcurrency: 4,
                enableParallel: true,
                maxQueriesPerSecond: 50
            };
            
            expect(() => configurePrisma(prisma, config)).not.toThrow();
        });
        
        it('should validate maxConcurrency is positive integer', () => {
            const prisma = new PrismaClient();
            
            expect(() => configurePrisma(prisma, { maxConcurrency: 0 }))
                .toThrow('maxConcurrency must be a positive integer');
            
            expect(() => configurePrisma(prisma, { maxConcurrency: -1 }))
                .toThrow('maxConcurrency must be a positive integer');
            
            expect(() => configurePrisma(prisma, { maxConcurrency: 1.5 }))
                .toThrow('maxConcurrency must be a positive integer');
        });
        
        it('should validate maxQueriesPerSecond is positive number', () => {
            const prisma = new PrismaClient();
            
            expect(() => configurePrisma(prisma, { maxQueriesPerSecond: 0 }))
                .toThrow('maxQueriesPerSecond must be a positive number');
            
            expect(() => configurePrisma(prisma, { maxQueriesPerSecond: -10 }))
                .toThrow('maxQueriesPerSecond must be a positive number');
        });
        
        it('should accept valid configuration values', () => {
            const prisma = new PrismaClient();
            
            expect(() => configurePrisma(prisma, { maxConcurrency: 1 })).not.toThrow();
            expect(() => configurePrisma(prisma, { maxConcurrency: 10 })).not.toThrow();
            expect(() => configurePrisma(prisma, { maxQueriesPerSecond: 0.5 })).not.toThrow();
            expect(() => configurePrisma(prisma, { maxQueriesPerSecond: 100 })).not.toThrow();
            expect(() => configurePrisma(prisma, { enableParallel: false })).not.toThrow();
        });
    });
    
    describe('getConnectionPoolSize', () => {
        it('should return default value when DATABASE_URL is not set', () => {
            delete process.env.DATABASE_URL;
            
            const prisma = new PrismaClient();
            configurePrisma(prisma);
            
            const poolSize = getConnectionPoolSize();
            expect(poolSize).toBeGreaterThan(0);
            expect(poolSize).toBeLessThanOrEqual(10);
        });
        
        it('should parse connection_limit from DATABASE_URL', () => {
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?connection_limit=15';
            
            const prisma = new PrismaClient();
            configurePrisma(prisma);
            
            const poolSize = getConnectionPoolSize();
            expect(poolSize).toBe(15);
        });
        
        it('should parse pool_size from DATABASE_URL (PostgreSQL)', () => {
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?pool_size=20';
            
            const prisma = new PrismaClient();
            configurePrisma(prisma);
            
            const poolSize = getConnectionPoolSize();
            expect(poolSize).toBe(20);
        });
        
        it('should handle invalid connection_limit gracefully', () => {
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?connection_limit=invalid';
            
            const prisma = new PrismaClient();
            configurePrisma(prisma);
            
            const poolSize = getConnectionPoolSize();
            expect(poolSize).toBeGreaterThan(0); // Should fallback to default
        });
        
        it('should handle negative connection_limit gracefully', () => {
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?connection_limit=-5';
            
            const prisma = new PrismaClient();
            configurePrisma(prisma);
            
            const poolSize = getConnectionPoolSize();
            expect(poolSize).toBeGreaterThan(0); // Should fallback to default
        });
        
        it('should return 1 for SQLite databases', () => {
            process.env.DATABASE_URL = 'file:./test.db';
            
            const prisma = new PrismaClient();
            configurePrisma(prisma);
            
            const poolSize = getConnectionPoolSize();
            expect(poolSize).toBe(1); // SQLite is single-threaded
        });
        
        it('should return default for MySQL without connection_limit', () => {
            process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/db';
            
            const prisma = new PrismaClient();
            configurePrisma(prisma);
            
            const poolSize = getConnectionPoolSize();
            expect(poolSize).toBe(8); // MySQL default
        });
        
        it('should return default for PostgreSQL without connection_limit', () => {
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
            
            const prisma = new PrismaClient();
            configurePrisma(prisma);
            
            const poolSize = getConnectionPoolSize();
            expect(poolSize).toBe(8); // PostgreSQL default
        });
        
        it('should return safe default when Prisma is not configured', () => {
            const poolSize = getConnectionPoolSize();
            expect(poolSize).toBe(2); // Safe default
        });
    });
    
    describe('getMaxConcurrency', () => {
        it('should return configured maxConcurrency when set', () => {
            const prisma = new PrismaClient();
            configurePrisma(prisma, { maxConcurrency: 8 });
            
            const concurrency = getMaxConcurrency();
            expect(concurrency).toBe(8);
        });
        
        it('should return pool size when maxConcurrency is not set', () => {
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?connection_limit=12';
            
            const prisma = new PrismaClient();
            configurePrisma(prisma);
            
            const concurrency = getMaxConcurrency();
            expect(concurrency).toBe(12);
        });
        
        it('should prioritize configured maxConcurrency over pool size', () => {
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?connection_limit=20';
            
            const prisma = new PrismaClient();
            configurePrisma(prisma, { maxConcurrency: 5 });
            
            const concurrency = getMaxConcurrency();
            expect(concurrency).toBe(5); // Should use configured value
        });
    });
    
    describe('isParallelEnabled', () => {
        it('should return true when pool size > 1 and not explicitly disabled', () => {
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?connection_limit=10';
            
            const prisma = new PrismaClient();
            configurePrisma(prisma);
            
            expect(isParallelEnabled()).toBe(true);
        });
        
        it('should return false when pool size = 1', () => {
            process.env.DATABASE_URL = 'file:./test.db';
            
            const prisma = new PrismaClient();
            configurePrisma(prisma);
            
            expect(isParallelEnabled()).toBe(false);
        });
        
        it('should return false when explicitly disabled', () => {
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?connection_limit=10';
            
            const prisma = new PrismaClient();
            configurePrisma(prisma, { enableParallel: false });
            
            expect(isParallelEnabled()).toBe(false);
        });
        
        it('should return true when explicitly enabled with pool size > 1', () => {
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?connection_limit=5';
            
            const prisma = new PrismaClient();
            configurePrisma(prisma, { enableParallel: true });
            
            expect(isParallelEnabled()).toBe(true);
        });
    });
    
    describe('resetPrismaConfiguration', () => {
        it('should reset configuration to defaults', () => {
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?connection_limit=10';
            
            const prisma = new PrismaClient();
            configurePrisma(prisma, {
                maxConcurrency: 10,
                enableParallel: false,
                maxQueriesPerSecond: 50
            });
            
            resetPrismaConfiguration();
            
            // After reset, should use defaults
            const prisma2 = new PrismaClient();
            configurePrisma(prisma2);
            
            // maxConcurrency should be undefined (auto-detect)
            // enableParallel should be true (default)
            expect(isParallelEnabled()).toBe(true);
        });
    });
    
    describe('Integration scenarios', () => {
        it('should handle complete configuration workflow', () => {
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?connection_limit=10';
            
            // Step 1: Configure with custom settings
            const prisma = new PrismaClient();
            configurePrisma(prisma, {
                maxConcurrency: 4,
                enableParallel: true,
                maxQueriesPerSecond: 100
            });
            
            // Step 2: Verify settings
            expect(getMaxConcurrency()).toBe(4);
            expect(isParallelEnabled()).toBe(true);
            
            // Step 3: Reset
            resetPrismaConfiguration();
            
            // Step 4: Reconfigure with different settings
            const prisma2 = new PrismaClient();
            configurePrisma(prisma2, {
                maxConcurrency: 8,
                enableParallel: false
            });
            
            // Step 5: Verify new settings
            expect(getMaxConcurrency()).toBe(8);
            expect(isParallelEnabled()).toBe(false);
        });
        
        it('should handle auto-detection with various database URLs', () => {
            const testCases = [
                { url: 'postgresql://localhost/db?connection_limit=5', expected: 5 },
                { url: 'mysql://localhost/db?connection_limit=7', expected: 7 },
                { url: 'postgresql://localhost/db?pool_size=12', expected: 12 },
                { url: 'file:./test.db', expected: 1 },
            ];
            
            for (const testCase of testCases) {
                resetPrismaConfiguration();
                process.env.DATABASE_URL = testCase.url;
                
                const prisma = new PrismaClient();
                configurePrisma(prisma);
                
                const poolSize = getConnectionPoolSize();
                expect(poolSize).toBe(testCase.expected);
            }
        });
    });
});
