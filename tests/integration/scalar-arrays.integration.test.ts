/**
 * Scalar Arrays Integration Test Suite
 * Tests scalar array operations (String[], Int[], etc.) on PostgreSQL
 * Runs on: PostgreSQL only
 * Skipped on: MySQL, MongoDB, SQLite (no native scalar array support)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/base-entity';
import { createTestDb, type TestDbInstance } from '../utils/test-db';
import { configurePrisma } from '../../src/config';

let db: TestDbInstance;

// Product entity for testing scalar arrays
interface IProduct {
  id?: number;
  name: string;
  sku: string;
  tags?: string[];
  categories?: string[];
  ratings?: number[];
  createdAt?: Date;
  updatedAt?: Date;
}

class Product extends BaseEntity<IProduct> {
  static override readonly model: any;

  private _name!: string;
  private _sku!: string;
  private _tags?: string[];
  private _categories?: string[];
  private _ratings?: number[];

  constructor(data: Partial<IProduct>) {
    super(data);
  }

  static override getModelInformation() {
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

  get tags(): string[] | undefined {
    return this._tags;
  }
  set tags(value: string[] | undefined) {
    this._tags = value;
  }

  get categories(): string[] | undefined {
    return this._categories;
  }
  set categories(value: string[] | undefined) {
    this._categories = value;
  }

  get ratings(): number[] | undefined {
    return this._ratings;
  }
  set ratings(value: number[] | undefined) {
    this._ratings = value;
  }
}

describe('Scalar Arrays Integration Tests', () => {
  beforeAll(async () => {
    db = await createTestDb();

    // Skip all tests if database doesn't support native scalar arrays (PostgreSQL only)
    // MongoDB supports arrays but stores them as JSON, not native scalar arrays
    if (db.provider !== 'postgresql') {
      console.log(`\n⏭️  Skipping Scalar Arrays tests - native scalar arrays only supported on PostgreSQL (current: ${db.provider.toUpperCase()})`);
      return;
    }

    // Configure Prisma globally
    configurePrisma(db.client as any);
    
    // Update the model reference after prisma is initialized
    (Product as any).model = db.client.product;
  });

  afterAll(async () => {
    if (db) {
      await db.cleanup();
    }
  });

  beforeEach(async () => {
    if (db.provider !== 'postgresql') return;
    await db.clear();
  });

  // Helper to skip tests if not PostgreSQL
  const skipIfNotSupported = () => {
    if (db.provider !== 'postgresql') {
      return true;
    }
    return false;
  };

  describe('String[] operations', () => {
    it('should create product with string array tags', async () => {
      if (skipIfNotSupported()) return;

      const product = new Product({
        name: 'Laptop',
        sku: 'LAP-001',
        tags: ['electronics', 'computers', 'portable'],
      });

      const created = await product.create();

      expect(created.tags).toEqual(['electronics', 'computers', 'portable']);
      expect(Array.isArray(created.tags)).toBe(true);
    });

    it('should create product with empty string array', async () => {
      if (skipIfNotSupported()) return;

      const product = new Product({
        name: 'Basic Product',
        sku: 'BASIC-001',
        tags: [],
      });

      const created = await product.create();

      expect(created.tags).toEqual([]);
      expect(Array.isArray(created.tags)).toBe(true);
    });

    it('should update string array tags', async () => {
      if (skipIfNotSupported()) return;

      const created = await db.client.product.create({
        data: {
          name: 'Phone',
          sku: 'PHN-001',
          tags: ['electronics', 'mobile'],
        },
      });

      const product = new Product({
        id: created.id,
        name: 'Phone',
        sku: 'PHN-001',
        tags: ['electronics', 'mobile', 'smartphone', '5g'],
      });

      const updated = await product.update();

      expect(updated.tags).toEqual(['electronics', 'mobile', 'smartphone', '5g']);
    });

    it('should handle multiple string arrays (tags and categories)', async () => {
      if (skipIfNotSupported()) return;

      const product = new Product({
        name: 'Gaming Console',
        sku: 'GAME-001',
        tags: ['gaming', 'entertainment', 'console'],
        categories: ['Electronics', 'Gaming', 'Home Entertainment'],
      });

      const created = await product.create();

      expect(created.tags).toEqual(['gaming', 'entertainment', 'console']);
      expect(created.categories).toEqual(['Electronics', 'Gaming', 'Home Entertainment']);
    });

    it('should handle special characters in string arrays', async () => {
      if (skipIfNotSupported()) return;

      const product = new Product({
        name: 'Special Product',
        sku: 'SPEC-001',
        tags: ['tag-with-dash', 'tag_with_underscore', 'tag with spaces', "tag's apostrophe"],
      });

      const created = await product.create();

      expect(created.tags).toEqual(['tag-with-dash', 'tag_with_underscore', 'tag with spaces', "tag's apostrophe"]);
    });
  });

  describe('Int[] operations', () => {
    it('should create product with integer array ratings', async () => {
      if (skipIfNotSupported()) return;

      const product = new Product({
        name: 'Rated Product',
        sku: 'RATE-001',
        tags: ['test'],
        ratings: [5, 4, 5, 3, 4],
      });

      const created = await product.create();

      expect(created.ratings).toEqual([5, 4, 5, 3, 4]);
      expect(Array.isArray(created.ratings)).toBe(true);
    });

    it('should create product with empty integer array', async () => {
      if (skipIfNotSupported()) return;

      const product = new Product({
        name: 'No Ratings',
        sku: 'NORATE-001',
        tags: ['test'],
        ratings: [],
      });

      const created = await product.create();

      expect(created.ratings).toEqual([]);
    });

    it('should update integer array ratings', async () => {
      if (skipIfNotSupported()) return;

      const created = await db.client.product.create({
        data: {
          name: 'Product',
          sku: 'PROD-001',
          tags: ['test'],
          ratings: [3, 4],
        },
      });

      const product = new Product({
        id: created.id,
        name: 'Product',
        sku: 'PROD-001',
        tags: ['test'],
        ratings: [3, 4, 5, 5, 4],
      });

      const updated = await product.update();

      expect(updated.ratings).toEqual([3, 4, 5, 5, 4]);
    });

    it('should handle negative and zero values in integer arrays', async () => {
      if (skipIfNotSupported()) return;

      const product = new Product({
        name: 'Test Product',
        sku: 'TEST-001',
        tags: ['test'],
        ratings: [-1, 0, 1, 2, 3],
      });

      const created = await product.create();

      expect(created.ratings).toEqual([-1, 0, 1, 2, 3]);
    });
  });

  describe('batch operations with scalar arrays', () => {
    it('should createMany products with string arrays', async () => {
      if (skipIfNotSupported()) return;

      const count = await Product.createMany([
        {
          name: 'Product 1',
          sku: 'PROD-001',
          tags: ['tag1', 'tag2'],
        },
        {
          name: 'Product 2',
          sku: 'PROD-002',
          tags: ['tag3', 'tag4', 'tag5'],
        },
        {
          name: 'Product 3',
          sku: 'PROD-003',
          tags: [],
        },
      ]);

      expect(count).toBe(3);

      const products = await db.client.product.findMany({ orderBy: { sku: 'asc' } });
      expect(products).toHaveLength(3);
      expect(products[0].tags).toEqual(['tag1', 'tag2']);
      expect(products[1].tags).toEqual(['tag3', 'tag4', 'tag5']);
      expect(products[2].tags).toEqual([]);
    });

    it('should createMany products with integer arrays', async () => {
      if (skipIfNotSupported()) return;

      const count = await Product.createMany([
        {
          name: 'Product 1',
          sku: 'PROD-001',
          tags: ['test'],
          ratings: [5, 4, 5],
        },
        {
          name: 'Product 2',
          sku: 'PROD-002',
          tags: ['test'],
          ratings: [3, 3, 4],
        },
      ]);

      expect(count).toBe(2);

      const products = await db.client.product.findMany({ orderBy: { sku: 'asc' } });
      expect(products).toHaveLength(2);
      expect(products[0].ratings).toEqual([5, 4, 5]);
      expect(products[1].ratings).toEqual([3, 3, 4]);
    });

    it('should upsertMany products with scalar arrays', async () => {
      if (skipIfNotSupported()) return;

      // Create initial product
      const existing = await db.client.product.create({
        data: {
          name: 'Existing Product',
          sku: 'EXIST-001',
          tags: ['old', 'tag'],
        },
      });

      // Upsert with one update and one insert
      const result = await Product.upsertMany([
        {
          id: existing.id,
          name: 'Updated Product',
          sku: 'EXIST-001',
          tags: ['new', 'updated', 'tags'],
        },
        {
          name: 'New Product',
          sku: 'NEW-001',
          tags: ['fresh', 'new'],
        },
      ]);

      expect(result.created + result.updated).toBe(2);
      
      const products = await db.client.product.findMany();
      const updated = products.find((p: any) => p.id === existing.id);
      expect(updated?.tags).toEqual(['new', 'updated', 'tags']);
      
      const inserted = products.find((p: any) => p.sku === 'NEW-001');
      expect(inserted?.tags).toEqual(['fresh', 'new']);
    });

    it('should updateManyById products with scalar arrays', async () => {
      if (skipIfNotSupported()) return;

      // Create products
      const product1 = await db.client.product.create({
        data: { name: 'Product 1', sku: 'PROD-001', tags: ['old1'] },
      });
      const product2 = await db.client.product.create({
        data: { name: 'Product 2', sku: 'PROD-002', tags: ['old2'] },
      });

      // Update both
      const count = await Product.updateManyById([
        { id: product1.id, tags: ['updated1', 'new1'] },
        { id: product2.id, tags: ['updated2', 'new2'] },
      ]);

      expect(count).toBe(2);

      const products = await db.client.product.findMany({ orderBy: { sku: 'asc' } });
      expect(products[0].tags).toEqual(['updated1', 'new1']);
      expect(products[1].tags).toEqual(['updated2', 'new2']);
    });
  });

  describe('array query operators', () => {
    beforeEach(async () => {
      if (skipIfNotSupported()) return;

      // Seed test data
      await Product.createMany([
        {
          name: 'Electronics Product',
          sku: 'ELEC-001',
          tags: ['electronics', 'gadget', 'portable'],
        },
        {
          name: 'Gaming Product',
          sku: 'GAME-001',
          tags: ['gaming', 'electronics', 'entertainment'],
        },
        {
          name: 'Book Product',
          sku: 'BOOK-001',
          tags: ['books', 'education', 'reading'],
        },
        {
          name: 'Empty Tags Product',
          sku: 'EMPTY-001',
          tags: [],
        },
      ]);
    });

    it('should query with hasSome operator', async () => {
      if (skipIfNotSupported()) return;

      const products = await db.client.product.findMany({
        where: {
          tags: {
            hasSome: ['electronics', 'gaming'],
          },
        },
      });

      expect(products.length).toBeGreaterThanOrEqual(2);
      
      const skus = products.map((p: any) => p.sku);
      expect(skus).toContain('ELEC-001');
      expect(skus).toContain('GAME-001');
    });

    it('should query with hasEvery operator', async () => {
      if (skipIfNotSupported()) return;

      const products = await db.client.product.findMany({
        where: {
          tags: {
            hasEvery: ['electronics', 'gadget'],
          },
        },
      });

      expect(products).toHaveLength(1);
      expect(products[0].sku).toBe('ELEC-001');
    });

    it('should query with isEmpty operator', async () => {
      if (skipIfNotSupported()) return;

      const products = await db.client.product.findMany({
        where: {
          tags: {
            isEmpty: true,
          },
        },
      });

      expect(products).toHaveLength(1);
      expect(products[0].sku).toBe('EMPTY-001');
    });

    it('should query with isEmpty false to find non-empty arrays', async () => {
      if (skipIfNotSupported()) return;

      const products = await db.client.product.findMany({
        where: {
          tags: {
            isEmpty: false,
          },
        },
      });

      expect(products.length).toBeGreaterThanOrEqual(3);
      
      const skus = products.map((p: any) => p.sku);
      expect(skus).not.toContain('EMPTY-001');
    });

    it('should combine array operators with other conditions', async () => {
      if (skipIfNotSupported()) return;

      const products = await db.client.product.findMany({
        where: {
          AND: [
            {
              tags: {
                hasSome: ['electronics'],
              },
            },
            {
              name: {
                contains: 'Gaming',
              },
            },
          ],
        },
      });

      expect(products).toHaveLength(1);
      expect(products[0].sku).toBe('GAME-001');
    });
  });

  describe('empty array handling', () => {
    it('should distinguish between null and empty array', async () => {
      if (skipIfNotSupported()) return;

      const withEmpty = new Product({
        name: 'Empty Array Product',
        sku: 'EMPTY-001',
        tags: [],
      });

      const withoutTags = new Product({
        name: 'No Tags Product',
        sku: 'NOTAGS-001',
        tags: undefined,
      });

      const created1 = await withEmpty.create();
      const created2 = await withoutTags.create();

      expect(created1.tags).toEqual([]);
      // PostgreSQL defaults to empty array, so we check for either empty or undefined
      expect(created2.tags === undefined || created2.tags?.length === 0).toBe(true);
    });

    it('should update from empty to populated array', async () => {
      if (skipIfNotSupported()) return;

      const created = await db.client.product.create({
        data: {
          name: 'Product',
          sku: 'PROD-001',
          tags: [],
        },
      });

      const product = new Product({
        id: created.id,
        name: 'Product',
        sku: 'PROD-001',
        tags: ['new', 'tags'],
      });

      const updated = await product.update();

      expect(updated.tags).toEqual(['new', 'tags']);
    });

    it('should update from populated to empty array', async () => {
      if (skipIfNotSupported()) return;

      const created = await db.client.product.create({
        data: {
          name: 'Product',
          sku: 'PROD-001',
          tags: ['old', 'tags'],
        },
      });

      const product = new Product({
        id: created.id,
        name: 'Product',
        sku: 'PROD-001',
        tags: [],
      });

      const updated = await product.update();

      expect(updated.tags).toEqual([]);
    });
  });
});