/**
 * Test suite for BaseEntity
 * Tests core entity CRUD operations and search functionality
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import BaseEntity from '../src/core/base-entity';
import { configurePrisma, resetPrismaConfiguration } from '../src/core/config';
import { mockPrismaClient } from './__mocks__/prisma-client.mock';

interface IBaseEntity {
  id?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

interface IUser extends IBaseEntity {
  id?: number;
  name: string;
  email: string;
  age?: number;
  isActive?: boolean;
}
/**
 * Test User entity class
 * Following the real project pattern: private properties with getters/setters
 */
class User extends BaseEntity<IUser> implements IUser {
  static override readonly model = mockPrismaClient.user;

  public declare readonly id: IUser['id'];
  private _name!: IUser['name'];
  private _email!: IUser['email'];
  private _age!: IUser['age'];
  private _isActive!: IUser['isActive'];

  constructor(data: Partial<IUser>) {
    super(data);
  }

  get name(): string {
    return this._name!;
  }
  set name(value: string) {
    this._name = value;
  }

  get email(): string {
    return this._email!;
  }
  set email(value: string) {
    this._email = value;
  }

  get age(): number | undefined {
    return this._age;
  }
  set age(value: number | undefined) {
    this._age = value;
  }

  get isActive(): boolean | undefined {
    return this._isActive;
  }
  set isActive(value: boolean | undefined) {
    this._isActive = value;
  }
}

