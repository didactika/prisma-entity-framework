
### Configuration

#### `configurePrisma(prisma: PrismaClient, config?: PrismaConfig): void`
Configure the Prisma client instance. **Call once at startup.**

```typescript
import { PrismaClient } from '@prisma/client';
import { configurePrisma } from 'prisma-entity-framework';

const prisma = new PrismaClient();
configurePrisma(prisma);

// with options
configurePrisma(prisma, {
    caseInsensitiveSearch: false,  // default: true
    maxConcurrency: 8,
    enableParallel: true,
    maxQueriesPerSecond: 100
});
```

**`config.caseInsensitiveSearch`** — whether `like`, `startsWith` and `endsWith` ignore letter case.
Defaults to `true`, which keeps text search consistent across providers rather than exposing each
database's collation rules. Any single condition can override it with its own `insensitive` field.

How far the guarantee reaches, since only PostgreSQL and MongoDB accept an explicit case mode:

| | PostgreSQL / MongoDB | SQLite | MySQL |
| --- | --- | --- | --- |
| `like` / `startsWith` / `endsWith`, insensitive | ✅ explicit mode | ✅ already insensitive | ✅ with a `_ci` collation |
| the same, `insensitive: false` | ✅ enforced | ❌ `LIKE` stays insensitive | ⚠️ collation decides |
| `equals` with `insensitive: true` | ✅ | ❌ `=` stays case-sensitive | ⚠️ collation decides |

The default — case-insensitive text search — holds everywhere. Overriding it in either direction is
only reliable on PostgreSQL and MongoDB.

#### `isCaseInsensitiveSearch(): boolean`
The configured value, defaulting to `true`.

#### `getPrismaInstance(): PrismaClient`
Get the configured Prisma instance.

#### `isPrismaConfigured(): boolean`
Check if Prisma has been configured.

#### `resetPrismaConfiguration(): void`
Reset configuration (useful for testing).

---

### Transactions

#### `runTransaction<T>(fn, options?): Promise<T>`
Execute multiple entity operations inside a Prisma interactive transaction. All operations within the callback are atomic — if any operation fails, all changes are rolled back.

**Parameters:**
- `fn` - Async callback that receives a `TransactionClient` (`tx`)
- `options.maxWait` - Max time (ms) to acquire a connection (default: 2000)
- `options.timeout` - Max time (ms) for the transaction to complete (default: 5000)
- `options.isolationLevel` - Transaction isolation level (PostgreSQL, MySQL, SQL Server)

**Returns:** The value returned by the callback

```typescript
import { runTransaction } from 'prisma-entity-framework';

// Implicit mode: operations auto-detect the active transaction
const user = await runTransaction(async (tx) => {
    const u = new User({ name: 'John', email: 'john@example.com' });
    await u.create();           // uses active transaction automatically

    const p = new Post({ title: 'Hello', authorId: u.id });
    await p.create();           // same transaction

    return u;
});

// Explicit mode: pass tx directly
const user = await runTransaction(async (tx) => {
    const u = new User({ name: 'John', email: 'john@example.com' });
    await u.create({ tx });     // explicit transaction client

    return u;
}, {
    maxWait: 5000,
    timeout: 10000,
    isolationLevel: 'Serializable'
});
```

#### `getActiveTransaction(): TransactionClient | null`
Returns the currently active transactional client, or `null` if not inside a transaction.

```typescript
const tx = getActiveTransaction();
if (tx) {
    // We are inside a runTransaction() callback
}
```

#### `isInTransaction(): boolean`
Returns `true` when called inside a `runTransaction()` callback.

```typescript
if (isInTransaction()) {
    console.log('Running inside a transaction');
}
```

#### Transaction-aware operations

All BaseEntity methods accept an optional `tx` parameter via `EntityOperationOptions`:

```typescript
// Instance methods
await entity.create({ tx });
await entity.update({ tx });
await entity.delete({ tx });

// Static methods
await User.createMany(items, { tx });
await User.updateManyById(dataList, { tx });
await User.upsertMany(items, { tx });
await User.upsert(data, { tx });
await User.updateByFilter(filter, data, { tx });
await User.deleteByFilter(filter, { tx });
await User.deleteByIds(ids, { tx });
await User.findByFilter(filter, { tx });
await User.countByFilter(filter, { tx });
```

> **Note:** Parallel batch execution is automatically disabled inside transactions to prevent deadlocks.

### BaseEntity Static Methods

#### `findByFilter<T>(filter, options?): Promise<T[] | PaginatedResponse<T>>`
Advanced query with filters, search, pagination, and relations.

**Parameters:**
- `filter` - Plain equality filter, ANDed with the search
- `options.search` - Search tree: conditions combined with `and` / `or` / `not`
- `options.pagination` - Pagination settings
- `options.relationsToInclude` - Relations to include
- `options.orderBy` - Sort configuration
- `options.onlyOne` - Return single result

**Returns:** Array of entities or paginated response

