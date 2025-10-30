# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2025-10-30

### Fixed
- **Scalar Array Support**: Fixed `processRelations()` to preserve scalar arrays (String[], Int[], ObjectId[]) instead of wrapping them in `{ connect: [] }` - critical for MongoDB ObjectId arrays
- **MySQL JSON Escaping**: Fixed JSON field corruption in raw SQL UPDATE queries by properly escaping backslashes for MySQL JSON fields
- **Change Detection Performance**: Optimized `hasChanges()` with early exit and custom `deepEqual()`

### Changed
- Removed hardcoded `siteUuid` from ignored fields in change detection - now only ignores standard fields (id, createdAt, updatedAt) with optional custom fields parameter
- Refactored change detection methods for better readability: `isStandardIgnoredField()`, `normalizeValueForComparison()`, `deepEqualArrays()`, `deepEqualObjects()`

### Added
- MySQL integration tests for JSON fields and special characters (`tests/integration/fields.mysql.test.ts`)
- Scalar array unit tests covering String[], Int[], ObjectId arrays, and mixed types
- Performance tests for optimized change detection

## [1.0.0] - 2025-10-29

### Added
- Parallel batch operations with automatic connection pool detection (2-6x performance improvement)
  - Pool size detection from `DATABASE_URL` parameters (`connection_limit`, `pool_size`, `maxPoolSize`)
  - MongoDB `maxPoolSize` parameter support for connection pool configuration
  - New parallel execution utilities: `executeInParallel()`, `chunkForParallel()`, `shouldUseParallel()`
  - Rate limiting with token bucket algorithm (`createRateLimiter()`, `TokenBucketRateLimiter`)
  - Performance metrics tracking (speedup, efficiency, throughput)
- OR query batching with database-aware limits
  - `getOptimalOrBatchSize()` for safe batch size calculation
  - `calculateOrPlaceholders()` for placeholder usage tracking
  - `isOrQuerySafe()` to determine if batching is needed
  - Database-specific placeholder/parameter limit configurations
- Comprehensive documentation in `docs/parallel-batch-operations.md` and `docs/or-query-batching.md`

### Changed
- All batch methods now support parallel execution with optional `parallel` and `concurrency` parameters
  - `createMany()`, `upsertMany()`, `updateManyById()`, `deleteByIds()` enhanced with parallel options
  - Automatic fallback to sequential execution for small datasets or single connections
  - PostgreSQL: Up to 3.2x speedup for deletes, 2.4x for creates
  - MySQL: Up to 4.8x speedup for deletes
  - MongoDB: 1.3-1.8x speedup with conservative concurrency (2-4 recommended)
- Test infrastructure improvements
  - Jest configuration excludes database-specific tests from default suite
  - Dedicated test scripts for each database: `test:mongodb`, `test:postgresql`, `test:mysql`, `test:sqlite`
  - 78 new unit tests for parallel execution infrastructure
  - Database compatibility integration tests and performance benchmarks

## [0.1.14] - 2025-10-27
### Added
- **MongoDB Support**: Full support for MongoDB databases
  - Added MongoDB provider to `DatabaseProvider` type
  - Created MongoDB Prisma schema (`tests/prisma/schema.mongodb.prisma`)
  - Added MongoDB Docker container configuration
  - Created MongoDB-specific integration tests (15 tests)
  - Added `test:mongodb` npm script for MongoDB testing
  - Updated `test-all-databases` script to include MongoDB
  - MongoDB uses ObjectId (string) instead of autoincrement (number) for IDs
  - Optimized `updateManyById()` for MongoDB using Prisma transactions
  - Updated `id` field type to support both `number` (SQL) and `string` (MongoDB)
  - Added MongoDB connection string to `.env.example`
  - Complete MongoDB documentation in `docs/mongodb-support.md`

