/**
 * Test Database Setup and Utilities
 * Provides utilities for setting up and tearing down test databases
 * Supports SQLite, MySQL, and PostgreSQL
 */

import { getDatabaseProvider } from '../../src/core/utils/database-utils';
import {
  detectDatabaseCapabilities,
  logDatabaseCapabilities,
  type DatabaseProvider,
  type DatabaseCapabilities
} from './database-detector';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';

// Track if database has been initialized for this test run
let databaseInitialized = false;

/**
 * Test database instance with full capability information
 */
export interface TestDbInstance {
  /** Prisma client instance */
  client: any;

  /** Database provider type */
  provider: DatabaseProvider;

  /** Complete database capabilities */
  capabilities: DatabaseCapabilities;

  /** Seed test data into database */
  seed: () => Promise<SeedData>;

  /** Clear all test data from database */
  clear: () => Promise<void>;

  /** Cleanup and disconnect from database */
  cleanup: () => Promise<void>;
}

/**
 * Seed data structure returned by seed function
 */
export interface SeedData {
  users: any[];
  posts: any[];
  comments: any[];
}

/**
 * Cleans up SQLite database files
 */
function cleanupSqliteDatabase(): void {
  const dbPath = join(process.cwd(), 'tests', 'prisma', 'test.db');
  const journalPath = `${dbPath}-journal`;

  if (existsSync(dbPath)) {
    try {
      unlinkSync(dbPath);
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  if (existsSync(journalPath)) {
    try {
      unlinkSync(journalPath);
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Creates a Prisma client for the specified provider
 */
async function createPrismaClient(provider: DatabaseProvider): Promise<any> {
  if (provider === 'sqlite') {
    const { PrismaClient } = await import('@prisma/client');
    const path = await import('path');

    // Use absolute path to ensure database is created in the correct location
    const dbPath = path.join(process.cwd(), 'tests', 'prisma', 'test.db');
    const DATABASE_URL = `file:${dbPath}`;
    process.env.DATABASE_URL = DATABASE_URL;

    return new PrismaClient({
      datasources: {
        db: {
          url: DATABASE_URL,
        },
      },
    });
  }

  // For other databases, use provider-specific clients
  const clientPaths: Record<string, string> = {
    mysql: '../../node_modules/.prisma/client-mysql/index.js',
    postgresql: '../../node_modules/.prisma/client-postgresql/index.js',
    mongodb: '../../node_modules/.prisma/client-mongodb/index.js',
  };

  const clientPath = clientPaths[provider];
  if (!clientPath) {
    throw new Error(`Unsupported database provider: ${provider}`);
  }

  // @ts-ignore - Dynamic import path based on runtime provider
  const clientModule = await import(clientPath);
  const { PrismaClient } = clientModule;
  return new PrismaClient();
}

/**
 * Initializes the database schema (only runs once per test session)
 */
async function initializeDatabaseSchema(provider: DatabaseProvider): Promise<void> {
  if (databaseInitialized) {
    return;
  }

  // Clean up SQLite database before tests (only for SQLite)
  if (provider === 'sqlite') {
    cleanupSqliteDatabase();

    // Push schema for SQLite
    try {
      const { execSync } = await import('child_process');
      execSync('npx prisma db push --schema=tests/prisma/schema.test.prisma --skip-generate --accept-data-loss', {
        stdio: 'ignore'
      });
    } catch (error) {
      console.error('Failed to push SQLite schema:', error);
      throw error;
    }
  }

  databaseInitialized = true;
}

/**
 * Creates a new test database with automatic provider detection
 * Supports SQLite (default), MySQL, PostgreSQL, and MongoDB
 * 
 * @param logCapabilities - Whether to log detected capabilities (default: false)
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
export async function setupTestDatabase(logCapabilities = false): Promise<TestDbInstance> {
  // Use shared database detection logic
  const capabilities = detectDatabaseCapabilities();
  const { provider } = capabilities;

  // Log capabilities if requested
  if (logCapabilities) {
    logDatabaseCapabilities();
  }

  // Initialize database schema once
  await initializeDatabaseSchema(provider);

  let client: any;

  // Create Prisma client based on provider
  try {
    client = await createPrismaClient(provider);
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
        if (client.job) {
          await client.job.deleteMany({});
        }

        // Disconnect
        await client.$disconnect();
      } catch (error) {
        console.error('❌ Cleanup error:', error);
      }
    };

    return { client, cleanup, provider, capabilities, seed: () => seedTestDatabase(client), clear: () => clearTestDatabase(client) };
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
export async function seedTestDatabase(client: any): Promise<SeedData> {
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
    if (client.job) {
      await client.job.deleteMany({});
    }
  } catch (error) {
    // If tables don't exist, it's okay - they'll be created on first use
    console.warn('Warning: Could not clear test database, tables may not exist yet', error);
  }
}

/**
 * Creates a test database instance for a single test suite
 * Automatically handles setup and cleanup with full capability detection
 * 
 * @param logCapabilities - Whether to log detected capabilities (default: true for integration tests)
 * @returns Promise with test database instance including full capabilities
 * 
 * @example
 * ```typescript
 * describe('My Tests', () => {
 *   let db: TestDbInstance;
 * 
 *   beforeAll(async () => {
 *     db = await createTestDb();
 *     
 *     // Skip tests based on capabilities
 *     if (!db.capabilities.supportsJSON) {
 *       console.log('Skipping JSON tests');
 *       return;
 *     }
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
export async function createTestDb(logCapabilities = true): Promise<TestDbInstance> {
  // Log capabilities if requested
  if (logCapabilities) {
    logDatabaseCapabilities();
  }

  return setupTestDatabase(logCapabilities);
}
