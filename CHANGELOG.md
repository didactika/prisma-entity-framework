# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.3] - 2026-03-16

### Fixed

- **`upsertMany()` with Prisma enums (Raw SQL)**: Fixed enum columns being omitted from generated `INSERT`/`UPDATE` SQL. This could cause failures like `NOT NULL constraint failed` on required enum fields.

### Added

- **Enum integration tests**: Added integration coverage for enum fields across `create()`, `update()`, `upsert()`, and `upsertMany()`, including mixed batch outcomes (created/updated/unchanged).

## [1.2.2] - 2026-03-13

### Fixed

- **Prisma Validation Error with `includeNull: true` in Date Range Search**: `rangeSearch` was generating `OR` clauses with raw `field: null` conditions for DateTime filters. In this query shape Prisma expects `field: { equals: null }`, and could throw validation errors (`Argument \`createdAt\` is missing`). The null branch is now emitted as `equals: null`.

- **Prisma Validation Error with Required DateTime Fields (without `includeNull`)**: For range filters without `includeNull`, the builder always appended `not: null`. This is only valid for nullable fields and caused errors on required DateTime fields (`Argument \`not\` must not be null`). Null exclusion is now applied only when the target field is nullable.

### Added

- **Integration Test Coverage for Date Range Null Semantics**: Added integration tests for `findByFilter` + `rangeSearch` validating:
  - `includeNull: true` includes both in-range dates and `NULL` values on nullable DateTime fields.
  - Omitting `includeNull` excludes `NULL` values on nullable DateTime fields.
  - Required DateTime range filters work without Prisma validation errors.

## [1.2.1] - 2026-03-13

### Fixed

- **All-Zero Counts for Models Without Updatable Columns**: Models used purely as join/pivot tables (e.g., composite-key-only models with no non-key columns to update) generated an empty `DO UPDATE SET` or `ON DUPLICATE KEY UPDATE SET` clause, producing invalid SQL. Batch execution would fail silently, returning `{created:0, updated:0, unchanged:0}` regardless of the input. PostgreSQL and SQLite now use `ON CONFLICT (...) DO NOTHING` when there are no updatable columns; MySQL uses a no-op self-assignment (`col = col`) as a fallback.

- **Silent Batch Failure Swallowing**: `executeRawUpsertBatch` previously caught all batch errors internally and returned zero counts when every batch in a run failed. It now re-throws the first batch error when all batches fail, making the failure visible to the caller instead of silently producing `{created:0, updated:0, unchanged:0, total:N}`.

- **PostgreSQL Inserted-Flag Misparse**: The PostgreSQL driver sometimes returns the `_was_inserted` result column as the string `'t'` or `'f'` rather than a boolean. Because `Boolean('f')` evaluates to `true` in JavaScript, updates were silently miscounted as inserts. Added `parseInsertedFlag()` which explicitly normalises all truthy-string forms (`'t'`, `'true'`, `'1'`, `'y'`, `'yes'`) to `true` and everything else to `false`.

- **BigInt-Safe Count Parsing**: Prisma can return `affectedRows` as a `BigInt` from MySQL and SQLite providers. Arithmetic on mixed `BigInt`/`number` values throws a `TypeError` in JavaScript. Added `toSafeNonNegativeInteger()` which converts `BigInt`, `null`, and `undefined` to a safe `number`, clamping negative results to `0`.

- **Defensive Count Normalisation**: Added `normalizeUpsertCounts()` as a last-line safety check. After all provider-specific parsing, counts are clamped to non-negative values and validated against the `created + updated + unchanged === total` invariant. When a violation is detected the function corrects the values and logs an error, making anomalies visible without crashing the caller.

- **Negative Count Values in Upsert Results**: Fixed `parseUpsertResults` producing negative values (e.g., `-1`) for `created`, `updated`, or `unchanged` counts. This occurred when race conditions or pre-count inconsistencies caused subtraction results to go below zero. Added `Math.max(0, ...)` guards to all subtraction-based count calculations across all four database providers (PostgreSQL, MySQL, SQLite, SQL Server).

## [1.2.0] - 2026-03-12

### Fixed