- **Performance Utilities**: New performance optimization module (`src/performance-utils.ts`)
  - `getOptimalBatchSize()` - Get database-specific optimal batch sizes
  - `estimateBatchMemoryUsage()` - Estimate memory usage for batch operations
  - `isBatchSafe()` - Check if batch operation is safe to execute
  - `createOptimalBatches()` - Split arrays into optimal batches
  - `createBatchMetrics()` - Track batch operation performance
  - `withRetry()` - Execute operations with exponential backoff retry
  - `chunk()` - Efficient array chunking utility
  - Database-specific batch size configurations (BATCH_SIZE_CONFIG)
  - Comprehensive test suite for performance utilities (18 tests)

### Changed
- **Flexible ID Types**: Updated `id` field to support both `number` and `string` types
  - `BaseEntity.id` is now `number | string | undefined`
  - `IBaseEntity.id` interface updated to support both types
  - `delete()` method return type changed to `number | string`
  - All database operations now handle both ID types correctly

- **Optimized MongoDB Batch Operations**:
  - `updateManyById()` now uses Prisma transactions for MongoDB (atomic batch updates)
  - Added `MONGODB_TRANSACTION_BATCH_SIZE` constant (100 items per transaction)
  - Automatic fallback to individual updates if transaction fails
  - Transaction timeout and maxWait configuration for reliability
  - Smaller batch sizes for MongoDB to respect transaction limits

- **Improved Error Handling**:
  - Better error messages for batch operations
  - Retry logic for transient errors in `createMany()`
  - Graceful fallback strategies for failed batch operations
  - More informative console logging for debugging

### Performance
- **MongoDB**: Batch updates now use transactions (up to 100x faster than individual updates)
- **All Databases**: Optimized batch size selection based on database provider
- **Memory**: Better memory estimation and safety checks for large batches

## [0.1.13] - 2025-10-27

### Added
- **JSON Field Support**: Full support for JSON/JSONB fields in all database operations
  - JSON fields are now preserved as-is without being wrapped in `connect`/`create` structures
  - Automatic detection of JSON fields using Prisma model metadata
  - PostgreSQL-specific JSONB casting in batch update queries
  - 13 comprehensive integration tests for JSON field operations in PostgreSQL
  - New `Product` model in test schemas with `metadata` and `settings` JSON fields

### Changed
- **Optimized Batch Upsert Performance**: Major performance improvements in `upsertMany()`
  - Changed from N individual queries to 1 batch query using `findMany({ OR: [...] })`
  - Batch comparison of changes in memory instead of individual checks
  - Batch operations: `createMany` + `updateManyById` instead of N individual operations
  - Performance improvement: from N+M queries to 2-3 queries total
  - Added `hasChanges()` and `getChangedFields()` helper methods for efficient change detection
  - Only compares fields present in new data (ignores extra fields in existing records)

- **Enhanced Data Processing**:
  - `DataUtils.processRelations()` now accepts optional `modelInfo` parameter
  - Detects JSON fields (`type: 'Json'` or `type: 'Bytes'`) and preserves them without relation processing
  - All entity methods now pass `modelInfo` to `processRelations()`: `create()`, `update()`, `createMany()`, `upsert()`, `upsertMany()`, `updateManyById()`

- **Improved Batch Updates**:
  - `prepareUpdateList()` now allows JSON objects in update payloads
  - `escapeValue()` properly serializes JSON objects to strings
  - `buildUpdateQuery()` adds PostgreSQL-specific `::jsonb` casting for JSON fields
  - Fixed table name resolution with multiple fallbacks: `dbName` → `name` → `model.name`

### Fixed
- Fixed JSON fields being incorrectly filtered out in batch update operations
- Fixed JSON objects being converted to `[object Object]` in SQL queries
- Fixed `update()` method not passing `modelInfo` to `processRelations()` after merge

### Tests
- Added 13 integration tests for JSON field operations (create, update, upsert, upsertMany, createMany)
- Added 3 unit tests for JSON field preservation in `DataUtils`
- All 309 tests passing across SQLite, MySQL, and PostgreSQL


## [0.1.12] - 2025-10-20

### Fixed
- **Update Method**: Fixed `update()` to correctly handle entities with both FK field and relation object
  - `DataUtils.normalizeRelationsToFK()` now preserves explicit FK values instead of overwriting with relation object ID
  - Added 8 new integration tests for update scenarios with relations

