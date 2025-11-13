/**
 * Prisma Entity Framework
 * 
 * Complete entity framework for Prisma combining Active Record pattern,
 * advanced Query Builder, graph traversal utilities, and batch operations.
 * 
 * @packageDocumentation
 */

/**
 * Configuration
 * 
 * Prisma client configuration and settings:
 * - configurePrisma: Configure Prisma client instance and settings
 * - getPrismaInstance: Get configured Prisma client instance
 * - isPrismaConfigured: Check if Prisma is configured
 * - getConnectionPoolSize: Get database connection pool size
 * - getMaxConcurrency: Get maximum concurrency for parallel operations
 * - isParallelEnabled: Check if parallel execution is enabled
 */
export {
    configurePrisma,
    getPrismaInstance,
    isPrismaConfigured,
    resetPrismaConfiguration,
    getConnectionPoolSize,
    getMaxConcurrency,
    isParallelEnabled,
    type PrismaConfig
} from './core/config';

/**
 * Rate Limiter
 * 
 * Rate limiting for API and database operations:
 * - RateLimiter: Abstract rate limiter interface
 * - TokenBucketRateLimiter: Token bucket algorithm implementation
 * - createRateLimiter: Factory function for creating rate limiters
 */
export {
    RateLimiter,
    TokenBucketRateLimiter,
    createRateLimiter,
    type RateLimiterOptions,
    type RateLimiterStatus
} from './core/rate-limiter';

/**
 * Parallel Execution
 * 
 * Parallel operation execution with concurrency control:
 * - executeInParallel: Execute operations in parallel with concurrency limit
 * - chunkForParallel: Split operations into chunks for parallel execution
 * - getOptimalConcurrency: Calculate optimal concurrency based on system resources
 * - shouldUseParallel: Determine if parallel execution is beneficial
 * - ParallelMetricsTracker: Track metrics for parallel operations
 */
export {
    executeInParallel,
    chunkForParallel,
    getOptimalConcurrency,
    shouldUseParallel,
    createParallelMetrics,
    ParallelMetricsTracker,
    type ParallelOptions,
    type ParallelResult,
    type ParallelMetrics
} from './core/utils/parallel-utils';

/**
 * Core Entity Classes
 * 
 * Main classes for entity management and ORM operations:
 * 
 * BaseEntity:
 * - Active Record pattern implementation with CRUD operations
 * - Instance methods: create(), update(), delete(), save()
 * - Static methods: findByFilter(), upsert(), getModelInformation()
 * - Property initialization and change tracking
 * 
 * BaseEntityBatch:
 * - Optimized batch operations for high-volume data processing
 * - createMany(): Bulk entity creation with deduplication and relation handling
 * - upsertMany(): Efficient update-or-create with change detection
 * - updateManyById(): Batch updates using optimized SQL CASE WHEN statements
 * - deleteByIds(): Parallel batch deletion
 * - Automatic batching based on database provider
 * - Parallel execution support with configurable concurrency
 * 
 * BaseEntityQuery:
 * - Advanced query operations with filtering and pagination
 * - findByFilter(): Complex queries with search, pagination, and relation includes
 * - countByFilter(): Count records matching filter criteria
 * - deleteByFilter(): Bulk deletion based on filter conditions
 * - Automatic OR batching for large condition sets (>1000 items)
 * - Parallel execution for chunked queries
 * 
 * BaseEntityHelpers:
 * - Internal helper methods for data processing and SQL generation
 * - sanitizeKeysRecursive(): Clean up internal property names
 * - deduplicateByUniqueConstraints(): Remove duplicates based on model constraints
 * - pruneUpdatePayload(): Filter out non-updateable fields
 * - buildUpdateQuery(): Generate optimized SQL for batch updates
 * - escapeValue(): Database-specific value escaping for SQL injection prevention
 * - JSON field handling with proper escaping
 * 
 * ModelUtils:
 * - Model metadata and relationship utilities with caching
 * - getModelInformation(): Retrieve Prisma model metadata
 * - getUniqueConstraints(): Extract unique constraint definitions
 * - getIncludesTree(): Build nested relation includes
 * - detectRelationType(): Identify explicit vs implicit many-to-many relations
 * - getJoinTableInfo(): Extract join table metadata for many-to-many relations
 * - Comprehensive caching for performance optimization
 * 
 * DataUtils:
 * - Relational data processing and many-to-many handling
 * - processRelations(): Transform relation objects to foreign keys
 * - extractManyToManyRelations(): Separate many-to-many data from entity data
 * - applyManyToManyRelations(): Apply many-to-many relations after entity creation
 * - normalizeRelationsToFK(): Convert relation objects to FK fields
 * - Support for both explicit and implicit many-to-many relations
 */
export { default as BaseEntity } from './core/base-entity';
export { default as BaseEntityBatch } from './core/base-entity-batch';
export { default as BaseEntityQuery } from './core/base-entity-query';
export { default as BaseEntityHelpers } from './core/base-entity-helpers';
export { default as ModelUtils, type JoinTableInfo } from './core/model-utils';
export { default as DataUtils } from './core/data-utils';

