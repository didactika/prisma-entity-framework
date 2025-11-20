# Testing Guide

This document describes the testing infrastructure for the Prisma Entity Framework.

## Test Structure

The project uses Jest for testing with two main categories:

- **Unit Tests**: Test individual functions and classes in isolation
- **Integration Tests**: Test database operations with real database connections

## Running Tests

### All Tests (Default - SQLite)
```bash
npm test
```

### Unit Tests Only
```bash
npm run test:unit
```

### Integration Tests Only
```bash
npm run test:integration
```

### Database-Specific Tests

Test against specific databases:

```bash
# SQLite (in-memory)
npm run test:sqlite

# MySQL (requires Docker)
npm run test:mysql

# PostgreSQL (requires Docker)
npm run test:postgresql

# MongoDB (requires Docker)
npm run test:mongodb

# All databases
npm run test:all-databases
```

### Other Test Commands

```bash
# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Verbose output
npm run test:verbose
```

## Test Scripts

The testing infrastructure uses PowerShell scripts located in the `scripts/` directory:

- **test-database.ps1**: Unified script that handles testing for any database
- **test-all-databases.ps1**: Runs tests against all supported databases sequentially

### Script Usage

The unified script can be called directly:

```powershell
# Test with specific database
.\scripts\test-database.ps1 -Database mysql
.\scripts\test-database.ps1 -Database postgresql
.\scripts\test-database.ps1 -Database mongodb
.\scripts\test-database.ps1 -Database sqlite
```

## Docker Setup

The project uses Docker Compose to run database containers for testing:

```bash
# Start all database containers
npm run docker:up

# Stop all containers
npm run docker:down

# Stop and remove volumes
npm run docker:clean
```

### Database Ports

- MySQL: `localhost:3311`
- PostgreSQL: `localhost:5433`
- MongoDB: `localhost:27020`

## Test Database Setup

Each database test:

1. Starts the appropriate Docker container (except SQLite)
2. Waits for the database to be ready
3. Generates the Prisma client for that database
4. Pushes the schema to the database
5. Runs integration tests with `--runInBand` flag
6. Reports results

## Writing Tests

### Unit Tests

Place unit tests in `tests/` directory with `.test.ts` extension:

```typescript
import { describe, it, expect } from '@jest/globals';

describe('MyFunction', () => {
  it('should do something', () => {
    expect(true).toBe(true);
  });
});
```

### Integration Tests

Place integration tests in `tests/integration/` directory:

```typescript
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { setupTestDatabase } from '../utils/test-db';

describe('MyEntity Integration', () => {
  let db: Awaited<ReturnType<typeof setupTestDatabase>>;

  beforeAll(async () => {
    db = await setupTestDatabase();
  });

  afterAll(async () => {
    await db.cleanup();
  });

  it('should perform database operation', async () => {
    // Test code
  });
});
```

### Database-Specific Tests

Use conditional describe blocks for database-specific tests:

```typescript
const isPostgreSQL = process.env.DATABASE_URL?.includes('postgresql');
const describePostgreSQL = isPostgreSQL ? describe : describe.skip;

describePostgreSQL('PostgreSQL-specific tests', () => {
  // Tests only run when using PostgreSQL
});
```


## Expected Console Errors

**Important:** When running tests, you may see error messages in the console output even when all tests pass. These are **expected and intentional** - they're part of tests that validate error handling behavior.

Common expected errors include:
- ❌ Unique constraint failures (testing duplicate handling)
- ⚠️ Retry attempt warnings (testing retry logic)
- ⚠️ Database provider detection warnings (testing fallback behavior)

**How to know if tests are actually passing:**

Look at the **final test summary**:
```
Test Suites: 2 passed, 2 of 3 total
Tests:       69 passed, 82 total
```

If you see `X passed` and no `X failed`, everything is working correctly! ✅
