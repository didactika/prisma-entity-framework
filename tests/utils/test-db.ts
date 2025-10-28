/**
 * Test Database Setup and Utilities
 * Provides utilities for setting up and tearing down test databases
 * Supports SQLite, MySQL, and PostgreSQL
 */

import { getDatabaseProvider } from '../../src/database-utils';

/**
 * Test database configuration
 */
export interface TestDbConfig {
  client: any;
  cleanup: () => Promise<void>;
  provider: 'sqlite' | 'mysql' | 'postgresql' | 'mongodb';
  supportsSkipDuplicates: boolean;
}

/**
 * Creates a new test database with automatic provider detection
 * Supports SQLite (default), MySQL, and PostgreSQL
 * 
 * @returns Test database configuration with client and cleanup function
 * 
 * @example
 * ```typescript
 * const { client, cleanup, provider } = await setupTestDatabase();
 * try {
 *   await client.user.create({ data: { name: 'Test' } });
 *   // ... run tests
 * } finally {
 *   await cleanup();
 * }
 * ```
 */
export async function setupTestDatabase(): Promise<TestDbConfig> {
  // Detect database URL from environment
  const databaseUrl = process.env.DATABASE_URL;
  let provider: 'sqlite' | 'mysql' | 'postgresql' | 'mongodb' = 'sqlite';
  let client: any;

  // Determine provider from URL
  if (databaseUrl) {
    if (databaseUrl.startsWith('mysql://')) {
      provider = 'mysql';
    } else if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
      provider = 'postgresql';
    } else if (databaseUrl.startsWith('mongodb://') || databaseUrl.startsWith('mongodb+srv://')) {
      provider = 'mongodb';
    }
  }

  // Create Prisma client based on provider using the generated clients with custom output paths
  try {
    if (provider === 'sqlite') {
      // Use default Prisma client for SQLite
      const { PrismaClient } = await import('@prisma/client');
      
      // Use file-based SQLite for compatibility - path is relative to schema location
      const DATABASE_URL = `file:./test.db`;
      process.env.DATABASE_URL = DATABASE_URL;

      client = new PrismaClient({
        datasources: {
          db: {
            url: DATABASE_URL,
          },
        },
      });
    } else if (provider === 'mysql') {
      // Use MySQL-specific Prisma client (generated to node_modules/.prisma/client-mysql)
      // @ts-ignore - Dynamic import path based on runtime provider
      const clientModule = await import('../../node_modules/.prisma/client-mysql/index.js');
      const { PrismaClient } = clientModule;
      client = new PrismaClient();
    } else if (provider === 'postgresql') {
      // Use PostgreSQL-specific Prisma client (generated to node_modules/.prisma/client-postgresql)
      // @ts-ignore - Dynamic import path based on runtime provider
      const clientModule = await import('../../node_modules/.prisma/client-postgresql/index.js');
      const { PrismaClient } = clientModule;
      client = new PrismaClient();
    } else {
      // Use MongoDB-specific Prisma client (generated to node_modules/.prisma/client-mongodb)
      // @ts-ignore - Dynamic import path based on runtime provider
      const clientModule = await import('../../node_modules/.prisma/client-mongodb/index.js');
      const { PrismaClient } = clientModule;
      client = new PrismaClient();
    }
  } catch (error) {
    console.error(`❌ Failed to initialize test database:`, error);
    throw error;
  }

  try {
    // Connect to database
    await client.$connect();

    // Verify provider
    const detectedProvider = getDatabaseProvider(client);
    console.log(`✅ Test database initialized (${detectedProvider})`);

    // MySQL and PostgreSQL support skipDuplicates, SQLite and MongoDB do not
    const supportsSkipDuplicates = provider !== 'sqlite' && provider !== 'mongodb';

    /**
     * Cleanup function to disconnect and clear database
     */
    const cleanup = async () => {
      try {
        // Clear all data
        await client.comment.deleteMany({});
        await client.post.deleteMany({});
        await client.user.deleteMany({});
        if (client.product) {
          await client.product.deleteMany({});
        }

        // Disconnect
        await client.$disconnect();
      } catch (error) {
        console.error('❌ Cleanup error:', error);
      }
    };

    return { client, cleanup, provider, supportsSkipDuplicates };
  } catch (error) {
    console.error('❌ Failed to initialize test database:', error);
    throw error;
  }
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
export async function seedTestDatabase(client: any) {
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
 * Clears all data from test database
 * 
 * @param client - Prisma client instance
 * 
 * @example
 * ```typescript
 * await clearTestDatabase(client);
 * ```
 */
export async function clearTestDatabase(client: any): Promise<void> {
  try {
    // Delete in order to respect foreign key constraints
    await client.comment.deleteMany({});
    await client.post.deleteMany({});
    await client.user.deleteMany({});
    if (client.product) {
      await client.product.deleteMany({});
    }
  } catch (error) {
    // If tables don't exist, it's okay - they'll be created on first use
    console.warn('Warning: Could not clear test database, tables may not exist yet', error);
  }
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
  const { client, cleanup: cleanupDb, provider, supportsSkipDuplicates } = await setupTestDatabase();

  return {
    client,
    provider,
    supportsSkipDuplicates,
    seed: () => seedTestDatabase(client),
    clear: () => clearTestDatabase(client),
    cleanup: cleanupDb,
  };
}
