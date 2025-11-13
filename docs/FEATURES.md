### Prisma Entity Framework vs Prisma Client

| Feature | Prisma Client | Prisma Entity Framework |
|---------|--------------|-------------------------|
| **Active Record** | ❌ No | ✅ `user.create()`, `user.update()` |
| **Instance Methods** | ❌ No | ✅ Full lifecycle methods |
| **Query DSL** | Basic where | ✅ LIKE, ranges, lists, OR/AND |
| **Batch Optimization** | Basic | ✅ Database-specific, SQL-optimized |
| **Upsert** | Manual | ✅ Automatic with change detection |
| **Graph Traversal** | Manual | ✅ Automatic path finding |
| **Performance Tools** | ❌ No | ✅ Metrics, retry, memory estimation |
| **JSON Field Detection** | Manual | ✅ Automatic |
| **Pagination** | Manual | ✅ Built-in formatted responses |
| **Type Safety** | ✅ Full | ✅ Full (maintains Prisma types) |

---

### ⚡ Parallel Batch Operations

Execute batch operations in parallel for **2-6x performance improvements**. Auto-detects your connection pool and runs operations concurrently.

### Quick Start

```typescript
import { configurePrisma } from 'prisma-entity-framework';

// Setup (auto-detects pool size from DATABASE_URL)
configurePrisma(prisma);

// Operations now run in parallel automatically!
await User.createMany(users);           // 2-4x faster
await User.upsertMany(users);           // 3-6x faster
await User.updateManyById(updates);     // 2-4x faster
await User.deleteByIds(ids);            // 2-4x faster
```

### Configuration (Optional)

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

### Performance

Benchmarks on 10,000 records:

| Database | Operation | Sequential | Parallel | Speedup |
|----------|-----------|-----------|----------|---------|
| PostgreSQL | Create | 947ms | 388ms | **2.4x** ⚡ |
| PostgreSQL | Delete | 209ms | 66ms | **3.2x** 🚀 |
| MySQL | Delete | 1,035ms | 218ms | **4.8x** 🔥 |
| SQLite | Create | 400ms | - | Auto-sequential |

### Features

- ✅ **Zero Config** - Auto-detects pool size from DATABASE_URL
- ✅ **Database-Aware** - Adapts to PostgreSQL, MySQL, SQLite, MongoDB, SQL Server
- ✅ **Rate Limiting** - Prevents database overload with token bucket algorithm
- ✅ **Backward Compatible** - Works with existing code
