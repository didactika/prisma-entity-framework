# Parallel Batch Operations

## Overview

The Prisma Entity Framework now supports automatic parallel execution of batch operations, leveraging your Prisma connection pool to maximize throughput and reduce execution time for large datasets.

## Features

- 🚀 **Automatic Parallelization**: Detects connection pool size and parallelizes operations automatically
- ⚡ **Significant Performance Gains**: 2-8x speedup depending on pool size and dataset
- 🎯 **Smart Concurrency**: Adapts to your database connection pool configuration
- 🛡️ **Rate Limiting**: Prevents database overload with configurable query throttling
- 📊 **Performance Metrics**: Built-in tracking of speedup, efficiency, and utilization
- 🔄 **Backward Compatible**: Works with existing code, no changes required

## Quick Start

### Basic Usage (Automatic)

Parallel execution is enabled automatically when your connection pool size > 1:

```typescript
import { PrismaClient } from '@prisma/client';
import { configurePrisma } from 'prisma-entity-framework';

// Configure with connection pool
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://user:pass@localhost:5432/db?connection_limit=10'
    }
  }
});

configurePrisma(prisma);

// Operations now run in parallel automatically!
const count = await User.createMany(users); // Parallelized
const result = await User.upsertMany(users); // Parallelized
await User.updateManyById(updates); // Parallelized
await User.deleteByIds(ids); // Parallelized
```

### Manual Control

You can control parallel execution per operation:

```typescript
// Force parallel execution
await User.createMany(users, false, undefined, {
  parallel: true,
  concurrency: 4
});

// Disable parallel execution
await User.createMany(users, false, undefined, {
  parallel: false
});
```

## Configuration

### Global Configuration

```typescript
import { configurePrisma } from 'prisma-entity-framework';

configurePrisma(prisma, {
  maxConcurrency: 8,           // Max concurrent operations
  enableParallel: true,        // Enable/disable parallel execution
  maxQueriesPerSecond: 100     // Rate limit (queries/sec)
});
```

### Connection Pool Configuration

Set your connection pool size in the DATABASE_URL:

```bash
# PostgreSQL
DATABASE_URL="postgresql://user:pass@localhost:5432/db?connection_limit=20"

# MySQL
DATABASE_URL="mysql://user:pass@localhost:3306/db?connection_limit=15"

# MongoDB
DATABASE_URL="mongodb://localhost:27017/db?maxPoolSize=25"
```

## Supported Methods

### createMany

Parallelizes batch creation operations:

```typescript
const users = Array.from({ length: 10000 }, (_, i) => ({
  name: `User ${i}`,
  email: `user${i}@example.com`
}));

// Automatically parallelized with pool size > 1
const count = await User.createMany(users);
console.log(`Created ${count} users`);
```

**Performance**: 2-5x speedup with 4-8 connections

### upsertMany

Parallelizes both OR queries and create/update operations:

```typescript
const result = await User.upsertMany(users, undefined, {
  parallel: true,
  concurrency: 4
});

console.log(`Created: ${result.created}, Updated: ${result.updated}`);
```

**Performance**: 3-6x speedup with parallel OR queries + operations

### updateManyById

Parallelizes batch SQL updates:

```typescript
const updates = users.map(u => ({ id: u.id, name: `Updated ${u.name}` }));

const count = await User.updateManyById(updates, {
  parallel: true
});
```

**Performance**: 2-4x speedup with 4-8 connections

### deleteByIds

New method for parallel batch deletes:

```typescript
const ids = [1, 2, 3, 4, 5, ...]; // Large array of IDs

const deleted = await User.deleteByIds(ids, {
  parallel: true,
  concurrency: 6
});
```

**Performance**: 2-4x speedup with 4-8 connections

## Performance Metrics

The parallel execution engine provides detailed metrics:

```typescript
import { executeInParallel } from 'prisma-entity-framework';

const operations = batches.map(batch => 
  () => User.createMany(batch)
);

const result = await executeInParallel(operations);

console.log('Performance Metrics:');
console.log(`Total time: ${result.metrics.totalTime}ms`);
console.log(`Speedup: ${result.metrics.speedupFactor.toFixed(2)}x`);
console.log(`Efficiency: ${(result.metrics.parallelEfficiency * 100).toFixed(1)}%`);
console.log(`Items/sec: ${result.metrics.itemsPerSecond.toFixed(0)}`);
console.log(`Pool utilization: ${(result.metrics.connectionUtilization * 100).toFixed(1)}%`);
```

## Rate Limiting

Prevent database overload with built-in rate limiting:

