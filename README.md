# Prisma Entity Framework

> **Transform Prisma into a powerful Active Record ORM with advanced querying, batch operations, and graph utilities**

A complete TypeScript framework that extends Prisma Client with the Active Record pattern, a declarative query builder, relation graph traversal, and high-performance batch operations.

[![npm version](https://badge.fury.io/js/prisma-entity-framework.svg)](https://www.npmjs.com/package/prisma-entity-framework)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
---

## 🌟 Why Prisma Entity Framework?

Prisma is a fantastic query builder, but it's not a traditional ORM. This framework brings the ergonomic benefits of an Active Record pattern to your Prisma workflow, without sacrificing the type safety and performance you love. Get the best of both worlds: a powerful, intuitive entity system on top of Prisma's rock-solid foundation.

---

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
| **Pagination** | Manual | ✅ Built-in formatted responses |
| **Type Safety** | ✅ Full | ✅ Full (maintains Prisma types) |

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

1.  **Configure Prisma Client (one-time setup)**
    ```typescript
    import { PrismaClient } from '@prisma/client';
    import { configurePrisma } from 'prisma-entity-framework';

    const prisma = new PrismaClient();
    configurePrisma(prisma);
    ```

2.  **Define an Entity**
    ```typescript
    import { BaseEntity, Property } from 'prisma-entity-framework';
    import { User as PrismaUser } from '@prisma/client';
    import { prisma } from './prisma-client';

    export class User extends BaseEntity<PrismaUser> {
        static readonly model = prisma.user;
        
        @Property() declare id: number;
        @Property() declare name: string;
        @Property() declare email: string;
    }
    ```

3.  **Use It!**
    ```typescript
    // Create a new user with the Active Record pattern
    const user = new User({ name: "John Doe", email: "john.doe@example.com" });
    await user.create();

    // Find users with the declarative query builder
    const results = await User.findByFilter({
        isActive: true
    }, {
        onlyOne: true, //get only first match or all records, false by default
        search: {
            stringSearch: [{ keys: ['name', 'email'], value: 'john', mode: 'LIKE' }]
        },
        pagination: { page: 1, pageSize: 10, take: 10, skip: 0 }
    });

    console.log(results.data); // Paginated array of User instances
    ```

---

## ✨ Core Features

-   🏛️ **Active Record Pattern**: Manage your data with intuitive instance methods like `user.create()`.
    ```typescript
    const user = new User({ name: "John" });
    await user.create();
    ```
-   🔍 **Advanced Query Builder**: Build complex, declarative queries with support for `LIKE`, ranges, and lists.
    ```typescript
    const users = await User.findByFilter({name: "John"}, {
        search: {
            rangeSearch: [{ keys: ['age'], min: 18 }]
        }
    });
    ```
-   ⚡ **Optimized Batch Operations**: High-performance, database-aware batching for `createMany`, `updateMany`, and `upsertMany`.
    ```typescript
    await User.createMany([{ name: "User1" }, { name: "User2" }]);
    ```
-   🚀 **Parallel Execution**: Run batch operations concurrently for a 2-6x speed boost with zero configuration required.
    ```typescript
    // This feature is automatic, no code change needed!
    const manyUsers = [{ email: 'user1@example.com' }, { email: 'user2@example.com' }];
    await User.upsertMany(manyUsers); // Runs in parallel
    ```
-   🕸️ **Graph Traversal**: Analyze and navigate your data model with utilities for dependency sorting and pathfinding.
    ```typescript
    import { ModelUtils } from 'prisma-entity-framework';

    const path = ModelUtils.findPathToParentModel('Comment', 'User'); // -> "post.author"
    ```
-   📄 **Automatic Pagination**: Get formatted, paginated responses from your queries out of the box.
    ```typescript
    const paginated = await User.findByFilter({}, { pagination: { page: 1, pageSize: 10 } });
    ```

---

## 📚 Documentation

Dive deeper into the framework's capabilities:

-   **[Complete API Reference](./docs/api-reference.md)**: A detailed breakdown of all classes, methods, and types.
-   **[Advanced Examples](./docs/advanced-examples.md)**: See complex queries in action.
-   **[Advanced configuration guide](./docs/config.md)**: Learn about advanced configuration.
-   **[Property Behavior Guide](./docs/property-behavior-guide.md)**: Understand how the `@Property` decorator works.
-   **[Testing Guide](./docs/testing-guide.md)**: Best practices for testing your entities.

---

## 🧪 Testing

```bash
# Run all tests (SQLite)
npm test

# Test a specific database
npm run test:mysql

# Run tests on all databases
npm run test:all-databases
```
---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. Check out our [development setup guide](./CONTRIBUTING.md).

---

## 📝 License

MIT © 2025 [Eduardo Estrada](https://github.com/e2rd0) & [Hector Arrechea](https://github.com/hector-ae21)
