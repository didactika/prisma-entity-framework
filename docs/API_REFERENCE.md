
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
const result = await User.upsertMany([
    { email: 'user1@example.com', name: 'User 1' },
    { email: 'user2@example.com', name: 'User 2' },
]);
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
import { SearchBuilder, SearchUtils, FindByFilterOptions, ModelUtils } from 'prisma-entity-framework';

const modelInfo = ModelUtils.getModelInformationCached('User');
const searchOptions: FindByFilterOptions.SearchOptions = {
    stringSearch: [{ keys: ['name'], value: 'john', mode: 'LIKE' }]
};
const filters = SearchBuilder.build({}, searchOptions, modelInfo);
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