### Changed
- Refactored `BaseEntity.pruneUpdatePayload()` for better maintainability
  - Split into helper methods: `shouldSkipField()`, `isEmptyObject()`, `hasPrismaOperations()`, `removeRelationObjectsWithFK()`
  - Improved filtering of Prisma operation objects (`connect`, `create`, `update`, etc.)
  - Reduced cognitive complexity

## [0.1.11] - 2025-10-16

### Added
- **Upsert Operations**: New `upsert()` and `upsertMany()` methods for smart create/update logic
  - Automatically detects existing records using unique constraints from Prisma schema
  - Only updates when actual changes are detected, avoiding unnecessary database writes
  - `upsert(data)`: Returns the entity (created, updated, or unchanged)
  - `upsertMany(items)`: Returns detailed statistics `{ created, updated, unchanged, total }`
  - Supports composite unique constraints and partial updates
  - Uses `ModelUtils.getUniqueConstraints()` for dynamic unique field detection
  - Added `findFirst` mock support in test infrastructure
  - 6 unit tests for upsert functionality
  - 11 integration tests

## [0.1.10] - 2025-10-16

### Added
- **Model-Aware Structure Building**: Enhanced `ObjectUtils` with Prisma relation awareness
  - New `buildWithRelations()` method constructs proper Prisma filter structures with `is`/`some` wrappers
  - Enhanced `assign()` method now accepts optional `modelInfo` parameter for relation-aware creation

### Fixed
- **Search with Nested Array Relations**: Fixed search query generation for deeply nested array relations
  - Search paths like `posts.author.name` now correctly generate `{ posts: { some: { author: { is: { name: {...} } } } } }`
  - Previously generated invalid structure: `{ posts: { author: { name: {...} } } }` causing "Unknown argument" errors
  - Fixed for both AND and OR grouping in search conditions
  - Resolves errors when searching on nested paths: array → single, array → array → single, etc.
- **Filter Merge with Nested Relations**: Fixed `ObjectUtils.assign()` to correctly merge filters when the same relation appears in both base filters and string search

### Changed
- Updated `SearchBuilder.build()` and `apply()` to propagate `modelInfo` through the query building chain
- Updated `BaseEntity.findByFilter()` to pass `modelInfo` to search filter operations
- Enhanced `ObjectUtils.assign()` to create Prisma-compliant structures when modelInfo is provided

### Tests
- Added 3 unit tests for `ObjectUtils.assign()` with modelInfo parameter
- Added 7 unit tests for `ObjectUtils.buildWithRelations()` method
- Added 8 integration tests for search queries with nested array relations
- Total: 18 new tests in v0.1.10, all 267 tests passing

## [0.1.9] - 2025-10-16

### Fixed
- **Filter Merge with Nested Relations**: Fixed `ObjectUtils.assign()` to correctly merge filters when the same relation appears in both base filters and string search
  - Now properly navigates into existing `is`/`some` wrappers instead of overwriting them
  - Resolves "Unknown argument" errors when combining nested relation filters with search queries
  - Example: `{ group: { is: {...} } }` + search on `group.course.name` now merges correctly
  - Added 5 new tests (unit) for Prisma filter structure merging
  - Added 3 new integration tests for real-world filter merge scenarios

### Changed
- Enhanced `ObjectUtils.assign()` to detect and merge with Prisma filter structures (`is`, `some`)
- Improved handling of complex nested queries with mixed filters and searches

## [0.1.8] - 2025-10-15

### Fixed
- **Nested Relation Filters**: Fixed `applyDefaultFilters()` to correctly handle deeply nested relations at any level
  - Filters now properly propagate model information through all nesting levels
  - Array relations (`some`) and single relations (`is`) are correctly identified at any depth
  - Added `getRelationModelInfo()` helper to resolve model info for nested relations
  - Added 3 new tests for deeply nested relation filtering

