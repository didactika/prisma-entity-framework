/**
 * Integration tests for MongoDB embedded (composite) document filtering.
 *
 * A dotted path into a composite type must expand to Prisma's composite filter syntax: `is` for a
 * single embedded document, and the relation quantifier (`some` / `every` / `none`) for a list of
 * them. Only MongoDB has composite types, so the whole suite is guarded to that provider.
 *
 * Run with: npm run test:mongodb
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/core/base-entity';
import { Property } from '../../src/core/decorators/property.decorator';
import { configurePrisma, resetPrismaConfiguration } from '../../src/core/config';
import { createTestDb } from '../helpers/test-db';
import type { PrismaClient } from '@prisma/client';

interface IProduct {
  id?: number | string;
  name: string;
  sku: string;
  dimensions?: { width: number; height: number; label?: string | null } | null;
  specs?: Array<{ key: string; value: string }>;
}

class Product extends BaseEntity<IProduct> implements IProduct {
  static override readonly model: PrismaClient['product'];

  public declare readonly id?: IProduct['id'];

  @Property() declare name: IProduct['name'];
  @Property() declare sku: IProduct['sku'];
  @Property() declare dimensions: IProduct['dimensions'];
  @Property() declare specs: IProduct['specs'];

  constructor(data?: Partial<IProduct>) {
    super(data);
  }
}

describe('MongoDB embedded documents - Integration Tests', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let prisma: PrismaClient;
  let runsHere = false;

  beforeAll(async () => {
    db = await createTestDb();
    prisma = db.client;
    runsHere = db.provider === 'mongodb';

    if (!runsHere) {
      console.log(`⏭️  Skipping embedded-document tests (current: ${db.provider.toUpperCase()})`);
      return;
    }

    await db.clear();
    (Product as any).model = prisma.product;
    configurePrisma(prisma as any);
  }, 30000);

  afterAll(async () => {
    if (db) {
      await db.cleanup();
      resetPrismaConfiguration();
    }
  }, 30000);

  const seed = async () => {
    await (prisma as any).product.createMany({
      data: [
        {
          name: 'Uno', sku: 'SKU-1',
          dimensions: { width: 10, height: 5, label: 'small' },
          specs: [{ key: 'cpu', value: 'x86' }, { key: 'ram', value: '8GB' }]
        },
        {
          name: 'Dos', sku: 'SKU-2',
          dimensions: { width: 20, height: 15, label: 'large' },
          specs: [{ key: 'cpu', value: 'arm' }, { key: 'ram', value: '16GB' }]
        },
        {
          name: 'Tres', sku: 'SKU-3',
          dimensions: { width: 30, height: 25, label: null },
          specs: [{ key: 'cpu', value: 'x86' }]
        }
      ]
    });
  };

  beforeEach(async () => {
    if (!runsHere) return;
    await db.clear();
    await seed();
  });

  describe('single embedded document', () => {
    it('should filter by a subfield with a comparison', async () => {
      if (!runsHere) return;

      const products = await Product.findByFilter({}, {
        search: { field: 'dimensions.width', gte: 20 }
      }) as IProduct[];

      expect(products.map(p => p.name).sort()).toEqual(['Dos', 'Tres']);
    });

    it('should filter by a string subfield', async () => {
      if (!runsHere) return;

      const products = await Product.findByFilter({}, {
        search: { field: 'dimensions.label', equals: 'small' }
      }) as IProduct[];

      expect(products.map(p => p.name)).toEqual(['Uno']);
    });

    it('should filter a string subfield case-insensitively by default', async () => {
      if (!runsHere) return;

      const products = await Product.findByFilter({}, {
        search: { field: 'dimensions.label', like: 'LARGE' }
      }) as IProduct[];

      expect(products.map(p => p.name)).toEqual(['Dos']);
    });

    it('should combine two subfield conditions', async () => {
      if (!runsHere) return;

      const products = await Product.findByFilter({}, {
        search: {
          and: [
            { field: 'dimensions.width', gte: 20 },
            { field: 'dimensions.height', lte: 20 }
          ]
        }
      }) as IProduct[];

      expect(products.map(p => p.name)).toEqual(['Dos']);
    });

    it('should not choke on a required subfield range (implicit not:null)', async () => {
      if (!runsHere) return;

      // width is a required Int in the composite; the resolver adds not:null because it cannot
      // read the subfield's nullability. This must still return the right rows, not error.
      const products = await Product.findByFilter({}, {
        search: { field: 'dimensions.width', lte: 10 }
      }) as IProduct[];

      expect(products.map(p => p.name)).toEqual(['Uno']);
    });
  });

  describe('creating embedded documents', () => {
    it('should create a single embedded document in one call', async () => {
      if (!runsHere) return;

      const product = new Product({
        name: 'Nuevo',
        sku: 'SKU-NEW',
        dimensions: { width: 40, height: 30, label: 'xl' }
      });
      await product.create();

      const found = await Product.findByFilter({}, {
        search: { field: 'dimensions.label', equals: 'xl' }
      }) as IProduct[];

      expect(found).toHaveLength(1);
      expect(found[0].name).toBe('Nuevo');
      expect(found[0].dimensions).toMatchObject({ width: 40, height: 30, label: 'xl' });
    });

    it('should create a list of embedded documents in one call', async () => {
      if (!runsHere) return;

      const product = new Product({
        name: 'ConSpecs',
        sku: 'SKU-SPECS',
        specs: [{ key: 'cpu', value: 'risc' }, { key: 'gpu', value: 'nvidia' }]
      });
      await product.create();

      const found = await Product.findByFilter({}, {
        search: { field: 'specs.value', equals: 'risc' }
      }) as IProduct[];

      expect(found).toHaveLength(1);
      expect(found[0].specs).toHaveLength(2);
      expect(found[0].specs?.map(s => s.key).sort()).toEqual(['cpu', 'gpu']);
    });

    it('should create both a single and a list embedded document together', async () => {
      if (!runsHere) return;

      const product = new Product({
        name: 'Completo',
        sku: 'SKU-FULL',
        dimensions: { width: 1, height: 2, label: null },
        specs: [{ key: 'ram', value: '32GB' }]
      });
      await product.create();

      const found = await Product.findByFilter({ sku: 'SKU-FULL' }, {}) as IProduct[];

      expect(found).toHaveLength(1);
      expect(found[0].dimensions).toMatchObject({ width: 1, height: 2 });
      expect(found[0].specs).toEqual([{ key: 'ram', value: '32GB' }]);
    });
  });

  describe('list of embedded documents', () => {
    it('should match when at least one embedded doc qualifies (some, default)', async () => {
      if (!runsHere) return;

      const products = await Product.findByFilter({}, {
        search: { field: 'specs.value', equals: 'x86' }
      }) as IProduct[];

      expect(products.map(p => p.name).sort()).toEqual(['Tres', 'Uno']);
    });

    it('should match only when every embedded doc qualifies', async () => {
      if (!runsHere) return;

      // Tres has a single spec, cpu=x86, so every spec has value starting with 'x'
      const products = await Product.findByFilter({}, {
        search: { field: 'specs.value', startsWith: 'x', relation: 'every' }
      }) as IProduct[];

      expect(products.map(p => p.name)).toEqual(['Tres']);
    });

    it('should match only when no embedded doc qualifies', async () => {
      if (!runsHere) return;

      const products = await Product.findByFilter({}, {
        search: { field: 'specs.value', equals: 'arm', relation: 'none' }
      }) as IProduct[];

      // Dos has an arm spec; Uno and Tres do not
      expect(products.map(p => p.name).sort()).toEqual(['Tres', 'Uno']);
    });

    it('should filter by an embedded key and combine with a base filter', async () => {
      if (!runsHere) return;

      const products = await Product.findByFilter({}, {
        search: [
          { field: 'specs.key', equals: 'ram' },
          { field: 'specs.value', equals: '16GB' }
        ]
      }) as IProduct[];

      expect(products.map(p => p.name)).toEqual(['Dos']);
    });
  });
});
