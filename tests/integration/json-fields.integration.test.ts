/**
 * Unified JSON Fields Integration Test Suite
 * Tests JSON field operations across all databases that support JSON
 * Runs on: MySQL, PostgreSQL, MongoDB
 * Skipped on: SQLite (no JSON support)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/base-entity';
import { createTestDb, type TestDbInstance } from '../helpers/test-db';
import { configurePrisma } from '../../src/config';

let db: TestDbInstance;

interface IProduct {
  id?: number | string;
  name: string;
  sku: string;
  tags?: any;
  metadata?: any;
  settings?: any;
  createdAt?: Date;
  updatedAt?: Date;
}

class Product extends BaseEntity<IProduct> {
  static override readonly model: any;

  private _name!: string;
  private _sku!: string;
  private _tags?: any;
  private _metadata?: any;
  private _settings?: any;

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

  get tags(): any {
    return this._tags;
  }
  set tags(value: any) {
    this._tags = value;
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

describe('JSON Fields Integration Tests', () => {
  beforeAll(async () => {
    db = await createTestDb();
    
    // Skip entire suite if JSON is not supported
    if (!db.capabilities.supportsJSON) {
      console.log(`⏭️  Skipping JSON field tests - not supported on ${db.provider}`);
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
    // Skip if JSON not supported
    if (!db.capabilities.supportsJSON) {
      return;
    }
    
    // Clean up products before each test
    if (db.client.product) {
      await db.client.product.deleteMany();
    }
  });

  describe('create operations with JSON data', () => {
    it('should create entity with JSON metadata', async () => {
      if (!db.capabilities.supportsJSON) return;

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
      const dbProduct = await db.client.product.findUnique({ where: { id: created.id } });
      expect(dbProduct?.metadata).toEqual(created.metadata);
    });

    it('should create entity with multiple JSON fields', async () => {
      if (!db.capabilities.supportsJSON) return;

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
      if (!db.capabilities.supportsJSON) return;

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

  describe('update operations with JSON data', () => {
    it('should update JSON field correctly', async () => {
      if (!db.capabilities.supportsJSON) return;

      // Create initial product
      const created = await db.client.product.create({
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
      const dbProduct = await db.client.product.findUnique({ where: { id: created.id } });
      expect(dbProduct?.metadata).toEqual({ version: 2, status: 'published', author: 'John' });
    });

    it('should update nested JSON objects', async () => {
      if (!db.capabilities.supportsJSON) return;

      const created = await db.client.product.create({
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

  describe('batch operations with JSON fields', () => {
    describe('createMany', () => {
      it('should create many entities with JSON', async () => {
        if (!db.capabilities.supportsJSON) return;

        const items = [
          { name: 'CreateMany 1', sku: 'CM-001', metadata: { index: 1 } },
          { name: 'CreateMany 2', sku: 'CM-002', metadata: { index: 2 } },
          { name: 'CreateMany 3', sku: 'CM-003', metadata: { index: 3 } }
        ];

        const count = await Product.createMany(items);

        expect(count).toBe(3);

        const products = await db.client.product.findMany({ orderBy: { sku: 'asc' } });
        expect(products).toHaveLength(3);
        expect(products[0].metadata).toEqual({ index: 1 });
        expect(products[1].metadata).toEqual({ index: 2 });
        expect(products[2].metadata).toEqual({ index: 3 });
      });
    });

    describe('upsertMany', () => {
      it('should create multiple entities with JSON', async () => {
        if (!db.capabilities.supportsJSON) return;

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
        const products = await db.client.product.findMany({ orderBy: { sku: 'asc' } });
        expect(products[0].metadata).toEqual({ batch: 1, type: 'A' });
        expect(products[1].metadata).toEqual({ batch: 2, type: 'B' });
        expect(products[2].metadata).toEqual({ batch: 3, type: 'C' });
      });

      it('should update entities with JSON changes', async () => {
        if (!db.capabilities.supportsJSON) return;

        // Create initial products
        await db.client.product.createMany({
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

        // Verify in database
        const product1 = await db.client.product.findUnique({ where: { sku: 'UPDATE-BATCH-001' } });
        const product2 = await db.client.product.findUnique({ where: { sku: 'UPDATE-BATCH-002' } });

        expect(product1.name).toBe('Update 1 Modified');
        expect(product1.metadata).toEqual({ version: 2, modified: true });
        expect(product2.name).toBe('Update 2 Modified');
        expect(product2.metadata).toEqual({ version: 2, modified: true });
      });

      it('should handle complex nested JSON in batch', async () => {
        if (!db.capabilities.supportsJSON) return;

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

        const products = await db.client.product.findMany({ orderBy: { sku: 'asc' } });
        expect(products[0].metadata.product.features).toEqual(['5G', 'waterproof', 'wireless charging']);
        expect(products[1].settings.display.resolution).toBe('1920x1080');
      });
    });

    describe('updateManyById', () => {
      it('should update multiple entities with JSON using raw SQL', async () => {
        if (!db.capabilities.supportsJSON) return;

        // Create test products
        const created1 = await db.client.product.create({
          data: { name: 'Product 1', sku: 'RAW-001', metadata: { version: 1 } }
        });
        const created2 = await db.client.product.create({
          data: { name: 'Product 2', sku: 'RAW-002', metadata: { version: 1 } }
        });

        // Update using updateManyById (uses raw SQL with CASE WHEN)
        const updates = [
          {
            id: created1.id,
            name: 'Product 1 Updated',
            metadata: { version: 2, updated: true }
          },
          {
            id: created2.id,
            name: 'Product 2 Updated',
            metadata: { version: 2, updated: true }
          }
        ];

        const updated = await Product.updateManyById(updates);

        expect(updated).toBe(2);

        // Verify JSON was properly escaped and stored
        const product1 = await db.client.product.findUnique({ where: { id: created1.id } });
        const product2 = await db.client.product.findUnique({ where: { id: created2.id } });

        expect(product1.metadata).toEqual({ version: 2, updated: true });
        expect(product2.metadata).toEqual({ version: 2, updated: true });
      });
    });
  });

  describe('special character handling', () => {
    it('should handle JSON with quotes', async () => {
      if (!db.capabilities.supportsJSON) return;

      const product = new Product({
        name: 'Quotes Product',
        sku: 'QUOTES-001',
        metadata: {
          description: "Product with 'single quotes' and \"double quotes\"",
          mixed: "It's a \"great\" product"
        }
      });

      const created = await product.create();

      expect(created.metadata.description).toBe("Product with 'single quotes' and \"double quotes\"");
      expect(created.metadata.mixed).toBe("It's a \"great\" product");

      // Verify in database
      const dbProduct = await db.client.product.findUnique({ where: { id: created.id } });
      expect(dbProduct?.metadata.description).toBe("Product with 'single quotes' and \"double quotes\"");
    });

    it('should handle JSON with backslashes', async () => {
      if (!db.capabilities.supportsJSON) return;

      const product = new Product({
        name: 'Backslash Product',
        sku: 'BACKSLASH-001',
        metadata: {
          path: "C:\\Users\\Test\\file.txt",
          windowsPath: "D:\\Program Files\\App\\config.json",
          regex: "\\d+\\.\\d+"
        }
      });

      const created = await product.create();

      expect(created.metadata.path).toBe("C:\\Users\\Test\\file.txt");
      expect(created.metadata.windowsPath).toBe("D:\\Program Files\\App\\config.json");
      expect(created.metadata.regex).toBe("\\d+\\.\\d+");
    });

    it('should handle JSON with unicode characters', async () => {
      if (!db.capabilities.supportsJSON) return;

      const product = new Product({
        name: 'Unicode Product',
        sku: 'UNICODE-001',
        metadata: {
          greeting: "Hello 世界 🌍",
          emoji: "🚀 🎉 ✨",
          multilang: {
            en: "Hello",
            zh: "你好",
            ja: "こんにちは",
            ar: "مرحبا"
          }
        }
      });

      const created = await product.create();

      expect(created.metadata.greeting).toBe("Hello 世界 🌍");
      expect(created.metadata.emoji).toBe("🚀 🎉 ✨");
      expect(created.metadata.multilang.zh).toBe("你好");
    });

    it('should handle JSON with escape sequences', async () => {
      if (!db.capabilities.supportsJSON) return;

      const product = new Product({
        name: 'Escape Product',
        sku: 'ESCAPE-001',
        metadata: {
          newlines: "Line1\nLine2\nLine3",
          tabs: "Col1\tCol2\tCol3",
          mixed: "Text with\nnewlines and\ttabs"
        }
      });

      const created = await product.create();

      expect(created.metadata.newlines).toBe("Line1\nLine2\nLine3");
      expect(created.metadata.tabs).toBe("Col1\tCol2\tCol3");
      expect(created.metadata.mixed).toBe("Text with\nnewlines and\ttabs");
    });

    it('should handle special characters in batch operations', async () => {
      if (!db.capabilities.supportsJSON) return;

      const items = [
        {
          name: 'Batch Special 1',
          sku: 'BATCH-SPECIAL-001',
          metadata: { text: "with 'quotes'", path: "C:\\test" }
        },
        {
          name: 'Batch Special 2',
          sku: 'BATCH-SPECIAL-002',
          metadata: { unicode: "Hello 世界", emoji: "🎉" }
        },
        {
          name: 'Batch Special 3',
          sku: 'BATCH-SPECIAL-003',
          metadata: { escape: "Line1\nLine2\tTabbed" }
        }
      ];

      const result = await Product.upsertMany(items);

      expect(result.created).toBe(3);

      const products = await db.client.product.findMany({ orderBy: { sku: 'asc' } });
      expect(products[0].metadata.text).toBe("with 'quotes'");
      expect(products[1].metadata.unicode).toBe("Hello 世界");
      expect(products[2].metadata.escape).toBe("Line1\nLine2\tTabbed");
    });

    it('should handle special characters in updateManyById', async () => {
      if (!db.capabilities.supportsJSON) return;

      // Create test products
      const created1 = await db.client.product.create({
        data: { name: 'Product 1', sku: 'SPECIAL-UPDATE-001', metadata: { text: 'original' } }
      });
      const created2 = await db.client.product.create({
        data: { name: 'Product 2', sku: 'SPECIAL-UPDATE-002', metadata: { text: 'original' } }
      });

      // Update with special characters
      const updates = [
        {
          id: created1.id,
          name: 'Product 1 Updated',
          metadata: { text: "with 'quotes'", path: "C:\\Program Files" }
        },
        {
          id: created2.id,
          name: 'Product 2 Updated',
          metadata: { unicode: "Hello 世界 🌍", escape: "Line1\nLine2" }
        }
      ];

      const updated = await Product.updateManyById(updates);

      expect(updated).toBe(2);

      const product1 = await db.client.product.findUnique({ where: { id: created1.id } });
      const product2 = await db.client.product.findUnique({ where: { id: created2.id } });

      expect(product1.metadata.text).toBe("with 'quotes'");
      expect(product1.metadata.path).toBe("C:\\Program Files");
      expect(product2.metadata.unicode).toBe("Hello 世界 🌍");
      expect(product2.metadata.escape).toBe("Line1\nLine2");
    });
  });

  describe('nested JSON objects and arrays', () => {
    it('should handle deeply nested JSON objects', async () => {
      if (!db.capabilities.supportsJSON) return;

      const product = new Product({
        name: 'Deep Nested',
        sku: 'DEEP-001',
        metadata: {
          level1: {
            level2: {
              level3: {
                level4: {
                  value: 'deep value',
                  array: [1, 2, 3]
                }
              }
            }
          }
        }
      });

      const created = await product.create();

      expect(created.metadata.level1.level2.level3.level4.value).toBe('deep value');
      expect(created.metadata.level1.level2.level3.level4.array).toEqual([1, 2, 3]);
    });

    it('should handle JSON arrays with objects', async () => {
      if (!db.capabilities.supportsJSON) return;

      const product = new Product({
        name: 'Array Objects',
        sku: 'ARRAY-OBJ-001',
        metadata: {
          items: [
            { id: 1, name: 'Item 1', active: true },
            { id: 2, name: 'Item 2', active: false },
            { id: 3, name: 'Item 3', active: true }
          ]
        }
      });

      const created = await product.create();

      expect(created.metadata.items).toHaveLength(3);
      expect(created.metadata.items[0]).toEqual({ id: 1, name: 'Item 1', active: true });
      expect(created.metadata.items[2].name).toBe('Item 3');
    });

    it('should handle mixed arrays (primitives and objects)', async () => {
      if (!db.capabilities.supportsJSON) return;

      const product = new Product({
        name: 'Mixed Arrays',
        sku: 'MIXED-ARRAY-001',
        metadata: {
          numbers: [1, 2, 3, 4, 5],
          strings: ['a', 'b', 'c'],
          booleans: [true, false, true],
          mixed: [1, 'text', true, { key: 'value' }, [1, 2, 3]]
        }
      });

      const created = await product.create();

      expect(created.metadata.numbers).toEqual([1, 2, 3, 4, 5]);
      expect(created.metadata.strings).toEqual(['a', 'b', 'c']);
      expect(created.metadata.booleans).toEqual([true, false, true]);
      expect(created.metadata.mixed).toHaveLength(5);
      expect(created.metadata.mixed[3]).toEqual({ key: 'value' });
    });

    it('should handle empty arrays and objects', async () => {
      if (!db.capabilities.supportsJSON) return;

      const product = new Product({
        name: 'Empty Structures',
        sku: 'EMPTY-001',
        metadata: {
          emptyArray: [],
          emptyObject: {},
          nested: {
            emptyArray: [],
            emptyObject: {}
          }
        }
      });

      const created = await product.create();

      expect(created.metadata.emptyArray).toEqual([]);
      expect(created.metadata.emptyObject).toEqual({});
      expect(created.metadata.nested.emptyArray).toEqual([]);
      expect(created.metadata.nested.emptyObject).toEqual({});
    });
  });

  describe('JSON field escaping in raw SQL queries', () => {
    it('should properly escape JSON in raw SQL updates', async () => {
      if (!db.capabilities.supportsJSON) return;

      // Create initial product
      const created = await db.client.product.create({
        data: { name: 'SQL Escape Test', sku: 'SQL-ESCAPE-001', metadata: { version: 1 } }
      });

      // Update with complex JSON that requires escaping
      const updates = [
        {
          id: created.id,
          name: 'SQL Escape Test Updated',
          metadata: {
            description: "Text with 'quotes' and \"double quotes\"",
            path: "C:\\Program Files\\App",
            sql: "SELECT * FROM users WHERE name = 'John'",
            json: { nested: "value with \"quotes\"" }
          }
        }
      ];

      const updated = await Product.updateManyById(updates);

      expect(updated).toBe(1);

      // Verify the data was stored correctly
      const product = await db.client.product.findUnique({ where: { id: created.id } });
      expect(product.metadata.description).toBe("Text with 'quotes' and \"double quotes\"");
      expect(product.metadata.path).toBe("C:\\Program Files\\App");
      expect(product.metadata.sql).toBe("SELECT * FROM users WHERE name = 'John'");
      expect(product.metadata.json.nested).toBe("value with \"quotes\"");
    });

    it('should handle JSON arrays in raw SQL', async () => {
      if (!db.capabilities.supportsJSON) return;

      const created = await db.client.product.create({
        data: { name: 'Array SQL', sku: 'ARRAY-SQL-001', tags: ['old'] }
      });

      const updates = [
        {
          id: created.id,
          name: 'Array SQL Updated',
          tags: ['new', 'updated', 'with spaces', "with 'quotes'"]
        }
      ];

      const updated = await Product.updateManyById(updates);

      expect(updated).toBe(1);

      const product = await db.client.product.findUnique({ where: { id: created.id } });
      
      // For MySQL, tags is stored as JSON array
      // For PostgreSQL, tags is a native String[] array
      if (db.provider === 'mysql') {
        expect(product.tags).toEqual(['new', 'updated', 'with spaces', "with 'quotes'"]);
      } else if (db.provider === 'postgresql') {
        // PostgreSQL has native array support, tested in scalar-arrays suite
        // This test focuses on JSON fields
      }
    });

    it('should handle complex nested structures in batch updates', async () => {
      if (!db.capabilities.supportsJSON) return;

      // Create initial
      await db.client.product.create({
        data: {
          name: 'Complex',
          sku: 'COMPLEX-SQL-001',
          metadata: { simple: 'value' }
        }
      });

      const items = [
        {
          name: 'Complex Updated',
          sku: 'COMPLEX-SQL-001',
          metadata: {
            product: {
              category: 'electronics',
              features: ['5G', 'waterproof', 'wireless charging']
            },
            pricing: {
              base: 999,
              discounts: [{ type: 'seasonal', amount: 50 }]
            },
            description: "Product with 'quotes' and backslashes: C:\\path\\to\\file"
          }
        }
      ];

      const result = await Product.upsertMany(items);

      expect(result.updated).toBe(1);

      const product = await db.client.product.findUnique({ where: { sku: 'COMPLEX-SQL-001' } });
      expect(product.metadata.product.features).toEqual(['5G', 'waterproof', 'wireless charging']);
      expect(product.metadata.description).toBe("Product with 'quotes' and backslashes: C:\\path\\to\\file");
    });
  });
});