/**
 * Database Utilities
 * 
 * Database provider detection, capabilities, and SQL formatting:
 * - getDatabaseProvider: Detect database provider from Prisma client
 * - getDatabaseProviderCached: Cached version for better performance
 * - getDatabaseCapabilities: Get database-specific feature support
 * - quoteIdentifier: Database-specific identifier quoting
 * - formatBoolean: Database-specific boolean formatting
 */
export {
    getDatabaseProvider,
    getDatabaseProviderCached,
    clearDatabaseProviderCache,
    getDatabaseDialect,
    getDatabaseCapabilities,
    supportsFeature,
    quoteIdentifier,
    formatBoolean,
    type DatabaseProvider,
    type DatabaseDialect,
    type DatabaseCapabilities
} from './core/utils/database-utils';

/**
 * Performance Utilities
 * 
 * Performance optimization and batch sizing:
 * - getOptimalBatchSize: Get optimal batch size for database operations
 * - estimateBatchMemoryUsage: Estimate memory usage for batch operations
 * - createOptimalBatches: Create batches with optimal sizing
 * - withRetry: Retry failed operations with exponential backoff
 * - getOptimalOrBatchSize: Get optimal batch size for OR queries
 * - BATCH_SIZE_CONFIG: Database-specific batch size configurations
 */
export {
    getOptimalBatchSize,
    estimateBatchMemoryUsage,
    isBatchSafe,
    createBatchMetrics,
    withRetry,
    getOptimalOrBatchSize,
    calculateOrPlaceholders,
    isOrQuerySafe,
    BATCH_SIZE_CONFIG,
    DEFAULT_RETRY_CONFIG,
    type BatchMetrics,
    type RetryConfig
} from './core/utils/performance-utils';

/**
 * Validation Utilities
 * 
 * Type checking and validation helpers:
 * - isObject: Check if value is a plain object
 * - isEmpty: Check if value is empty (null, undefined, empty string/array/object)
 * - isValidValue: Check if value is valid for database operations
 * - isNonEmptyArray: Check if value is a non-empty array
 * - shouldSkipField: Determine if field should be skipped in updates
 */
export {
    isObject,
    isEmpty,
    isValidValue,
    hasPrismaOperations,
    isNonEmptyArray,
    shouldSkipField
} from './core/utils/validation-utils';

/**
 * Comparison Utilities
 * 
 * Deep comparison and change detection:
 * - deepEqual: Deep equality comparison for any values
 * - hasChanges: Detect if object has changes compared to another
 * - normalizeValue: Normalize values for comparison
 */
export {
    normalizeValue,
    deepEqual,
    deepEqualArrays,
    deepEqualObjects,
    hasChanges
} from './core/utils/comparison-utils';

/**
 * Batch Utilities
 * 
 * Batch creation and processing:
 * - createBatches: Split array into batches of specified size
 * - processBatches: Process batches with callback (sequential or parallel)
 * - getOptimalBatchSize: Get optimal batch size for operations
 */
export {
    createBatches,
    getOptimalBatchSize as getBatchSize,
    processBatches,
    type BatchProcessingOptions,
    type BatchProcessingResult
} from './core/utils/batch-utils';

/**
 * Error Utilities
 * 
 * Error handling and logging:
 * - logError: Consistent error logging with context
 * - isUniqueConstraintError: Check if error is unique constraint violation
 * - handleUniqueConstraintError: Handle unique constraint errors with retry
 * - withErrorHandling: Wrap operations with error handling and fallback
 */
export {
    logError,
    isUniqueConstraintError,
    handleUniqueConstraintError,
    withErrorHandling
} from './core/utils/error-utils';

/**
 * Query Utilities
 * 
 * Query optimization and batching:
 * - needsOrBatching: Check if OR query needs batching
 * - createOrBatches: Create batches for large OR queries
 * - executeWithOrBatching: Execute query with automatic OR batching
 * - deduplicateResults: Remove duplicate results by ID
 */
export {
    needsOrBatching,
    createOrBatches,
    deduplicateResults,
    executeWithOrBatching,
    type OrBatchingOptions
} from './core/query-utils';

/**
 * Decorators
 * 
 * Property decorators for entity classes:
 * - Property: Mark class properties for automatic initialization and tracking
 */
export { Property } from './core/decorators/property.decorator';

/**
 * Search Utilities
 * 
 * Advanced search and filtering capabilities:
 * - SearchUtils: Apply search filters and conditions to queries
 * - SearchBuilder: Fluent API for building complex search queries
 * - ConditionUtils: Build Prisma where conditions from search criteria
 * - ObjectUtils: Object manipulation utilities for search operations
 */
export { default as SearchUtils } from './core/search-utils';
export { default as SearchBuilder } from './core/search-builder';
export { default as ConditionUtils } from './core/condition-utils';
export { default as ObjectUtils } from './core/object-utils';

/**
 * Types
 * 
 * TypeScript type definitions for search, pagination, and filtering
 */
export * from './core/structures/types/search.types';

/**
 * Interfaces
 * 
 * TypeScript interfaces for BaseEntity and related functionality
 */
export * from './core/structures/interfaces/base-entity.interface';
