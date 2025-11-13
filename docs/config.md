## Configuration

### ⚡ Parallel Batch Operations

Execute batch operations in parallel for **2-4x performance improvements**. Auto-detects your connection pool and runs operations concurrently.

#### Quick Start

```typescript
import { configurePrisma } from 'prisma-entity-framework';

// Setup (auto-detects pool size from DATABASE_URL from '?connection_limit=')
configurePrisma(prisma);

// Operations now run in parallel automatically! (2-4x faster for large quantity of data)
await User.createMany(users);
await User.upsertMany(users);
await User.updateManyById(updates);
await User.deleteByIds(ids);
```

#### Custom config (optional)

```typescript
// Global configuration
configurePrisma(prisma, {
  maxConcurrency: 8,           // Max concurrent operations (default: auto-detect)
  maxQueriesPerSecond: 100     // Rate limiting (default: 100)
});

// Per-operation override
await User.createMany(users, false, undefined, {
  parallel: true,
  concurrency: 4
});
```

#### Performance

Benchmarks on 10,000 records:

| Database | Operation | Sequential | Parallel | Speedup |
|----------|-----------|-----------|----------|---------|
| PostgreSQL | Create | 947ms | 388ms | **2.4x** ⚡ |
| PostgreSQL | Delete | 209ms | 66ms | **3.2x** 🚀 |
| MySQL | Delete | 1,035ms | 218ms | **4.8x** 🔥 |
| SQLite | Create | 400ms | - | Auto-sequential |

#### Features

- ✅ **Zero Config** - Auto-detects pool size from DATABASE_URL
- ✅ **Database-Aware** - Adapts to PostgreSQL, MySQL, SQLite, MongoDB, SQL Server
- ✅ **Rate Limiting** - Prevents database overload with token bucket algorithm