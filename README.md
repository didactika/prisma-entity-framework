# Prisma Entity Framework

> **Transform Prisma into a powerful Active Record ORM with advanced querying, batch operations, and graph utilities**

A complete TypeScript framework that extends Prisma Client with the Active Record pattern, a declarative query builder, relation graph traversal, and high-performance batch operations.

[![npm version](https://badge.fury.io/js/prisma-entity-framework.svg)](https://www.npmjs.com/package/prisma-entity-framework)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
---

## 🌟 Why Prisma Entity Framework?

Prisma is a fantastic query builder, but it's not a traditional ORM. This framework brings the ergonomic benefits of an Active Record pattern to your Prisma workflow, without sacrificing the type safety and performance you love. Get the best of both worlds: a powerful, intuitive entity system on top of Prisma's rock-solid foundation.

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
        search: {
            stringSearch: [{ keys: ['name', 'email'], value: 'john', mode: 'LIKE' }]
        },
        pagination: { page: 1, pageSize: 10 }
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
    const users = await User.findByFilter({ age: { gt: 18 } });
    ```
-   ⚡ **Optimized Batch Operations**: High-performance, database-aware batching for `createMany`, `updateMany`, and `upsertMany`.
    ```typescript
    await User.createMany([{ name: "User1" }, { name: "User2" }]);
    ```
-   🚀 **Parallel Execution**: Run batch operations concurrently for a 2-6x speed boost with zero configuration required.
    ```typescript
    // This feature is automatic, no code change needed!
    await User.upsertMany(manyUsers); // Runs in parallel
    ```
-   🕸️ **Graph Traversal**: Analyze and navigate your data model with utilities for dependency sorting and pathfinding.
    ```typescript
    const path = ModelUtils.findPathToParentModel('Comment', 'User'); // -> "post.author"
    ```
-   📄 **Automatic Pagination**: Get formatted, paginated responses from your queries out of the box.
    ```typescript
    const paginated = await User.findByFilter({}, { pagination: { page: 1, pageSize: 10 } });
    ```

---

## 📚 Documentation

Dive deeper into the framework's capabilities:

-   **[Complete API Reference](./docs/API_REFERENCE.md)**: A detailed breakdown of all classes, methods, and types.
-   **[Advanced Examples](./docs/ADVANCED_EXAMPLES.md)**: See complex queries and performance monitoring in action.
-   **[Core Features Guide](./docs/FEATURES.md)**: Learn about parallel batching and see how we stack up against Prisma Client.
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

MIT © 2025 [Hector Arrechea](https://github.com/hector-ae21) & [Eduardo Estrada](https://github.com/e2rd0)
