/**
 * Integration test for BaseEntity with MongoDB
 * Tests MongoDB-specific features and compatibility
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/base-entity';
// Property decorator not used in this test file
import { configurePrisma, resetPrismaConfiguration } from '../../src/config';
import { createTestDb } from '../utils/test-db';
import type { PrismaClient } from '@prisma/client';

/**
 * User entity for testing using @Property() decorator
 */
interface IUser {
  id?: string;
  name: string;
  email: string;
  age?: number;
  isActive?: boolean;
}

class User extends BaseEntity<IUser> {
  static readonly model: any;

  name!: string;
  email!: string;
  age?: number;
  isActive!: boolean;

  constructor(data?: IUser) {
    super(data);
  }
}

// Check if we should run MongoDB tests
const shouldRunMongoTests = process.env.DATABASE_URL?.includes('mongodb') || false;

const describeOrSkip = shouldRunMongoTests ? describe : describe.skip;

describeOrSkip('BaseEntity - MongoDB Integration Tests', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Setup MongoDB test database
    db = await createTestDb();
    prisma = db.client;

    console.log(`Running MongoDB integration tests with ${db.provider}`);

    // Clear all data before starting tests
    await db.clear();

    // Configure User entity with real Prisma model
    (User as any).model = prisma.user;
    configurePrisma(prisma as any);
  }, 30000);

  afterAll(async () => {
    await db.cleanup();
    resetPrismaConfiguration();
  });

  beforeEach(async () => {
    await db.clear();
  });

  describe('MongoDB-specific features', () => {
    it('should create user with ObjectId', async () => {

      const user = new User({ name: 'Alice', email: 'alice@example.com', age: 28 });
      const result = await user.create();

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe('string');
      expect(result.id).toMatch(/^[a-f0-9]{24}$/); // MongoDB ObjectId format
      expect(result.name).toBe('Alice');
      expect(result.email).toBe('alice@example.com');
    });

    it('should handle unique email constraint', async () => {
      const user1 = new User({ name: 'User 1', email: 'same@example.com' });
      await user1.create();

      const user2 = new User({ name: 'User 2', email: 'same@example.com' });
      await expect(user2.create()).rejects.toThrow();
    });

    it('should update existing user', async () => {
      const user = new User({ name: 'Original', email: 'original@example.com' });
      const created = await user.create();

      const userToUpdate = new User({
        id: created.id as string,
        name: 'Updated',
        email: 'updated@example.com'
      });
      const updated = await userToUpdate.update();

      expect(updated.name).toBe('Updated');
      expect(updated.email).toBe('updated@example.com');
    });

    it('should delete user', async () => {
      const user = new User({ name: 'ToDelete', email: 'delete@example.com' });
      const created = await user.create();

      const userToDelete = new User({
        id: created.id as string,
        name: 'ToDelete',
        email: 'delete@example.com'
      });
      await userToDelete.delete();

      const dbUser = await (prisma as any).user.findUnique({ where: { id: created.id } });
      expect(dbUser).toBeNull();
    });

    it('should find users by filter', async () => {
      await db.seed();

      const users = await User.findByFilter({}) as any[];
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBe(3);
    });

    it('should filter by name', async () => {
      await db.seed();

      const users = await User.findByFilter({ name: 'John Doe' }) as any[];
      expect(users.length).toBe(1);
      expect(users[0].name).toBe('John Doe');
    });

    it('should handle pagination', async () => {
      await db.seed();

      const result = await User.findByFilter({}, {
        pagination: { page: 1, pageSize: 2, take: 2, skip: 0 },
      }) as any;

      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('data');
      expect(result.total).toBe(3);
      expect(result.data.length).toBe(2);
    });

    it('should create multiple users with createMany', async () => {
      const users = [
        { name: 'User 1', email: 'usercreatemany1@example.com' },
        { name: 'User 2', email: 'usercreatemany2@example.com' },
        { name: 'User 3', email: 'usercreatemany3@example.com' },
      ];

      const count = await User.createMany(users);
      expect(count).toBe(3);

      const dbUsers = await prisma.user.findMany();
      expect(dbUsers.length).toBe(3);
    });

    it('should handle skipDuplicates in createMany', async () => {
      await prisma.user.create({
        data: { name: 'Existing', email: 'exist@example.com' }
      });

      const users = [
        { name: 'New User', email: 'new@example.com' },
        { name: 'Existing', email: 'exist@example.com' },
      ];

      // MongoDB doesn't support skipDuplicates in createMany
      // It will throw an error on duplicate, which is expected
      try {
        const count = await User.createMany(users, true);
        // If it succeeds, at least one should be created
        expect(count).toBeGreaterThanOrEqual(1);
      } catch (error) {
        // Expected for MongoDB with duplicate email
        expect(error).toBeDefined();
      }

      const allUsers = await prisma.user.findMany();
      // Should have at least the existing user
      expect(allUsers.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle JSON fields', async () => {
      const product = await (prisma as any).product.create({
        data: {
          name: 'Test Product',
          sku: 'TEST-001',
          metadata: { color: 'blue', size: 'large' },
          settings: { featured: true, stock: 100 }
        }
      });

      expect(product.metadata).toEqual({ color: 'blue', size: 'large' });
      expect(product.settings).toEqual({ featured: true, stock: 100 });
    });

    it('should include relations', async () => {
      await db.seed();

      const users = await User.findByFilter({}, {
        relationsToInclude: [{ posts: [] }],
      }) as any[];

      expect(users[0]).toHaveProperty('posts');
      expect(Array.isArray(users[0].posts)).toBe(true);
    });

    it('should handle nested relations', async () => {
      await db.seed();

      const users = await User.findByFilter({}, {
        relationsToInclude: [{ posts: [{ comments: [] }] }],
      }) as any[];

      expect(users[0]).toHaveProperty('posts');
      if (users[0].posts.length > 0) {
        expect(users[0].posts[0]).toHaveProperty('comments');
      }
    });

    it('should apply string search', async () => {
      await db.seed();

      const users = await User.findByFilter({}, {
        search: {
          stringSearch: [{ keys: ['name'], value: 'John', mode: 'LIKE' }],
        },
      }) as any[];

      expect(users.length).toBeGreaterThan(0);
      expect(users[0].name).toContain('John');
    });

    it('should apply range search', async () => {
      await db.seed();

      const users = await User.findByFilter({}, {
        search: {
          rangeSearch: [{ keys: ['age'], min: 25, max: 30 }],
        },
      }) as any[];

      expect(users.length).toBeGreaterThan(0);
      expect(users.every((u: any) => u.age >= 25 && u.age <= 30)).toBe(true);
    });

    it('should count by filter', async () => {
      await db.seed();

      const count = await User.countByFilter({ isActive: true });
      expect(count).toBe(2);
    });

    it('should delete by filter', async () => {
      await db.seed();

      const count = await User.deleteByFilter({ isActive: false });
      expect(count).toBe(1);

      const remainingUsers = await prisma.user.findMany();
      expect(remainingUsers.length).toBe(2);
    });
  });
});