### Changed
- Enhanced `SearchUtils.buildDefaultCondition()` to retrieve and pass correct model info for nested relations
- Improved nested filter handling for complex relation structures (e.g., `group: { groupMembers: { userId: 81 } }`)

## [0.1.7] - 2025-10-14

### Added
- **Wildcard Relation Includes**: Support for `"*"` in `relationsToInclude` to automatically include all first-level relations
  - Use `relationsToInclude: "*"` in `findByFilter()` to load all direct relations
  - Wildcard only includes first-level relations (no deep nesting)
  - Can be mixed with specific nested relations for fine-grained control
  - Added 6 new tests (3 unit + 3 integration) for wildcard functionality

### Changed
- Updated `ModelUtils.getIncludesTree()` to handle `"*"` parameter for first-level relation expansion
- Enhanced `BaseEntity.findByFilter()` to accept `"*"` string in addition to arrays for `relationsToInclude`

## [0.1.4] - 2025-10-14

### Fixed
- Fixed `ModelUtils.getModelDependencyTree()` to include all relation fields, not just required ones

### Changed
- Improved optional chaining in `BaseEntity.findByFilter()` for safer property access

## [0.1.3] - 2025-10-13

### Fixed
- Fixed package.json entry points to match actual build output (`index.js`/`index.mjs`)

### Changed
- Updated module exports to correctly point to CommonJS and ESM builds

## [0.1.2] - 2025-10-13

### Fixed
- Fixed `@Property()` decorator not being exported in compiled CommonJS output
- Removed unnecessary `emitDecoratorMetadata` from TypeScript configuration
- Added `tsup.config.ts` for proper build configuration

### Changed
- Improved build process to ensure all decorators are properly compiled and exported

## [0.1.1] - 2025-10-13

### Added
- **Multi-Database Support**: Full support for MySQL, PostgreSQL, SQLite, and SQL Server
  - Automatic database provider detection from Prisma configuration
  - Database-specific SQL dialect handling (identifier quoting, boolean formatting)
  - New utility functions: `getDatabaseProvider()`, `getDatabaseDialect()`, `quoteIdentifier()`, `formatBoolean()`
  - Comprehensive unit tests for all database utilities (23 new tests)

- **Property Decorator**: New `@Property()` decorator for cleaner entity class definitions
  - Automatically creates private properties with getters and setters
  - Simplifies entity field declarations
  - Full TypeScript support with type safety
  
- **Testing Infrastructure**: 
  - Docker Compose configuration for MySQL (port 3311) and PostgreSQL (port 5433) testing
  - Separate Prisma schemas for each database provider
  - PowerShell scripts for automated multi-database testing
  - NPM scripts for easy database testing workflows:
    - `npm run test:mysql`
    - `npm run test:postgresql`
    - `npm run test:all-databases`
    
- **Documentation**:
  - Comprehensive Multi-Database Testing Guide
  - Examples demonstrating database-agnostic code
  - Updated README with database support and decorator information

### Changed
- Updated `BaseEntity.buildUpdateQuery()` to use database-agnostic identifier quoting
- Updated `BaseEntity.escapeValue()` to use database-specific boolean formatting
- Updated `BaseEntity.createMany()` to handle database-specific features (e.g., `skipDuplicates` support)
- Enhanced package.json with new test scripts for different databases
- Improved test utilities to support dynamic Prisma client loading per database

### Technical Details
- SQL generation now adapts to database dialect automatically
- Boolean values formatted correctly for each database (1/0 for MySQL/SQLite, TRUE/FALSE for PostgreSQL)
- Identifier quoting uses correct syntax (backticks for MySQL, double quotes for PostgreSQL/SQLite/others)
- RETURNING clause support detection for optimized queries
- Dynamic Prisma client imports for multi-database testing
- Database capability detection (e.g., `skipDuplicates` parameter support)

## [0.1.0] - 2025-10-09

### Added
- Initial release with Active Record pattern
- Fluent query builder with relation graphs
- Batch operations and advanced CRUD
- Search filters and pagination utilities
- TypeScript support with full type safety
- Integration with Prisma ORM
