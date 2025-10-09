# Prisma Entity Framework

> **Transform Prisma into a complete entity system**

Full-featured framework combining Active Record pattern, advanced Query Builder, graph traversal utilities, and batch operations for Prisma Client.

[![npm version](https://badge.fury.io/js/prisma-entity-framework.svg)](https://www.npmjs.com/package/prisma-entity-framework)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🌟 Why This Exists

Prisma documentation states: ["Prisma is not a traditional ORM"](https://www.prisma.io/docs/orm/overview/prisma-in-your-stack/is-prisma-an-orm). It's a query builder focused on type safety and developer experience.

**We think both approaches have value.** This framework brings traditional ORM ergonomics to Prisma while maintaining its type safety and performance benefits.

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

```typescript
import { BaseEntity } from 'prisma-entity-framework';
import { User as PrismaUser } from '@prisma/client';
import { prisma } from './prisma-client';

export class User extends BaseEntity<PrismaUser> {
    static readonly model = prisma.user;
    
    private _name!: string;
    private _email!: string;
    
    get name() { return this._name; }
    set name(value: string) { this._name = value; }
    
    get email() { return this._email; }
    set email(value: string) { this._email = value; }
}
```

### 3. Use Active Record Pattern

```typescript
// Create
const user = new User({ name: "John Doe", email: "john@example.com" });
await user.create();

// Update
user.name = "Jane Doe";
await user.update();

// Delete
await user.delete();
```

---

## 💡 Features & Examples

### 🔍 Advanced Query Builder

```typescript
const results = await User.findByFilter({}, {
    search: {
        // String search with LIKE
        stringSearch: [{
            keys: ['name', 'email'],
            value: 'john',
            mode: 'LIKE',
            grouping: 'or'
        }],
        // Range search
        rangeSearch: [{
            keys: ['age'],
            min: 18,
            max: 65
        }],
        // List search
        listSearch: [{
            keys: ['status'],
            values: ['active', 'pending']
        }]
    }
});
```

### 📄 Built-in Pagination

```typescript
const paginated = await User.findByFilter({}, {
    pagination: {
        page: 1,
        pageSize: 10,
        take: 10,
        skip: 0
    }
});

console.log(paginated);
// {
//   total: 42,
//   page: 1,
//   pageSize: 10,
//   data: [...]
// }
```

### 🔗 Smart Relation Includes

```typescript
const usersWithPosts = await User.findByFilter({}, {
    relationsToInclude: [
        { posts: [{ comments: '*' }] }
    ]
});
```

### ⚡ Batch Operations

```typescript
// Batch create
await User.createMany([
    { name: "User 1", email: "user1@example.com" },
    { name: "User 2", email: "user2@example.com" },
    // ... up to 1500 records optimally
]);

// Batch update with SQL optimization
await User.updateManyById([
    { id: 1, name: "Updated 1" },
    { id: 2, name: "Updated 2" },
    // Generates optimized CASE WHEN SQL
]);
```

### 🕸️ Graph Traversal Utilities

```typescript
import { ModelUtils } from 'prisma-entity-framework';

// Find path between models
const path = ModelUtils.findPathToParentModel('Comment', 'User');
// → "post.author"

// Build dependency tree
const deps = ModelUtils.getModelDependencyTree(['User', 'Post', 'Comment']);

// Auto-generate includes
const includes = await ModelUtils.getIncludesTree('User', [
    { posts: [{ comments: [{ author: '*' }] }] }
]);
```

---

## 📚 API Documentation

### Configuration

#### `configurePrisma(prisma: PrismaClient): void`
Configure the Prisma client instance. **Call this once at application startup.**

```typescript
import { PrismaClient } from '@prisma/client';
import { configurePrisma } from 'prisma-entity-framework';

const prisma = new PrismaClient();
configurePrisma(prisma);
```

---

### BaseEntity Methods

#### Static Methods

##### `findByFilter<T>(filter, options?): Promise<...>`
Advanced query with filters, search, pagination, and relations.

```typescript
const users = await User.findByFilter(
    { isActive: true }, // Base filter
    {
        search: { /* search options */ },
        pagination: { /* pagination */ },
        relationsToInclude: [/* relations */],
        orderBy: { createdAt: 'desc' }
    }
);
```

##### `countByFilter<T>(filter): Promise<number>`
Count records matching filter.

##### `createMany<T>(items, skipDuplicates?): Promise<number>`
Bulk create with automatic batching.

##### `updateManyById(dataList): Promise<number>`
Bulk update by ID with SQL optimization.

##### `deleteByFilter<T>(filter): Promise<number>`
Delete records matching filter.

#### Instance Methods

##### `create(): Promise<TModel>`
Create the entity in database.

##### `update(): Promise<TModel>`
Update the entity in database.

##### `delete(): Promise<number>`
Delete the entity from database.

---

## Comparison

### Prisma entity framework vs Prisma Client (vanilla)

| Feature | Prisma Client | Prisma Entity Framework |
|---------|--------------|-------------------------|
| Active Record | ❌ | ✅ |
| Instance methods | ❌ | ✅ `user.create()` |
| Query DSL | Basic | ✅ Advanced (LIKE, ranges, OR/AND) |
| Batch optimization | Basic | ✅ SQL-optimized |
| Graph traversal | Manual | ✅ Automatic |


---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Reporting Issues

Found a bug or have a feature request? Please open an issue on [GitHub Issues](https://github.com/didactika/prisma-entity-framework/issues).


## License

MIT © 2025 [Hector Arrechea](https://github.com/hector-ae21) & [Eduardo Estrada](https://github.com/e2rd0)

## Acknowledgments

Built on top of the amazing [Prisma](https://www.prisma.io/) project.
