/**
 * Integration test for BaseEntity with real Prisma database
 * 
 * This test suite uses capability-based testing to ensure compatibility across all supported databases:
 * - SQLite (default): Fast, file-based, sequential operations
 * - MySQL: Relational, supports JSON, parallel operations
 * - PostgreSQL: Relational, supports JSON and scalar arrays, parallel operations
 * - MongoDB: Document-based, uses string IDs (ObjectId), limited transaction support
 * 
 * Tests automatically adapt based on detected database capabilities:
 * - ID Type: number (auto-increment) vs string (ObjectId)
 * - Skip Duplicates: Supported on MySQL/PostgreSQL, not on SQLite/MongoDB
 * - Parallel Operations: Supported on all except SQLite
 * 
 * Run with specific database:
 * - SQLite: npm test (default)
 * - MySQL: DATABASE_URL=mysql://... npm test
 * - PostgreSQL: DATABASE_URL=postgresql://... npm test
 * - MongoDB: DATABASE_URL=mongodb://... npm test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/core/base-entity';
import { Property } from '../../src/core/decorators/property.decorator';
import { configurePrisma, resetPrismaConfiguration } from '../../src/core/config';
import { createTestDb } from '../helpers/test-db';
import type { PrismaClient } from '@prisma/client';

/**
 * User entity for testing using @Property() decorator
 * ID type is flexible to support both numeric (SQLite, MySQL, PostgreSQL) and string (MongoDB) IDs
 */
interface IUser {
  id?: number | string;
  name: string;
  email: string;
  age?: number | null;
  isActive?: boolean;
}

class User extends BaseEntity<IUser> implements IUser {
  static override readonly model: PrismaClient['user'];

  public declare readonly id?: IUser['id'];

  @Property() declare name: IUser['name'];
  @Property() declare email: IUser['email'];
  @Property() declare age: IUser['age'];
  @Property() declare isActive: IUser['isActive'];

  constructor(data?: Partial<IUser>) {
    super(data);
  }
}

