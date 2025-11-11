import { PrismaClient } from '@prisma/client';
import { RateLimiter, createRateLimiter } from './utils/rate-limiter';
import { getDatabaseProvider } from './utils/database-utils';

/**
 * Configuration options for Prisma Entity Framework
 */
export interface PrismaConfig {
    /**
     * Maximum number of concurrent operations
     * If not set, will be auto-detected from connection pool
     */
    maxConcurrency?: number;
    
    /**
     * Enable or disable parallel execution
     * Default: true (enabled when pool size > 1)
     */
    enableParallel?: boolean;
    
    /**
     * Maximum queries per second (rate limiting)
     * Default: 100
     */
    maxQueriesPerSecond?: number;
}

/**
 * Global Prisma instance for the framework
 */
let globalPrismaInstance: PrismaClient | null = null;

/**
 * Global configuration for parallel execution
 */
let globalConfig: PrismaConfig = {
    maxConcurrency: undefined,
    enableParallel: true,
    maxQueriesPerSecond: 100,
};

/**
 * Global rate limiter instance
 */
let globalRateLimiter: RateLimiter | null = null;

/**
 * Configure the Prisma client instance to be used by all entities
 * This must be called once at application startup before using any entity operations
 * 
 * @param prisma - PrismaClient instance
 * @param config - Optional configuration for parallel execution
 * @throws Error if prisma is null or undefined
 * @throws Error if configuration options are invalid
 * 
 * @example
 * ```typescript
 * import { PrismaClient } from '@prisma/client';
 * import { configurePrisma } from 'prisma-entity-framework';
 * 
 * const prisma = new PrismaClient();
 * 
 * // Basic configuration (auto-detect pool size)
 * configurePrisma(prisma);
 * 
 * // Custom configuration
 * configurePrisma(prisma, {
 *   maxConcurrency: 4,
 *   enableParallel: true,
 *   maxQueriesPerSecond: 50
 * });
 * ```
 */
export function configurePrisma(prisma: PrismaClient, config?: PrismaConfig): void {
    if (!prisma) {
        throw new Error('Prisma client instance is required');
    }
    
    // Validate configuration options
    if (config) {
        if (config.maxConcurrency !== undefined) {
            if (!Number.isInteger(config.maxConcurrency) || config.maxConcurrency < 1) {
                throw new Error('maxConcurrency must be a positive integer');
            }
        }
        
        if (config.maxQueriesPerSecond !== undefined) {
            if (!Number.isFinite(config.maxQueriesPerSecond) || config.maxQueriesPerSecond <= 0) {
                throw new Error('maxQueriesPerSecond must be a positive number');
            }
        }
        
        // Merge with global config
        globalConfig = {
            ...globalConfig,
            ...config,
        };
    }
    
    globalPrismaInstance = prisma;
    
    // Initialize rate limiter with configured rate
    globalRateLimiter = createRateLimiter({
        maxQueriesPerSecond: globalConfig.maxQueriesPerSecond || 100,
        algorithm: 'token-bucket'
    });
}

/**
 * Get the configured Prisma instance
 * 
 * @returns PrismaClient instance
 * @throws Error if Prisma has not been configured
 * @internal
 */
export function getPrismaInstance(): PrismaClient {
    if (!globalPrismaInstance) {
        throw new Error(
            'Prisma instance not configured. Call configurePrisma(prisma) before using any entity operations.'
        );
    }
    return globalPrismaInstance;
}

/**
 * Check if Prisma has been configured
 * 
 * @returns boolean indicating if Prisma is configured
 */
export function isPrismaConfigured(): boolean {
    return globalPrismaInstance !== null;
}

/**
 * Reset the Prisma configuration
 * Useful for testing scenarios where you need to reconfigure Prisma
 */
export function resetPrismaConfiguration(): void {
    globalPrismaInstance = null;
    globalRateLimiter = null;
    globalConfig = {
        maxConcurrency: undefined,
        enableParallel: true,
        maxQueriesPerSecond: 100,
    };
}



/**
 * Detect connection pool size from Prisma configuration
 * 
 * Attempts to read pool size from:
 * 1. DATABASE_URL connection_limit parameter
 * 2. DATABASE_URL pool_size parameter (PostgreSQL)
 * 3. Prisma internal configuration
 * 4. Default values based on database provider
 * 
 * @returns Detected connection pool size
 * 
 * @example
 * ```typescript
 * // With DATABASE_URL=postgresql://user:pass@localhost:5432/db?connection_limit=20
 * const poolSize = getConnectionPoolSize(); // Returns 20
 * ```
 */
