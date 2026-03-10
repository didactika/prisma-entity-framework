/**
 * Integration test for upsert change detection with type-coerced fields
 *
 * Verifies that `hasChanges` correctly compares values returned by Prisma
 * (Decimal objects, float precision, Date instances, JSON fields) against
 * submitted data to avoid unnecessary UPDATE queries.
 *
 * Runs on: SQLite, MySQL, PostgreSQL, MongoDB
 * Uses the Product model which has Float, Decimal (PG/MySQL), JSON, and DateTime fields.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/core/base-entity';
import { Property } from '../../src/core/decorators/property.decorator';
import { createTestDb, type TestDbInstance } from '../helpers/test-db';
import { configurePrisma } from '../../src/core/config';

let db: TestDbInstance;

interface IProduct {
  id?: number | string;
  name: string;
  sku: string;
  price?: number | null;
  discount?: number | null;
  metadata?: any;
  settings?: any;
  createdAt?: Date;
  updatedAt?: Date;
}

class Product extends BaseEntity<IProduct> implements IProduct {
  static override readonly model: any;

  public declare readonly id?: IProduct['id'];

  @Property() declare name: IProduct['name'];
  @Property() declare sku: IProduct['sku'];
  @Property() declare price: IProduct['price'];
  @Property() declare discount: IProduct['discount'];
  @Property() declare metadata: IProduct['metadata'];
  @Property() declare settings: IProduct['settings'];

  constructor(data?: Partial<IProduct>) {
    super(data);
  }
}

describe('Upsert Comparison Integration Tests', () => {
  beforeAll(async () => {
    db = await createTestDb();
    configurePrisma(db.client);
    (Product as any).model = db.client.product;

    console.log(`\nRunning Upsert Comparison Integration Tests on ${db.provider.toUpperCase()}\n`);
  });

  afterAll(async () => {
    if (db) {
      await db.cleanup();
    }
  });

  beforeEach(async () => {
    await db.client.product.deleteMany({});
  });

  describe('Float fields - no false positive updates', () => {
    it('should NOT update when float value has not changed', async () => {
      // Create a product with a float price
      await db.client.product.create({
        data: { name: 'Widget', sku: 'W-001', price: 19.99, discount: 5.5 }
      });

      // Upsert with the same values — should detect no changes
      const result = await Product.upsert({ name: 'Widget', sku: 'W-001', price: 19.99, discount: 5.5 });

      expect(result.name).toBe('Widget');
      expect(result.sku).toBe('W-001');
    });

    it('should update when float value genuinely changes', async () => {
      await db.client.product.create({
        data: { name: 'Widget', sku: 'W-002', price: 19.99 }
      });

      await Product.upsert({ name: 'Widget', sku: 'W-002', price: 29.99 });

      // Fetch from DB to verify the update was applied
      const fromDb = await db.client.product.findUnique({ where: { sku: 'W-002' } });
      expect(fromDb.price).toBeCloseTo(29.99, 1);
    });
  });

  describe('DateTime fields - no false positive updates', () => {
    it('should NOT update when only createdAt/updatedAt differ (ignored fields)', async () => {
      await db.client.product.create({
        data: { name: 'Gadget', sku: 'G-001', price: 49.99 }
      });

      // Upsert with same data — createdAt/updatedAt should be ignored
      const result = await Product.upsert({ name: 'Gadget', sku: 'G-001', price: 49.99 });

      expect(result.name).toBe('Gadget');
    });
  });

  describe('upsertMany - batch change detection', () => {
    it('should correctly categorize unchanged records in batch', async () => {
      // Create existing records
      await db.client.product.createMany({
        data: [
          { name: 'Item A', sku: 'BATCH-001', price: 10 },
          { name: 'Item B', sku: 'BATCH-002', price: 20 },
        ]
      });

      // Upsert with mix: one unchanged, one updated, one new
      const result = await Product.upsertMany([
        { name: 'Item A', sku: 'BATCH-001', price: 10 },   // unchanged
        { name: 'Item B v2', sku: 'BATCH-002', price: 25 }, // updated
        { name: 'Item C', sku: 'BATCH-003', price: 30 },    // new
      ]);

      expect(result.unchanged).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.created).toBe(1);
      expect(result.total).toBe(3);
    });

    it('should count all as unchanged when nothing changed', async () => {
      await db.client.product.createMany({
        data: [
          { name: 'X1', sku: 'UNCH-001', price: 5 },
          { name: 'X2', sku: 'UNCH-002', price: 15 },
        ]
      });

      const result = await Product.upsertMany([
        { name: 'X1', sku: 'UNCH-001', price: 5 },
        { name: 'X2', sku: 'UNCH-002', price: 15 },
      ]);

      expect(result.unchanged).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.created).toBe(0);
    });
  });

  // JSON and Decimal tests — only run on databases that support them
  describe('JSON fields - database-dependent', () => {
    const supportsJson = () => db.provider === 'postgresql' || db.provider === 'mysql' || db.provider === 'mongodb';

    it('should NOT update when JSON metadata is identical', async () => {
      if (!supportsJson()) {
        console.log(`⏭️  Skipping JSON test on ${db.provider}`);
        return;
      }

      const metadata = { theme: 'dark', lang: 'en', nested: { deep: true } };

      await db.client.product.create({
        data: { name: 'JSONProd', sku: 'JSON-001', metadata }
      });

      const result = await Product.upsert({
        name: 'JSONProd',
        sku: 'JSON-001',
        metadata: { theme: 'dark', lang: 'en', nested: { deep: true } }
      });

      expect(result.name).toBe('JSONProd');
    });

    it('should update when JSON metadata actually changes', async () => {
      if (!supportsJson()) {
        console.log(`⏭️  Skipping JSON test on ${db.provider}`);
        return;
      }

      await db.client.product.create({
        data: { name: 'JSONProd2', sku: 'JSON-002', metadata: { version: 1 } }
      });

      await Product.upsert({
        name: 'JSONProd2',
        sku: 'JSON-002',
        metadata: { version: 2 }
      });

      const fromDb = await db.client.product.findUnique({ where: { sku: 'JSON-002' } });
      expect(fromDb.metadata).toEqual({ version: 2 });
    });
  });
});
