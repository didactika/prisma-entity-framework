/**
 * Database Provider Detection Utility
 * Comprehensive database capability detection for test infrastructure
 */

export type DatabaseProvider = 'sqlite' | 'mysql' | 'postgresql' | 'mongodb';

/**
 * Comprehensive database capabilities interface
 * Defines all feature flags for database-specific functionality
 */
export interface DatabaseCapabilities {
  /** Database provider type */
  provider: DatabaseProvider;
  
  /** Schema file path for this provider */
  schemaFile: string;
  
  /** Supports JSON/JSONB data types */
  supportsJSON: boolean;
  
  /** Supports scalar array types (String[], Int[], etc.) */
  supportsScalarArrays: boolean;
  
  /** Supports skipDuplicates option in createMany */
  supportsSkipDuplicates: boolean;
  
  /** Supports explicit many-to-many relationships with join tables */
  supportsManyToMany: boolean;
  
  /** Supports parallel batch operations */
  supportsParallel: boolean;
  
  /** Maximum recommended concurrency for parallel operations */
  maxConcurrency: number;
  
  /** ID type used by this database (number for auto-increment, string for ObjectId) */
  idType: 'number' | 'string';
  
  /** Supports transactions */
  supportsTransactions: boolean;
  
  /** Supports full-text search */
  supportsFullTextSearch: boolean;
}

/**
 * Detects comprehensive database capabilities from DATABASE_URL
 * @returns Complete database capabilities object
 */
export function detectDatabaseCapabilities(): DatabaseCapabilities {
    const databaseUrl = process.env.DATABASE_URL || '';

    if (databaseUrl.startsWith('mysql://')) {
        return {
            provider: 'mysql',
            schemaFile: 'schema.mysql.prisma',
            supportsJSON: true,
            supportsScalarArrays: false,
            supportsSkipDuplicates: true,
            supportsManyToMany: true,
            supportsParallel: true,
            maxConcurrency: 8,
            idType: 'number',
            supportsTransactions: true,
            supportsFullTextSearch: true,
        };
    }

    if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
        return {
            provider: 'postgresql',
            schemaFile: 'schema.postgresql.prisma',
            supportsJSON: true,
            supportsScalarArrays: true,
            supportsSkipDuplicates: true,
            supportsManyToMany: true,
            supportsParallel: true,
            maxConcurrency: 8,
            idType: 'number',
            supportsTransactions: true,
            supportsFullTextSearch: true,
        };
    }

    if (databaseUrl.startsWith('mongodb://') || databaseUrl.startsWith('mongodb+srv://')) {
        return {
            provider: 'mongodb',
            schemaFile: 'schema.mongodb.prisma',
            supportsJSON: true, // Native document storage
            supportsScalarArrays: true, // Embedded arrays
            supportsSkipDuplicates: false,
            supportsManyToMany: false, // Uses embedded documents instead
            supportsParallel: true,
            maxConcurrency: 2, // Conservative due to transaction limits
            idType: 'string', // ObjectId
            supportsTransactions: true,
            supportsFullTextSearch: true,
        };
    }

    // Default to SQLite
    return {
        provider: 'sqlite',
        schemaFile: 'schema.test.prisma',
        supportsJSON: false, // Can store as TEXT but no JSON functions
        supportsScalarArrays: false,
        supportsSkipDuplicates: false,
        supportsManyToMany: true,
        supportsParallel: false, // Sequential only
        maxConcurrency: 1,
        idType: 'number',
        supportsTransactions: true,
        supportsFullTextSearch: false,
    };
}

/**
 * Checks if the current database supports JSON fields
 * @returns true if JSON is supported
 */
export function supportsJSON(): boolean {
    return detectDatabaseCapabilities().supportsJSON;
}

/**
 * Checks if the current database supports scalar arrays
 * @returns true if scalar arrays are supported
 */
export function supportsScalarArrays(): boolean {
    return detectDatabaseCapabilities().supportsScalarArrays;
}

