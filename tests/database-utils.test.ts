import {
    getDatabaseProvider,
    getDatabaseDialect,
    quoteIdentifier,
    formatBoolean,
    __testing
} from '../src/database-utils';
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

        it('should detect mongodb from connection string', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'mongodb://localhost:27017/testdb';
            
            const provider = getDatabaseProvider({} as PrismaClient);
            expect(provider).toBe('mongodb');
            
            process.env.DATABASE_URL = originalUrl;
        });

        it('should detect cockroachdb from connection string', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'cockroachdb://user:pass@localhost:26257/testdb';
            
            const provider = getDatabaseProvider({} as PrismaClient);
            expect(provider).toBe('cockroachdb');
            
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

        it('should return unquoted identifier for MongoDB', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'mongodb://localhost:27017/testdb';
            
            const quoted = quoteIdentifier('User', {} as PrismaClient);
            expect(quoted).toBe('User');
            
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

        it('should format boolean as true/false for MongoDB', () => {
            const originalUrl = process.env.DATABASE_URL;
            process.env.DATABASE_URL = 'mongodb://localhost:27017/testdb';
            
            expect(formatBoolean(true, {} as PrismaClient)).toBe('true');
            expect(formatBoolean(false, {} as PrismaClient)).toBe('false');
            
            process.env.DATABASE_URL = originalUrl;
        });
    });

    describe('Internal Utilities', () => {
        it('should validate correct provider names', () => {
            expect(__testing.isValidProvider('mysql')).toBe(true);
            expect(__testing.isValidProvider('postgresql')).toBe(true);
            expect(__testing.isValidProvider('sqlite')).toBe(true);
            expect(__testing.isValidProvider('sqlserver')).toBe(true);
            expect(__testing.isValidProvider('mongodb')).toBe(true);
            expect(__testing.isValidProvider('cockroachdb')).toBe(true);
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
});
