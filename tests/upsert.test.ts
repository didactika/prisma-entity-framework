/**
 * Test suite for upsert and upsertMany methods
 * Tests upsert functionality with unique constraints
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
  code?: string;
  age?: number;
}

/**
 * Test User entity class for upsert tests
 */
class User extends BaseEntity<IUser> implements IUser {
  static override readonly model = mockPrismaClient.user;

  private _name!: IUser['name'];
  private _email!: IUser['email'];
  private _code: IUser['code'];
  private _age: IUser['age'];

  constructor(data: Partial<IUser>) {
    super(data);
  }

  static override getModelInformation() {
    return {
      name: 'user',
      dbName: 'users',
      fields: [
        { name: 'id', dbName: 'id', kind: 'scalar' },
        { name: 'name', dbName: 'name', kind: 'scalar' },
        { name: 'email', dbName: 'email', kind: 'scalar' },
        { name: 'age', dbName: 'age', kind: 'scalar' },
      ]
    };
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

  get code(): string | undefined {
    return this._code;
  }
  set code(value: string | undefined) {
    this._code = value;
  }

  get age(): number | undefined {
    return this._age;
  }
  set age(value: number | undefined) {
    this._age = value;
  }
}

describe('BaseEntity - Upsert', () => {
  beforeEach(() => {
    configurePrisma(mockPrismaClient as any);
    mockPrismaClient._reset();
  });

  afterEach(() => {
    resetPrismaConfiguration();
  });

  describe('upsert', () => {
    it('should create new record when it doesn\'t exist', async () => {
      const newData = { email: 'new@example.com', name: 'New User' };
      const createdRecord = { id: 1, ...newData };

      mockPrismaClient.user.findFirst.mockResolvedValue(null);
      mockPrismaClient.user.create.mockResolvedValue(createdRecord);

      const result = await User.upsert(newData);

      expect(mockPrismaClient.user.findFirst).toHaveBeenCalled();
      expect(mockPrismaClient.user.create).toHaveBeenCalled();
      expect(result.id).toBe(1);
      expect(result.email).toBe('new@example.com');
    });

    it('should update existing record when changes detected', async () => {
      const existingRecord = { id: 1, email: 'existing@example.com', name: 'Old Name' };
      const updateData = { email: 'existing@example.com', name: 'New Name' };
      const updatedRecord = { id: 1, email: 'existing@example.com', name: 'New Name' };

      mockPrismaClient.user.findFirst.mockResolvedValue(existingRecord);
      mockPrismaClient.user.update.mockResolvedValue(updatedRecord);

      const result = await User.upsert(updateData);

      expect(mockPrismaClient.user.findFirst).toHaveBeenCalled();
      expect(mockPrismaClient.user.update).toHaveBeenCalled();
      expect(result.name).toBe('New Name');
    });

    it('should return existing record when no changes detected', async () => {
      const existingRecord = { id: 1, email: 'same@example.com', name: 'Same Name' };
      const sameData = { email: 'same@example.com', name: 'Same Name' };

      mockPrismaClient.user.findFirst.mockResolvedValue(existingRecord);

      const result = await User.upsert(sameData);

      expect(mockPrismaClient.user.findFirst).toHaveBeenCalled();
      expect(mockPrismaClient.user.update).not.toHaveBeenCalled();
      expect(mockPrismaClient.user.create).not.toHaveBeenCalled();
      expect(result.id).toBe(1);
      expect(result.name).toBe('Same Name');
    });
  });

  describe('upsertMany', () => {
    it('should handle mixed operations (create, update, unchanged)', async () => {
      const items = [
        { email: 'new@example.com', name: 'New User' },
        { email: 'update@example.com', name: 'Updated Name' },
        { email: 'same@example.com', name: 'Same Name' }
      ];

      // Mock findMany to return existing records (batch query)
      mockPrismaClient.user.findMany.mockResolvedValue([
        { id: 2, email: 'update@example.com', name: 'Old Name' },
        { id: 3, email: 'same@example.com', name: 'Same Name' }
      ]);

      // Mock createMany for new records
      mockPrismaClient.user.createMany.mockResolvedValue({ count: 1 });

      // Mock updateManyById (raw query) for updates
      mockPrismaClient.$executeRawUnsafe.mockResolvedValue(1);

      const result = await User.upsertMany(items);

      expect(result).toEqual({
        created: 1,
        updated: 1,
        unchanged: 1,
        total: 3
      });
    });

    it('should create all records when none exist', async () => {
      const items = [
        { email: 'user1@example.com', name: 'User 1' },
        { email: 'user2@example.com', name: 'User 2' }
      ];

      // Mock findMany to return no existing records
      mockPrismaClient.user.findMany.mockResolvedValue([]);
      
      // Mock createMany
      mockPrismaClient.user.createMany.mockResolvedValue({ count: 2 });

      const result = await User.upsertMany(items);

      expect(result).toEqual({
        created: 2,
        updated: 0,
        unchanged: 0,
        total: 2
      });
    });

    it('should return zero counts for empty array', async () => {
      const result = await User.upsertMany([]);

      expect(result).toEqual({
        created: 0,
        updated: 0,
        unchanged: 0,
        total: 0
      });
    });
  });
});