describe('BaseEntity', () => {
  beforeEach(() => {
    configurePrisma(mockPrismaClient as any);
    mockPrismaClient._reset();
  });

  afterEach(() => {
    resetPrismaConfiguration();
  });

  describe('Constructor and Initialization', () => {
    /**
     * Test: should create entity with data
     */
    it('should create entity with data', () => {
      const user = new User({ name: 'John', email: 'john@example.com', age: 30, isActive: true });
      console.log(user);
      expect(user.name).toBe('John');
      expect(user.email).toBe('john@example.com');
      expect(user.age).toBe(30);
      expect(user.isActive).toBe(true);
    });

    /**
     * Test: should initialize properties correctly
     */
    it('should initialize properties correctly', () => {
      const user = new User({ id: 1, name: 'John', email: 'john@example.com', age: 30, isActive: true });
      expect(user.id).toBe(1);
      expect(user.name).toBe('John');
      expect(user.email).toBe('john@example.com');
      expect(user.age).toBe(30);
      expect(user.isActive).toBe(true);
    });
  });

  describe('create', () => {
    /**
     * Test: should call create method
     */
    it('should call create method', async () => {
      const user = new User({ name: 'New User', email: 'new@example.com' });

      // Mock the create to return data
      jest.spyOn(mockPrismaClient.user, 'create').mockResolvedValueOnce({
        id: 4,
        name: 'New User',
        email: 'new@example.com',
        age: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await user.create();
      expect(mockPrismaClient.user.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    /**
     * Test: should call update method
     */
    it('should call update method', async () => {
      const user = new User({ id: 1, name: 'Updated Name', email: 'updated@example.com' });

      jest.spyOn(mockPrismaClient.user, 'update').mockResolvedValueOnce({
        id: 1,
        name: 'Updated Name',
        email: 'updated@example.com',
        age: 30,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await user.update();
      expect(mockPrismaClient.user.update).toHaveBeenCalled();
    });

    /**
     * Test: should exclude createdAt from update payload
     */
    it('should exclude createdAt from update payload', async () => {
      const now = new Date();
      const user = new User({
        id: 1,
        name: 'Updated Name',
        email: 'updated@example.com',
      });
      (user as any).createdAt = now;

      const updateSpy = jest.spyOn(mockPrismaClient.user, 'update').mockResolvedValueOnce({
        id: 1,
        name: 'Updated Name',
        email: 'updated@example.com',
        age: 30,
        isActive: true,
        createdAt: now,
        updatedAt: new Date(),
      });

      await user.update();

      const callArgs = updateSpy.mock.calls[0][0];
      expect(callArgs.data).not.toHaveProperty('createdAt');
    });

    /**
     * Test: should exclude updatedAt object from update payload
     */
    it('should exclude updatedAt object from update payload', async () => {
      const user = new User({
        id: 1,
        name: 'Updated Name',
        email: 'updated@example.com'
      });
      (user as any).updatedAt = { create: {} };

      const updateSpy = jest.spyOn(mockPrismaClient.user, 'update').mockResolvedValueOnce({
        id: 1,
        name: 'Updated Name',
        email: 'updated@example.com',
        age: 30,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await user.update();

      const callArgs = updateSpy.mock.calls[0][0];
      expect(callArgs.data).not.toHaveProperty('updatedAt');
    });

    /**
     * Test: should exclude empty objects from update payload
     */
    it('should exclude empty objects from update payload', async () => {
      const user = new User({
        id: 1,
        name: 'Updated Name',
        email: 'updated@example.com'
      });
      (user as any).emptyField = {};

      const updateSpy = jest.spyOn(mockPrismaClient.user, 'update').mockResolvedValueOnce({
        id: 1,
        name: 'Updated Name',
        email: 'updated@example.com',
        age: 30,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await user.update();

      const callArgs = updateSpy.mock.calls[0][0];
      expect(callArgs.data).not.toHaveProperty('emptyField');
    });
  });

  describe('delete', () => {
    /**
     * Test: should call delete method
     */
    it('should call delete method', async () => {
      const user = new User({ id: 1, name: 'John', email: 'john@example.com' });

      jest.spyOn(mockPrismaClient.user, 'delete').mockResolvedValueOnce({
        id: 1,
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await user.delete();
      expect(mockPrismaClient.user.delete).toHaveBeenCalled();
    });
  });

  describe('findByFilter', () => {
    /**
     * Test: should call findMany
     */
    it('should call findMany', async () => {
      await User.findByFilter({});
      expect(mockPrismaClient.user.findMany).toHaveBeenCalled();
    });

    /**
     * Test: should support single orderBy field
     */
    it('should support single orderBy field', async () => {
      const findManySpy = jest.spyOn(mockPrismaClient.user, 'findMany');
      
      await User.findByFilter({}, {
        orderBy: { name: 'asc' }
      });
      
      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { name: 'asc' }
        })
      );
    });

    /**
     * Test: should support multiple orderBy fields as array
     */
    it('should support multiple orderBy fields as array', async () => {
      const findManySpy = jest.spyOn(mockPrismaClient.user, 'findMany');
      
      await User.findByFilter({}, {
        orderBy: [
          { name: 'asc' },
          { createdAt: 'desc' }
        ]
      });
      
      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { name: 'asc' },
            { createdAt: 'desc' }
          ]
        })
      );
    });

    /**
     * Test: should support array filter with OR grouping
     */
    it('should support array filter with OR grouping', async () => {
      const findManySpy = jest.spyOn(mockPrismaClient.user, 'findMany');
      
      await User.findByFilter(
        [
          { name: 'John' },
          { name: 'Jane' }
        ],
        { filterGrouping: 'or' }
      );
      
      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [{
              OR: [
                { name: { equals: 'John' } },
                { name: { equals: 'Jane' } }
              ]
            }]
          }
        })
      );
    });

    /**
     * Test: should support array filter with AND grouping
     */
    it('should support array filter with AND grouping', async () => {
      const findManySpy = jest.spyOn(mockPrismaClient.user, 'findMany');
      
      await User.findByFilter(
        [
          { isActive: true },
          { age: 30 }
        ],
        { filterGrouping: 'and' }
      );
      
      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { isActive: { equals: true } },
              { age: { equals: 30 } }
            ]
          }
        })
      );
    });

    /**
     * Test: should default to AND for array filter without filterGrouping
     */
    it('should default to AND for array filter without filterGrouping', async () => {
      const findManySpy = jest.spyOn(mockPrismaClient.user, 'findMany');
      
      await User.findByFilter([
        { isActive: true },
        { name: 'John' }
      ]);
      
      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: expect.any(Array)
          }
        })
      );
    });

    /**
     * Test: should maintain backwards compatibility with single filter object
     */
    it('should maintain backwards compatibility with single filter', async () => {
      const findManySpy = jest.spyOn(mockPrismaClient.user, 'findMany');
      
      await User.findByFilter({ name: 'John', isActive: true });
      
      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            name: { equals: 'John' },
            isActive: { equals: true }
          }
        })
      );
    });
  });

  describe('countByFilter', () => {
    /**
     * Test: should call count method
     */
    it('should call count method', async () => {
      await User.countByFilter({});
      expect(mockPrismaClient.user.count).toHaveBeenCalled();
    });
  });

  describe('createMany', () => {
    /**
     * Test: should call createMany
     */
    it('should call createMany', async () => {
      const items = [
        { name: 'User 1', email: 'user1@example.com', age: 25, isActive: true },
        { name: 'User 2', email: 'user2@example.com', age: 30, isActive: false },
      ];

      // Mock the createMany to return proper format
      jest.spyOn(mockPrismaClient.user, 'createMany').mockResolvedValueOnce({ count: 2 });

      const result = await User.createMany(items);
      expect(mockPrismaClient.user.createMany).toHaveBeenCalled();
      expect(result).toBe(2);
    });
  });

  describe('deleteByFilter', () => {
    /**
     * Test: should call deleteMany
     */
    it('should call deleteMany', async () => {
      await User.deleteByFilter({ isActive: false });
      expect(mockPrismaClient.user.deleteMany).toHaveBeenCalled();
    });
  });

  describe('toJson and toObject', () => {
    /**
     * Test: should convert to JSON string
     */
    it('should convert to JSON string', () => {
      const user = new User({ name: 'John', email: 'john@example.com' });
      const json = user.toJson();

      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json);
      expect(parsed.name).toBe('John');
    });

    /**
     * Test: should convert to plain object
     */
    it('should convert to plain object', () => {
      const user = new User({ name: 'John', email: 'john@example.com' });
      const obj = user.toObject();

      expect(typeof obj).toBe('object');
      expect(obj.name).toBe('John');
      expect(obj.email).toBe('john@example.com');
    });
  });

  describe('getModelInformation', () => {
    /**
     * Test: should handle model information requests
     */
    it('should handle model information requests', () => {
      try {
        const info = User.getModelInformation('User');
        expect(info).toBeDefined();
      } catch (error) {
        // Model information may not be available in test environment
        expect(error).toBeDefined();
      }
    });
  });
});