/**
 * Checks if the current database supports skipDuplicates option
 * @returns true if skipDuplicates is supported
 */
export function supportsSkipDuplicates(): boolean {
    return detectDatabaseCapabilities().supportsSkipDuplicates;
}

/**
 * Checks if the current database supports explicit many-to-many relationships
 * @returns true if many-to-many is supported
 */
export function supportsManyToMany(): boolean {
    return detectDatabaseCapabilities().supportsManyToMany;
}

/**
 * Checks if the current database supports parallel operations
 * @returns true if parallel operations are supported
 */
export function supportsParallel(): boolean {
    return detectDatabaseCapabilities().supportsParallel;
}

/**
 * Checks if the current database supports transactions
 * @returns true if transactions are supported
 */
export function supportsTransactions(): boolean {
    return detectDatabaseCapabilities().supportsTransactions;
}

/**
 * Gets the maximum recommended concurrency for the current database
 * @returns maximum concurrency level
 */
export function getMaxConcurrency(): number {
    return detectDatabaseCapabilities().maxConcurrency;
}

/**
 * Gets the ID type for the current database
 * @returns 'number' for auto-increment, 'string' for ObjectId
 */
export function getIdType(): 'number' | 'string' {
    return detectDatabaseCapabilities().idType;
}

/**
 * Checks if a specific capability is supported by the current database
 * @param capability - The capability to check
 * @returns true if the capability is supported
 */
export function hasCapability(capability: keyof DatabaseCapabilities): boolean {
    const capabilities = detectDatabaseCapabilities();
    const value = capabilities[capability];
    
    // For boolean capabilities, return the value directly
    if (typeof value === 'boolean') {
        return value;
    }
    
    // For other types, return true if they exist
    return value !== undefined && value !== null;
}

/**
 * Logs detected database provider and capabilities
 * Useful for debugging test execution
 */
export function logDatabaseCapabilities(): void {
    const capabilities = detectDatabaseCapabilities();
    
    console.log('\n' + '='.repeat(60));
    console.log('Database Capabilities Detection');
    console.log('='.repeat(60));
    console.log(`Provider:              ${capabilities.provider.toUpperCase()}`);
    console.log(`Schema File:           ${capabilities.schemaFile}`);
    console.log(`ID Type:               ${capabilities.idType}`);
    console.log(`Max Concurrency:       ${capabilities.maxConcurrency}`);
    console.log('-'.repeat(60));
    console.log('Feature Support:');
    console.log(`  JSON Fields:         ${capabilities.supportsJSON ? '✅' : '❌'}`);
    console.log(`  Scalar Arrays:       ${capabilities.supportsScalarArrays ? '✅' : '❌'}`);
    console.log(`  Skip Duplicates:     ${capabilities.supportsSkipDuplicates ? '✅' : '❌'}`);
    console.log(`  Many-to-Many:        ${capabilities.supportsManyToMany ? '✅' : '❌'}`);
    console.log(`  Parallel Operations: ${capabilities.supportsParallel ? '✅' : '❌'}`);
    console.log(`  Transactions:        ${capabilities.supportsTransactions ? '✅' : '❌'}`);
    console.log(`  Full-Text Search:    ${capabilities.supportsFullTextSearch ? '✅' : '❌'}`);
    console.log('='.repeat(60) + '\n');
}

/**
 * Helper to skip tests based on capability requirements
 * @param capability - The required capability
 * @param testName - Name of the test being skipped
 * @returns true if test should be skipped
 */
export function shouldSkipTest(capability: keyof DatabaseCapabilities, testName?: string): boolean {
    const capabilities = detectDatabaseCapabilities();
    const value = capabilities[capability];
    
    let shouldSkip = false;
    
    if (typeof value === 'boolean') {
        shouldSkip = !value;
    } else {
        shouldSkip = false;
    }
    
    if (shouldSkip && testName) {
        console.log(`⏭️  Skipping "${testName}" - ${capability} not supported on ${capabilities.provider}`);
    }
    
    return shouldSkip;
}