export function getConnectionPoolSize(): number {
    try {
        const prisma = getPrismaInstance();
        
        // Try to get from DATABASE_URL connection_limit parameter
        const datasourceUrl = process.env.DATABASE_URL;
        if (datasourceUrl) {
            try {
                const url = new URL(datasourceUrl);
                
                // Check for connection_limit parameter (MySQL, PostgreSQL)
                const connectionLimit = url.searchParams.get('connection_limit');
                if (connectionLimit) {
                    const limit = parseInt(connectionLimit, 10);
                    if (!isNaN(limit) && limit > 0) {
                        return limit;
                    }
                }
                
                // Check for pool_size parameter (PostgreSQL)
                const poolSize = url.searchParams.get('pool_size');
                if (poolSize) {
                    const size = parseInt(poolSize, 10);
                    if (!isNaN(size) && size > 0) {
                        return size;
                    }
                }
                
                // Check for maxPoolSize parameter (MongoDB)
                const maxPoolSize = url.searchParams.get('maxPoolSize');
                if (maxPoolSize) {
                    const size = parseInt(maxPoolSize, 10);
                    if (!isNaN(size) && size > 0) {
                        return size;
                    }
                }
            } catch {
                // URL parsing failed, continue to other methods
            }
        }
        
        // Try to access internal Prisma client configuration
        const clientConfig = (prisma as any)?._engineConfig;
        if (clientConfig?.datasources?.[0]?.url) {
            try {
                const url = new URL(clientConfig.datasources[0].url);
                const connectionLimit = url.searchParams.get('connection_limit');
                if (connectionLimit) {
                    const limit = parseInt(connectionLimit, 10);
                    if (!isNaN(limit) && limit > 0) {
                        return limit;
                    }
                }
            } catch {
                // Continue to defaults
            }
        }
        
        // Default pool sizes by database provider
        const provider = getDatabaseProvider(prisma);
        const defaultPoolSizes: Record<string, number> = {
            postgresql: 8,  // PostgreSQL default
            mysql: 8,       // MySQL default
            sqlite: 1,       // SQLite is single-threaded
            sqlserver: 8,   // SQL Server default
            mongodb: 2,      // MongoDB default (conservative due to transaction limits)
        };
        
        return defaultPoolSizes[provider] || 2; // Fallback to safe default of 2
    } catch (error) {
        // If Prisma is not configured or any error occurs, return safe default
        return 2;
    }
}

/**
 * Get the maximum concurrency level for parallel operations
 * 
 * Returns the configured maxConcurrency if set, otherwise returns
 * the detected connection pool size
 * 
 * @returns Maximum concurrency level
 * 
 * @example
 * ```typescript
 * const concurrency = getMaxConcurrency();
 * console.log(`Max concurrent operations: ${concurrency}`);
 * ```
 */
export function getMaxConcurrency(): number {
    // If user explicitly set maxConcurrency, use that
    if (globalConfig.maxConcurrency !== undefined) {
        return globalConfig.maxConcurrency;
    }
    
    // Otherwise, use detected pool size
    return getConnectionPoolSize();
}

/**
 * Check if parallel execution is enabled
 * 
 * Parallel execution is enabled when:
 * - enableParallel config is true (default)
 * - Connection pool size > 1
 * 
 * @returns true if parallel execution is enabled
 * 
 * @example
 * ```typescript
 * if (isParallelEnabled()) {
 *   console.log('Parallel execution is enabled');
 * }
 * ```
 */
export function isParallelEnabled(): boolean {
    // Check if explicitly disabled
    if (globalConfig.enableParallel === false) {
        return false;
    }
    
    // Check if pool size supports parallel execution
    const poolSize = getConnectionPoolSize();
    return poolSize > 1;
}

/**
 * Get the current configuration
 * @internal
 */
export function getConfig(): PrismaConfig {
    return { ...globalConfig };
}

/**
 * Get the global rate limiter instance
 * 
 * @returns RateLimiter instance or null if not configured
 * @internal
 */
export function getRateLimiter(): RateLimiter | null {
    return globalRateLimiter;
}
