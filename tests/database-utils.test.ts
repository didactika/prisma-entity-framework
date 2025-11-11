import {
    getDatabaseProvider,
    getDatabaseProviderCached,
    clearDatabaseProviderCache,
    getDatabaseDialect,
    quoteIdentifier,
    formatBoolean,
    supportsFeature,
    getDatabaseCapabilities,
    __testing
} from '../src/utils/database-utils';
import { PrismaClient } from '@prisma/client';

describe('Database Utils', () => {
    describe('Database Provider Detection', () => {
        it('should detect mysql from connection string', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/testdb';
            
            const provider = getDatabaseProvider({} as PrismaClient);
            expect(provider).toBe('mysql');
            
            process.env.DATABASE_URL = originalUrl;
        });

        it('should detect postgresql from connection string', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
            
            const provider = getDatabaseProvider({} as PrismaClient);
            expect(provider).toBe('postgresql');
            
            process.env.DATABASE_URL = originalUrl;
        });

        it('should detect postgres (alternative protocol) from connection string', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/testdb';
            
            const provider = getDatabaseProvider({} as PrismaClient);
            expect(provider).toBe('postgresql');
            
            process.env.DATABASE_URL = originalUrl;
        });

        it('should detect sqlite from connection string', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'file:./dev.db';
            
            const provider = getDatabaseProvider({} as PrismaClient);
            expect(provider).toBe('sqlite');
            
            process.env.DATABASE_URL = originalUrl;
        });

        it('should detect sqlserver from connection string', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'sqlserver://localhost:1433;database=testdb';
            
            const provider = getDatabaseProvider({} as PrismaClient);
            expect(provider).toBe('sqlserver');
            
            process.env.DATABASE_URL = originalUrl;
        });


        it('should default to sqlite when provider cannot be detected', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'unknown://localhost/testdb';
            
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
            const provider = getDatabaseProvider({} as PrismaClient);
            
            expect(provider).toBe('sqlite');
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                'Could not detect database provider, defaulting to sqlite'
            );
            
            consoleWarnSpy.mockRestore();
            process.env.DATABASE_URL = originalUrl;
        });

        it('should detect provider from Prisma engine config', () => {
            const mockPrisma = {
                _engineConfig: {
                    datasources: [
                        {
                            activeProvider: 'postgresql'
                        }
                    ]
                }
            } as any;

            const provider = getDatabaseProvider(mockPrisma);
            expect(provider).toBe('postgresql');
        });
    });

    describe('Database Dialect', () => {
        it('should return correct dialect for MySQL', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/testdb';
            
            const dialect = getDatabaseDialect({} as PrismaClient);
            
            expect(dialect.provider).toBe('mysql');
            expect(dialect.identifierQuote).toBe('`');
            expect(dialect.booleanTrue).toBe('1');
            expect(dialect.booleanFalse).toBe('0');
            expect(dialect.supportsReturning).toBe(false);
            
            process.env.DATABASE_URL = originalUrl;
        });

        it('should return correct dialect for PostgreSQL', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
            
            const dialect = getDatabaseDialect({} as PrismaClient);
            
            expect(dialect.provider).toBe('postgresql');
            expect(dialect.identifierQuote).toBe('"');
            expect(dialect.booleanTrue).toBe('TRUE');
            expect(dialect.booleanFalse).toBe('FALSE');
            expect(dialect.supportsReturning).toBe(true);
            
            process.env.DATABASE_URL = originalUrl;
        });

        it('should return correct dialect for SQLite', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'file:./dev.db';
            
            const dialect = getDatabaseDialect({} as PrismaClient);
            
            expect(dialect.provider).toBe('sqlite');
            expect(dialect.identifierQuote).toBe('"');
            expect(dialect.booleanTrue).toBe('1');
            expect(dialect.booleanFalse).toBe('0');
            expect(dialect.supportsReturning).toBe(true);
            
            process.env.DATABASE_URL = originalUrl;
        });
    });

    describe('Quote Identifier', () => {
        it('should quote identifiers with backticks for MySQL', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/testdb';
            
            const quoted = quoteIdentifier('User', {} as PrismaClient);
            expect(quoted).toBe('`User`');
            
            process.env.DATABASE_URL = originalUrl;
        });

        it('should quote identifiers with double quotes for PostgreSQL', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
            
            const quoted = quoteIdentifier('User', {} as PrismaClient);
            expect(quoted).toBe('"User"');
            
            process.env.DATABASE_URL = originalUrl;
        });

        it('should quote identifiers with double quotes for SQLite', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'file:./dev.db';
            
            const quoted = quoteIdentifier('User', {} as PrismaClient);
            expect(quoted).toBe('"User"');
            
            process.env.DATABASE_URL = originalUrl;
        });
    });

    describe('Format Boolean', () => {
        it('should format boolean as 1/0 for MySQL', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/testdb';
            
            expect(formatBoolean(true, {} as PrismaClient)).toBe('1');
            expect(formatBoolean(false, {} as PrismaClient)).toBe('0');
            
            process.env.DATABASE_URL = originalUrl;
        });

        it('should format boolean as TRUE/FALSE for PostgreSQL', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
            
            expect(formatBoolean(true, {} as PrismaClient)).toBe('TRUE');
            expect(formatBoolean(false, {} as PrismaClient)).toBe('FALSE');
            
            process.env.DATABASE_URL = originalUrl;
        });

        it('should format boolean as 1/0 for SQLite', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'file:./dev.db';
            
            expect(formatBoolean(true, {} as PrismaClient)).toBe('1');
            expect(formatBoolean(false, {} as PrismaClient)).toBe('0');
            
            process.env.DATABASE_URL = originalUrl;
        });
    });

    describe('Internal Utilities', () => {
        it('should validate correct provider names', () => {
            expect(__testing.isValidProvider('mysql')).toBe(true);
            expect(__testing.isValidProvider('postgresql')).toBe(true);
            expect(__testing.isValidProvider('sqlite')).toBe(true);
            expect(__testing.isValidProvider('sqlserver')).toBe(true);
        });

        it('should reject invalid provider names', () => {
            expect(__testing.isValidProvider('invalid')).toBe(false);
            expect(__testing.isValidProvider('oracle')).toBe(false);
            expect(__testing.isValidProvider('')).toBe(false);
        });

        it('should have correct dialect configurations', () => {
            expect(__testing.DIALECTS.mysql.identifierQuote).toBe('`');
            expect(__testing.DIALECTS.postgresql.identifierQuote).toBe('"');
            expect(__testing.DIALECTS.sqlite.identifierQuote).toBe('"');
            expect(__testing.DIALECTS.mysql.supportsReturning).toBe(false);
            expect(__testing.DIALECTS.postgresql.supportsReturning).toBe(true);
        });
    });

    describe('Database Provider Caching', () => {
        beforeEach(() => {
            // Clear cache before each test
            clearDatabaseProviderCache();
        });

        afterEach(() => {
            // Clean up cache after each test
            clearDatabaseProviderCache();
        });

        it('should cache provider detection result', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
            
            // First call should detect and cache
            const provider1 = getDatabaseProviderCached({} as PrismaClient);
            expect(provider1).toBe('postgresql');
            
            // Change DATABASE_URL
            process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/testdb';
            
            // Second call should return cached value (still postgresql)
            const provider2 = getDatabaseProviderCached({} as PrismaClient);
            expect(provider2).toBe('postgresql');
            
            process.env.DATABASE_URL = originalUrl;
        });

        it('should return same result as non-cached version on first call', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/testdb';
            
            const uncached = getDatabaseProvider({} as PrismaClient);
            clearDatabaseProviderCache();
            const cached = getDatabaseProviderCached({} as PrismaClient);
            
            expect(cached).toBe(uncached);
            expect(cached).toBe('mysql');
            
            process.env.DATABASE_URL = originalUrl;
        });

        it('should re-detect provider after cache is cleared', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
            
            // First call
            const provider1 = getDatabaseProviderCached({} as PrismaClient);
            expect(provider1).toBe('postgresql');
            
            // Clear cache and change URL
            clearDatabaseProviderCache();
            process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/testdb';
            
            // Should detect new provider
            const provider2 = getDatabaseProviderCached({} as PrismaClient);
            expect(provider2).toBe('mysql');
            
            process.env.DATABASE_URL = originalUrl;
        });

        it('should verify cache is actually being used', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
            
            // First call should set cache
            getDatabaseProviderCached({} as PrismaClient);
            expect(__testing.getCachedProvider()).toBe('postgresql');
            
            // Cache should persist
            expect(__testing.getCachedProvider()).toBe('postgresql');
            
            // Clear cache
            clearDatabaseProviderCache();
            expect(__testing.getCachedProvider()).toBe(null);
            
            process.env.DATABASE_URL = originalUrl;
        });
    });

    describe('Database Capabilities', () => {
        it('should return correct capabilities for PostgreSQL', () => {
            const capabilities = getDatabaseCapabilities('postgresql');
            
            expect(capabilities.supportsSkipDuplicates).toBe(true);
            expect(capabilities.supportsReturning).toBe(true);
            expect(capabilities.supportsJson).toBe(true);
            expect(capabilities.supportsArrays).toBe(true);
            expect(capabilities.maxPlaceholders).toBe(32767);
        });

        it('should return correct capabilities for MySQL', () => {
            const capabilities = getDatabaseCapabilities('mysql');
            
            expect(capabilities.supportsSkipDuplicates).toBe(false);
            expect(capabilities.supportsReturning).toBe(false);
            expect(capabilities.supportsJson).toBe(true);
            expect(capabilities.supportsArrays).toBe(false);
            expect(capabilities.maxPlaceholders).toBe(65535);
        });

        it('should return correct capabilities for SQLite', () => {
            const capabilities = getDatabaseCapabilities('sqlite');
            
            expect(capabilities.supportsSkipDuplicates).toBe(true);
            expect(capabilities.supportsReturning).toBe(true);
            expect(capabilities.supportsJson).toBe(true);
            expect(capabilities.supportsArrays).toBe(false);
            expect(capabilities.maxPlaceholders).toBe(999);
        });

        it('should return correct capabilities for SQL Server', () => {
            const capabilities = getDatabaseCapabilities('sqlserver');
            
            expect(capabilities.supportsSkipDuplicates).toBe(false);
            expect(capabilities.supportsReturning).toBe(true);
            expect(capabilities.supportsJson).toBe(true);
            expect(capabilities.supportsArrays).toBe(false);
            expect(capabilities.maxPlaceholders).toBe(2100);
        });

        it('should return correct capabilities for MongoDB', () => {
            const capabilities = getDatabaseCapabilities('mongodb');
            
            expect(capabilities.supportsSkipDuplicates).toBe(false);
            expect(capabilities.supportsReturning).toBe(false);
            expect(capabilities.supportsJson).toBe(true);
            expect(capabilities.supportsArrays).toBe(true);
            expect(capabilities.maxPlaceholders).toBe(Infinity);
        });

        it('should use cached provider when no provider specified', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
            
            clearDatabaseProviderCache();
            
            // This should cache postgresql
            getDatabaseProviderCached({} as PrismaClient);
            
            // Should use cached provider
            const capabilities = getDatabaseCapabilities();
            expect(capabilities.supportsSkipDuplicates).toBe(true);
            expect(capabilities.supportsReturning).toBe(true);
            
            process.env.DATABASE_URL = originalUrl;
            clearDatabaseProviderCache();
        });
    });

    describe('Feature Support Checks', () => {
        it('should correctly check skipDuplicates support', () => {
            expect(supportsFeature('skipDuplicates', 'postgresql')).toBe(true);
            expect(supportsFeature('skipDuplicates', 'mysql')).toBe(false);
            expect(supportsFeature('skipDuplicates', 'sqlite')).toBe(true);
            expect(supportsFeature('skipDuplicates', 'sqlserver')).toBe(false);
            expect(supportsFeature('skipDuplicates', 'mongodb')).toBe(false);
        });

        it('should correctly check returning support', () => {
            expect(supportsFeature('returning', 'postgresql')).toBe(true);
            expect(supportsFeature('returning', 'mysql')).toBe(false);
            expect(supportsFeature('returning', 'sqlite')).toBe(true);
            expect(supportsFeature('returning', 'sqlserver')).toBe(true);
            expect(supportsFeature('returning', 'mongodb')).toBe(false);
        });

        it('should correctly check json support', () => {
            expect(supportsFeature('json', 'postgresql')).toBe(true);
            expect(supportsFeature('json', 'mysql')).toBe(true);
            expect(supportsFeature('json', 'sqlite')).toBe(true);
            expect(supportsFeature('json', 'sqlserver')).toBe(true);
            expect(supportsFeature('json', 'mongodb')).toBe(true);
        });

        it('should correctly check arrays support', () => {
            expect(supportsFeature('arrays', 'postgresql')).toBe(true);
            expect(supportsFeature('arrays', 'mysql')).toBe(false);
            expect(supportsFeature('arrays', 'sqlite')).toBe(false);
            expect(supportsFeature('arrays', 'sqlserver')).toBe(false);
            expect(supportsFeature('arrays', 'mongodb')).toBe(true);
        });

        it('should use cached provider when no provider specified', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
            
            clearDatabaseProviderCache();
            
            // This should cache postgresql
            getDatabaseProviderCached({} as PrismaClient);
            
            // Should use cached provider
            expect(supportsFeature('skipDuplicates')).toBe(true);
            expect(supportsFeature('arrays')).toBe(true);
            
            process.env.DATABASE_URL = originalUrl;
            clearDatabaseProviderCache();
        });
    });
});
