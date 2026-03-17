import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/core/base-entity';
import { Property } from '../../src/core/decorators/property.decorator';
import { createTestDb, type TestDbInstance } from '../helpers/test-db';
import { configurePrisma, resetPrismaConfiguration } from '../../src/core/config';

type TaskStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED';
type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

interface ITaskItem {
  id?: number | string;
  code: string;
  title: string;
  status: TaskStatus;
  priority?: TaskPriority | null;
  description?: string | null;
}

class TaskItemEntity extends BaseEntity<ITaskItem> implements ITaskItem {
  static override readonly model: any;

  public declare readonly id?: ITaskItem['id'];

  @Property() declare code: ITaskItem['code'];
  @Property() declare title: ITaskItem['title'];
  @Property() declare status: ITaskItem['status'];
  @Property() declare priority: ITaskItem['priority'];
  @Property() declare description: ITaskItem['description'];

  constructor(data?: Partial<ITaskItem>) {
    super(data);
  }
}

describe('Prisma Enum Fields - Integration Tests', () => {
  let db: TestDbInstance;

  beforeAll(async () => {
    db = await createTestDb();
    configurePrisma(db.client);
    (TaskItemEntity as any).model = db.client.taskItem;
  });

  afterAll(async () => {
    if (db) {
      await db.cleanup();
    }
    resetPrismaConfiguration();
  });

  beforeEach(async () => {
    await db.clear();
  });

  describe('create', () => {
    it('should create records with required and optional enum fields', async () => {
      const task = new TaskItemEntity({
        code: 'ENUM-CREATE-001',
        title: 'Create enum task',
        status: 'PENDING',
        priority: 'HIGH',
        description: 'created through BaseEntity.create'
      });

      const created = await task.create();

      expect(created.code).toBe('ENUM-CREATE-001');
      expect(created.status).toBe('PENDING');
      expect(created.priority).toBe('HIGH');

      const fromDb = await db.client.taskItem.findUnique({ where: { code: 'ENUM-CREATE-001' } });
      expect(fromDb).not.toBeNull();
      expect(fromDb.status).toBe('PENDING');
      expect(fromDb.priority).toBe('HIGH');
    });
  });

  describe('update', () => {
    it('should update enum fields with instance update()', async () => {
      const existing = await db.client.taskItem.create({
        data: {
          code: 'ENUM-UPDATE-001',
          title: 'Update enum task',
          status: 'PENDING',
          priority: 'LOW',
          description: 'before update'
        }
      });

      const task = new TaskItemEntity({
        id: existing.id,
        code: existing.code,
        title: existing.title,
        status: 'ACTIVE',
        priority: 'MEDIUM',
        description: 'after update'
      });

      const updated = await task.update();

      expect(updated.status).toBe('ACTIVE');
      expect(updated.priority).toBe('MEDIUM');

      const fromDb = await db.client.taskItem.findUnique({ where: { code: 'ENUM-UPDATE-001' } });
      expect(fromDb.status).toBe('ACTIVE');
      expect(fromDb.priority).toBe('MEDIUM');
      expect(fromDb.description).toBe('after update');
    });
  });

  describe('upsert', () => {
    it('should create a new record when unique enum record does not exist', async () => {
      const created = await TaskItemEntity.upsert({
        code: 'ENUM-UPSERT-NEW',
        title: 'Upsert created task',
        status: 'ACTIVE',
        priority: 'LOW',
        description: 'created via upsert'
      });

      expect(created.code).toBe('ENUM-UPSERT-NEW');
      expect(created.status).toBe('ACTIVE');
      expect(created.priority).toBe('LOW');

      const fromDb = await db.client.taskItem.findUnique({ where: { code: 'ENUM-UPSERT-NEW' } });
      expect(fromDb).not.toBeNull();
      expect(fromDb.status).toBe('ACTIVE');
      expect(fromDb.priority).toBe('LOW');
    });

    it('should update an existing record when enum values change', async () => {
      await db.client.taskItem.create({
        data: {
          code: 'ENUM-UPSERT-UPDATE',
          title: 'Task before enum change',
          status: 'PENDING',
          priority: 'LOW',
          description: 'before enum change'
        }
      });

      const updated = await TaskItemEntity.upsert({
        code: 'ENUM-UPSERT-UPDATE',
        title: 'Task after enum change',
        status: 'COMPLETED',
        priority: 'HIGH',
        description: 'after enum change'
      });

      expect(updated.status).toBe('COMPLETED');
      expect(updated.priority).toBe('HIGH');

      const fromDb = await db.client.taskItem.findUnique({ where: { code: 'ENUM-UPSERT-UPDATE' } });
      expect(fromDb.status).toBe('COMPLETED');
      expect(fromDb.priority).toBe('HIGH');
      expect(fromDb.title).toBe('Task after enum change');
    });
  });

  describe('upsertMany', () => {
    it('should handle created, updated, and unchanged enum records in the same batch', async () => {
      await db.client.taskItem.createMany({
        data: [
          {
            code: 'ENUM-BATCH-UNCHANGED',
            title: 'Batch unchanged',
            status: 'PENDING',
            priority: 'LOW',
            description: 'same values'
          },
          {
            code: 'ENUM-BATCH-UPDATED',
            title: 'Batch old',
            status: 'ACTIVE',
            priority: 'MEDIUM',
            description: 'before batch update'
          }
        ]
      });

      const result = await TaskItemEntity.upsertMany([
        {
          code: 'ENUM-BATCH-UNCHANGED',
          title: 'Batch unchanged',
          status: 'PENDING',
          priority: 'LOW',
          description: 'same values'
        },
        {
          code: 'ENUM-BATCH-UPDATED',
          title: 'Batch updated',
          status: 'COMPLETED',
          priority: 'HIGH',
          description: 'after batch update'
        },
        {
          code: 'ENUM-BATCH-CREATED',
          title: 'Batch created',
          status: 'ACTIVE',
          priority: 'MEDIUM',
          description: 'created in batch'
        }
      ]);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.unchanged).toBe(1);
      expect(result.total).toBe(3);

      const updated = await db.client.taskItem.findUnique({ where: { code: 'ENUM-BATCH-UPDATED' } });
      const created = await db.client.taskItem.findUnique({ where: { code: 'ENUM-BATCH-CREATED' } });

      expect(updated.status).toBe('COMPLETED');
      expect(updated.priority).toBe('HIGH');
      expect(created.status).toBe('ACTIVE');
      expect(created.priority).toBe('MEDIUM');
    });
  });
});