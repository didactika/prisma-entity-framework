# Prisma Entity Framework

> **Transform Prisma into a powerful Active Record ORM with advanced querying, batch operations, and graph utilities**

A complete TypeScript framework that extends Prisma Client with Active Record pattern, declarative query builder, relation graph traversal, and batch operations.

[![npm version](https://badge.fury.io/js/prisma-entity-framework.svg)](https://www.npmjs.com/package/prisma-entity-framework)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
---

## 🌟 Why This Framework?

Prisma documentation states: ["Prisma is not a traditional ORM"](https://www.prisma.io/docs/orm/overview/prisma-in-your-stack/is-prisma-an-orm). It's a query builder focused on type safety and developer experience.

**We believe both approaches have value.** This framework brings traditional ORM ergonomics to Prisma while maintaining its type safety and performance benefits.

### What Makes This Special?

This isn't just an ORM wrapper. It's a complete framework with:

- 🏛️ **Entity System** - Active Record with lifecycle management
- 🔍 **Query DSL** - Declarative search with LIKE, ranges, lists, OR/AND operators
- 🕸️ **Graph Utilities** - Dependency trees, path finding, automatic include builders
- 🔗 **Smart Relations** - Automatic connect/create processing
- ⚡ **Batch Engine** - SQL-optimized bulk operations (up to 1500 records per batch)
- 📄 **Pagination** - Built-in formatted responses

---

## 📦 Installation

```bash
npm install prisma-entity-framework
# or
yarn add prisma-entity-framework
# or
pnpm add prisma-entity-framework
```

**Requirements:**
- Node.js >= 16
- Prisma Client >= 4.0.0

**Supported Databases:**
- ✅ SQLite
- ✅ MySQL
- ✅ PostgreSQL
- ✅ SQL Server
- ✅ MongoDB

---

## 🚀 Quick Start

### 1. Configure Prisma

```typescript
import { PrismaClient } from '@prisma/client';
import { configurePrisma } from 'prisma-entity-framework';

const prisma = new PrismaClient();
configurePrisma(prisma); // One-time setup
```

### 2. Create Entity Classes

**Option A: Using @Property() Decorator (Recommended)**

```typescript
import { BaseEntity, Property } from 'prisma-entity-framework';
import { User as PrismaUser } from '@prisma/client';
import { prisma } from './prisma-client';

export class User extends BaseEntity<PrismaUser> {
    static readonly model = prisma.user;
    
    @Property() declare name: string;
    @Property() declare email: string;
    @Property() declare age?: number;
    @Property() declare isActive: boolean;
}
```

**Option B: Traditional Getters/Setters (For Validation)**

```typescript
export class User extends BaseEntity<PrismaUser> {
    static readonly model = prisma.user;
    
    private _email!: string;
    
    get email() { return this._email; }
    set email(value: string) { 
        if (!value.includes('@')) throw new Error('Invalid email');
        this._email = value.toLowerCase(); // Normalize
    }
}
```

> 💡 **Tip:** Use `@Property()` for simple properties. Use traditional getters/setters when you need validation or transformation logic.

### 3. Use Active Record Pattern

```typescript
// Create
const user = new User({ name: "John", email: "john@example.com" });
await user.create();

// Update
user.name = "Jane";
await user.update();

// Delete
await user.delete();
```

---

## 💡 Core Features

### 🔍 Advanced Query Builder

Build complex queries declaratively without writing raw Prisma syntax:

```typescript
const results = await User.findByFilter({
    isActive: true  // Base filter
}, {
    search: {
        // String search with LIKE, STARTS_WITH, ENDS_WITH, EXACT
        stringSearch: [{
            keys: ['name', 'email'],
            value: 'john',
            mode: 'LIKE',
            grouping: 'or'  // OR across fields
        }],
        
        // Range search for numbers and dates
        rangeSearch: [{
            keys: ['age'],
            min: 18,
            max: 65
        }],
        
        // List search with IN, NOT_IN, HAS_SOME, HAS_EVERY
        listSearch: [{
            keys: ['status'],
            values: ['active', 'pending'],
            mode: 'IN'
        }],
        
        grouping: 'and'  // AND across search types
    },
    
    // Pagination
    pagination: {
        page: 1,
        pageSize: 10,
        take: 10,
        skip: 0
    },
    
    // Sorting
    orderBy: { createdAt: 'desc' },
    
    // Include relations
    relationsToInclude: [
        { posts: [{ comments: '*' }] }
    ]
});
```

**Search Modes:**
- `LIKE` - Contains substring (case-insensitive)
- `STARTS_WITH` - Begins with value
- `ENDS_WITH` - Ends with value
- `EXACT` - Exact match

**List Modes:**
- `IN` - Value in list
- `NOT_IN` - Value not in list
- `HAS_SOME` - Array has some values
- `HAS_EVERY` - Array has all values

### 📄 Pagination

Get formatted pagination responses automatically:

```typescript
const result = await User.findByFilter({}, {
    pagination: {
        page: 2,
        pageSize: 20,
        take: 20,
        skip: 20
    }
});

console.log(result);
// {
//   total: 142,
//   page: 2,
//   pageSize: 20,
//   data: [... 20 users ...]
// }
```

### 🔗 Smart Relation Handling

Automatically processes relations and detects JSON fields:

```typescript
// Nested relations with wildcard
const users = await User.findByFilter({}, {
    relationsToInclude: [
        { 
            posts: [
                { comments: [{ author: '*' }] }
            ] 
        }
    ]
});

// Automatic connect/create processing
const post = new Post({
    title: "My Post",
    author: { id: 1 },  // Automatically converts to { connect: { id: 1 } }
    metadata: { tags: ['tech'] }  // JSON fields preserved as-is
});
await post.create();
```

### ⚡ Batch Operations

Optimized bulk operations with database-specific batch sizes:

```typescript
// Batch create (auto-batched by database type)
const count = await User.createMany([
    { name: "User 1", email: "user1@example.com" },
    { name: "User 2", email: "user2@example.com" },
]);

// Batch update with SQL optimization
const updated = await User.updateManyById([
    { id: 1, name: "Updated 1" },
    { id: 2, name: "Updated 2" },
    { id: 3, name: "Updated 3" }
]);

// Generates optimized CASE WHEN SQL


// Batch delete
const deleted = await User.deleteByFilter({ 
    isActive: false 
});
```

### 🔄 Upsert Operations

Smart create/update with automatic change detection:

```typescript
// Single upsert
const user = await User.upsert({
    email: "john@example.com",  // Unique field
    name: "John Doe",
    age: 30
});
// Creates if not exists, updates only if changed

// Batch upsert with statistics
const result = await User.upsertMany([
    { email: "user1@example.com", name: "User 1" },
    { email: "user2@example.com", name: "User 2" },
    { email: "user3@example.com", name: "User 3" }
]);

console.log(result);
// {
//   created: 2,    // New records
//   updated: 1,    // Changed records
//   unchanged: 0,  // No changes detected
//   total: 3
// }
```

### 🕸️ Graph Traversal Utilities

Navigate and analyze your data model relationships:

```typescript
import { ModelUtils } from 'prisma-entity-framework';

// Find path between models
const path = ModelUtils.findPathToParentModel('Comment', 'User');
// → "post.author"

// Build dependency tree
const deps = ModelUtils.getModelDependencyTree(['User', 'Post', 'Comment']);
// → [
//   { name: 'User', dependencies: [] },
//   { name: 'Post', dependencies: ['User'] },
//   { name: 'Comment', dependencies: ['Post', 'User'] }
// ]

// Sort by dependencies (topological sort)
const sorted = ModelUtils.sortModelsByDependencies(deps);
// → ['User', 'Post', 'Comment']

// Auto-generate includes from relation graph
const includes = await ModelUtils.getIncludesTree('User', [
    { posts: [{ comments: [{ author: '*' }] }] }
]);
```

---

## 📚 Complete API Reference

### Configuration

#### `configurePrisma(prisma: PrismaClient): void`
Configure the Prisma client instance. **Call once at startup.**

```typescript
import { PrismaClient } from '@prisma/client';
import { configurePrisma } from 'prisma-entity-framework';

const prisma = new PrismaClient();
configurePrisma(prisma);
```

#### `getPrismaInstance(): PrismaClient`
Get the configured Prisma instance.

#### `isPrismaConfigured(): boolean`
Check if Prisma has been configured.

#### `resetPrismaConfiguration(): void`
Reset configuration (useful for testing).

---

### BaseEntity Static Methods

#### `findByFilter<T>(filter, options?): Promise<T[] | PaginatedResponse<T>>`
Advanced query with filters, search, pagination, and relations.

**Parameters:**
- `filter` - Base Prisma where clause
- `options.search` - Search configuration (string, range, list)
- `options.pagination` - Pagination settings
- `options.relationsToInclude` - Relations to include
- `options.orderBy` - Sort configuration
- `options.onlyOne` - Return single result

**Returns:** Array of entities or paginated response

```typescript
const users = await User.findByFilter(
    { isActive: true },
    {
        search: {
            stringSearch: [{ keys: ['name'], value: 'john', mode: 'LIKE' }]
        },
        pagination: { page: 1, pageSize: 10 },
        orderBy: { createdAt: 'desc' }
    }
);
```

#### `countByFilter<T>(filter): Promise<number>`
Count records matching filter.

```typescript
const count = await User.countByFilter({ isActive: true });
```

#### `createMany<T>(items, skipDuplicates?): Promise<number>`
Bulk create with automatic batching and retry logic.

```typescript
const count = await User.createMany([
    { name: "User 1", email: "user1@example.com" },
    { name: "User 2", email: "user2@example.com" }
], true);  // skipDuplicates
```

#### `updateManyById<T>(dataList): Promise<number>`
Bulk update by ID with SQL optimization (CASE WHEN) or transactions (MongoDB).

```typescript
const updated = await User.updateManyById([
    { id: 1, name: "Updated 1" },
    { id: 2, name: "Updated 2" }
]);
```

#### `upsert<T>(data): Promise<T>`
Create or update based on unique constraints. Only updates if changes detected.

```typescript
const user = await User.upsert({
    email: "john@example.com",  // Unique field
    name: "John Doe"
});
```

#### `upsertMany<T>(items): Promise<UpsertResult>`
Batch upsert with statistics.

```typescript
const result = await User.upsertMany([...]);
// { created: 2, updated: 1, unchanged: 0, total: 3 }
```

#### `deleteByFilter<T>(filter): Promise<number>`
Delete records matching filter.

```typescript
const deleted = await User.deleteByFilter({ isActive: false });
```

#### `deleteByIds<T>(ids): Promise<number>`
Delete records by ID array.

```typescript
const deleted = await User.deleteByIds([1, 2, 3]);
```

---

### BaseEntity Instance Methods

#### `create(): Promise<TModel>`
Create the entity in database.

```typescript
const user = new User({ name: "John", email: "john@example.com" });
await user.create();
```

#### `update(): Promise<TModel>`
Update the entity in database.

```typescript
user.name = "Jane";
await user.update();
```

#### `delete(): Promise<number | string>`
Delete the entity from database.

```typescript
await user.delete();
```

#### `toObject(): Record<string, any>`
Convert entity to plain object.

```typescript
const obj = user.toObject();
```

#### `toJson(): string`
Convert entity to JSON string.

```typescript
const json = user.toJson();
```

---

### ModelUtils

Utilities for analyzing and traversing your Prisma data model.

#### `getModelDependencyTree(modelNames): Array<{name, dependencies}>`
Get dependency relationships between models.

#### `sortModelsByDependencies(models): string[]`
Topological sort of models by dependencies.

#### `findPathToParentModel(from, to, maxDepth?): string | null`
Find relation path between two models.

#### `getIncludesTree(modelName, relations): Promise<object>`
Generate Prisma include object from relation graph.

#### `getUniqueConstraints(modelName): string[][]`
Get unique field combinations for a model.

---

### DataUtils

Utilities for processing relational data.

#### `processRelations(data, modelInfo?): Record<string, any>`
Transform nested objects into Prisma connect/create structures. Preserves JSON fields.

#### `normalizeRelationsToFK(data, keyTransform?): Record<string, any>`
Convert relation objects to foreign key fields.

---

### SearchUtils & SearchBuilder

Build complex search queries declaratively.

```typescript
import { SearchBuilder, SearchUtils } from 'prisma-entity-framework';

const builder = new SearchBuilder(modelInfo);
const filters = builder.build(searchOptions);
```

---

### Database Utilities

#### `getDatabaseProvider(prisma): DatabaseProvider`
Get current database provider (sqlite, mysql, postgresql, sqlserver, mongodb).

#### `getDatabaseDialect(prisma): DatabaseDialect`
Get database dialect for SQL generation.

#### `quoteIdentifier(identifier, dialect): string`
Quote identifier for SQL queries.

#### `formatBoolean(value, provider): string`
Format boolean for database.

---

## 🔥 Advanced Examples

### Complex Search Query

```typescript
const products = await Product.findByFilter({
    // Base filter
    categoryId: { in: [1, 2, 3] },
    isActive: true
}, {
    search: {
        // Text search across multiple fields
        stringSearch: [
            {
                keys: ['name', 'description'],
                value: 'laptop',
                mode: 'LIKE',
                grouping: 'or'
            }
        ],
        
        // Price range
        rangeSearch: [
            {
                keys: ['price'],
                min: 500,
                max: 2000
            }
        ],
        
        // Stock status
        listSearch: [
            {
                keys: ['status'],
                values: ['in_stock', 'low_stock'],
                mode: 'IN'
            }
        ],
        
        grouping: 'and'  // AND between search types
    },
    
    // Pagination
    pagination: {
        page: 1,
        pageSize: 20
    },
    
    // Sort by relevance
    orderBy: { 
        price: 'asc',
        name: 'asc'
    },
    
    // Include relations
    relationsToInclude: [
        'category',
        { reviews: ['user'] }
    ]
});
```

### Batch Operations with Performance Monitoring

```typescript
import { 
    createOptimalBatches, 
    createBatchMetrics,
    withRetry 
} from 'prisma-entity-framework';

const metrics = createBatchMetrics();
const batches = createOptimalBatches(largeDataset, 'createMany');

for (const batch of batches) {
    const startTime = Date.now();
    
    await withRetry(
        () => User.createMany(batch),
        { maxRetries: 3, initialDelayMs: 100 }
    );
    
    metrics.recordBatch(batch.length, Date.now() - startTime);
}

console.log('Performance:', metrics.getStats());
// {
//   totalBatches: 10,
//   totalItems: 10000,
//   totalTime: 45000,
//   avgBatchSize: 1000,
//   avgBatchTime: 4500,
//   itemsPerSecond: 222
// }
```

---

## 🆚 Comparison

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

---

## ⚡ Parallel Batch Operations

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

📖 **[Complete Guide](./docs/parallel-batch-operations.md)** - Configuration, benchmarks, best practices, and troubleshooting

---

## 🧪 Testing

```bash
# Run all tests (SQLite)
npm test

# Test specific database
npm run test:sqlite
npm run test:mysql
npm run test:postgresql
npm run test:mongodb

# Test all databases
npm run test:all-databases

# Coverage report
npm run test:coverage
```
---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup

```bash
# Install dependencies
npm install

# Start databases
npm run docker:up

# Run tests
npm test

# Run tests on all databases
npm run test:all-databases
```

### Reporting Issues

Found a bug or have a feature request? Please open an issue on [GitHub Issues](https://github.com/didactika/prisma-entity-framework/issues).

---

## 📝 License

MIT © 2025 [Hector Arrechea](https://github.com/hector-ae21) & [Eduardo Estrada](https://github.com/e2rd0)

---

## 🙏 Acknowledgments

Built on top of the amazing [Prisma](https://www.prisma.io/) project.

---

## 🔗 Links

- [npm Package](https://www.npmjs.com/package/prisma-entity-framework)
- [GitHub Repository](https://github.com/didactika/prisma-entity-framework)
- [Issue Tracker](https://github.com/didactika/prisma-entity-framework/issues)
- [Changelog](CHANGELOG.md)

---

**Made with ❤️ for the Prisma community**

---

## 📚 Complete Documentation

- [Getting Started Guide](./docs/getting-started.md)
- [Parallel Batch Operations](./docs/parallel-batch-operations.md) ⚡ NEW!
- [OR Query Batching](./docs/or-query-batching.md)
- [API Reference](./docs/api-reference.md)
- [Examples](./examples/)

---

**⭐ If you find this framework useful, please star the repository!**