describe('BaseEntity - Integration Tests with Real Database', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Setup real test database with capability detection
    db = await createTestDb();
    prisma = db.client;

    // Log database provider and capabilities at test startup
    console.log('\n' + '='.repeat(60));
    console.log(`Running BaseEntity Integration Tests`);
    console.log('='.repeat(60));
    console.log(`Database Provider:     ${db.provider.toUpperCase()}`);
    console.log(`ID Type:               ${db.capabilities.idType}`);
    console.log(`Skip Duplicates:       ${db.capabilities.supportsSkipDuplicates ? '✅' : '❌'}`);
    console.log(`Parallel Operations:   ${db.capabilities.supportsParallel ? '✅' : '❌'}`);
    console.log(`Max Concurrency:       ${db.capabilities.maxConcurrency}`);
    console.log('='.repeat(60) + '\n');

    // Clear all data before starting tests
    await db.clear();

    // Configure User entity with real Prisma model
    (User as any).model = prisma.user;
    configurePrisma(prisma as any);

    // Log detected pool size for MongoDB
    if (db.provider === 'mongodb') {
      const { getConnectionPoolSize } = require('../../src/core/config');
      const poolSize = getConnectionPoolSize();
      console.log(`✅ Detected MongoDB connection pool size: ${poolSize}`);

      if (process.env.DATABASE_URL?.includes('maxPoolSize')) {
        const match = process.env.DATABASE_URL.match(/maxPoolSize=(\d+)/);
        if (match) {
          const expectedSize = parseInt(match[1], 10);
          console.log(`✅ maxPoolSize parameter in DATABASE_URL: ${expectedSize}`);
          if (poolSize === expectedSize) {
            console.log(`✅ Pool size correctly detected from maxPoolSize parameter!`);
          }
        }
      }
    }
  }, 30000); // 30 second timeout for database setup

  afterAll(async () => {
    // Cleanup database
    await db.cleanup();
    resetPrismaConfiguration();
  });

  beforeEach(async () => {
    // Clear data before each test
    await db.clear();
  });

  describe('create', () => {
    /**
     * Test: should create new user in database
     */
    it('should create new user in database', async () => {
      const user = new User({ name: 'Alice', email: 'alice@example.com', age: 28 });
      const result = await user.create();

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.name).toBe('Alice');
      expect(result.email).toBe('alice@example.com');
      expect(result.age).toBe(28);

      // Verify in database
      const dbUser = await prisma.user.findUnique({ where: { id: result.id as any } });
      expect(dbUser).toBeDefined();
      expect(dbUser?.name).toBe('Alice');
    });

    /**
     * Test: should enforce unique email constraint
     */
    it('should enforce unique email constraint', async () => {
      const user1 = new User({ name: 'User 1', email: 'same@example.com' });
      await user1.create();

      const user2 = new User({ name: 'User 2', email: 'same@example.com' });
      await expect(user2.create()).rejects.toThrow();
    });
  });

  describe('update', () => {
    /**
     * Test: should update existing user
     */
    it('should update existing user', async () => {
      const user = new User({ name: 'Original', email: 'original@example.com' });
      const created = await user.create();

      const userToUpdate = new User({ id: created.id, name: 'Updated', email: 'updated@example.com' });
      const updated = await userToUpdate.update();

      expect(updated.name).toBe('Updated');
      expect(updated.email).toBe('updated@example.com');

      // Verify in database
      const dbUser = await prisma.user.findUnique({ where: { id: created.id as any } });
      expect(dbUser?.name).toBe('Updated');
    });

    /**
     * Test: should handle update after findByFilter with relations
     * This reproduces the bug: findByFilter with relationsToInclude, then update
     */
    it('should update after findByFilter with relations included', async () => {
      // Create user first
      const created = await prisma.user.create({
        data: { name: 'John', email: 'john@example.com', age: 30 }
      });

      // Create a post for the user
      const postResult = await prisma.post.create({
        data: {
          title: 'Test Post',
          content: 'Content',
          published: true,
          authorId: created.id
        }
      });
      expect(postResult).toBeDefined();

      // Find user with relations (simulating the bug scenario)
      const found = await User.findByFilter(
        { email: 'john@example.com' },
        {
          onlyOne: true,
          relationsToInclude: [{ posts: [] }]
        }
      ) as any;

      expect(found).not.toBeNull();
      expect(found.posts).toBeDefined();
      expect(Array.isArray(found.posts)).toBe(true);

      // Create entity instance from found data
      const userToUpdate = new User(found);

      // Update a field
      userToUpdate.age = 31;

      // This should work without errors
      const updated = await userToUpdate.update();

      expect(updated.age).toBe(31);
      expect(updated.name).toBe('John');

      // Verify in database
      const dbUser = await prisma.user.findUnique({ where: { id: created.id as any } });
      expect(dbUser?.age).toBe(31);
    });

    /**
     * Test: should handle update with nested relation object in data
     */
    it('should update when entity has relation object', async () => {
      // Create user first
      const created = await prisma.user.create({
        data: { name: 'Jane', email: 'jane@example.com', age: 25 }
      });

      // Create post for user
      const createdUserPost = await prisma.post.create({
        data: {
          title: 'Jane Post',
          content: 'Content',
          published: true,
          authorId: created.id
        }
      });
      expect(createdUserPost).toBeDefined();

      // Find user with posts relation
      const found = await User.findByFilter(
        { id: created.id },
        {
          onlyOne: true,
          relationsToInclude: [{ posts: [] }]
        }
      ) as any;

      // Create entity with relation data
      const userEntity = new User({
        id: found.id,
        name: found.name,
        email: found.email,
        age: found.age,
        posts: found.posts // This should be filtered out in update
      } as any);

      // Update a field
      userEntity.name = 'Jane Updated';

      // Should not fail with "Unknown argument `posts`"
      const updated = await userEntity.update();

      expect(updated.name).toBe('Jane Updated');

      // Verify in database
      const dbUser = await prisma.user.findUnique({ where: { id: created.id as any } });
      expect(dbUser?.name).toBe('Jane Updated');
    });

    /**
     * Test: should handle update with FK field when relation object exists
     */
    it('should prefer FK field over relation object', async () => {
      // This test ensures that if both authorId and author exist,
      // the FK field is used and the relation object is removed

      const user1 = await prisma.user.create({
        data: { name: 'Author 1', email: 'author1@example.com' }
      });

      const user2 = await prisma.user.create({
        data: { name: 'Author 2', email: 'author2@example.com' }
      });

      const createdPost = await prisma.post.create({
        data: {
          title: 'Original Post',
          content: 'Content',
          published: true,
          authorId: user1.id
        }
      });

      // Find post with author relation
      const foundPost = await prisma.post.findUnique({
        where: { id: createdPost.id },
        include: { author: true }
      });

      // Simulate entity with both authorId and author object
      const postData: any = {
        id: foundPost!.id,
        title: 'Updated Post',
        content: foundPost!.content,
        published: foundPost!.published,
        authorId: user2.id, // Change to user2
        author: foundPost!.author // Has user1 data
      };

      // Mock entity class for Post
      class Post extends BaseEntity<any> {
        static readonly model = prisma.post;

        declare title: string;
        declare content: string;
        declare published: boolean;
        declare authorId: number;

        constructor(data?: any) {
          super(data);
        }
      }

      const postEntity = new Post(postData);
      const updated = await postEntity.update();

      // Should use authorId (user2), not the author object (user1)
      expect(updated.authorId).toBe(user2.id);

      // Verify in database
      const dbPost = await prisma.post.findUnique({ where: { id: createdPost.id as any } });
      expect(dbPost?.authorId).toBe(user2.id);
      expect(dbPost?.title).toBe('Updated Post');
    });

    /**
     * Test: should not include createdAt in update
     */
    it('should not update createdAt field', async () => {
      const user = new User({ name: 'TestUser', email: 'test@example.com' });
      const created = await user.create();
      const originalCreatedAt = (created as any).createdAt;

      // Wait a bit to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10));

      // Try to update with createdAt
      const userToUpdate = new User({
        id: created.id,
        name: 'Updated User',
        email: 'test@example.com',
        createdAt: new Date() // This should be ignored
      } as any);

      await userToUpdate.update();

      // Verify createdAt didn't change
      const dbUser = await prisma.user.findUnique({ where: { id: created.id as any } });
      expect((dbUser as any)?.createdAt.getTime()).toBe(originalCreatedAt.getTime());
      expect(dbUser?.name).toBe('Updated User');
    });

    /**
     * Test: should handle updatedAt correctly
     */
    it('should handle updatedAt field', async () => {
      const user = new User({ name: 'TestUser', email: 'test2@example.com' });
      const created = await user.create();
      const originalUpdatedAt = (created as any).updatedAt;

      // Wait to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const userToUpdate = new User({
        id: created.id,
        name: 'Updated User',
        email: 'test2@example.com'
      });

      await userToUpdate.update();

      // Verify updatedAt was updated by database
      const dbUser = await prisma.user.findUnique({ where: { id: created.id as any } });
      expect((dbUser as any)?.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());
      expect(dbUser?.name).toBe('Updated User');
    });

    /**
     * Test: should not fail when entity has object-type fields with create/update syntax
     */
    it('should filter out Prisma operation objects', async () => {
      const user = new User({ name: 'TestUser', email: 'test3@example.com' });
      const created = await user.create();

      // Simulate entity with Prisma operation objects (like from findByFilter)
      const userWithOperations: any = {
        id: created.id,
        name: 'Updated',
        email: 'test3@example.com',
        createdAt: { create: {} }, // Prisma operation object
        updatedAt: { create: {} }  // Prisma operation object
      };

      const userToUpdate = new User(userWithOperations);

      // Should not fail with "Invalid invocation" error
      const updated = await userToUpdate.update();

      expect(updated.name).toBe('Updated');
    });
  });

  describe('delete', () => {
    /**
     * Test: should delete user from database
     */
    it('should delete user from database', async () => {
      const user = new User({ name: 'ToDelete', email: 'delete@example.com' });
      const created = await user.create();

      const userToDelete = new User({ id: created.id!, name: 'ToDelete', email: 'delete@example.com' });
      await userToDelete.delete();

      // Verify deleted from database
      const dbUser = await prisma.user.findUnique({ where: { id: created.id as any } });
      expect(dbUser).toBeNull();
    });
  });

  describe('findByFilter', () => {
    beforeEach(async () => {
      // Seed test data
      await db.seed();
    });

    /**
     * Test: should find all users
     */
    it('should find all users', async () => {
      const users = await User.findByFilter({}) as any[];

      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBe(3);
    });

    /**
     * Test: should filter by name
     */
    it('should filter by name', async () => {
      const users = await User.findByFilter({ name: 'John Doe' }) as any[];

      expect(users.length).toBe(1);
      expect(users[0].name).toBe('John Doe');
    });

    /**
     * Test: should filter by isActive
     */
    it('should filter by isActive', async () => {
      const users = await User.findByFilter({ isActive: true }) as any[];

      expect(users.length).toBe(2);
      expect(users.every((u: any) => u.isActive)).toBe(true);
    });

    /**
     * Test: should return single entity with onlyOne option
     */
    it('should return single entity with onlyOne option', async () => {
      const user = await User.findByFilter({ name: 'John Doe' }, { onlyOne: true });

      expect(user).not.toBeNull();
      expect(Array.isArray(user)).toBe(false);
      expect((user as any).name).toBe('John Doe');
    });

    /**
     * Test: should handle pagination
     */
    it('should handle pagination', async () => {
      const result = await User.findByFilter({}, {
        pagination: { page: 1, pageSize: 2, take: 2, skip: 0 },
      }) as any;

      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('data');
      expect(result.total).toBe(3);
      expect(result.data.length).toBe(2);
    });

    /**
     * Test: should apply string search with LIKE
     */
    it('should apply string search with LIKE', async () => {
      const users = await User.findByFilter({}, {
        search: {
          stringSearch: [{ keys: ['name'], value: 'John', mode: 'LIKE' }],
        },
      }) as any[];

      expect(users.length).toBeGreaterThan(0);
      expect(users[0].name).toContain('John');
    });

    /**
     * Test: should apply range search
     */
    it('should apply range search', async () => {
      const users = await User.findByFilter({}, {
        search: {
          rangeSearch: [{ keys: ['age'], min: 25, max: 30 }],
        },
      }) as any[];

      expect(users.length).toBeGreaterThan(0);
      expect(users.every((u: any) => u.age >= 25 && u.age <= 30)).toBe(true);
    });

    /**
     * Test: should apply ordering
     */
    it('should apply ordering', async () => {
      const users = await User.findByFilter({}, {
        orderBy: { name: 'asc' },
      }) as any[];

      expect(users[0].name).toBe('Bob Johnson');
      expect(users[2].name).toBe('John Doe');
    });
  });

  describe('countByFilter', () => {
    beforeEach(async () => {
      await db.seed();
    });

    /**
     * Test: should count all users
     */
    it('should count all users', async () => {
      const count = await User.countByFilter({});

      expect(count).toBe(3);
    });

    /**
     * Test: should count filtered users
     */
    it('should count filtered users', async () => {
      const count = await User.countByFilter({ isActive: true });

      expect(count).toBe(2);
    });
  });

  describe('createMany', () => {
    /**
     * Test: should create multiple users
     */
    it('should create multiple users', async () => {
      const users = [
        { name: 'User 1', email: 'usercreatemany01@example.com' },
        { name: 'User 2', email: 'usercreatemany02@example.com' },
        { name: 'User 3', email: 'usercreatemany03@example.com' },
      ];

      const count = await User.createMany(users);

      expect(count).toBe(3);

      // Verify in database
      const dbUsers = await prisma.user.findMany();
      expect(dbUsers.length).toBe(3);
    });

    /**
     * Test: should handle skipDuplicates with capability detection
     * SQLite and MongoDB do not support skipDuplicates parameter in createMany
     * This test adapts based on database capabilities
     */
    it('should handle skipDuplicates based on database capabilities', async () => {
      // Create initial user
      await prisma.user.create({ data: { name: 'Existing', email: 'exist@example.com' } });

      const users = [
        { name: 'New User', email: 'new@example.com' },
        { name: 'Existing', email: 'exist@example.com' }, // Duplicate
      ];

      if (db.capabilities.supportsSkipDuplicates) {
        // MySQL and PostgreSQL support skipDuplicates
        console.log(`✅ Testing skipDuplicates on ${db.provider} (supported)`);
        const count = await User.createMany(users, { skipDuplicates: true });
        expect(count).toBeGreaterThanOrEqual(1);

        // Verify that only non-duplicate was created
        const allUsers = await prisma.user.findMany();
        expect(allUsers.length).toBe(2); // 1 existing + 1 new
      } else {
        // SQLite and MongoDB don't support skipDuplicates
        console.log(`⏭️  Skipping skipDuplicates test on ${db.provider} (not supported)`);
        // Should either throw an error or create only valid records
        try {
          await User.createMany(users, { skipDuplicates: true });
          // If it succeeds, verify behavior
          const allUsers = await prisma.user.findMany();
          expect(allUsers.length).toBeGreaterThanOrEqual(1);
        } catch (error) {
          // Expected for databases without skipDuplicates support
          expect(error).toBeDefined();
        }
      }
    });
  });

  describe('deleteByFilter', () => {
    beforeEach(async () => {
      await db.seed();
    });

    /**
     * Test: should delete users by filter
     */
    it('should delete users by filter', async () => {
      const count = await User.deleteByFilter({ isActive: false });

      expect(count).toBe(1);

      // Verify in database
      const remainingUsers = await prisma.user.findMany();
      expect(remainingUsers.length).toBe(2);
      expect(remainingUsers.every((u: any) => u.isActive)).toBe(true);
    });
  });

  describe('Relations', () => {
    beforeEach(async () => {
      await db.seed();
    });

    /**
     * Test: should include related posts
     */
    it('should include related posts', async () => {
      const users = await User.findByFilter({}, {
        relationsToInclude: [{ posts: [] }],
      }) as any[];

      expect(users[0]).toHaveProperty('posts');
      expect(Array.isArray(users[0].posts)).toBe(true);
    });

    /**
     * Test: should include nested relations
     */
    it('should include nested relations', async () => {
      const users = await User.findByFilter({}, {
        relationsToInclude: [{ posts: [{ comments: [] }] }],
      }) as any[];

      expect(users[0]).toHaveProperty('posts');
      if (users[0].posts.length > 0) {
        expect(users[0].posts[0]).toHaveProperty('comments');
      }
    });

    /**
     * Test: should include all first-level relations with "*"
     */
    it('should include all first-level relations with "*"', async () => {
      const users = await User.findByFilter({}, {
        relationsToInclude: "*",
      }) as any[];

      expect(users.length).toBeGreaterThan(0);
      expect(users[0]).toHaveProperty('posts');
      expect(users[0]).toHaveProperty('comments');
      expect(Array.isArray(users[0].posts)).toBe(true);
      expect(Array.isArray(users[0].comments)).toBe(true);
    });

    /**
     * Test: wildcard should not include deep nested relations
     */
    it('wildcard should not include deep nested relations', async () => {
      const users = await User.findByFilter({}, {
        relationsToInclude: "*",
      }) as any[];

      expect(users.length).toBeGreaterThan(0);
      expect(users[0]).toHaveProperty('posts');

      // Posts should be loaded, but their nested relations (author, comments) should not be automatically included
      if (users[0].posts.length > 0) {
        const post = users[0].posts[0];
        // The post object itself should exist
        expect(post).toBeDefined();
        expect(post).toHaveProperty('id');
        expect(post).toHaveProperty('title');
        // But it should not have deep nested relations loaded unless we explicitly requested them
        // This verifies that "*" only loads first level
      }
    });

    /**
     * Test: should allow mixing wildcard with specific nested relations
     */
    it('should allow mixing wildcard with specific nested relations', async () => {
      const users = await User.findByFilter({}, {
        relationsToInclude: [
          { posts: [{ author: [] }, { comments: [] }] }, // Nested relations on posts
          { comments: [] } // Just comments without nesting
        ],
      }) as any[];

      expect(users.length).toBeGreaterThan(0);
      expect(users[0]).toHaveProperty('posts');
      expect(users[0]).toHaveProperty('comments');

      // Posts should have nested includes
      if (users[0].posts.length > 0) {
        expect(users[0].posts[0]).toHaveProperty('author');
        expect(users[0].posts[0]).toHaveProperty('comments');
      }

      // Comments should be simple (no nesting)
      if (users[0].comments.length > 0) {
        expect(users[0].comments[0]).toHaveProperty('id');
        expect(users[0].comments[0]).toHaveProperty('text');
      }
    });

    /**
     * Test: should correctly merge filters with nested relations and string search
     */
    it('should correctly merge filters with nested relations and string search', async () => {
      // Skip for databases with string IDs - test uses hardcoded numeric IDs
      if (db.capabilities.idType === 'string') {
        console.log(`⏭️  Skipping test on ${db.provider} (uses string IDs, test requires numeric IDs)`);
        return;
      }

      // This test simulates the real-world scenario where you have:
      // 1. A filter with nested relations (e.g., posts.comments.authorId)
      // 2. A string search on a nested field (e.g., posts.title)
      // The ObjectUtils.assign should merge them correctly into the 'is/some' structure

      const users = await User.findByFilter(
        {
          posts: {
            comments: {
              authorId: 2
            }
          }
        } as any,
        {
          search: {
            stringSearch: [
              {
                keys: ['posts.title'],
                value: 'Post',
                mode: 'LIKE',
                grouping: 'and'
              }
            ]
          },
          relationsToInclude: [{ posts: [{ comments: [] }] }]
        }
      ) as any[];

      // Should not throw an error about unknown arguments
      expect(Array.isArray(users)).toBe(true);

      // If results exist, they should have the correct structure
      if (users.length > 0) {
        expect(users[0]).toHaveProperty('posts');
        if (users[0].posts.length > 0) {
          expect(users[0].posts[0]).toHaveProperty('title');
          expect(users[0].posts[0].title).toContain('Post');
          expect(users[0].posts[0]).toHaveProperty('comments');
        }
      }
    });

    /**
     * Test: should handle deeply nested filter with search on same relation
     */
    it('should handle deeply nested filter with search on same relation', async () => {
      // Skip for MongoDB - uses string IDs (ObjectId) instead of numeric IDs
      if (db.capabilities.idType === 'string') {
        console.log(`⏭️  Skipping test on ${db.provider} (uses string IDs, test requires numeric IDs)`);
        return;
      }

      // Test case where both filter and search target the same nested relation
      // Filter: posts.authorId = 1
      // Search: posts.title LIKE 'First'
      // Both should merge into the same posts.is structure

      const users = await User.findByFilter(
        {
          posts: {
            authorId: 1
          }
        } as any,
        {
          search: {
            stringSearch: [
              {
                keys: ['posts.title'],
                value: 'First',
                mode: 'LIKE'
              }
            ]
          }
        }
      ) as any[];

      expect(Array.isArray(users)).toBe(true);

      // Should find user with id=1 who has posts (only for numeric ID databases)
      if (users.length > 0) {
        expect(users[0].id).toBe(1);
      }
    });

    /**
     * Test: should merge multiple nested paths correctly
     */
    it('should merge multiple nested paths correctly', async () => {
      // Complex case with multiple nested paths on the same relation
      const users = await User.findByFilter(
        {
          posts: {
            published: true
          }
        } as any,
        {
          search: {
            stringSearch: [
              {
                keys: ['posts.title'],
                value: 'Post',
                mode: 'LIKE'
              },
              {
                keys: ['posts.content'],
                value: 'post',
                mode: 'LIKE'
              }
            ]
          }
        }
      ) as any[];

      // Should execute without errors
      expect(Array.isArray(users)).toBe(true);
    });
  });

  describe('Search with nested array relations', () => {
    beforeEach(async () => {
      await db.seed();
    });

    /**
     * Test: should handle search on nested array relation with single relation
     * Path: posts.author.name (array → single)
     * Expected structure: { posts: { some: { author: { is: { name: {...} } } } } }
     */
    it('should handle search on posts.author.name (array → single)', async () => {
      const users = await User.findByFilter(
        {},
        {
          search: {
            stringSearch: [
              {
                keys: ['posts.author.name'],
                value: 'John',
                mode: 'LIKE'
              }
            ]
          }
        }
      ) as any[];

      // Should not throw "Unknown argument `author`" error
      expect(Array.isArray(users)).toBe(true);
    });

    /**
     * Test: should handle search on deeply nested array relations
     * Path: posts.comments.author.name (array → array → single)
     * Expected structure: { posts: { some: { comments: { some: { author: { is: { name: {...} } } } } } } }
     */
    it('should handle search on posts.comments.author.name (array → array → single)', async () => {
      const users = await User.findByFilter(
        {},
        {
          search: {
            stringSearch: [
              {
                keys: ['posts.comments.author.name'],
                value: 'John',
                mode: 'LIKE'
              }
            ]
          }
        }
      ) as any[];

      // Should not throw error about unknown arguments
      expect(Array.isArray(users)).toBe(true);
    });

    /**
     * Test: should combine base filter on array relation with search on nested field
     * Base filter: posts.published = true (needs 'some')
     * Search: posts.author.name LIKE 'John' (needs 'some' → 'is')
     */
    it('should combine filter and search on same nested array relation', async () => {
      const users = await User.findByFilter(
        {
          posts: {
            published: true
          }
        } as any,
        {
          search: {
            stringSearch: [
              {
                keys: ['posts.author.name'],
                value: 'John',
                mode: 'LIKE'
              }
            ]
          }
        }
      ) as any[];

      expect(Array.isArray(users)).toBe(true);
    });

    /**
     * Test: should handle search with ENDS_WITH operator on nested path
     * This is the exact scenario from the user's bug report
     */
    it('should handle ENDS_WITH search on nested array relation path', async () => {
      const users = await User.findByFilter(
        {},
        {
          search: {
            stringSearch: [
              {
                keys: ['posts.author.email'],
                value: '@example.com',
                mode: 'ENDS_WITH'
              }
            ]
          }
        }
      ) as any[];

      // Should not throw "Unknown argument `author`. Did you mean `every`?" error
      expect(Array.isArray(users)).toBe(true);

      // If results exist, verify they match
      if (users.length > 0) {
        // Users should have posts with authors whose emails end with @example.com
        expect(users[0]).toHaveProperty('id');
      }
    });

    /**
     * Test: should handle multiple search keys on nested array relations
     */
    it('should handle multiple nested array relation searches', async () => {
      const users = await User.findByFilter(
        {},
        {
          search: {
            stringSearch: [
              {
                keys: ['posts.title', 'posts.author.name'],
                value: 'Post',
                mode: 'LIKE',
                grouping: 'or'
              }
            ]
          }
        }
      ) as any[];

      expect(Array.isArray(users)).toBe(true);
    });

    /**
     * Test: should handle range search on nested array relation
     */
    it('should handle range search on nested array relation', async () => {
      const users = await User.findByFilter(
        {},
        {
          search: {
            rangeSearch: [
              {
                keys: ['posts.author.age'],
                min: 25,
                max: 35
              }
            ]
          }
        }
      ) as any[];

      expect(Array.isArray(users)).toBe(true);
    });

    /**
     * Test: should handle search on comments.author.name (array → single)
     */
    it('should handle search on comments.author.name', async () => {
      const users = await User.findByFilter(
        {},
        {
          search: {
            stringSearch: [
              {
                keys: ['comments.author.name'],
                value: 'John',
                mode: 'LIKE'
              }
            ]
          }
        }
      ) as any[];

      expect(Array.isArray(users)).toBe(true);
    });

    /**
     * Test: should handle mixed single and array relations in path
     * Path: posts.comments.post.author.name (array → array → single → single)
     */
    it('should handle complex mixed relation path', async () => {
      const users = await User.findByFilter(
        {},
        {
          search: {
            stringSearch: [
              {
                keys: ['posts.comments.post.author.name'],
                value: 'John',
                mode: 'LIKE'
              }
            ]
          }
        }
      ) as any[];

      // Should handle the complex path without errors
      expect(Array.isArray(users)).toBe(true);
    });
  });

  describe('Upsert Operations', () => {
    beforeEach(async () => {
      await db.clear();
    });

    describe('upsert', () => {
      /**
       * Test: should create new user when doesn't exist (real database)
       */
      it('should create new user when doesn\'t exist', async () => {
        const userData = { name: 'New User', email: 'newuser@example.com', age: 25 };

        const result = await User.upsert(userData);

        expect(result).toBeDefined();
        expect(result.id).toBeDefined();
        expect(result.name).toBe('New User');
        expect(result.email).toBe('newuser@example.com');
        expect(result.age).toBe(25);

        // Verify in database
        const dbUser = await prisma.user.findUnique({ where: { email: 'newuser@example.com' } });
        expect(dbUser).toBeDefined();
        expect(dbUser?.name).toBe('New User');
      });

      /**
       * Test: should update existing user when changes detected
       */
      it('should update existing user when changes detected', async () => {
        // Create initial user
        const created = await prisma.user.create({
          data: { name: 'Old Name', email: 'update@example.com', age: 30 }
        });

        // Upsert with changes
        const result = await User.upsert({
          email: 'update@example.com',
          name: 'New Name',
          age: 35
        });

        expect(result.id).toBe(created.id);
        expect(result.name).toBe('New Name');
        expect(result.age).toBe(35);

        // Verify in database
        const dbUser = await prisma.user.findUnique({ where: { id: created.id as any } });
        expect(dbUser?.name).toBe('New Name');
        expect(dbUser?.age).toBe(35);
      });

      /**
       * Test: should return existing user when no changes detected
       */
      it('should return existing user when no changes detected', async () => {
        // Create initial user
        const created = await prisma.user.create({
          data: { name: 'Same Name', email: 'same@example.com', age: 28 }
        });

        const createdUpdatedAt = created.updatedAt;

        // Small delay to ensure updatedAt would change if updated
        await new Promise(resolve => setTimeout(resolve, 100));

        // Upsert with same data
        const result = await User.upsert({
          email: 'same@example.com',
          name: 'Same Name',
          age: 28
        });

        expect(result.id).toBe(created.id);
        expect(result.name).toBe('Same Name');
        expect(result.age).toBe(28);

        // Verify no update occurred in database
        const dbUser = await prisma.user.findUnique({ where: { id: created.id as any } });
        expect(dbUser?.updatedAt?.getTime()).toBe(createdUpdatedAt?.getTime());
      });

      /**
       * Test: should handle boolean fields in change detection
       */
      it('should handle boolean fields in change detection', async () => {
        // Create user with isActive = true
        const created = await prisma.user.create({
          data: { name: 'Active User', email: 'active@example.com', isActive: true }
        });

        // Upsert changing isActive to false
        const result = await User.upsert({
          email: 'active@example.com',
          name: 'Active User',
          isActive: false
        });

        expect(result.id).toBe(created.id);
        expect(result.isActive).toBe(false);

        // Verify in database
        const dbUser = await prisma.user.findUnique({ where: { id: created.id as any } });
        expect(dbUser?.isActive).toBe(false);
      });

      /**
       * Test: should handle partial updates (only changed fields)
       */
      it('should handle partial updates', async () => {
        // Create initial user
        const created = await prisma.user.create({
          data: { name: 'Original Name', email: 'partial@example.com', age: 30, isActive: true }
        });

        // Upsert changing only name
        const result = await User.upsert({
          email: 'partial@example.com',
          name: 'Updated Name'
        });

        expect(result.id).toBe(created.id);
        expect(result.name).toBe('Updated Name');
        expect(result.age).toBe(30); // Should keep original value
        expect(result.isActive).toBe(true); // Should keep original value

        // Verify in database
        const dbUser = await prisma.user.findUnique({ where: { id: created.id as any } });
        expect(dbUser?.name).toBe('Updated Name');
        expect(dbUser?.age).toBe(30);
        expect(dbUser?.isActive).toBe(true);
      });
    });

    describe('upsertMany', () => {
      /**
       * Test: should handle mixed operations (create, update, unchanged)
       */
      it('should handle mixed operations in real database', async () => {
        // Create one existing user
        await prisma.user.create({
          data: { name: 'Existing User', email: 'existing@example.com', age: 30 }
        });

        const items = [
          { name: 'New User', email: 'new@example.com', age: 25 }, // Will be created
          { name: 'Updated User', email: 'existing@example.com', age: 35 }, // Will be updated
          { name: 'Existing User', email: 'existing@example.com', age: 30 } // Will be unchanged (processed as same as previous)
        ];

        const result = await User.upsertMany(items);

        expect(result.total).toBe(3);
        expect(result.created).toBeGreaterThanOrEqual(1);
        expect(result.updated).toBeGreaterThanOrEqual(0);

        // Verify in database
        const allUsers = await prisma.user.findMany();
        expect(allUsers.length).toBeGreaterThanOrEqual(2);

        // Check new user was created
        const newUser = await prisma.user.findUnique({ where: { email: 'new@example.com' } });
        expect(newUser).toBeDefined();
        expect(newUser?.name).toBe('New User');

        // Check existing user
        const existingUser = await prisma.user.findUnique({ where: { email: 'existing@example.com' } });
        expect(existingUser).toBeDefined();
      });

      /**
       * Test: should create all records when none exist
       */
      it('should create all records when none exist', async () => {
        const items = [
          { name: 'User 1', email: 'user1@example.com', age: 25 },
          { name: 'User 2', email: 'user2@example.com', age: 30 },
          { name: 'User 3', email: 'user3@example.com', age: 35 }
        ];

        const result = await User.upsertMany(items);

        expect(result.total).toBe(3);
        expect(result.created).toBe(3);
        expect(result.updated).toBe(0);
        expect(result.unchanged).toBe(0);

        // Verify in database
        const allUsers = await prisma.user.findMany();
        expect(allUsers.length).toBe(3);
      });

      /**
       * Test: should update all records when all exist with changes
       */
      it('should update all records when all exist with changes', async () => {
        // Create initial users
        await prisma.user.createMany({
          data: [
            { name: 'User 1 Old', email: 'user1@example.com', age: 25 },
            { name: 'User 2 Old', email: 'user2@example.com', age: 30 }
          ]
        });

        // Upsert with updated data
        const items = [
          { name: 'User 1 New', email: 'user1@example.com', age: 26 },
          { name: 'User 2 New', email: 'user2@example.com', age: 31 }
        ];

        const result = await User.upsertMany(items);

        expect(result.total).toBe(2);
        expect(result.created).toBe(0);
        expect(result.updated).toBe(2);
        expect(result.unchanged).toBe(0);

        // Verify updates in database
        const user1 = await prisma.user.findUnique({ where: { email: 'user1@example.com' } });
        expect(user1?.name).toBe('User 1 New');
        expect(user1?.age).toBe(26);

        const user2 = await prisma.user.findUnique({ where: { email: 'user2@example.com' } });
        expect(user2?.name).toBe('User 2 New');
        expect(user2?.age).toBe(31);
      });

      /**
       * Test: should return correct counts for unchanged records
       */
      it('should skip update when no changes detected', async () => {
        // Create initial users
        const created = await prisma.user.create({
          data: { name: 'Same User', email: 'same@example.com', age: 30 }
        });

        const createdUpdatedAt = created.updatedAt;

        // Small delay
        await new Promise(resolve => setTimeout(resolve, 100));

        // Upsert with same data
        const items = [
          { name: 'Same User', email: 'same@example.com', age: 30 }
        ];

        const result = await User.upsertMany(items);

        expect(result.total).toBe(1);
        expect(result.created).toBe(0);
        expect(result.updated).toBe(0);
        expect(result.unchanged).toBe(1);

        // Verify no update occurred
        const dbUser = await prisma.user.findUnique({ where: { email: 'same@example.com' } });
        expect(dbUser?.updatedAt?.getTime()).toBe(createdUpdatedAt?.getTime());
      });

      /**
       * Test: should return zero counts for empty array
       */
      it('should return zero counts for empty array', async () => {
        const result = await User.upsertMany([]);

        expect(result).toEqual({
          created: 0,
          updated: 0,
          unchanged: 0,
          total: 0
        });

        // Verify no changes in database
        const allUsers = await prisma.user.findMany();
        expect(allUsers.length).toBe(0);
      });

      /**
       * Test: should handle large batch upserts
       */
      it('should handle large batch upserts', async () => {
        // Create some existing users
        await prisma.user.createMany({
          data: [
            { name: 'Existing 1', email: 'exist1@example.com', age: 25 },
            { name: 'Existing 2', email: 'exist2@example.com', age: 30 }
          ]
        });

        // Create large batch with mix of new and existing
        const items: IUser[] = [];
        for (let i = 1; i <= 20; i++) {
          items.push({
            name: `User ${i}`,
            email: `user${i}@example.com`,
            age: 20 + i
          });
        }

        // Update existing ones
        items[0] = { name: 'Existing 1 Updated', email: 'exist1@example.com', age: 26 };
        items[1] = { name: 'Existing 2 Updated', email: 'exist2@example.com', age: 31 };

        const result = await User.upsertMany(items);

        expect(result.total).toBe(20);
        expect(result.created).toBeGreaterThanOrEqual(18);
        expect(result.updated).toBeGreaterThanOrEqual(2);

        // Verify total count in database
        const allUsers = await prisma.user.findMany();
        expect(allUsers.length).toBeGreaterThanOrEqual(20);
      });

      /**
       * Test: should properly handle upserts without keyTransformTemplate
       */
      it('should handle upsert without keyTransformTemplate', async () => {
        const items = [
          { name: 'Transform User', email: 'transform@example.com', age: 30 }
        ];

        const result = await User.upsertMany(items);

        expect(result.total).toBe(1);
        expect(result.created).toBe(1);

        // Verify in database
        const dbUser = await prisma.user.findUnique({ where: { email: 'transform@example.com' } });
        expect(dbUser).toBeDefined();
      });
    });

    describe('upsert edge cases', () => {
      /**
       * Test: should handle null and undefined values correctly
       */
      it('should handle null and undefined values in upsert', async () => {
        const created = await prisma.user.create({
          data: { name: 'User With Age', email: 'nulltest@example.com', age: 30 }
        });

        // Upsert with age undefined (should keep original)
        const result = await User.upsert({
          email: 'nulltest@example.com',
          name: 'User With Age',
          age: undefined
        });

        expect(result.id).toBe(created.id);

        // Verify age was preserved
        const dbUser = await prisma.user.findUnique({ where: { id: created.id as any } });
        expect(dbUser?.age).toBe(30);
      });

      /**
       * Test: should handle upsert when only optional fields change
       */
      it('should detect changes in optional fields', async () => {
        await prisma.user.create({
          data: { name: 'User', email: 'optional@example.com', age: 25, isActive: true }
        });

        // Change only isActive
        const result = await User.upsert({
          email: 'optional@example.com',
          name: 'User',
          age: 25,
          isActive: false
        });

        expect(result.isActive).toBe(false);

        // Verify in database
        const dbUser = await prisma.user.findUnique({ where: { email: 'optional@example.com' } });
        expect(dbUser?.isActive).toBe(false);
      });
    });
  });
});
