/**
 * Test Database Setup and Utilities
 * Provides utilities for setting up and tearing down test databases
 */

import { PrismaClient } from '@prisma/client';
import { join } from 'path';

/**
 * Test database configuration
 */
export interface TestDbConfig {
  client: PrismaClient;
  cleanup: () => Promise<void>;
}

/**
 * Creates a new test database with SQLite
 * This provides a real Prisma client for integration testing
 * 
 * @returns Test database configuration with client and cleanup function
 * 
 * @example
 * ```typescript
 * const { client, cleanup } = await setupTestDatabase();
 * try {
 *   await client.user.create({ data: { name: 'Test' } });
 *   // ... run tests
 * } finally {
 *   await cleanup();
 * }
 * ```
 */
export async function setupTestDatabase(): Promise<TestDbConfig> {
  // Use file-based SQLite for compatibility (faster than real DB, works reliably)
  const dbPath = join(process.cwd(), 'tests', 'prisma', 'test.db');
  const DATABASE_URL = `file:${dbPath}`;
  process.env.DATABASE_URL = DATABASE_URL;

  // Create Prisma client
  const client = new PrismaClient({
    datasources: {
      db: {
        url: DATABASE_URL,
      },
    },
  });

  try {
    // Connect to database
    await client.$connect();

    // Create tables using raw SQL (faster and more reliable than CLI)
    await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "User" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL,
        "email" TEXT NOT NULL UNIQUE,
        "age" INTEGER,
        "isActive" BOOLEAN NOT NULL DEFAULT 1,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Post" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "title" TEXT NOT NULL,
        "content" TEXT,
        "published" BOOLEAN NOT NULL DEFAULT 0,
        "authorId" INTEGER NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE
      );
    `);

    await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Comment" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "text" TEXT NOT NULL,
        "postId" INTEGER NOT NULL,
        "authorId" INTEGER NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE,
        FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE
      );
    `);

    console.log('✅ Test database initialized');
  } catch (error) {
    console.error('❌ Failed to initialize test database:', error);
    throw error;
  }

  /**
   * Cleanup function to disconnect and clear database
   */
  const cleanup = async () => {
    try {
      // Clear all data
      await client.comment.deleteMany();
      await client.post.deleteMany();
      await client.user.deleteMany();

      // Disconnect
      await client.$disconnect();
    } catch (error) {
      console.error('❌ Cleanup error:', error);
    }
  };

  return { client, cleanup };
}

/**
 * Seeds the test database with initial data
 * 
 * @param client - Prisma client instance
 * @returns Object with created entities
 * 
 * @example
 * ```typescript
 * const { users, posts, comments } = await seedTestDatabase(client);
 * ```
 */
export async function seedTestDatabase(client: PrismaClient) {
  // Create users
  const user1 = await client.user.create({
    data: {
      name: 'John Doe',
      email: 'john@example.com',
      age: 30,
      isActive: true,
    },
  });

  const user2 = await client.user.create({
    data: {
      name: 'Jane Smith',
      email: 'jane@example.com',
      age: 25,
      isActive: true,
    },
  });

  const user3 = await client.user.create({
    data: {
      name: 'Bob Johnson',
      email: 'bob@example.com',
      age: 35,
      isActive: false,
    },
  });

  // Create posts
  const post1 = await client.post.create({
    data: {
      title: 'First Post',
      content: 'This is the first post',
      published: true,
      authorId: user1.id,
    },
  });

  const post2 = await client.post.create({
    data: {
      title: 'Second Post',
      content: 'This is the second post',
      published: false,
      authorId: user1.id,
    },
  });

  const post3 = await client.post.create({
    data: {
      title: 'Third Post',
      content: 'This is the third post',
      published: true,
      authorId: user2.id,
    },
  });

  // Create comments
  const comment1 = await client.comment.create({
    data: {
      text: 'Great post!',
      postId: post1.id,
      authorId: user2.id,
    },
  });

  const comment2 = await client.comment.create({
    data: {
      text: 'Thanks for sharing',
      postId: post1.id,
      authorId: user3.id,
    },
  });

  const comment3 = await client.comment.create({
    data: {
      text: 'Interesting perspective',
      postId: post2.id,
      authorId: user2.id,
    },
  });

  return {
    users: [user1, user2, user3],
    posts: [post1, post2, post3],
    comments: [comment1, comment2, comment3],
  };
}

/**
 * Clears all data from the test database
 * Useful for cleanup between tests
 * 
 * @param client - Prisma client instance
 * 
 * @example
 * ```typescript
 * await clearTestDatabase(client);
 * ```
 */
export async function clearTestDatabase(client: PrismaClient): Promise<void> {
  // Delete in order to respect foreign key constraints
  await client.comment.deleteMany();
  await client.post.deleteMany();
  await client.user.deleteMany();
}

/**
 * Creates a test database instance for a single test suite
 * Automatically handles setup and cleanup
 * 
 * @returns Promise with test database functions
 * 
 * @example
 * ```typescript
 * describe('My Tests', () => {
 *   let db: Awaited<ReturnType<typeof createTestDb>>;
 * 
 *   beforeAll(async () => {
 *     db = await createTestDb();
 *   });
 * 
 *   afterAll(async () => {
 *     await db.cleanup();
 *   });
 * 
 *   it('should work', async () => {
 *     await db.seed();
 *     // ... test with db.client
 *   });
 * });
 * ```
 */
export async function createTestDb() {
  const { client, cleanup: cleanupDb } = await setupTestDatabase();

  return {
    client,
    seed: () => seedTestDatabase(client),
    clear: () => clearTestDatabase(client),
    cleanup: cleanupDb,
  };
}
