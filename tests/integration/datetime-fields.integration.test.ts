/**
 * Integration test for DateTime field handling with explicit Date fields
 * 
 * Tests that Date objects passed through BaseEntity.create() are correctly preserved
 * and not incorrectly transformed into { create: {} } or other invalid structures.
 * 
 * This test uses a Job model with explicit scheduledFor DateTime? field
 * to test the COMPLETE flow: new Entity({dateField: Date}).create()
 * 
 * Run with: npm run test:integration -- datetime-fields
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/core/base-entity';
import { Property } from '../../src/core/decorators/property.decorator';
import { configurePrisma, resetPrismaConfiguration } from '../../src/core/config';
import { createTestDb } from '../helpers/test-db';
import type { PrismaClient } from '@prisma/client';

/**
 * Job entity with explicit DateTime fields for testing
 * This mirrors the user's real-world scenario with scheduledFor
 */
interface IJob {
  id?: number | string;
  type: string;
  status?: string;
  scheduledFor?: Date | null;
  completedAt?: Date | null;
  payload?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

class Job extends BaseEntity<IJob> implements IJob {
  static override readonly model: PrismaClient['job'];

  public declare readonly id?: IJob['id'];

  @Property() declare type: IJob['type'];
  @Property() declare status: IJob['status'];
  @Property() declare scheduledFor: IJob['scheduledFor'];
  @Property() declare completedAt: IJob['completedAt'];
  @Property() declare payload: IJob['payload'];
  @Property() declare createdAt: IJob['createdAt'];
  @Property() declare updatedAt: IJob['updatedAt'];

