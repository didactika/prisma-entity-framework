import { PrismaClient } from '@prisma/client';
import { getPrismaInstance } from '../config';

/**
 * Supported database providers
 */
export type DatabaseProvider = 'mysql' | 'postgresql' | 'sqlite' | 'sqlserver' | 'mongodb';

/**
 * Database capabilities interface
 */
export interface DatabaseCapabilities {
    supportsSkipDuplicates: boolean;
    supportsReturning: boolean;
    supportsJson: boolean;
    supportsArrays: boolean;
    maxPlaceholders: number;
}

/**
 * Cache for database provider detection
 */
let cachedProvider: DatabaseProvider | null = null;

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
    mongodb: {
        provider: 'mongodb',
        identifierQuote: '',
        booleanTrue: 'true',
        booleanFalse: 'false',
        supportsReturning: false,
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
        if (datasourceUrl.startsWith('mongodb://') || datasourceUrl.startsWith('mongodb+srv://')) {
            return 'mongodb';
        }
    }

    // Default to sqlite (most common in tests) - using console.warn for configuration issues
    console.warn('Could not detect database provider, defaulting to sqlite');
    return 'sqlite';
}

/**
 * Gets database provider with caching to avoid repeated detection
 * 
 * @param prisma - Optional PrismaClient instance (uses global if not provided)
 * @returns The detected database provider (cached after first call)
 * 
 * @example
 * ```typescript
 * const provider = getDatabaseProviderCached();
 * console.log(provider); // 'postgresql' or 'mysql'
 * // Subsequent calls return cached value
 * ```
 */
export function getDatabaseProviderCached(prisma?: PrismaClient): DatabaseProvider {
    if (cachedProvider === null) {
        cachedProvider = getDatabaseProvider(prisma);
    }
    return cachedProvider;
}

/**
 * Clears the database provider cache
 * Useful for testing or when database configuration changes
 * 
 * @example
 * ```typescript
 * clearDatabaseProviderCache();
 * // Next call to getDatabaseProviderCached will re-detect provider
 * ```
 */
export function clearDatabaseProviderCache(): void {
    cachedProvider = null;
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
    const provider = prisma ? getDatabaseProvider(prisma) : getDatabaseProviderCached();
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
 * Checks if the database supports a specific feature
 * 
 * @param feature - The feature to check
 * @param provider - Optional database provider (uses cached if not provided)
 * @returns True if the feature is supported
 * 
 * @example
 * ```typescript
 * if (supportsFeature('skipDuplicates')) {
 *   // Use skipDuplicates option
 * }
 * ```
 */
export function supportsFeature(
    feature: 'skipDuplicates' | 'returning' | 'json' | 'arrays',
    provider?: DatabaseProvider
): boolean {
    const dbProvider = provider || getDatabaseProviderCached();
    const capabilities = getDatabaseCapabilities(dbProvider);
    
    switch (feature) {
        case 'skipDuplicates':
            return capabilities.supportsSkipDuplicates;
        case 'returning':
            return capabilities.supportsReturning;
        case 'json':
            return capabilities.supportsJson;
        case 'arrays':
            return capabilities.supportsArrays;
        default:
            return false;
    }
}

/**
 * Gets comprehensive database capabilities for a provider
 * 
 * @param provider - Optional database provider (uses cached if not provided)
 * @returns Database capabilities object
 * 
 * @example
 * ```typescript
 * const capabilities = getDatabaseCapabilities();
 * if (capabilities.supportsSkipDuplicates) {
 *   // Use skipDuplicates
 * }
 * ```
 */
export function getDatabaseCapabilities(provider?: DatabaseProvider): DatabaseCapabilities {
    const dbProvider = provider || getDatabaseProviderCached();
    
    switch (dbProvider) {
        case 'postgresql':
            return {
                supportsSkipDuplicates: true,
                supportsReturning: true,
                supportsJson: true,
                supportsArrays: true,
                maxPlaceholders: 32767, // PostgreSQL limit
            };
        case 'mysql':
            return {
                supportsSkipDuplicates: false,
                supportsReturning: false,
                supportsJson: true,
                supportsArrays: false,
                maxPlaceholders: 65535, // MySQL limit
            };
        case 'sqlite':
            return {
                supportsSkipDuplicates: true,
                supportsReturning: true,
                supportsJson: true,
                supportsArrays: false,
                maxPlaceholders: 999, // SQLite limit (SQLITE_MAX_VARIABLE_NUMBER)
            };
        case 'sqlserver':
            return {
                supportsSkipDuplicates: false,
                supportsReturning: true,
                supportsJson: true,
                supportsArrays: false,
                maxPlaceholders: 2100, // SQL Server limit
            };
        case 'mongodb':
            return {
                supportsSkipDuplicates: false,
                supportsReturning: false,
                supportsJson: true,
                supportsArrays: true,
                maxPlaceholders: Infinity, // MongoDB has no placeholder limit
            };
        default:
            // Default to conservative capabilities
            return {
                supportsSkipDuplicates: false,
                supportsReturning: false,
                supportsJson: false,
                supportsArrays: false,
                maxPlaceholders: 999,
            };
    }
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
    getCachedProvider: () => cachedProvider,
};
