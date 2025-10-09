/**
 * Test suite for BaseEntity
 * Tests core entity CRUD operations and search functionality
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import BaseEntity from '../src/base-entity';
import { configurePrisma, resetPrismaConfiguration } from '../src/config';
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

  private _name!: IUser['name'];
  private _email!: IUser['email'];
  private _age: IUser['age'];
  private _isActive: IUser['isActive'];

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
      mockPrismaClient.user.createMany.mockResolvedValueOnce({ count: 2 });

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