- **Negative Count Values in Upsert Results**: Fixed `parseUpsertResults` producing negative values (e.g., `-1`) for `created`, `updated`, or `unchanged` counts. This occurred when race conditions or pre-count inconsistencies caused subtraction results to go below zero. Added `Math.max(0, ...)` guards to all subtraction-based count calculations across all four database providers (PostgreSQL, MySQL, SQLite, SQL Server).

## [1.1.10] - 2026-03-12

### Fixed

- **PostgreSQL Upsert with @@unique Constraints**: Fixed `getUniqueConstraints()` not reading `@@unique` composite constraints defined via `uniqueFields` in Prisma's runtime model. Only `uniqueIndexes` and field-level `@unique` were being read, causing PostgreSQL error `42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification`. Now reads `uniqueFields` first, then `uniqueIndexes`, then `field.isUnique`, with deduplication via `Set<string>`.

## [1.1.9] - 2026-03-12

### Added

- **Raw SQL Upsert Optimization**: `upsertMany()` now uses single-statement raw SQL (`INSERT ... ON CONFLICT`/`ON DUPLICATE KEY`/`MERGE`) for PostgreSQL, MySQL, SQLite, and SQL Server. MongoDB continues using the legacy multi-query approach. Performance improvement: from N+M queries to 1-2 queries.

- **Comprehensive upsertMany Integration Tests**: Added 17 new integration tests covering all edge cases: all creates, all updates, all unchanged, mixed operations, duplicate key deduplication, large batches, null handling, timestamp behavior, and consecutive calls.

### Fixed

- **PostgreSQL Duplicate Key in Batch**: Fixed "ON CONFLICT DO UPDATE command cannot affect row a second time" error when multiple items share the same unique key. Items are now deduplicated before SQL generation (last-write-wins semantics).

- **MySQL Unchanged Count**: Fixed incorrect `unchanged` count in MySQL upserts. Two bugs addressed:
  - SET clause ordering: `updatedAt` conditional now evaluated FIRST (MySQL evaluates SET left-to-right)
  - Parsing formula: Corrected for Prisma's `CLIENT_FOUND_ROWS` flag where matched-but-unchanged rows return 1

- **SQLite Timestamp Precision**: Fixed `updatedAt` comparisons failing because `datetime('now')` returns second precision while Prisma stores milliseconds. Now uses `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` for millisecond precision.

- **Upsert Without @unique Fields**: Models with only `@id` (no `@unique` fields) can now use upsert operations. `getUniqueConstraints()` falls back to the primary key when no unique constraints exist.

- **MongoDB Duplicate Key Processing**: Fixed items with same unique key being processed multiple times in MongoDB upserts. Added deduplication with last-write-wins semantics to `upsertManyLegacy`.

- **createMany Treating All Items as Duplicates**: Fixed `deduplicateByUniqueConstraints` incorrectly treating all items as duplicates when the unique constraint field (e.g., `id`) is not provided in the data. Now skips constraints where items don't provide all field values.

## [1.1.8] - 2026-03-10

### Fixed

- **False Positive Change Detection in Upsert (hasChanges)**: Fixed `hasChanges()` reporting changes when values were actually equal, causing unnecessary database updates. Five root-cause bugs were addressed:
  - **Float/Decimal precision**: Prisma returns `Decimal` objects (decimal.js) from the database, which failed strict equality against plain numbers. Now coerced via `Number(value.toString())` before comparison.
  - **Float epsilon tolerance**: Added relative epsilon comparison (`Math.abs(a - b) <= Number.EPSILON * Math.max(1, |a|, |b|)`) to handle IEEE 754 floating-point rounding differences.
  - **Date reference equality**: `Date` objects were compared by reference instead of value. Now compared via `getTime()` timestamps.
  - **JSON/object deep equality**: Nested JSON objects were compared by reference. `deepEqual()` now recursively compares objects, with special handling for `Date` and `Decimal` types.
  - **BigInt coercion**: `BigInt` values are now coerced to `Number` for comparison.

- **MongoDB Null Inclusion in Range Queries**: Fixed `rangeSearch` without `includeNull` returning records with null values on MongoDB. MongoDB treats null as less than any value in `lte`/`gte` comparisons (unlike SQL where NULL comparisons return NULL). Range conditions now explicitly add `not: null` to exclude null values when `includeNull` is not set.

