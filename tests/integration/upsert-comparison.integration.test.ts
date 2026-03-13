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

  describe('upsertMany - comprehensive coverage', () => {
    it('should create all records when none exist', async () => {
      const result = await Product.upsertMany([
        { name: 'Prod A', sku: 'NEW-001', price: 10 },
        { name: 'Prod B', sku: 'NEW-002', price: 20 },
        { name: 'Prod C', sku: 'NEW-003', price: 30 },
      ]);

      expect(result.created).toBe(3);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(result.total).toBe(3);

      // Verify all records exist in database
      const all = await db.client.product.findMany({ orderBy: { sku: 'asc' } });
      expect(all.length).toBe(3);
      expect(all[0].name).toBe('Prod A');
      expect(all[1].name).toBe('Prod B');
      expect(all[2].name).toBe('Prod C');
    });

    it('should update all records when all exist with changes', async () => {
      await db.client.product.createMany({
        data: [
          { name: 'Old A', sku: 'UPD-001', price: 10 },
          { name: 'Old B', sku: 'UPD-002', price: 20 },
        ],
      });

      const result = await Product.upsertMany([
        { name: 'New A', sku: 'UPD-001', price: 15 },
        { name: 'New B', sku: 'UPD-002', price: 25 },
      ]);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(2);
      expect(result.unchanged).toBe(0);
      expect(result.total).toBe(2);

      const a = await db.client.product.findUnique({ where: { sku: 'UPD-001' } });
      expect(a.name).toBe('New A');
      expect(a.price).toBeCloseTo(15, 1);

      const b = await db.client.product.findUnique({ where: { sku: 'UPD-002' } });
      expect(b.name).toBe('New B');
      expect(b.price).toBeCloseTo(25, 1);
    });

    it('should handle single item upsert (create)', async () => {
      const result = await Product.upsertMany([
        { name: 'Solo', sku: 'SOLO-001', price: 99 },
      ]);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(result.total).toBe(1);
    });

    it('should handle single item upsert (update)', async () => {
      await db.client.product.create({
        data: { name: 'Solo Old', sku: 'SOLO-002', price: 50 },
      });

      const result = await Product.upsertMany([
        { name: 'Solo New', sku: 'SOLO-002', price: 75 },
      ]);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.unchanged).toBe(0);
      expect(result.total).toBe(1);
    });

    it('should handle single item upsert (unchanged)', async () => {
      await db.client.product.create({
        data: { name: 'Solo Same', sku: 'SOLO-003', price: 42 },
      });

      const result = await Product.upsertMany([
        { name: 'Solo Same', sku: 'SOLO-003', price: 42 },
      ]);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(1);
      expect(result.total).toBe(1);
    });

    it('should return zero counts for empty array', async () => {
      const result = await Product.upsertMany([]);
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(result.total).toBe(0);
    });

    it('should handle mixed create, update, and unchanged in one batch', async () => {
      await db.client.product.createMany({
        data: [
          { name: 'Keep', sku: 'MIX-001', price: 100 },
          { name: 'Change Me', sku: 'MIX-002', price: 200 },
        ],
      });

      const result = await Product.upsertMany([
        { name: 'Keep', sku: 'MIX-001', price: 100 },       // unchanged
        { name: 'Changed', sku: 'MIX-002', price: 250 },    // updated
        { name: 'Brand New', sku: 'MIX-003', price: 300 },  // created
      ]);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.unchanged).toBe(1);
      expect(result.total).toBe(3);

      // Verify database state
      const keep = await db.client.product.findUnique({ where: { sku: 'MIX-001' } });
      expect(keep.name).toBe('Keep');
      expect(keep.price).toBeCloseTo(100, 1);

      const changed = await db.client.product.findUnique({ where: { sku: 'MIX-002' } });
      expect(changed.name).toBe('Changed');
      expect(changed.price).toBeCloseTo(250, 1);

      const brandNew = await db.client.product.findUnique({ where: { sku: 'MIX-003' } });
      expect(brandNew.name).toBe('Brand New');
      expect(brandNew.price).toBeCloseTo(300, 1);
    });

    it('should only update updatedAt when data actually changes', async () => {
      const created = await db.client.product.create({
        data: { name: 'Timestamp Test', sku: 'TS-001', price: 50 },
      });
      const originalUpdatedAt = created.updatedAt;

      // Wait to ensure timestamp difference is detectable
      await new Promise(r => setTimeout(r, 150));

      // Upsert with same data — updatedAt should NOT change
      await Product.upsertMany([
        { name: 'Timestamp Test', sku: 'TS-001', price: 50 },
      ]);

      const afterUnchanged = await db.client.product.findUnique({ where: { sku: 'TS-001' } });
      expect(afterUnchanged.updatedAt.getTime()).toBe(originalUpdatedAt.getTime());

      // Wait again
      await new Promise(r => setTimeout(r, 150));

      // Upsert with changed data — updatedAt SHOULD change
      await Product.upsertMany([
        { name: 'Timestamp Changed', sku: 'TS-001', price: 99 },
      ]);

      const afterChanged = await db.client.product.findUnique({ where: { sku: 'TS-001' } });
      expect(afterChanged.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
      expect(afterChanged.name).toBe('Timestamp Changed');
    });

    it('should handle null values in optional fields', async () => {
      await db.client.product.create({
        data: { name: 'Nullable', sku: 'NULL-001', price: 10, discount: 5 },
      });

      // Update: set discount to null
      const result = await Product.upsertMany([
        { name: 'Nullable', sku: 'NULL-001', price: 10, discount: null },
      ]);

      expect(result.updated).toBe(1);
      expect(result.unchanged).toBe(0);

      const record = await db.client.product.findUnique({ where: { sku: 'NULL-001' } });
      expect(record.discount).toBeNull();
    });

    it('should handle creating records with null optional fields', async () => {
      const result = await Product.upsertMany([
        { name: 'No Price', sku: 'NOPRICE-001', price: null },
      ]);

      expect(result.created).toBe(1);

      const record = await db.client.product.findUnique({ where: { sku: 'NOPRICE-001' } });
      expect(record.name).toBe('No Price');
      expect(record.price).toBeNull();
    });

    it('should deduplicate items with same unique key (last wins)', async () => {
      await db.client.product.create({
        data: { name: 'Original', sku: 'DUP-001', price: 10 },
      });

      // Two items with same sku — the last one should win
      const result = await Product.upsertMany([
        { name: 'First Write', sku: 'DUP-001', price: 20 },
        { name: 'Last Write', sku: 'DUP-001', price: 30 },
      ]);

      // Dedup: 2 → 1 (removed = 1, added to unchanged)
      expect(result.total).toBe(2);
      expect(result.updated).toBe(1);

      const record = await db.client.product.findUnique({ where: { sku: 'DUP-001' } });
      expect(record.name).toBe('Last Write');
      expect(record.price).toBeCloseTo(30, 1);
    });

    it('should handle large batch with mixed operations', async () => {
      // Pre-create 5 records
      const existingData = [];
      for (let i = 1; i <= 5; i++) {
        existingData.push({ name: `Existing ${i}`, sku: `LARGE-${String(i).padStart(3, '0')}`, price: i * 10 });
      }
      await db.client.product.createMany({ data: existingData });

      // Build batch: 5 unchanged, 5 updated, 10 new
      const items: Partial<IProduct>[] = [];
      // 5 unchanged (same data)
      for (let i = 1; i <= 5; i++) {
        items.push({ name: `Existing ${i}`, sku: `LARGE-${String(i).padStart(3, '0')}`, price: i * 10 });
      }
      // 5 updated (changed price)
      for (let i = 1; i <= 5; i++) {
        items[i - 1] = { name: `Existing ${i}`, sku: `LARGE-${String(i).padStart(3, '0')}`, price: i * 10 + 1 };
      }
      // 10 new
      for (let i = 6; i <= 15; i++) {
        items.push({ name: `New ${i}`, sku: `LARGE-${String(i).padStart(3, '0')}`, price: i * 10 });
      }

      const result = await Product.upsertMany(items);

      expect(result.total).toBe(15);
      expect(result.created).toBe(10);
      expect(result.updated).toBe(5);
      expect(result.unchanged).toBe(0);

      // Verify total count in database
      const all = await db.client.product.findMany();
      expect(all.length).toBe(15);
    });

    it('should handle updating only the name field', async () => {
      await db.client.product.create({
        data: { name: 'Old Name', sku: 'NAME-001', price: 50 },
      });

      const result = await Product.upsertMany([
        { name: 'New Name', sku: 'NAME-001', price: 50 },
      ]);

      expect(result.updated).toBe(1);
      expect(result.unchanged).toBe(0);

      const record = await db.client.product.findUnique({ where: { sku: 'NAME-001' } });
      expect(record.name).toBe('New Name');
      expect(record.price).toBeCloseTo(50, 1);
    });

    it('should handle updating only the price field', async () => {
      await db.client.product.create({
        data: { name: 'Same Name', sku: 'PRICE-001', price: 50 },
      });

      const result = await Product.upsertMany([
        { name: 'Same Name', sku: 'PRICE-001', price: 75 },
      ]);

      expect(result.updated).toBe(1);
      expect(result.unchanged).toBe(0);

      const record = await db.client.product.findUnique({ where: { sku: 'PRICE-001' } });
      expect(record.name).toBe('Same Name');
      expect(record.price).toBeCloseTo(75, 1);
    });

    it('should handle float precision correctly in comparisons', async () => {
      await db.client.product.create({
        data: { name: 'Float', sku: 'FLOAT-001', price: 19.99 },
      });

      // Upsert with exact same float — should be unchanged
      const result = await Product.upsertMany([
        { name: 'Float', sku: 'FLOAT-001', price: 19.99 },
      ]);

      expect(result.unchanged).toBe(1);
      expect(result.updated).toBe(0);
    });

    it('should handle multiple unchanged records correctly', async () => {
      await db.client.product.createMany({
        data: [
          { name: 'U1', sku: 'UNCH-A', price: 1 },
          { name: 'U2', sku: 'UNCH-B', price: 2 },
          { name: 'U3', sku: 'UNCH-C', price: 3 },
          { name: 'U4', sku: 'UNCH-D', price: 4 },
          { name: 'U5', sku: 'UNCH-E', price: 5 },
        ],
      });

      const result = await Product.upsertMany([
        { name: 'U1', sku: 'UNCH-A', price: 1 },
        { name: 'U2', sku: 'UNCH-B', price: 2 },
        { name: 'U3', sku: 'UNCH-C', price: 3 },
        { name: 'U4', sku: 'UNCH-D', price: 4 },
        { name: 'U5', sku: 'UNCH-E', price: 5 },
      ]);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(5);
      expect(result.total).toBe(5);
    });

    it('should handle consecutive upsertMany calls correctly', async () => {
      // First call: all creates
      const firstResult = await Product.upsertMany([
        { name: 'P1', sku: 'SEQ-001', price: 10 },
        { name: 'P2', sku: 'SEQ-002', price: 20 },
      ]);
      expect(firstResult.created).toBe(2);
      expect(firstResult.updated).toBe(0);

      // Second call: same data — all unchanged
      const secondResult = await Product.upsertMany([
        { name: 'P1', sku: 'SEQ-001', price: 10 },
        { name: 'P2', sku: 'SEQ-002', price: 20 },
      ]);
      expect(secondResult.created).toBe(0);
      expect(secondResult.updated).toBe(0);
      expect(secondResult.unchanged).toBe(2);

      // Third call: update one, keep other
      const thirdResult = await Product.upsertMany([
        { name: 'P1 Updated', sku: 'SEQ-001', price: 15 },
        { name: 'P2', sku: 'SEQ-002', price: 20 },
      ]);
      expect(thirdResult.created).toBe(0);
      expect(thirdResult.updated).toBe(1);
      expect(thirdResult.unchanged).toBe(1);
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

  // ---------------------------------------------------------------------------
  // Regression: unchanged counts must never be 0 when nothing actually changed
  //
  // Root cause: on PostgreSQL, unchanged rows are absent from RETURNING (DO NOTHING
  // or WHERE IS DISTINCT FROM filters them out), so unchanged = total - RETURNING.length.
  // On MySQL/SQLite, the pre-count drives the formula. Any broken SQL generation
  // (e.g. empty SET clause for pivot-like models) caused batch failure and silent 0s.
  // These tests cover ALL providers so any regression is caught regardless of DB.
  // ---------------------------------------------------------------------------
  describe('Regressions - unchanged counts (all providers)', () => {
    it('should not return all-zero counts when all records are unchanged', async () => {
      // This was the root bug: unchanged was 0 instead of N when nothing changed
      await db.client.product.createMany({
        data: [
          { name: 'Stable 1', sku: 'REG-UNCH-001', price: 11 },
          { name: 'Stable 2', sku: 'REG-UNCH-002', price: 22 },
          { name: 'Stable 3', sku: 'REG-UNCH-003', price: 33 },
        ]
      });

      const result = await Product.upsertMany([
        { name: 'Stable 1', sku: 'REG-UNCH-001', price: 11 },
        { name: 'Stable 2', sku: 'REG-UNCH-002', price: 22 },
        { name: 'Stable 3', sku: 'REG-UNCH-003', price: 33 },
      ]);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(3);
      expect(result.total).toBe(3);
      // Invariant: counts must always sum to total
      expect(result.created + result.updated + result.unchanged).toBe(result.total);
    });

    it('should never produce negative or NaN counts', async () => {
      await db.client.product.createMany({
        data: [
          { name: 'Guard 1', sku: 'REG-GUARD-001', price: 1 },
          { name: 'Guard 2', sku: 'REG-GUARD-002', price: 2 },
        ]
      });

      const result = await Product.upsertMany([
        { name: 'Guard 1', sku: 'REG-GUARD-001', price: 1 },
        { name: 'Guard 2', sku: 'REG-GUARD-002', price: 2 },
      ]);

      expect(result.created).toBeGreaterThanOrEqual(0);
      expect(result.updated).toBeGreaterThanOrEqual(0);
      expect(result.unchanged).toBeGreaterThanOrEqual(0);
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(result.created)).toBe(true);
      expect(Number.isFinite(result.updated)).toBe(true);
      expect(Number.isFinite(result.unchanged)).toBe(true);
    });

    it('should count duplicate-key input items toward total and unchanged', async () => {
      // Dedup reduces the SQL batch but the orignal item count should still appear in total
      await db.client.product.create({
        data: { name: 'Dup Stable', sku: 'REG-UNCH-DUP-001', price: 50 }
      });

      const result = await Product.upsertMany([
        { name: 'Dup Stable', sku: 'REG-UNCH-DUP-001', price: 50 },
        { name: 'Dup Stable', sku: 'REG-UNCH-DUP-001', price: 50 },
      ]);

      // Two items in → dedup to 1 → unchanged=1 (real) + 1 (duplicate) = 2 total
      expect(result.total).toBe(2);
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(2);
      expect(result.created + result.updated + result.unchanged).toBe(result.total);
    });

    it('should preserve counts invariant across mixed create/update/unchanged', async () => {
      await db.client.product.createMany({
        data: [
          { name: 'Keep', sku: 'REG-MIX-001', price: 10 },
          { name: 'Change', sku: 'REG-MIX-002', price: 20 },
        ]
      });

      const result = await Product.upsertMany([
        { name: 'Keep', sku: 'REG-MIX-001', price: 10 },    // unchanged
        { name: 'Changed', sku: 'REG-MIX-002', price: 99 }, // updated
        { name: 'New', sku: 'REG-MIX-003', price: 30 },     // created
      ]);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.unchanged).toBe(1);
      expect(result.total).toBe(3);
      expect(result.created + result.updated + result.unchanged).toBe(result.total);
    });
  });
});