  constructor(data?: Partial<IJob>) {
    super(data);
  }
}

describe('DateTime Fields with Explicit Date Input - Integration Tests', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Setup real test database
    db = await createTestDb();
    prisma = db.client;

    console.log('\n' + '='.repeat(60));
    console.log(`Running DateTime Fields Integration Tests (Job Model)`);
    console.log('='.repeat(60));
    console.log(`Database Provider: ${db.provider.toUpperCase()}`);
    console.log('='.repeat(60) + '\n');

    // Clear all data before starting tests
    await db.clear();

    // Configure Job entity with real Prisma model
    (Job as any).model = prisma.job;
    configurePrisma(prisma as any);
  }, 30000);

  afterAll(async () => {
    await db.cleanup();
    resetPrismaConfiguration();
  });

  beforeEach(async () => {
    // Clear jobs before each test
    await prisma.job.deleteMany({});
  });

  describe('create() with explicit Date field from constructor', () => {
    /**
     * CRITICAL TEST: This tests the exact scenario that was failing
     * new Entity({ scheduledFor: Date }).create() should properly save the Date
     */
    it('should create job with scheduledFor Date passed through constructor', async () => {
      const scheduledDate = new Date('2026-02-12T00:00:00.000Z');

      // Create entity exactly like user's code: new Entity({...Date...}).create()
      const job = new Job({
        type: 'SYNC_USER',
        status: 'pending',
        scheduledFor: scheduledDate,
        payload: JSON.stringify({ reason: 'Test reason' })
      });

      // This is where the bug occurred: Date became { create: {} }
      const created = await job.create();

      expect(created).toBeDefined();
      expect(created.id).toBeDefined();
      expect(created.type).toBe('SYNC_USER');
      expect(created.status).toBe('pending');

      // The scheduledFor should be a Date object, not { create: {} }
      expect((created as any).scheduledFor).toBeInstanceOf(Date);
      expect((created as any).scheduledFor.getTime()).toBe(scheduledDate.getTime());

      // Verify in database
      const dbJob = await prisma.job.findUnique({ where: { id: created.id as any } });
      expect(dbJob).toBeDefined();
      expect(dbJob?.scheduledFor).toBeInstanceOf(Date);
      expect(dbJob?.scheduledFor?.getTime()).toBe(scheduledDate.getTime());
    });

    /**
     * Test: Create with null scheduledFor (nullable DateTime)
     */
    it('should create job with null scheduledFor', async () => {
      const job = new Job({
        type: 'IMMEDIATE_JOB',
        status: 'pending',
        scheduledFor: null,
        payload: JSON.stringify({ data: 'test' })
      });

      const created = await job.create();

      expect(created).toBeDefined();
      expect((created as any).scheduledFor).toBeNull();

      // Verify in database
      const dbJob = await prisma.job.findUnique({ where: { id: created.id as any } });
      expect(dbJob?.scheduledFor).toBeNull();
    });

    /**
     * Test: Create without providing scheduledFor (undefined)
     */
    it('should create job without scheduledFor (undefined)', async () => {
      const job = new Job({
        type: 'NO_SCHEDULE_JOB',
        status: 'pending'
      });

      const created = await job.create();

      expect(created).toBeDefined();
      expect((created as any).scheduledFor).toBeNull(); // SQLite stores undefined as null

      // Verify in database
      const dbJob = await prisma.job.findUnique({ where: { id: created.id as any } });
      expect(dbJob?.scheduledFor).toBeNull();
    });

    /**
     * Test: Create with multiple Date fields
     */
    it('should create job with multiple Date fields', async () => {
      const scheduledDate = new Date('2026-02-15T10:00:00.000Z');
      const completedDate = new Date('2026-02-15T10:30:00.000Z');

      const job = new Job({
        type: 'COMPLETED_JOB',
        status: 'completed',
        scheduledFor: scheduledDate,
        completedAt: completedDate
      });

      const created = await job.create();

      // First verify in database (source of truth)
      const dbJob = await prisma.job.findUnique({ where: { id: created.id as any } });
      expect(dbJob).not.toBeNull();
      expect(dbJob?.scheduledFor).toBeInstanceOf(Date);
      expect(dbJob?.completedAt).toBeInstanceOf(Date);
      expect(dbJob?.scheduledFor?.getTime()).toBe(scheduledDate.getTime());
      expect(dbJob?.completedAt?.getTime()).toBe(completedDate.getTime());

      // Then verify entity return values
      expect((created as any).scheduledFor).toBeInstanceOf(Date);
      expect((created as any).completedAt).toBeInstanceOf(Date);
      expect((created as any).scheduledFor.getTime()).toBe(scheduledDate.getTime());
      expect((created as any).completedAt.getTime()).toBe(completedDate.getTime());
    });
  });

  describe('update() with Date fields', () => {
    /**
     * Test: Update entity setting a Date field
     */
    it('should update job setting scheduledFor Date', async () => {
      // Create job without schedule
      const created = await new Job({
        type: 'UPDATE_TEST',
        status: 'pending'
      }).create();

      const newSchedule = new Date('2026-03-01T08:00:00.000Z');

      // Update with Date
      const jobToUpdate = new Job({
        id: created.id,
        type: (created as any).type,
        status: (created as any).status,
        scheduledFor: newSchedule
      });

      const updated = await jobToUpdate.update();

      expect((updated as any).scheduledFor).toBeInstanceOf(Date);
      expect((updated as any).scheduledFor.getTime()).toBe(newSchedule.getTime());

      // Verify in database
      const dbJob = await prisma.job.findUnique({ where: { id: created.id as any } });
      expect(dbJob?.scheduledFor?.getTime()).toBe(newSchedule.getTime());
    });

    /**
     * Test: Update entity setting Date to null
     */
    it('should update job setting scheduledFor to null', async () => {
      const initialDate = new Date('2026-02-20T12:00:00.000Z');

      // Create job with schedule
      const created = await new Job({
        type: 'CANCEL_SCHEDULE_TEST',
        status: 'pending',
        scheduledFor: initialDate
      }).create();

      // Update setting scheduledFor to null
      const jobToUpdate = new Job({
        id: created.id,
        type: (created as any).type,
        status: 'cancelled',
        scheduledFor: null
      });

      const updated = await jobToUpdate.update();

      expect((updated as any).scheduledFor).toBeNull();
      expect((updated as any).status).toBe('cancelled');

      // Verify in database
      const dbJob = await prisma.job.findUnique({ where: { id: created.id as any } });
      expect(dbJob?.scheduledFor).toBeNull();
    });
  });

  describe('findByFilter() returns proper Date instances', () => {
    /**
     * Test: findByFilter returns Date instances for DateTime fields
     */
    it('should return Date instances from findByFilter', async () => {
      const scheduledDate = new Date('2026-04-01T09:00:00.000Z');

      await new Job({
        type: 'FIND_TEST',
        status: 'pending',
        scheduledFor: scheduledDate
      }).create();

      const jobs = await Job.findByFilter({ type: 'FIND_TEST' }) as any[];

      expect(jobs.length).toBe(1);
      expect(jobs[0].scheduledFor).toBeInstanceOf(Date);
      expect(jobs[0].scheduledFor.getTime()).toBe(scheduledDate.getTime());
      expect(jobs[0].createdAt).toBeInstanceOf(Date);
      expect(jobs[0].updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('createMany() with Date fields', () => {
    /**
     * Test: createMany should handle records with explicit Date fields
     */
    it('should create multiple jobs with Date fields via createMany', async () => {
      const date1 = new Date('2026-05-01T10:00:00.000Z');
      const date2 = new Date('2026-05-02T10:00:00.000Z');

      const jobs = [
        { type: 'BATCH_JOB_1', status: 'pending', scheduledFor: date1 },
        { type: 'BATCH_JOB_2', status: 'pending', scheduledFor: date2 },
        { type: 'BATCH_JOB_3', status: 'pending', scheduledFor: null }
      ];

      const count = await Job.createMany(jobs);

      expect(count).toBe(3);

      // Verify in database
      const dbJobs = await prisma.job.findMany({
        where: { type: { startsWith: 'BATCH_JOB' } },
        orderBy: { type: 'asc' }
      });

      expect(dbJobs.length).toBe(3);
      expect(dbJobs[0].scheduledFor?.getTime()).toBe(date1.getTime());
      expect(dbJobs[1].scheduledFor?.getTime()).toBe(date2.getTime());
      expect(dbJobs[2].scheduledFor).toBeNull();
    });
  });
});