- **Multi-Database Test Infrastructure**:
  - **Docker stderr handling**: Fixed `test-database.ps1` script failing on Docker container startup because PowerShell's `$ErrorActionPreference = "Stop"` treated Docker's stderr progress messages ("Network Creating", "Volume Creating") as terminating exceptions.
  - **Missing Job model**: Added `Job` model to MySQL, PostgreSQL, and MongoDB Prisma schemas (was only in SQLite test schema), fixing `TypeError: Cannot read properties of undefined` in `datetime-fields` and `rangeSearch includeNull` integration tests.
  - **Added Float/Decimal fields**: Added `price Float?`, `discount Float?`, and `weight Decimal?` fields to `Product` model across all database schemas to support float comparison integration tests.

### Added

- **Comparison Utilities Module** (`src/core/utils/comparison-utils.ts`): New dedicated module with extracted and improved comparison functions:
  - `normalizeValue()` — Normalizes values for comparison (whitespace trimming, Decimal coercion, BigInt coercion)
  - `deepEqual()` — Recursive deep equality with Date/Decimal awareness
  - `numbersAreEqual()` — Epsilon-tolerant numeric comparison for float precision
  - `fieldHasChanged()` — Per-field change detection with normalization pipeline
  - `isDecimalLike()` — Duck-type detection for Prisma Decimal / decimal.js objects

- **Unit Tests**: Added 129 new tests for `comparison-utils` and 23 new tests for `upsert` edge cases covering Decimal objects, float precision, Date comparisons, JSON/object deep equality, BigInt, and mixed-type scenarios.

- **Integration Tests**: Added `upsert-comparison.integration.test.ts` for Float, DateTime, JSON, and batch upsert comparison scenarios.

## [1.1.7] - 2026-03-05

### Fixed

- **JSON Primitive Casting in Batch Updates**: Fixed `escapeValue()` producing invalid SQL for JSON fields with primitive values (numbers, booleans, strings). Previously, a numeric JSON value like `42` generated `42::jsonb` which PostgreSQL rejected with `ERROR: cannot cast type integer to jsonb` (code `42846`). Now primitive JSON values are routed through `escapeJsonValue()` first, producing valid SQL like `'42'::jsonb`.

### Added

- **Unit Tests**: Added 4 new tests for `escapeValue()` covering JSON primitive scenarios (numbers, booleans, strings, null/undefined)

## [1.1.5] - 2026-02-18

### Changed

- **Documentation**: Updated README and advanced-examples.md with `filterGrouping`, `includeNull`, and multiple `orderBy` examples

## [1.1.4] - 2026-02-18

### Added

- **Array Filter Support**: `findByFilter` now accepts an array of filter objects with `filterGrouping` option
  - `filterGrouping: 'or'` combines filters with OR logic
  - `filterGrouping: 'and'` (default) combines filters with AND logic
  - Example: `findByFilter([{ status: 'PENDING' }, { status: 'FAILED' }], { filterGrouping: 'or' })`

- **includeNull Option for rangeSearch**: New `includeNull` property in `RangeSearch` type
  - When `true`, includes records where the field is NULL in addition to matching the range
  - Useful for queries like "scheduledFor <= now OR scheduledFor IS NULL"
  - Example: `rangeSearch: [{ keys: ['scheduledFor'], max: new Date(), includeNull: true }]`

- **New Types**: Added `FilterGrouping`, `FilterInput<T>` types for better type safety

- **Unit Tests**: Added 10 new unit tests for array filters and includeNull functionality

- **Integration Tests**: Added 6 new integration tests for filterGrouping and includeNull

### Fixed

- **Multiple OrderBy Fields**: Fixed `orderBy` option to support arrays for multiple sort fields

### Changed

- **OrderBy Type**: Updated `OrderBy` type from `Record<string, 'asc' | 'desc'>` to `OrderByItem | OrderByItem[]` to properly support both single and multiple field sorting
- **sortResults Method**: Updated internal `sortResults()` to iterate through all orderBy items when sorting in-memory results
- **findByFilter Signature**: Updated to accept `FilterInput<TModel>` (single filter or array of filters)

