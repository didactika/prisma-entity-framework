# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
