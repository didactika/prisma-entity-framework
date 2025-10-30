/**
 * Integration tests for special field handling in MySQL
 * Tests JSON fields and proper JSON escaping in raw SQL queries
 * Ensures JSON fields are stored correctly without corruption
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/base-entity';
import { setupTestDatabase } from '../utils/test-db';
import { configurePrisma } from '../../src/config';
import type { PrismaClient as MySQLPrismaClient } from '../../node_modules/.prisma/client-mysql';

// Only run these tests when testing with MySQL
const isMySQL = process.env.DATABASE_URL?.includes('mysql');
const describeMySQL = isMySQL ? describe : describe.skip;

let prisma: MySQLPrismaClient;

interface IProduct {
    id?: number;
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

describeMySQL('MySQL - Special Fields Integration Tests', () => {
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

        it('should handle JSON with special characters', async () => {
            const product = new Product({
                name: 'Special Chars Product',
                sku: 'SPECIAL-001',
                metadata: {
                    description: "Product with 'quotes' and \"double quotes\"",
                    path: "C:\\Users\\Test\\file.txt",
                    unicode: "Hello 世界 🌍",
                    escaped: "Line1\nLine2\tTabbed"
                }
            });

            const created = await product.create();

            expect(created.metadata.description).toBe("Product with 'quotes' and \"double quotes\"");
            expect(created.metadata.path).toBe("C:\\Users\\Test\\file.txt");
            expect(created.metadata.unicode).toBe("Hello 世界 🌍");
            expect(created.metadata.escaped).toBe("Line1\nLine2\tTabbed");
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

        it('should update JSON with special characters', async () => {
            const created = await (prisma as any).product.create({
                data: {
                    name: 'Special Update',
                    sku: 'SPECIAL-UPDATE-001',
                    metadata: { text: 'original' }
                }
            });

            const product = new Product({
                id: created.id,
                name: 'Special Update',
                sku: 'SPECIAL-UPDATE-001',
                metadata: {
                    text: "Updated with 'quotes'",
                    path: "C:\\Program Files\\App",
                    json: { nested: "value with \"quotes\"" }
                }
            });

            const updated = await product.update();

            expect(updated.metadata.text).toBe("Updated with 'quotes'");
            expect(updated.metadata.path).toBe("C:\\Program Files\\App");
            expect(updated.metadata.json.nested).toBe("value with \"quotes\"");
        });
    });

    describe('upsertMany with JSON fields - MySQL specific', () => {
        it('should create multiple products with JSON', async () => {
            const items = [
                {
                    name: 'Batch 1',
                    sku: 'BATCH-001',
                    metadata: { batch: 1, type: 'A', special: "with 'quotes'" }
                },
                {
                    name: 'Batch 2',
                    sku: 'BATCH-002',
                    metadata: { batch: 2, type: 'B', path: "C:\\test" }
                },
                {
                    name: 'Batch 3',
                    sku: 'BATCH-003',
                    metadata: { batch: 3, type: 'C', unicode: "Hello 世界" }
                }
            ];

            const result = await Product.upsertMany(items);

            expect(result.created).toBe(3);
            expect(result.updated).toBe(0);
            expect(result.unchanged).toBe(0);

            // Verify in database
            const products = await (prisma as any).product.findMany({ orderBy: { sku: 'asc' } });
            expect(products[0].metadata).toEqual({ batch: 1, type: 'A', special: "with 'quotes'" });
            expect(products[1].metadata).toEqual({ batch: 2, type: 'B', path: "C:\\test" });
            expect(products[2].metadata).toEqual({ batch: 3, type: 'C', unicode: "Hello 世界" });
        });

        it('should update products with JSON changes using raw SQL', async () => {
            // Create initial products
            await (prisma as any).product.createMany({
                data: [
                    { name: 'Update 1', sku: 'UPDATE-BATCH-001', metadata: { version: 1 } },
                    { name: 'Update 2', sku: 'UPDATE-BATCH-002', metadata: { version: 1 } }
                ]
            });

            // Upsert with updated JSON (this uses updateManyById with raw SQL)
            const items = [
                {
                    name: 'Update 1 Modified',
                    sku: 'UPDATE-BATCH-001',
                    metadata: { version: 2, modified: true, text: "with 'quotes'" }
                },
                {
                    name: 'Update 2 Modified',
                    sku: 'UPDATE-BATCH-002',
                    metadata: { version: 2, modified: true, path: "C:\\Program Files" }
                }
            ];

            const result = await Product.upsertMany(items);

            expect(result.created).toBe(0);
            expect(result.updated).toBe(2);
            expect(result.unchanged).toBe(0);

            // Verify in database - this is the critical test for JSON escaping
            const product1 = await (prisma as any).product.findUnique({ where: { sku: 'UPDATE-BATCH-001' } });
            const product2 = await (prisma as any).product.findUnique({ where: { sku: 'UPDATE-BATCH-002' } });

            expect(product1.name).toBe('Update 1 Modified');
            expect(product1.metadata).toEqual({ version: 2, modified: true, text: "with 'quotes'" });
            expect(product2.name).toBe('Update 2 Modified');
            expect(product2.metadata).toEqual({ version: 2, modified: true, path: "C:\\Program Files" });
        });

        it('should handle complex nested JSON in batch updates', async () => {
            // Create initial
            await (prisma as any).product.create({
                data: {
                    name: 'Complex',
                    sku: 'COMPLEX-001',
                    metadata: { simple: 'value' }
                }
            });

            const items = [
                {
                    name: 'Complex Updated',
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
                        },
                        description: "Product with 'quotes' and backslashes: C:\\path\\to\\file"
                    }
                }
            ];

            const result = await Product.upsertMany(items);

            expect(result.updated).toBe(1);

            const product = await (prisma as any).product.findUnique({ where: { sku: 'COMPLEX-001' } });
            expect(product.metadata.product.features).toEqual(['5G', 'waterproof', 'wireless charging']);
            expect(product.metadata.description).toBe("Product with 'quotes' and backslashes: C:\\path\\to\\file");
        });

        it('should handle JSON arrays in batch updates', async () => {
            await (prisma as any).product.create({
                data: {
                    name: 'Array Test',
                    sku: 'ARRAY-001',
                    tags: ['old', 'tag']
                }
            });

            const items = [
                {
                    name: 'Array Test Updated',
                    sku: 'ARRAY-001',
                    tags: ['new', 'updated', 'with spaces', "with 'quotes'"]
                }
            ];

            const result = await Product.upsertMany(items);

            expect(result.updated).toBe(1);

            const product = await (prisma as any).product.findUnique({ where: { sku: 'ARRAY-001' } });
            expect(product.tags).toEqual(['new', 'updated', 'with spaces', "with 'quotes'"]);
        });
    });

    describe('updateManyById with JSON fields - Raw SQL', () => {
        it('should update multiple products with JSON using raw SQL', async () => {
            // Create test products
            const created1 = await (prisma as any).product.create({
                data: { name: 'Product 1', sku: 'RAW-001', metadata: { version: 1 } }
            });
            const created2 = await (prisma as any).product.create({
                data: { name: 'Product 2', sku: 'RAW-002', metadata: { version: 1 } }
            });

            // Update using updateManyById (uses raw SQL with CASE WHEN)
            const updates = [
                {
                    id: created1.id,
                    name: 'Product 1 Updated',
                    metadata: { version: 2, text: "with 'quotes'", path: "C:\\test" }
                },
                {
                    id: created2.id,
                    name: 'Product 2 Updated',
                    metadata: { version: 2, unicode: "Hello 世界 🌍" }
                }
            ];

            const updated = await Product.updateManyById(updates);

            expect(updated).toBe(2);

            // Verify JSON was properly escaped and stored
            const product1 = await (prisma as any).product.findUnique({ where: { id: created1.id } });
            const product2 = await (prisma as any).product.findUnique({ where: { id: created2.id } });

            expect(product1.metadata).toEqual({ version: 2, text: "with 'quotes'", path: "C:\\test" });
            expect(product2.metadata).toEqual({ version: 2, unicode: "Hello 世界 🌍" });
        });
    });
});
