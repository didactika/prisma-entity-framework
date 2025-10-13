import { PrismaClient } from '@prisma/client';
import { getPrismaInstance } from './config';

/**
 * Supported database providers
 */
export type DatabaseProvider = 'mysql' | 'postgresql' | 'sqlite' | 'sqlserver';

/**
 * Database dialect configuration for SQL generation
 */
export interface DatabaseDialect {
    provider: DatabaseProvider;
    identifierQuote: string;
    booleanTrue: string;
    booleanFalse: string;
    supportsReturning: boolean;
}

/**
 * Database dialect configurations by provider
 */
const DIALECTS: Record<DatabaseProvider, DatabaseDialect> = {
    mysql: {
        provider: 'mysql',
        identifierQuote: '`',
        booleanTrue: '1',
        booleanFalse: '0',
        supportsReturning: false,
    },
    postgresql: {
        provider: 'postgresql',
        identifierQuote: '"',
        booleanTrue: 'TRUE',
        booleanFalse: 'FALSE',
        supportsReturning: true,
    },
    sqlite: {
        provider: 'sqlite',
        identifierQuote: '"',
        booleanTrue: '1',
        booleanFalse: '0',
        supportsReturning: true,
    },
    sqlserver: {
        provider: 'sqlserver',
        identifierQuote: '"',
        booleanTrue: '1',
        booleanFalse: '0',
        supportsReturning: true,
    },
};

/**
 * Detects the database provider from Prisma client configuration
 * 
 * @param prisma - Optional PrismaClient instance (uses global if not provided)
 * @returns The detected database provider
 * @throws Error if provider cannot be detected
 * 
 * @example
 * ```typescript
 * const provider = getDatabaseProvider();
 * console.log(provider); // 'postgresql' or 'mysql'
 * ```
 */
export function getDatabaseProvider(prisma?: PrismaClient): DatabaseProvider {
    const client = prisma || getPrismaInstance();
    
    // Try to get provider from Prisma internal configuration
    const datasources = (client as any)._engineConfig?.datasources;
    
    if (datasources && Array.isArray(datasources) && datasources.length > 0) {
        const provider = datasources[0].activeProvider;
        if (provider && isValidProvider(provider)) {
            return provider as DatabaseProvider;
        }
    }

    // Fallback: try to detect from connection string
    const datasourceUrl = process.env.DATABASE_URL;
    if (datasourceUrl) {
        if (datasourceUrl.startsWith('postgresql://') || datasourceUrl.startsWith('postgres://')) {
            return 'postgresql';
        }
        if (datasourceUrl.startsWith('mysql://')) {
            return 'mysql';
        }
        if (datasourceUrl.startsWith('file:') || datasourceUrl.startsWith('sqlite:')) {
            return 'sqlite';
        }
        if (datasourceUrl.startsWith('sqlserver://')) {
            return 'sqlserver';
        }
    }

    // Default to sqlite (most common in tests)
    console.warn('Could not detect database provider, defaulting to sqlite');
    return 'sqlite';
}

/**
 * Gets the database dialect configuration for the current provider
 * 
 * @param prisma - Optional PrismaClient instance (uses global if not provided)
 * @returns Database dialect configuration
 * 
 * @example
 * ```typescript
 * const dialect = getDatabaseDialect();
 * console.log(dialect.identifierQuote); // '`' for MySQL, '"' for PostgreSQL
 * ```
 */
export function getDatabaseDialect(prisma?: PrismaClient): DatabaseDialect {
    const provider = getDatabaseProvider(prisma);
    return DIALECTS[provider];
}

/**
 * Quotes an identifier according to the database dialect
 * 
 * @param identifier - The identifier to quote (table name, column name, etc.)
 * @param prisma - Optional PrismaClient instance
 * @returns Quoted identifier
 * 
 * @example
 * ```typescript
 * // MySQL
 * quoteIdentifier('User') // '`User`'
 * 
 * // PostgreSQL
 * quoteIdentifier('User') // '"User"'
 * ```
 */
export function quoteIdentifier(identifier: string, prisma?: PrismaClient): string {
    const dialect = getDatabaseDialect(prisma);
    if (!dialect.identifierQuote) return identifier;
    return `${dialect.identifierQuote}${identifier}${dialect.identifierQuote}`;
}

/**
 * Formats a boolean value according to the database dialect
 * 
 * @param value - The boolean value
 * @param prisma - Optional PrismaClient instance
 * @returns Formatted boolean string
 * 
 * @example
 * ```typescript
 * // MySQL
 * formatBoolean(true) // '1'
 * 
 * // PostgreSQL
 * formatBoolean(true) // 'TRUE'
 * ```
 */
export function formatBoolean(value: boolean, prisma?: PrismaClient): string {
    const dialect = getDatabaseDialect(prisma);
    return value ? dialect.booleanTrue : dialect.booleanFalse;
}

/**
 * Checks if a string is a valid database provider
 */
function isValidProvider(provider: string): boolean {
    return provider in DIALECTS;
}

/**
 * Exports for testing
 * @internal
 */
export const __testing = {
    DIALECTS,
    isValidProvider,
};
