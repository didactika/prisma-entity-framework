# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
