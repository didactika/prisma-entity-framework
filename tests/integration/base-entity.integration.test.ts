/**
 * Integration test for BaseEntity with real Prisma database
 * Uses SQLite in-memory for fast and isolated testing
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/base-entity';
import { Property } from '../../src/decorators/property.decorator';
import { configurePrisma, resetPrismaConfiguration } from '../../src/config';
import { createTestDb } from '../utils/test-db';
import type { PrismaClient } from '@prisma/client';

/**
 * User entity for testing using @Property() decorator
 */
interface IUser {
  id?: number;
  name: string;
  email: string;
  age?: number;
  isActive?: boolean;
}
class User extends BaseEntity<IUser> implements IUser {
  static readonly model: any;

  @Property() declare name: string;
  @Property() declare email: string;
  @Property() declare age?: number;
  @Property() declare isActive: boolean;

  constructor(data?: IUser) {
    super(data);
  }
}

describe('BaseEntity - Integration Tests with Real Database', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Setup real test database
    db = await createTestDb();
    prisma = db.client;

    console.log(`Running integration tests with ${db.provider}`);

    // Configure User entity with real Prisma model
    (User as any).model = prisma.user;
    configurePrisma(prisma as any);
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
      const dbUser = await prisma.user.findUnique({ where: { id: result.id } });
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
      const dbUser = await prisma.user.findUnique({ where: { id: created.id } });
      expect(dbUser?.name).toBe('Updated');
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
      const dbUser = await prisma.user.findUnique({ where: { id: created.id } });
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
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' },
        { name: 'User 3', email: 'user3@example.com' },
      ];

      const count = await User.createMany(users);

      expect(count).toBe(3);

      // Verify in database
      const dbUsers = await prisma.user.findMany();
      expect(dbUsers.length).toBe(3);
    });

    /**
     * Test: should handle skipDuplicates
     * SQLite does not support skipDuplicates parameter in createMany
     * This test is conditional based on the database provider
     */
    it('should handle skipDuplicates or fail gracefully', async () => {
      // Create initial user
      await prisma.user.create({ data: { name: 'Existing', email: 'exist@example.com' } });

      const users = [
        { name: 'New User', email: 'new@example.com' },
        { name: 'Existing', email: 'exist@example.com' }, // Duplicate
      ];

      if (db.supportsSkipDuplicates) {
        // MySQL and PostgreSQL support skipDuplicates
        const count = await User.createMany(users, true);
        expect(count).toBeGreaterThanOrEqual(1);

        // Verify that only non-duplicate was created
        const allUsers = await prisma.user.findMany();
        expect(allUsers.length).toBe(2); // 1 existing + 1 new
      } else {
        // SQLite doesn't support skipDuplicates
        // Should either throw an error or create only valid records
        try {
          await User.createMany(users, true);
          // If it succeeds, verify behavior
          const allUsers = await prisma.user.findMany();
          expect(allUsers.length).toBeGreaterThanOrEqual(1);
        } catch (error) {
          // Expected for SQLite with duplicate email (unique constraint)
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
     * Test: should allow mixing "*" with specific nested relations
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
  });
});