```typescript
configurePrisma(prisma, {
  maxQueriesPerSecond: 50  // Limit to 50 queries/sec
});

// Operations will be throttled automatically
await User.createMany(largeDataset);
```

The rate limiter uses a token bucket algorithm to allow bursts while maintaining average rate.

## Best Practices

### 1. Configure Appropriate Pool Size

```typescript
// For high-throughput applications
DATABASE_URL="postgresql://...?connection_limit=20"

// For resource-constrained environments
DATABASE_URL="postgresql://...?connection_limit=5"
```

### 2. Monitor Performance

```typescript
import { getConnectionPoolSize, getMaxConcurrency } from 'prisma-entity-framework';

console.log(`Pool size: ${getConnectionPoolSize()}`);
console.log(`Max concurrency: ${getMaxConcurrency()}`);
```

### 3. Use Appropriate Concurrency

```typescript
import { getOptimalConcurrency } from 'prisma-entity-framework';

const concurrency = getOptimalConcurrency('write', items.length);

await User.createMany(items, false, undefined, {
  concurrency
});
```

### 4. Handle Large Datasets

```typescript
// For very large datasets (100k+ records)
const CHUNK_SIZE = 10000;

for (let i = 0; i < items.length; i += CHUNK_SIZE) {
  const chunk = items.slice(i, i + CHUNK_SIZE);
  await User.createMany(chunk, false, undefined, {
    parallel: true,
    concurrency: 8
  });
}
```

## Database-Specific Behavior

### PostgreSQL
- **Default pool**: 10 connections
- **Recommended concurrency**: 4-8
- **Best for**: Large batch operations

### MySQL
- **Default pool**: 10 connections
- **Recommended concurrency**: 4-8
- **Best for**: Medium to large batches

### SQLite
- **Pool size**: 1 (single-threaded)
- **Parallel execution**: Disabled automatically
- **Behavior**: Falls back to sequential

### MongoDB
- **Default pool**: 10 connections
- **Recommended concurrency**: 4-6
- **Note**: Respects transaction limits

## Performance Benchmarks

Based on internal testing with PostgreSQL:

| Dataset Size | Sequential | Parallel (4 conn) | Speedup |
|--------------|-----------|-------------------|---------|
| 1,000 records | 1,200ms | 450ms | 2.7x |
| 10,000 records | 12,500ms | 3,200ms | 3.9x |
| 100,000 records | 125,000ms | 28,000ms | 4.5x |

*Results vary based on hardware, network, and database configuration*

## Troubleshooting

### Parallel execution not working

Check if parallel execution is enabled:

```typescript
import { isParallelEnabled, getConnectionPoolSize } from 'prisma-entity-framework';

console.log(`Parallel enabled: ${isParallelEnabled()}`);
console.log(`Pool size: ${getConnectionPoolSize()}`);
```

### Performance not improving

1. **Check pool size**: Ensure connection_limit > 1
2. **Check dataset size**: Small datasets (<100 records) won't benefit
3. **Check concurrency**: May need to adjust manually
4. **Check database load**: Database may be the bottleneck

### Connection pool exhausted

Reduce concurrency or increase pool size:

```typescript
configurePrisma(prisma, {
  maxConcurrency: 4  // Reduce from default
});
```

## Advanced Usage

### Custom Parallel Operations

```typescript
import { executeInParallel } from 'prisma-entity-framework';

const operations = [
  () => User.createMany(batch1),
  () => Post.createMany(batch2),
  () => Comment.createMany(batch3)
];

const result = await executeInParallel(operations, {
  concurrency: 3,
  onProgress: (completed, total) => {
    console.log(`Progress: ${completed}/${total}`);
  },
  onError: (error, index) => {
    console.error(`Operation ${index} failed:`, error);
  }
});
```

### Optimal Batching

```typescript
import { chunkForParallel, getOptimalConcurrency } from 'prisma-entity-framework';

const concurrency = getOptimalConcurrency('write', items.length);
const chunks = chunkForParallel(items, 1000, concurrency);

console.log(`Created ${chunks.length} chunks for ${concurrency} concurrent operations`);
```

## API Reference

See the main documentation for complete API reference:

- [Configuration API](./configuration.md)
- [Parallel Utilities API](./parallel-utils.md)
- [Rate Limiter API](./rate-limiter.md)

## Migration Guide

### From Sequential to Parallel

No code changes required! Just configure your connection pool:

```typescript
// Before (sequential)
const prisma = new PrismaClient();
configurePrisma(prisma);

// After (parallel) - just add connection_limit
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL + '?connection_limit=10'
    }
  }
});
configurePrisma(prisma);
```
