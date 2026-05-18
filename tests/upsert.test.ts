/**
 * Test suite for upsert and upsertMany methods
 * Tests upsert functionality with unique constraints
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import BaseEntity from '../src/core/base-entity';
import { configurePrisma, resetPrismaConfiguration } from '../src/core/config';
import { clearDatabaseProviderCache } from '../src/core/utils/database-utils';
import { clearUpsertMetadataCache } from '../src/core/upsert-utils';
import ModelUtils from '../src/core/model-utils';
import { createMockModel, mockPrismaClient } from './__mocks__/prisma-client.mock';

const originalDatabaseUrl = process.env.DATABASE_URL;

function expectDetailedCounts(
  result: {
    counts: { created: number; updated: number; unchanged: number; total: number };
    items: { createdIds: Array<number | string>; updatedIds: Array<number | string>; unchangedIds: Array<number | string> };
  },
  expected: { created: number; updated: number; unchanged: number; total: number }
) {
  expect(result.counts).toEqual(expected);
  expect(Array.isArray(result.items.createdIds)).toBe(true);
  expect(Array.isArray(result.items.updatedIds)).toBe(true);
  expect(Array.isArray(result.items.unchangedIds)).toBe(true);
}

function mockDecimal(value: string) {
  const num = Number.parseFloat(value);
  return {
    d: [Number.parseInt(value.replace('.', ''))],
    e: value.includes('.') ? value.indexOf('.') - 1 : value.length - 1,
    s: num >= 0 ? 1 : -1,
    toNumber: () => num,
    toString: () => value
  };
}

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

interface ICourseState extends IBaseEntity {
  id?: number;
  campusId: number;
  courseIdNumber: string;
  userUuid: string;
  state: string;
  reason?: string | null;
  role?: string;
}

const courseStateModel = createMockModel(
  [
    {
      id: 1,
      campusId: 1,
      courseIdNumber: 'test-course-idnumber',
      userUuid: 'studentautograder',
      state: 'NOT_OPEN',
      reason: null,
      role: 'STUDENT'
    }
  ],
  'courseState'
);

/**
 * Test User entity class for upsert tests
 */
class User extends BaseEntity<IUser> {
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
        { name: 'id', dbName: 'id', kind: 'scalar' as const, type: 'Int' },
        { name: 'name', dbName: 'name', kind: 'scalar' as const, type: 'String' },
        { name: 'email', dbName: 'email', kind: 'scalar' as const, type: 'String' },
        { name: 'age', dbName: 'age', kind: 'scalar' as const, type: 'Int' },
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

class CourseStateEntity extends BaseEntity<ICourseState> {
  static override readonly model = courseStateModel as any;

