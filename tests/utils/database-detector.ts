/**
 * Database Provider Detection Utility
 * Shared logic for detecting database provider from DATABASE_URL
 */

export type DatabaseProvider = 'sqlite' | 'mysql' | 'postgresql' | 'mongodb';

export interface DatabaseConfig {
    provider: DatabaseProvider;
    schemaFile: string;
    supportsSkipDuplicates: boolean;
}

/**
 * Detects database provider from DATABASE_URL environment variable
 * @returns Database configuration with provider, schema file, and feature support
 */
export function detectDatabaseProvider(): DatabaseConfig {
    const databaseUrl = process.env.DATABASE_URL || '';

    if (databaseUrl.startsWith('mysql://')) {
        return {
            provider: 'mysql',
            schemaFile: 'schema.mysql.prisma',
            supportsSkipDuplicates: true
        };
    }

    if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
        return {
            provider: 'postgresql',
            schemaFile: 'schema.postgresql.prisma',
            supportsSkipDuplicates: true
        };
    }

    if (databaseUrl.startsWith('mongodb://') || databaseUrl.startsWith('mongodb+srv://')) {
        return {
            provider: 'mongodb',
            schemaFile: 'schema.mongodb.prisma',
            supportsSkipDuplicates: false
        };
    }

    // Default to SQLite
    return {
        provider: 'sqlite',
        schemaFile: 'schema.test.prisma',
        supportsSkipDuplicates: false
    };
}