## [1.1.3] - 2026-01-19

### Fixed

- **Date Field Handling**: Fixed Date objects being incorrectly processed across multiple methods:
  - `processRelations()` - Date objects were wrapped in `{ create: {} }` structures
  - `sanitizeKeysRecursive()` - Date objects were converted to empty `{}` objects
  - `shouldSkipField()` - Date objects were incorrectly skipped because `isEmpty(Date)` returned true
  - All DateTime fields now correctly preserve Date objects and null values

### Changed

- **Prisma Version**: Pinned `prisma` to `6.19.1` and constrained `@prisma/client` peer dependency to `>=6.0.0 <7.0.0`

### Added

- **DateTime Integration Tests**: New `datetime-fields.integration.test.ts` with 8 tests for Date object handling
- **Date Unit Tests**: 3 new unit tests in `data-utils.test.ts` for Date preservation
- **Test Model**: Added `Job` model to test schema with explicit `scheduledFor DateTime?` field

## [1.1.2] - 2026-01-19

### Fixed

- **Date Field Handling (initial fix)**: Fixed `processRelations()` incorrectly wrapping Date objects in `{ create: {} }` structures

### Changed

- **Prisma Version**: Pinned `prisma` to `6.19.1` and constrained `@prisma/client` peer dependency to `>=6.0.0 <7.0.0`

## [1.1.1] - 2025-11-20

### Fixed

- **EntityPrismaModel**: Fixed type definition of prisma model interface to be more permissive and generic.

## [1.1.0] - 2025-11-20

### Changed

- **IMPORTANT**: Removed `skipDuplicates` and other standalone parameters from `createMany` and `upsertMany` in favor of a unified `options` object.
  - `createMany(items, skipDuplicates)` -> `createMany(items, { skipDuplicates })`
  - `upsertMany(items, keyTransformTemplate)` -> `upsertMany(items, { keyTransformTemplate })`
  - `updateManyById(dataList, parallel, concurrency)` -> `updateManyById(dataList, { parallel, concurrency })`
- **IMPORTANT**: The generic type constraint for entity operations has been changed from `Record<string, unknown>` to `object`. This supports a wider range of entity models (including class instances) but may break implementations relying on strict `Record` types. Consumers extending `BaseEntity` should update their generic constraints to `object` or `Record<string, any>`.
- **Consolidated Batch Options**: Refactored batch operations (`createMany`, `upsert`, `upsertMany`, `updateManyById`) to use a consistent options object pattern. This improves API extensibility and readability.
- **Generic Type Refactoring**: Relaxed generic type constraints from `Record<string, unknown>` to `object` (and renamed `T` to `TModel`) across `BaseEntity`, `BaseEntityBatch`, `BaseEntityQuery`, and `DataUtils`.
- **Type Safety**: Improved type safety in `DataUtils.extractManyToManyRelations` with explicit casting.
- **Documentation**: Updated API documentation to reflect the new options object pattern and provide detailed parameter descriptions.

### Added

- **Test Infrastructure**: Updated `prisma-client.mock.ts` to include mock implementations for `findUnique`, `updateMany`, and `upsert` to support new test cases.

## [1.0.3] - 2025-10-30

### Fixed

Added SqlServer in supported database providers list

## [1.0.2] - 2025-10-30

### Changed

- **Optimized `executeInParallel()`**: Eliminated nested loops, reduced memory allocations, and removed redundant Promise wrappers faster parallel execution

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

## [0.1.13] - 2025-10-27

### Added

- **JSON Field Support**: Full support for JSON/JSONB fields in all database operations
  - JSON fields are now preserved as-is without being wrapped in `connect`/`create` structures
  - Automatic detection of JSON fields using Prisma model metadata
  - PostgreSQL-specific JSONB casting in batch update queries
  - 13 comprehensive integration tests for JSON field operations in PostgreSQL
  - Added 3 unit tests for JSON field preservation in `DataUtils`
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

## [0.1.0] - 2025-10-09

### Added

- Initial release with Active Record pattern
- Fluent query builder with relation graphs
- Batch operations and advanced CRUD
- Search filters and pagination utilities
- TypeScript support with full type safety
- Integration with Prisma ORM