```typescript
const users = await User.findByFilter(
    { isActive: true },
    {
        search: { field: 'name', like: 'john' },
        pagination: { page: 1, pageSize: 10, take: 10, skip: 0 },
        orderBy: { createdAt: 'desc' }
    }
);
```

#### `countByFilter<T>(filter): Promise<number>`
Count records matching filter.

```typescript
const count = await User.countByFilter({ isActive: true });
```

#### `createMany<T>(items, options?): Promise<number>`
Bulk create with automatic batching and retry logic.

**Parameters:**
- `items` - Array of entities to create
- `options.skipDuplicates` - Skip duplicate records (database-dependent)
- `options.keyTransformTemplate` - Function to transform relation names to FK field names
- `options.parallel` - Enable parallel execution
- `options.concurrency` - Number of concurrent operations
- `options.handleRelations` - Handle many-to-many relations (default: true)

```typescript
const count = await User.createMany([
    { name: "User 1", email: "user1@example.com" },
    { name: "User 2", email: "user2@example.com" }
], { 
    skipDuplicates: true,
    parallel: true,
    concurrency: 4
});
```

#### `updateManyById<T>(dataList): Promise<number>`
Bulk update by ID with SQL optimization (CASE WHEN) or transactions (MongoDB).

```typescript
const updated = await User.updateManyById([
    { id: 1, name: "Updated 1" },
    { id: 2, name: "Updated 2" }
]);
```

#### `upsert<T>(data, options?): Promise<T>`
Create or update based on unique constraints. Only updates if changes detected.

**Parameters:**
- `data` - Entity data to upsert
- `options.keyTransformTemplate` - Function to transform relation names to FK field names

```typescript
const user = await User.upsert(
    {
        email: "john@example.com",  // Unique field
        name: "John Doe"
    },
    { keyTransformTemplate: (key) => `${key}Id` }
);
```

#### `upsertMany<T>(items, options?): Promise<UpsertResult>`
Batch upsert with statistics.

**Parameters:**
- `items` - Array of entities to upsert
- `options.keyTransformTemplate` - Function to transform relation names to FK field names
- `options.parallel` - Enable parallel execution
- `options.concurrency` - Number of concurrent operations
- `options.handleRelations` - Handle many-to-many relations (default: true)

```typescript
const result = await User.upsertMany([
    { email: 'user1@example.com', name: 'User 1' },
    { email: 'user2@example.com', name: 'User 2' },
], {
    parallel: true,
    concurrency: 4
});
// { created: 2, updated: 1, unchanged: 0, total: 3 }
```

#### `updateByFilter<T>(filter, data, options?): Promise<number>`
Apply one set of changes to every record matching the filter (and `options.search`). The sibling of
`deleteByFilter`. For per-row changes keyed by id, use `updateManyById`.

**Parameters:**
- `filter` - Base equality filter, ANDed with `options.search`
- `data` - The changes to apply to every matching row (scalar fields and foreign keys)
- `options.search` - Search tree to narrow the rows
- `options.tx` - Run inside a transaction

Maps to Prisma's `updateMany`: `data` sets scalar fields and FK relations by id, not nested relation
writes. `id`, `createdAt` and empty values are stripped; an empty payload updates nothing.

```typescript
// mark every overdue pending job as failed
const changed = await Job.updateByFilter(
    { status: 'PENDING' },
    { status: 'FAILED' },
    { search: { field: 'scheduledFor', lte: new Date() } }
);
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

### SearchResolver, SearchUtils & helpers

A search is a boolean expression built from conditions and the `and` / `or` / `not` nodes that
combine them, to any depth.

```typescript
import { SearchResolver, SearchUtils, anyOf, allOf, Search, ModelUtils } from 'prisma-entity-framework';

const modelInfo = ModelUtils.getModelInformationCached('User');

// Resolve a tree into a Prisma `where` fragment
const where = SearchResolver.resolve({ field: 'name', like: 'john' }, modelInfo);
// { name: { contains: 'john' } }

// Combine a base filter with a search tree
const filters = SearchUtils.applySearchFilter(
    { isActive: { equals: true } },
    anyOf(['name', 'email'], { like: 'john' }),
    modelInfo
);
// { isActive: { equals: true }, OR: [ { name: {...} }, { email: {...} } ] }

// Turn form data into conditions
const conditions = SearchUtils.conditionsFrom({ name: 'John', email: '' }, 'like');
// [ { field: 'name', like: 'John' } ]
```

| Export | Purpose |
| --- | --- |
| `SearchResolver.resolve(tree, modelInfo?)` | Tree → Prisma `where` fragment, or `null` when nothing survives pruning |
| `SearchResolver.merge(base, tree, modelInfo?)` | Same, merged onto an already-resolved base filter |
| `SearchResolver.chunkLargeLists(tree, size)` | Split an oversized `in`/`notIn` into one tree per chunk |
| `anyOf(fields, condition)` | One condition per field, combined with OR |
| `allOf(fields, condition)` | One condition per field, combined with AND |
| `SearchUtils.conditionsFrom(obj, operator?)` | One condition per non-empty string field |

See [Advanced Examples](./advanced-examples.md)

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
