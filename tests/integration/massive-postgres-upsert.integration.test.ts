import { describe, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
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
  createdAt?: Date;
  updatedAt?: Date;
}

class Product extends BaseEntity<IProduct> implements IProduct {
  static override readonly model: any;

  public declare readonly id?: IProduct['id'];

  @Property() declare name: IProduct['name'];
  @Property() declare sku: IProduct['sku'];
  @Property() declare price: IProduct['price'];

  constructor(data?: Partial<IProduct>) {
    super(data);
  }
}

describe('Massive PostgreSQL Upsert Integration', () => {
  beforeAll(async () => {
    db = await createTestDb();
    configurePrisma(db.client);
    (Product as any).model = db.client.product;
  });

  afterAll(async () => {
    if (db) {
      await db.cleanup();
    }
  });

  beforeEach(async () => {
    if (db?.provider === 'postgresql') {
      await db.client.product.deleteMany({});
    }
  });

  it('should return counts and ids for mixed create/update/unchanged on PostgreSQL', async () => {
    if (db.provider !== 'postgresql') {
      return;
    }

    await db.client.product.createMany({
      data: [
        { name: 'Existing A', sku: 'PG-STAGE-001', price: 10 },
        { name: 'Existing B', sku: 'PG-STAGE-002', price: 20 },
      ]
    });

    const result = await Product.upsertMany([
      { name: 'Existing A Updated', sku: 'PG-STAGE-001', price: 15 },
      { name: 'Existing B', sku: 'PG-STAGE-002', price: 20 },
      { name: 'New C', sku: 'PG-STAGE-003', price: 30 },
    ]);

    expect(result.counts).toEqual({
      created: 1,
      updated: 1,
      unchanged: 1,
      total: 3
    });
    expect(result.items.createdIds).toHaveLength(1);
    expect(result.items.updatedIds).toHaveLength(1);
    expect(result.items.unchangedIds).toHaveLength(1);

    const records = await db.client.product.findMany({ orderBy: { sku: 'asc' } });
    expect(records).toHaveLength(3);
    expect(records[0].name).toBe('Existing A Updated');
    expect(records[1].name).toBe('Existing B');
    expect(records[2].name).toBe('New C');
  });
});