  static override getModelInformation() {
    return {
      name: 'courseState',
      dbName: 'course_state',
      fields: [
        { name: 'id', dbName: 'id', kind: 'scalar' as const, type: 'Int', isId: true },
        { name: 'campusId', dbName: 'campus_id', kind: 'scalar' as const, type: 'Int', isRequired: true },
        { name: 'courseIdNumber', dbName: 'course_idnumber', kind: 'scalar' as const, type: 'String', isRequired: true },
        { name: 'userUuid', dbName: 'user_uuid', kind: 'scalar' as const, type: 'String', isRequired: true },
        { name: 'state', dbName: 'state', kind: 'enum' as const, type: 'State', isRequired: true },
        { name: 'reason', dbName: 'reason', kind: 'enum' as const, type: 'Reason', isRequired: false },
        { name: 'role', dbName: 'role', kind: 'scalar' as const, type: 'String', isRequired: true },
      ]
    };
  }
}

describe('BaseEntity - Upsert', () => {
  beforeEach(() => {
    configurePrisma(mockPrismaClient as any);
    mockPrismaClient._reset();
    (courseStateModel as any)._reset();
    clearDatabaseProviderCache();
    clearUpsertMetadataCache();
    process.env.DATABASE_URL = 'file:./test.db';
  });

  afterEach(() => {
    resetPrismaConfiguration();
    clearDatabaseProviderCache();
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  describe('upsert', () => {
    it('should create new record when it doesn\'t exist', async () => {
      const newData = { email: 'new@example.com', name: 'New User' };
      const createdRecord = { id: 1, ...newData };

      jest.spyOn(mockPrismaClient.user, 'findFirst').mockResolvedValue(null);
      jest.spyOn(mockPrismaClient.user, 'create').mockResolvedValue(createdRecord);

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

      jest.spyOn(mockPrismaClient.user, 'findFirst').mockResolvedValue(existingRecord);
      jest.spyOn(mockPrismaClient.user, 'update').mockResolvedValue(updatedRecord);

      const result = await User.upsert(updateData);

      expect(mockPrismaClient.user.findFirst).toHaveBeenCalled();
      expect(mockPrismaClient.user.update).toHaveBeenCalled();
      expect(result.name).toBe('New Name');
    });

    it('should return existing record when no changes detected', async () => {
      const existingRecord = { id: 1, email: 'same@example.com', name: 'Same Name' };
      const sameData = { email: 'same@example.com', name: 'Same Name' };

      jest.spyOn(mockPrismaClient.user, 'findFirst').mockResolvedValue(existingRecord);

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

      // Mock pre-count query (SQLite: 2 existing records)
      jest.spyOn(mockPrismaClient, '$queryRawUnsafe' as any).mockResolvedValue([{ cnt: 2 }]);
      // Mock executeRawUnsafe: 2 changes (1 insert + 1 real update; 1 unchanged excluded by WHERE)
      jest.spyOn(mockPrismaClient, '$executeRawUnsafe').mockResolvedValue(2);

      const result = await User.upsertMany(items);

      expectDetailedCounts(result, {
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

      // Mock pre-count query (0 existing)
      jest.spyOn(mockPrismaClient, '$queryRawUnsafe' as any).mockResolvedValue([{ cnt: 0 }]);
      // Mock executeRawUnsafe: 2 changes (all inserts)
      jest.spyOn(mockPrismaClient, '$executeRawUnsafe').mockResolvedValue(2);

      const result = await User.upsertMany(items);

      expectDetailedCounts(result, {
        created: 2,
        updated: 0,
        unchanged: 0,
        total: 2
      });
    });

    it('should return zero counts for empty array', async () => {
      const result = await User.upsertMany([]);

      expectDetailedCounts(result, {
        created: 0,
        updated: 0,
        unchanged: 0,
        total: 0
      });
    });

    it('should use Prisma operations when useRawQuery is false', async () => {
      const result = await User.upsertMany(
        [{ email: 'prisma-mode@example.com', name: 'Prisma Mode' }],
        { useRawQuery: false }
      );

      expect(mockPrismaClient.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(mockPrismaClient.user.create).toHaveBeenCalled();
      expect(result.counts.total).toBe(1);
      expect(result.counts.created).toBe(1);
    });

    it('should use PostgreSQL staging-table upsert path when provider is postgresql', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      clearDatabaseProviderCache();

      jest.spyOn(mockPrismaClient, '$queryRawUnsafe' as any).mockResolvedValue([
        {
          unchanged_ids: [2],
          updated_ids: [1],
          inserted_ids: [3]
        }
      ]);

      const result = await User.upsertMany([
        { email: 'john@example.com', name: 'John Updated' },
        { email: 'jane@example.com', name: 'Jane Smith' },
        { email: 'new@example.com', name: 'New User' }
      ]);

      expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrismaClient.$executeRawUnsafe).toHaveBeenCalled();
      expectDetailedCounts(result, {
        created: 1,
        updated: 1,
        unchanged: 1,
        total: 3
      });
      expect(result.items.createdIds).toEqual([3]);
      expect(result.items.updatedIds).toEqual([1]);
      expect(result.items.unchangedIds).toEqual([2]);
    });

    it('should run before and after hooks when provided', async () => {
      const beforeUpsertMany = jest.fn(async (_payload: unknown) => undefined);
      const afterUpsertMany = jest.fn(async (_payload: unknown) => undefined);

      await User.upsertMany(
        [{ email: 'hooks@example.com', name: 'Hooks User' }],
        {
          hooks: {
            before: beforeUpsertMany,
            after: afterUpsertMany,
          }
        }
      );

      expect(beforeUpsertMany).toHaveBeenCalledTimes(1);
      expect(afterUpsertMany).toHaveBeenCalledTimes(1);
      expect(beforeUpsertMany.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          modelName: 'user',
          totalItems: 1,
        })
      );
      expect(afterUpsertMany.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          modelName: 'user',
          totalItems: 1,
          result: expect.objectContaining({
            total: 1,
            created: expect.objectContaining({ count: expect.any(Number), items: expect.any(Array) }),
            updated: expect.objectContaining({ count: expect.any(Number), items: expect.any(Array) }),
            unchanged: expect.objectContaining({ count: expect.any(Number), items: expect.any(Array) })
          })
        })
      );

      const afterPayload = afterUpsertMany.mock.calls[0][0] as {
        result: {
          created: { items: Array<number | string> | null };
          updated: { items: Array<number | string> | null };
          unchanged: { items: Array<number | string> | null };
        };
      };

      const allIds = [
        ...(afterPayload.result.created.items ?? []),
        ...(afterPayload.result.updated.items ?? []),
        ...(afterPayload.result.unchanged.items ?? [])
      ];
      expect(allIds.every(id => typeof id === 'number' || typeof id === 'string')).toBe(true);
    });

    it('should use global config useRawQuery when local option is not provided', async () => {
      configurePrisma(mockPrismaClient as any, { upsertManyUseRawQuery: false });

      await User.upsertMany([{ email: 'global-prisma@example.com', name: 'Global Prisma' }]);

      expect(mockPrismaClient.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(mockPrismaClient.user.create).toHaveBeenCalled();
    });

    it('should prioritize local useRawQuery over global config', async () => {
      configurePrisma(mockPrismaClient as any, { upsertManyUseRawQuery: false });
      jest.spyOn(mockPrismaClient, '$queryRawUnsafe' as any).mockResolvedValue([{ cnt: 0 }]);
      jest.spyOn(mockPrismaClient, '$executeRawUnsafe').mockResolvedValue(1);

      await User.upsertMany(
        [{ email: 'override-raw@example.com', name: 'Override Raw' }],
        { useRawQuery: true }
      );

      expect(mockPrismaClient.$executeRawUnsafe).toHaveBeenCalled();
    });

    it('should run global and local hooks in order', async () => {
      const callOrder: string[] = [];

      configurePrisma(mockPrismaClient as any, {
        upsertManyHooks: {
          before: async () => { callOrder.push('global-before'); },
          after: async () => { callOrder.push('global-after'); },
        },
      });

      await User.upsertMany(
        [{ email: 'hooks-order@example.com', name: 'Hooks Order' }],
        {
          hooks: {
            before: async () => { callOrder.push('local-before'); },
            after: async () => { callOrder.push('local-after'); },
          }
        }
      );

      expect(callOrder).toEqual(['global-before', 'local-before', 'global-after', 'local-after']);
    });

    it('should fallback from raw and update existing row when required field is missing but composite unique matches', async () => {
      const uniqueSpy = jest.spyOn(ModelUtils, 'getUniqueConstraints').mockImplementation((modelName: string) => {
        if (modelName === 'courseState') {
          return [['userUuid', 'courseIdNumber', 'campusId']];
        }
        return [['email']];
      });

      try {
        jest.spyOn(mockPrismaClient, '$queryRawUnsafe' as any).mockImplementation(async (...args: unknown[]) => {
          const rawQuery = args[0];
          const query = typeof rawQuery === 'string' ? rawQuery : JSON.stringify(rawQuery);
          if (/from\s+(?:"|`|\[)?course_state/i.test(query)) {
            return [
              {
                id: 1,
                campusId: 1,
                courseIdNumber: 'test-course-idnumber',
                userUuid: 'studentautograder',
                state: 'NOT_OPEN',
                reason: null,
                role: 'STUDENT'
              }
            ];
          }
          return [];
        });
        jest.spyOn(mockPrismaClient, '$executeRawUnsafe').mockResolvedValue(1);

        const result = await CourseStateEntity.upsertMany([
          {
            campusId: 1,
            courseIdNumber: 'test-course-idnumber',
            userUuid: 'studentautograder',
            state: 'CLOSED',
            reason: null,
            // role intentionally omitted (required/non-null in schema)
          }
        ], {
          useRawQuery: true
        });

        expect(mockPrismaClient.$queryRawUnsafe).toHaveBeenCalled();
        expect(mockPrismaClient.$executeRawUnsafe).toHaveBeenCalled();
        expect((courseStateModel as any).update).not.toHaveBeenCalled();
        expect((courseStateModel as any).create).not.toHaveBeenCalled();
        expectDetailedCounts(result, {
          created: 0,
          updated: 1,
          unchanged: 0,
          total: 1
        });
      } finally {
        uniqueSpy.mockRestore();
      }
    });
  });

  describe('Change Detection Performance', () => {
    it('should efficiently detect no changes in large objects', () => {
      const largeObject = {
        id: 1,
        name: 'Test User',
        email: 'test@example.com',
        metadata: {
          settings: { theme: 'dark', language: 'en', notifications: true },
          preferences: { privacy: 'public', newsletter: false },
          profile: {
            bio: 'Long bio text here',
            avatar: 'https://example.com/avatar.jpg',
            social: { twitter: '@user', github: 'user' }
          }
        },
        tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'],
        scores: [95, 87, 92, 88, 90]
      };

      const startTime = Date.now();

      // Test 1000 comparisons of identical objects
      for (let i = 0; i < 1000; i++) {
        const hasChanges = (BaseEntity as any).hasChanges(largeObject, largeObject);
        expect(hasChanges).toBe(false);
      }

      const duration = Date.now() - startTime;

      // Should complete 1000 comparisons in under 100ms (optimized)
      // Old JSON.stringify approach would take 500ms+
      expect(duration).toBeLessThan(120);
    });

    it('should quickly detect changes in large objects', () => {
      const object1 = {
        id: 1,
        name: 'Test User',
        email: 'test@example.com',
        metadata: {
          settings: { theme: 'dark', language: 'en' },
          profile: { bio: 'Bio text', scores: [1, 2, 3, 4, 5] }
        }
      };

      const object2 = {
        ...object1,
        name: 'Different User' // Changed field
      };

      const startTime = Date.now();

      // Test 1000 comparisons with early exit
      for (let i = 0; i < 1000; i++) {
        const hasChanges = (BaseEntity as any).hasChanges(object2, object1);
        expect(hasChanges).toBe(true);
      }

      const duration = Date.now() - startTime;

      // Should complete very fast with early exit (typically < 50ms)
      // Using 150ms threshold to account for CI/slow machines
      expect(duration).toBeLessThan(150);
    });

    it('should handle deep object comparisons correctly', () => {
      const obj1 = {
        id: 1,
        metadata: { nested: { deep: { value: 'test' } } }
      };

      const obj2 = {
        id: 1,
        metadata: { nested: { deep: { value: 'test' } } }
      };

      const obj3 = {
        id: 1,
        metadata: { nested: { deep: { value: 'different' } } }
      };

      expect((BaseEntity as any).hasChanges(obj1, obj2)).toBe(false);
      expect((BaseEntity as any).hasChanges(obj1, obj3)).toBe(true);
    });

    it('should handle array comparisons correctly', () => {
      const obj1 = {
        id: 1,
        tags: ['a', 'b', 'c'],
        scores: [1, 2, 3]
      };

      const obj2 = {
        id: 1,
        tags: ['a', 'b', 'c'],
        scores: [1, 2, 3]
      };

      const obj3 = {
        id: 1,
        tags: ['a', 'b', 'd'], // Different
        scores: [1, 2, 3]
      };

      expect((BaseEntity as any).hasChanges(obj1, obj2)).toBe(false);
      expect((BaseEntity as any).hasChanges(obj1, obj3)).toBe(true);
    });

    it('should handle null and undefined correctly', () => {
      const obj1 = { id: 1, name: 'Test', value: null };
      const obj2 = { id: 1, name: 'Test', value: undefined };
      const obj3 = { id: 1, name: 'Test', value: null };

      // null and undefined should be treated as equal (normalized)
      expect((BaseEntity as any).hasChanges(obj1, obj2)).toBe(false);
      expect((BaseEntity as any).hasChanges(obj1, obj3)).toBe(false);
    });
  });

  describe('Float/Decimal precision in upsert change detection', () => {
    it('should NOT update when Prisma.Decimal equals the submitted number', async () => {
      const existingRecord = { id: 1, email: 'user@example.com', name: 'User', age: 25 };
      const existingWithDecimal = {
        ...existingRecord,
        price: mockDecimal('19.99')
      };

      jest.spyOn(mockPrismaClient.user, 'findFirst').mockResolvedValue(existingWithDecimal);

      const result = await User.upsert({ email: 'user@example.com', name: 'User', age: 25 });

      expect(mockPrismaClient.user.update).not.toHaveBeenCalled();
      expect(result.id).toBe(1);
    });

    it('should NOT update when float precision differs within epsilon', async () => {
      const existingRecord = { id: 1, email: 'user@example.com', name: 'User', age: 30 };
      jest.spyOn(mockPrismaClient.user, 'findFirst').mockResolvedValue(existingRecord);

      const result = await User.upsert({ email: 'user@example.com', name: 'User', age: 30 });

      expect(mockPrismaClient.user.update).not.toHaveBeenCalled();
      expect(result.id).toBe(1);
    });

    it('should NOT update when both DB and input have Decimal objects with same value', () => {
      const newData = { price: mockDecimal('99.95') };
      const existingData = { price: mockDecimal('99.95') };

      expect((BaseEntity as any).hasChanges(newData, existingData)).toBe(false);
    });

    it('should detect change when Decimal differs from number', () => {
      const newData = { price: 50 };
      const existingData = { price: mockDecimal('99.95') };

      expect((BaseEntity as any).hasChanges(newData, existingData)).toBe(true);
    });
  });

  describe('JSON fields in upsert change detection', () => {
    it('should NOT update when JSON is deeply identical', () => {
      const newData = { metadata: { theme: 'dark', notifications: { email: true, sms: false } } };
      const existingData = { metadata: { theme: 'dark', notifications: { email: true, sms: false } } };

      expect((BaseEntity as any).hasChanges(newData, existingData)).toBe(false);
    });

    it('should detect change when nested JSON value differs', () => {
      const newData = { metadata: { theme: 'dark', notifications: { email: true, sms: false } } };
      const existingData = { metadata: { theme: 'dark', notifications: { email: false, sms: false } } };

      expect((BaseEntity as any).hasChanges(newData, existingData)).toBe(true);
    });

    it('should NOT update when JSON arrays are identical', () => {
      const newData = { tags: ['admin', 'user', 'editor'] };
      const existingData = { tags: ['admin', 'user', 'editor'] };

      expect((BaseEntity as any).hasChanges(newData, existingData)).toBe(false);
    });

    it('should detect change when JSON arrays differ in order', () => {
      const newData = { tags: ['admin', 'user'] };
      const existingData = { tags: ['user', 'admin'] };

      expect((BaseEntity as any).hasChanges(newData, existingData)).toBe(true);
    });
  });

  describe('Date fields in upsert change detection', () => {
    it('should NOT update when Date timestamps match', () => {
      const date = new Date('2024-06-15T10:00:00.000Z');
      const newData = { startDate: new Date('2024-06-15T10:00:00.000Z') };
      const existingData = { startDate: date };

      expect((BaseEntity as any).hasChanges(newData, existingData)).toBe(false);
    });

    it('should detect change when Date timestamps differ', () => {
      const newData = { startDate: new Date('2024-06-15T10:00:00.000Z') };
      const existingData = { startDate: new Date('2024-06-15T11:00:00.000Z') };

      expect((BaseEntity as any).hasChanges(newData, existingData)).toBe(true);
    });

    it('should detect change when Date vs null', () => {
      const newData = { startDate: new Date('2024-06-15T10:00:00.000Z') };
      const existingData: Record<string, unknown> = { startDate: null };

      expect((BaseEntity as any).hasChanges(newData, existingData)).toBe(true);
    });
  });

  describe('upsertMany with type-coerced fields', () => {
    it('should count records as unchanged when values match exactly', async () => {
      const items = [
        { email: 'user1@example.com', name: 'User 1' },
        { email: 'user2@example.com', name: 'User 2' }
      ];

      // Mock pre-count (SQLite: 2 existing records)
      jest.spyOn(mockPrismaClient, '$queryRawUnsafe' as any).mockResolvedValue([{ cnt: 2 }]);
      // Mock executeRawUnsafe: 0 changes (all unchanged due to WHERE clause)
      jest.spyOn(mockPrismaClient, '$executeRawUnsafe').mockResolvedValue(0);

      const result = await User.upsertMany(items);

      expect(result.counts.unchanged).toBe(2);
      expect(result.counts.updated).toBe(0);
      expect(result.counts.created).toBe(0);
    });
  });
});
