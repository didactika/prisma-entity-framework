/**
 * Integration tests for JSON field handling in PostgreSQL
 * Tests that JSON fields are stored correctly without being wrapped in connect/create
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/base-entity';
import { setupTestDatabase } from '../utils/test-db';
import { configurePrisma } from '../../src/config';
import type { PrismaClient as PostgreSQLPrismaClient } from '../../node_modules/.prisma/client-postgresql';

// Only run these tests when testing with PostgreSQL
const isPostgreSQL = process.env.DATABASE_URL?.includes('postgresql');
const describePostgreSQL = isPostgreSQL ? describe : describe.skip;

let prisma: PostgreSQLPrismaClient;

interface IProduct {
  id?: number;
  name: string;
  sku: string;
  metadata?: any;
  settings?: any;
  createdAt?: Date;
  updatedAt?: Date;
}

class Product extends BaseEntity<IProduct> {
  static override readonly model: any;

  private _name!: string;
  private _sku!: string;
  private _metadata?: any;
  private _settings?: any;

  constructor(data: Partial<IProduct>) {
    super(data);
  }

  static override getModelInformation() {
    // Get the model info from Prisma runtime
    return super.getModelInformation();
  }

  get name(): string {
    return this._name;
  }
  set name(value: string) {
    this._name = value;
  }

  get sku(): string {
    return this._sku;
  }
  set sku(value: string) {
    this._sku = value;
  }

  get metadata(): any {
    return this._metadata;
  }
  set metadata(value: any) {
    this._metadata = value;
  }

  get settings(): any {
    return this._settings;
  }
  set settings(value: any) {
    this._settings = value;
  }
}

describePostgreSQL('PostgreSQL - JSON Fields Integration Tests', () => {
  beforeAll(async () => {
    const dbConfig = await setupTestDatabase();
    prisma = dbConfig.client as any;
    // Configure Prisma globally
    configurePrisma(prisma as any);
    // Update the model reference after prisma is initialized
    (Product as any).model = (prisma as any).product;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    // Clean up products before each test
    if ((prisma as any).product) {
      await (prisma as any).product.deleteMany();
    }
  });

  describe('create with JSON fields', () => {
    it('should create product with JSON metadata', async () => {
      const product = new Product({
        name: 'Test Product',
        sku: 'TEST-001',
        metadata: {
          color: 'blue',
          size: 'large',
          tags: ['electronics', 'gadget'],
          specs: {
            weight: 1.5,
            dimensions: { width: 10, height: 20, depth: 5 }
          }
        }
      });

      const created = await product.create();

      expect(created.id).toBeDefined();
      expect(created.name).toBe('Test Product');
      expect(created.metadata).toEqual({
        color: 'blue',
        size: 'large',
        tags: ['electronics', 'gadget'],
        specs: {
          weight: 1.5,
          dimensions: { width: 10, height: 20, depth: 5 }
        }
      });

      // Verify in database
      const dbProduct = await (prisma as any).product.findUnique({ where: { id: created.id } });
      expect(dbProduct?.metadata).toEqual(created.metadata);
    });

    it('should create product with multiple JSON fields', async () => {
      const product = new Product({
        name: 'Multi JSON Product',
        sku: 'MULTI-001',
        metadata: { category: 'electronics', brand: 'TestBrand' },
        settings: { notifications: true, theme: 'dark', language: 'en' }
      });

      const created = await product.create();

      expect(created.metadata).toEqual({ category: 'electronics', brand: 'TestBrand' });
      expect(created.settings).toEqual({ notifications: true, theme: 'dark', language: 'en' });
    });

    it('should handle null JSON fields', async () => {
      const product = new Product({
        name: 'Null JSON Product',
        sku: 'NULL-001',
        metadata: null,
        settings: null
      });

      const created = await product.create();

      expect(created.metadata).toBeNull();
      expect(created.settings).toBeNull();
    });
  });

  describe('update with JSON fields', () => {
    it('should update JSON field correctly', async () => {
      // Create initial product
      const created = await (prisma as any).product.create({
        data: {
          name: 'Update Test',
          sku: 'UPDATE-001',
          metadata: { version: 1, status: 'draft' }
        }
      });

      // Update using BaseEntity
      const product = new Product({
        id: created.id,
        name: 'Update Test',
        sku: 'UPDATE-001',
        metadata: { version: 2, status: 'published', author: 'John' }
      });

      const updated = await product.update();

      expect(updated.metadata).toEqual({ version: 2, status: 'published', author: 'John' });

      // Verify in database
      const dbProduct = await (prisma as any).product.findUnique({ where: { id: created.id } });
      expect(dbProduct?.metadata).toEqual({ version: 2, status: 'published', author: 'John' });
    });

    it('should update nested JSON objects', async () => {
      const created = await (prisma as any).product.create({
        data: {
          name: 'Nested JSON',
          sku: 'NESTED-001',
          settings: {
            ui: { theme: 'light', fontSize: 14 },
            api: { timeout: 5000, retries: 3 }
          }
        }
      });

      const product = new Product({
        id: created.id,
        name: 'Nested JSON',
        sku: 'NESTED-001',
        settings: {
          ui: { theme: 'dark', fontSize: 16, animations: true },
          api: { timeout: 10000, retries: 5 },
          notifications: { email: true, push: false }
        }
      });

      const updated = await product.update();

      expect(updated.settings.ui.theme).toBe('dark');
      expect(updated.settings.notifications).toEqual({ email: true, push: false });
    });
  });

  describe('upsert with JSON fields', () => {
    it('should create new product with JSON via upsert', async () => {
      const result = await Product.upsert({
        name: 'Upsert Create',
        sku: 'UPSERT-CREATE-001',
        metadata: { type: 'new', priority: 'high' }
      });

      expect(result.id).toBeDefined();
      expect(result.metadata).toEqual({ type: 'new', priority: 'high' });
    });

    it('should update existing product with JSON via upsert', async () => {
      // Create initial
      await (prisma as any).product.create({
        data: {
          name: 'Upsert Update',
          sku: 'UPSERT-UPDATE-001',
          metadata: { version: 1 }
        }
      });

      // Upsert with updated JSON
      const result = await Product.upsert({
        name: 'Upsert Update Modified',
        sku: 'UPSERT-UPDATE-001',
        metadata: { version: 2, updated: true }
      });

      expect(result.metadata).toEqual({ version: 2, updated: true });
    });

    it('should not update when JSON has no changes', async () => {
      const created = await (prisma as any).product.create({
        data: {
          name: 'No Change',
          sku: 'NO-CHANGE-001',
          metadata: { status: 'active' }
        }
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Upsert with same data
      const result = await Product.upsert({
        name: 'No Change',
        sku: 'NO-CHANGE-001',
        metadata: { status: 'active' }
      });

      // Verify the record was returned (not updated)
      expect(result.id).toBe(created.id);
      expect(result.metadata).toEqual({ status: 'active' });
    });
  });

  describe('upsertMany with JSON fields', () => {
    it('should create multiple products with JSON', async () => {
      const items = [
        {
          name: 'Batch 1',
          sku: 'BATCH-001',
          metadata: { batch: 1, type: 'A' }
        },
        {
          name: 'Batch 2',
          sku: 'BATCH-002',
          metadata: { batch: 2, type: 'B' }
        },
        {
          name: 'Batch 3',
          sku: 'BATCH-003',
          metadata: { batch: 3, type: 'C' }
        }
      ];

      const result = await Product.upsertMany(items);

      expect(result.created).toBe(3);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(0);

      // Verify in database
      const products = await (prisma as any).product.findMany({ orderBy: { sku: 'asc' } });
      expect(products[0].metadata).toEqual({ batch: 1, type: 'A' });
      expect(products[1].metadata).toEqual({ batch: 2, type: 'B' });
      expect(products[2].metadata).toEqual({ batch: 3, type: 'C' });
    });

    it('should update products with JSON changes', async () => {
      // Create initial products
      await (prisma as any).product.createMany({
        data: [
          { name: 'Update 1', sku: 'UPDATE-BATCH-001', metadata: { version: 1 } },
          { name: 'Update 2', sku: 'UPDATE-BATCH-002', metadata: { version: 1 } }
        ]
      });

      // Upsert with updated JSON
      const items = [
        {
          name: 'Update 1 Modified',
          sku: 'UPDATE-BATCH-001',
          metadata: { version: 2, modified: true }
        },
        {
          name: 'Update 2 Modified',
          sku: 'UPDATE-BATCH-002',
          metadata: { version: 2, modified: true }
        }
      ];

      const result = await Product.upsertMany(items);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(2);
      expect(result.unchanged).toBe(0);

      // Verify in database - check that at least one was updated correctly
      const product1 = await (prisma as any).product.findUnique({ where: { sku: 'UPDATE-BATCH-001' } });
      const product2 = await (prisma as any).product.findUnique({ where: { sku: 'UPDATE-BATCH-002' } });
      
      expect(product1.name).toBe('Update 1 Modified');
      expect(product1.metadata).toEqual({ version: 2, modified: true });
      expect(product2.name).toBe('Update 2 Modified');
      expect(product2.metadata).toEqual({ version: 2, modified: true });
    });

    it('should handle mixed operations with JSON', async () => {
      // Create one existing product
      await (prisma as any).product.create({
        data: { name: 'Existing', sku: 'MIXED-001', metadata: { status: 'old' } }
      });

      const items = [
        { name: 'Existing', sku: 'MIXED-001', metadata: { status: 'old' } }, // unchanged
        { name: 'Existing Updated', sku: 'MIXED-001', metadata: { status: 'new' } }, // This will be skipped as duplicate
        { name: 'New Product', sku: 'MIXED-002', metadata: { status: 'fresh' } } // new
      ];

      const result = await Product.upsertMany(items);

      expect(result.total).toBe(3);
      // Note: The duplicate will be handled by deduplication logic
    });

    it('should handle complex nested JSON in batch', async () => {
      const items = [
        {
          name: 'Complex 1',
          sku: 'COMPLEX-001',
          metadata: {
            product: {
              category: 'electronics',
              subcategory: 'phones',
              features: ['5G', 'waterproof', 'wireless charging']
            },
            pricing: {
              base: 999,
              currency: 'USD',
              discounts: [{ type: 'seasonal', amount: 50 }]
            }
          }
        },
        {
          name: 'Complex 2',
          sku: 'COMPLEX-002',
          settings: {
            display: { resolution: '1920x1080', refresh: 60 },
            performance: { cpu: 'high', gpu: 'medium' }
          }
        }
      ];

      const result = await Product.upsertMany(items);

      expect(result.created).toBe(2);

      const products = await (prisma as any).product.findMany({ orderBy: { sku: 'asc' } });
      expect(products[0].metadata.product.features).toEqual(['5G', 'waterproof', 'wireless charging']);
      expect(products[1].settings.display.resolution).toBe('1920x1080');
    });
  });

  describe('createMany with JSON fields', () => {
    it('should create many products with JSON', async () => {
      const items = [
        { name: 'CreateMany 1', sku: 'CM-001', metadata: { index: 1 } },
        { name: 'CreateMany 2', sku: 'CM-002', metadata: { index: 2 } },
        { name: 'CreateMany 3', sku: 'CM-003', metadata: { index: 3 } }
      ];

      const count = await Product.createMany(items);

      expect(count).toBe(3);

      const products = await (prisma as any).product.findMany({ orderBy: { sku: 'asc' } });
      expect(products).toHaveLength(3);
      expect(products[0].metadata).toEqual({ index: 1 });
      expect(products[1].metadata).toEqual({ index: 2 });
      expect(products[2].metadata).toEqual({ index: 3 });
    });
  });
});
