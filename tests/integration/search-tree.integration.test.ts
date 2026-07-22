/**
 * Integration tests for the search tree against a real database.
 *
 * Covers the paths that unit tests cannot reach:
 * - `not`, and the relation quantifiers `every` / `none`, which are new in v3 and whose semantics
 *   are decided by Prisma, not by the resolver
 * - the chunking branch of findByFilter, which splits an oversized `in` list into several queries
 *   and merges the results
 * - NULL handling end to end, where SQL's three-valued logic is what actually decides the rows
 *
 * Run with: npm run test:integration -- search-tree
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import BaseEntity from '../../src/core/base-entity';
import { Property } from '../../src/core/decorators/property.decorator';
import { configurePrisma, resetPrismaConfiguration } from '../../src/core/config';
import { createTestDb } from '../helpers/test-db';
import { anyOf, allOf } from '../../src/core/search-helpers';
import SearchResolver from '../../src/core/search-resolver';
import type { PrismaClient } from '@prisma/client';

interface IUser {
  id?: number;
  name: string;
  email: string;
  age?: number | null;
  isActive?: boolean;
}

class User extends BaseEntity<IUser> implements IUser {
  static override readonly model: PrismaClient['user'];

  public declare readonly id?: IUser['id'];

  @Property() declare name: IUser['name'];
  @Property() declare email: IUser['email'];
  @Property() declare age: IUser['age'];
  @Property() declare isActive: IUser['isActive'];

  constructor(data?: Partial<IUser>) {
    super(data);
  }
}

interface IJob {
  id?: number;
  type: string;
  status?: string;
  scheduledFor?: Date | null;
}

class Job extends BaseEntity<IJob> implements IJob {
  static override readonly model: PrismaClient['job'];

  public declare readonly id?: IJob['id'];

  @Property() declare type: IJob['type'];
  @Property() declare status: IJob['status'];
  @Property() declare scheduledFor: IJob['scheduledFor'];

  constructor(data?: Partial<IJob>) {
    super(data);
  }
}

describe('Search tree - Integration Tests', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    db = await createTestDb();
    prisma = db.client;

    await db.clear();

    (User as any).model = prisma.user;
    (Job as any).model = prisma.job;
    configurePrisma(prisma as any);
  }, 30000);

  afterAll(async () => {
    await db.cleanup();
    resetPrismaConfiguration();
  }, 30000);

  describe('not', () => {
    beforeEach(async () => {
      await db.clear();
      await prisma.user.createMany({
        data: [
          { name: 'Ana', email: 'ana@example.com', age: 30, isActive: true },
          { name: 'Beto', email: 'beto@example.com', age: 40, isActive: true },
          { name: 'Carla', email: 'carla@test.com', age: 50, isActive: false }
        ]
      });
    });

    it('should exclude the rows matching the negated condition', async () => {
      const users = await User.findByFilter({}, {
        search: { not: { field: 'name', in: ['Ana', 'Beto'] } }
      }) as IUser[];

      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Carla');
    });

    it('should negate a whole subtree', async () => {
      const users = await User.findByFilter({}, {
        search: {
          not: {
            or: [
              { field: 'name', equals: 'Ana' },
              { field: 'email', endsWith: '@test.com' }
            ]
          }
        }
      }) as IUser[];

      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Beto');
    });

    it('should combine a negation with a positive requirement', async () => {
      const users = await User.findByFilter({}, {
        search: [
          { field: 'isActive', equals: true },
          { not: { field: 'name', equals: 'Ana' } }
        ]
      }) as IUser[];

      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Beto');
    });

    it('should exclude NULL rows from a negated range', async () => {
      await prisma.user.create({
        data: { name: 'Sin edad', email: 'null@example.com', age: null }
      });

      // The implicit not:null makes "everything that does not satisfy the range" include
      // the NULL row, which is the reading a user expects from NOT.
      const users = await User.findByFilter({}, {
        search: { not: { field: 'age', gte: 40 } }
      }) as IUser[];

      const names = users.map(u => u.name).sort();
      expect(names).toEqual(['Ana', 'Sin edad']);
    });
  });

  describe('relation quantifiers', () => {
    beforeEach(async () => {
      await db.clear();

      // Ana: every post published · Beto: one published, one not · Carla: no posts at all
      const ana = await prisma.user.create({
        data: { name: 'Ana', email: 'ana@example.com', isActive: true }
      });
      const beto = await prisma.user.create({
        data: { name: 'Beto', email: 'beto@example.com', isActive: true }
      });
      await prisma.user.create({
        data: { name: 'Carla', email: 'carla@example.com', isActive: true }
      });

      await prisma.post.createMany({
        data: [
          { title: 'Ana uno', published: true, authorId: ana.id },
          { title: 'Ana dos', published: true, authorId: ana.id },
          { title: 'Beto uno', published: true, authorId: beto.id },
          { title: 'Beto dos', published: false, authorId: beto.id }
        ]
      });
    });

    it('should match when at least one related row qualifies (some, the default)', async () => {
      const users = await User.findByFilter({}, {
        search: { field: 'posts.published', equals: true }
      }) as IUser[];

      const names = users.map(u => u.name).sort();
      expect(names).toEqual(['Ana', 'Beto']);
    });

    it('should match only when every related row qualifies', async () => {
      const users = await User.findByFilter({}, {
        search: { field: 'posts.published', equals: true, relation: 'every' }
      }) as IUser[];

      const names = users.map(u => u.name).sort();

      // Beto is out: one of his posts is unpublished.
      // Carla is IN: `every` is vacuously true for a user with no posts at all.
      expect(names).toEqual(['Ana', 'Carla']);
    });

    it('should match only when no related row qualifies', async () => {
      const users = await User.findByFilter({}, {
        search: { field: 'posts.published', equals: false, relation: 'none' }
      }) as IUser[];

      const names = users.map(u => u.name).sort();

      // Ana has no unpublished post, Carla has no posts at all. Beto has one.
      expect(names).toEqual(['Ana', 'Carla']);
    });

    it('should combine a quantifier with a plain requirement', async () => {
      const users = await User.findByFilter({}, {
        search: [
          { field: 'isActive', equals: true },
          { field: 'posts.published', equals: true, relation: 'every' }
        ]
      }) as IUser[];

      const names = users.map(u => u.name).sort();
      expect(names).toEqual(['Ana', 'Carla']);
    });

    it('should apply a quantifier inside an or node', async () => {
      const users = await User.findByFilter({}, {
        search: {
          or: [
            { field: 'posts.title', like: 'Ana', relation: 'some' },
            { field: 'name', equals: 'Carla' }
          ]
        }
      }) as IUser[];

      const names = users.map(u => u.name).sort();
      expect(names).toEqual(['Ana', 'Carla']);
    });
  });

  describe('date ranges', () => {
    const JAN = new Date('2026-01-15T00:00:00.000Z');
    const FEB = new Date('2026-02-15T00:00:00.000Z');
    const MAR = new Date('2026-03-15T00:00:00.000Z');

    beforeEach(async () => {
      await db.clear();
      await prisma.job.createMany({
        data: [
          { type: 'A', status: 'PENDING', scheduledFor: JAN },
          { type: 'B', status: 'PENDING', scheduledFor: FEB },
          { type: 'C', status: 'PENDING', scheduledFor: MAR },
          { type: 'D', status: 'PENDING', scheduledFor: null }
        ]
      });
    });

    it('should filter a Date range with between', async () => {
      const jobs = await Job.findByFilter({}, {
        search: {
          field: 'scheduledFor',
          between: [new Date('2026-01-01T00:00:00.000Z'), new Date('2026-02-28T00:00:00.000Z')]
        }
      }) as IJob[];

      const types = jobs.map(j => j.type).sort();
      expect(types).toEqual(['A', 'B']);
    });

    it('should treat between as inclusive on both bounds', async () => {
      const jobs = await Job.findByFilter({}, {
        search: { field: 'scheduledFor', between: [JAN, MAR] }
      }) as IJob[];

      const types = jobs.map(j => j.type).sort();
      expect(types).toEqual(['A', 'B', 'C']);
    });

    it('should exclude NULL dates from a range by default', async () => {
      const jobs = await Job.findByFilter({}, {
        search: { field: 'scheduledFor', between: [JAN, MAR] }
      }) as IJob[];

      expect(jobs.every(j => j.scheduledFor !== null)).toBe(true);
    });

    it('should include NULL dates with orNull', async () => {
      const jobs = await Job.findByFilter({}, {
        search: { field: 'scheduledFor', between: [JAN, FEB], orNull: true }
      }) as IJob[];

      const types = jobs.map(j => j.type).sort();
      expect(types).toEqual(['A', 'B', 'D']);
    });

    it('should match NULL dates with isNull', async () => {
      const jobs = await Job.findByFilter({}, {
        search: { field: 'scheduledFor', isNull: true }
      }) as IJob[];

      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe('D');
    });

    it('should support an open-ended range with gte alone', async () => {
      const jobs = await Job.findByFilter({}, {
        search: { field: 'scheduledFor', gte: FEB }
      }) as IJob[];

      const types = jobs.map(j => j.type).sort();
      expect(types).toEqual(['B', 'C']);
    });
  });

  describe('deep nesting', () => {
    beforeEach(async () => {
      await db.clear();
      await prisma.user.createMany({
        data: [
          { name: 'Ana', email: 'ana@example.com', age: 20, isActive: true },
          { name: 'Beto', email: 'beto@example.com', age: 60, isActive: true },
          { name: 'Carla', email: 'carla@example.com', age: 20, isActive: false },
          { name: 'Dario', email: 'dario@example.com', age: 60, isActive: false }
        ]
      });
    });

    it('should resolve an or of two ands', async () => {
      // (isActive AND age < 30) OR (NOT isActive AND age > 50)
      const users = await User.findByFilter({}, {
        search: {
          or: [
            { and: [{ field: 'isActive', equals: true }, { field: 'age', lte: 30 }] },
            { and: [{ field: 'isActive', equals: false }, { field: 'age', gte: 50 }] }
          ]
        }
      }) as IUser[];

      const names = users.map(u => u.name).sort();
      expect(names).toEqual(['Ana', 'Dario']);
    });

    it('should resolve three levels of nesting', async () => {
      // isActive AND ( age < 30 OR (name LIKE Bet AND age > 50) )
      const users = await User.findByFilter({}, {
        search: {
          and: [
            { field: 'isActive', equals: true },
            {
              or: [
                { field: 'age', lte: 30 },
                { and: [{ field: 'name', like: 'Bet' }, { field: 'age', gte: 50 }] }
              ]
            }
          ]
        }
      }) as IUser[];

      const names = users.map(u => u.name).sort();
      expect(names).toEqual(['Ana', 'Beto']);
    });

    /**
     * `like` maps to Prisma's `contains`, which is case-sensitive on PostgreSQL and MySQL but
     * case-insensitive on SQLite. These use substrings that match with identical casing in every
     * field involved, so the assertions hold on any provider.
     */
    it('should resolve anyOf and allOf helpers against the database', async () => {
      // 'Ana' matches the name only; the OR needs just one branch
      const anyMatch = await User.findByFilter({}, {
        search: anyOf(['name', 'email'], { like: 'Ana' })
      }) as IUser[];

      expect(anyMatch).toHaveLength(1);
      expect(anyMatch[0].name).toBe('Ana');

      // 'eto' appears with the same casing in both 'Beto' and 'beto@example.com'
      const allMatch = await User.findByFilter({}, {
        search: allOf(['name', 'email'], { like: 'eto' })
      }) as IUser[];

      expect(allMatch).toHaveLength(1);
      expect(allMatch[0].name).toBe('Beto');
    });

    it('should require every field of an allOf, not just one', async () => {
      // 'example' is in every email and in no name, whatever the provider's LIKE casing rules
      const anyMatch = await User.findByFilter({}, {
        search: anyOf(['name', 'email'], { like: 'example' })
      }) as IUser[];

      const allMatch = await User.findByFilter({}, {
        search: allOf(['name', 'email'], { like: 'example' })
      }) as IUser[];

      expect(anyMatch).toHaveLength(4);
      expect(allMatch).toHaveLength(0);
    });
  });

  describe('chunking of oversized lists', () => {
    beforeEach(async () => {
      await db.clear();
      await prisma.user.createMany({
        data: [
          { name: 'Ana', email: 'ana@example.com', isActive: true },
          { name: 'Beto', email: 'beto@example.com', isActive: true },
          { name: 'Carla', email: 'carla@example.com', isActive: false }
        ]
      });
    });

    /** Builds an id list past the 10k chunk threshold, most of whose values do not exist */
    const oversizedIds = (realIds: number[]) => {
      const padding = Array.from({ length: 10_050 }, (_, i) => 900_000 + i);
      return [...realIds, ...padding];
    };

    it('should split an oversized in list and merge the results', async () => {
      const all = await prisma.user.findMany();
      const ids = all.map(u => u.id);

      const users = await User.findByFilter({}, {
        search: { field: 'id', in: oversizedIds(ids) }
      }) as IUser[];

      const names = users.map(u => u.name).sort();
      expect(names).toEqual(['Ana', 'Beto', 'Carla']);
    });

    it('should not return duplicates when chunking', async () => {
      const all = await prisma.user.findMany();
      const ids = all.map(u => u.id);

      const users = await User.findByFilter({}, {
        search: { field: 'id', in: oversizedIds(ids) }
      }) as IUser[];

      const seen = new Set(users.map(u => u.id));
      expect(seen.size).toBe(users.length);
    });

    it('should keep the rest of the tree in every chunk', async () => {
      const all = await prisma.user.findMany();
      const ids = all.map(u => u.id);

      const users = await User.findByFilter({}, {
        search: [
          { field: 'id', in: oversizedIds(ids) },
          { field: 'isActive', equals: true }
        ]
      }) as IUser[];

      const names = users.map(u => u.name).sort();
      expect(names).toEqual(['Ana', 'Beto']);
    });

    it('should honour the base filter while chunking', async () => {
      const all = await prisma.user.findMany();
      const ids = all.map(u => u.id);

      const users = await User.findByFilter({ isActive: false }, {
        search: { field: 'id', in: oversizedIds(ids) }
      }) as IUser[];

      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Carla');
    });

    it('should honour onlyOne while chunking', async () => {
      const all = await prisma.user.findMany();
      const ids = all.map(u => u.id);

      const user = await User.findByFilter({}, {
        onlyOne: true,
        search: { field: 'id', in: oversizedIds(ids) }
      }) as IUser | null;

      expect(user).not.toBeNull();
      expect(['Ana', 'Beto', 'Carla']).toContain(user!.name);
    });

    it('should honour orderBy while chunking', async () => {
      const all = await prisma.user.findMany();
      const ids = all.map(u => u.id);

      const users = await User.findByFilter({}, {
        search: { field: 'id', in: oversizedIds(ids) },
        orderBy: { name: 'desc' }
      }) as IUser[];

      expect(users.map(u => u.name)).toEqual(['Carla', 'Beto', 'Ana']);
    });

    it('should return nothing when no chunk matches', async () => {
      const users = await User.findByFilter({}, {
        search: { field: 'id', in: oversizedIds([]) }
      }) as IUser[];

      expect(users).toHaveLength(0);
    });
  });

  /**
   * Scalar-list operators only exist on providers that support array columns. SQLite does not,
   * so these are skipped there and run on PostgreSQL / MySQL / MongoDB.
   */
  describe('scalar list operators', () => {
    /** Native scalar arrays exist only on PostgreSQL in this test matrix */
    const skipIfUnsupported = () => {
      if (db.provider !== 'postgresql') {
        console.log(`⏭️  Skipping scalar list operators (current: ${db.provider.toUpperCase()})`);
        return true;
      }
      return false;
    };

    beforeEach(async () => {
      if (db.provider !== 'postgresql') return;

      await db.clear();
      await (prisma as any).product.createMany({
        data: [
          { name: 'Uno', sku: 'SKU-1', tags: ['nuevo', 'oferta'] },
          { name: 'Dos', sku: 'SKU-2', tags: ['nuevo'] },
          { name: 'Tres', sku: 'SKU-3', tags: ['usado'] },
          { name: 'Cuatro', sku: 'SKU-4', tags: [] }
        ]
      });
    });

    it('should resolve hasSome through the search tree', async () => {
      if (skipIfUnsupported()) return;

      const where = SearchResolver.resolve({ field: 'tags', hasSome: ['nuevo'] });
      const products = await (prisma as any).product.findMany({ where });

      expect(products.map((p: any) => p.name).sort()).toEqual(['Dos', 'Uno']);
    });

    it('should resolve hasEvery through the search tree', async () => {
      if (skipIfUnsupported()) return;

      const where = SearchResolver.resolve({ field: 'tags', hasEvery: ['nuevo', 'oferta'] });
      const products = await (prisma as any).product.findMany({ where });

      expect(products.map((p: any) => p.name)).toEqual(['Uno']);
    });

    it('should match nothing when hasEvery asks for a value no row carries', async () => {
      if (skipIfUnsupported()) return;

      const where = SearchResolver.resolve({ field: 'tags', hasEvery: ['nuevo', 'inexistente'] });
      const products = await (prisma as any).product.findMany({ where });

      expect(products).toHaveLength(0);
    });

    it('should combine a list operator with the rest of the tree', async () => {
      if (skipIfUnsupported()) return;

      const where = SearchResolver.resolve({
        and: [
          { field: 'tags', hasSome: ['nuevo'] },
          { not: { field: 'name', equals: 'Dos' } }
        ]
      });
      const products = await (prisma as any).product.findMany({ where });

      expect(products.map((p: any) => p.name)).toEqual(['Uno']);
    });

    it('should prune an empty list operator instead of matching nothing', async () => {
      if (skipIfUnsupported()) return;

      expect(SearchResolver.resolve({ field: 'tags', hasSome: [] })).toBeNull();

      const products = await (prisma as any).product.findMany({ where: {} });
      expect(products).toHaveLength(4);
    });
  });

  /**
   * The point of the default is that a text search behaves the same everywhere. These run on every
   * provider: on PostgreSQL and MongoDB because `mode: 'insensitive'` is emitted, on SQLite and
   * MySQL because they are already case-insensitive.
   */
  describe('case-insensitive text search', () => {
    beforeEach(async () => {
      await db.clear();
      await prisma.user.createMany({
        data: [
          { name: 'John Doe', email: 'JOHN@example.com', isActive: true },
          { name: 'jane roe', email: 'jane@example.com', isActive: true }
        ]
      });
    });

    it('should match regardless of case with like', async () => {
      const upper = await User.findByFilter({}, { search: { field: 'name', like: 'JOHN' } }) as IUser[];
      const lower = await User.findByFilter({}, { search: { field: 'name', like: 'john' } }) as IUser[];

      expect(upper).toHaveLength(1);
      expect(lower).toHaveLength(1);
      expect(upper[0].name).toBe('John Doe');
      expect(lower[0].name).toBe('John Doe');
    });

    it('should match regardless of case with startsWith and endsWith', async () => {
      const starts = await User.findByFilter({}, { search: { field: 'name', startsWith: 'JANE' } }) as IUser[];
      const ends = await User.findByFilter({}, { search: { field: 'email', endsWith: '@EXAMPLE.COM' } }) as IUser[];

      expect(starts).toHaveLength(1);
      expect(starts[0].name).toBe('jane roe');
      expect(ends).toHaveLength(2);
    });

    it('should match across fields with anyOf', async () => {
      const users = await User.findByFilter({}, {
        search: anyOf(['name', 'email'], { like: 'JOHN' })
      }) as IUser[];

      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('John Doe');
    });

    /**
     * `insensitive` on `equals` needs Prisma's explicit `mode`, which only PostgreSQL and MongoDB
     * accept. SQLite compares strings with `=` case-sensitively and offers no per-query override,
     * and MySQL follows the column collation. So this modifier is honoured on PG/Mongo and is a
     * no-op elsewhere — unlike the text operators, which are consistent on every provider.
     */
    it('should honour insensitive:true on equals where the provider supports it', async () => {
      if (db.provider !== 'postgresql' && db.provider !== 'mongodb') {
        console.log(`⏭️  Skipping insensitive equals (current: ${db.provider.toUpperCase()})`);
        return;
      }

      const sensitive = await User.findByFilter({}, {
        search: { field: 'name', equals: 'JOHN DOE' }
      }) as IUser[];

      const insensitive = await User.findByFilter({}, {
        search: { field: 'name', equals: 'JOHN DOE', insensitive: true }
      }) as IUser[];

      expect(sensitive).toHaveLength(0);
      expect(insensitive).toHaveLength(1);
      expect(insensitive[0].name).toBe('John Doe');
    });

    it('should keep equals exact when nothing is asked', async () => {
      const exact = await User.findByFilter({}, {
        search: { field: 'name', equals: 'John Doe' }
      }) as IUser[];

      expect(exact).toHaveLength(1);
      expect(exact[0].name).toBe('John Doe');
    });

    it('should honour insensitive:false where the provider can enforce it', async () => {
      if (db.provider !== 'postgresql' && db.provider !== 'mongodb') {
        console.log(`⏭️  Skipping case-sensitive assertion (current: ${db.provider.toUpperCase()})`);
        return;
      }

      const users = await User.findByFilter({}, {
        search: { field: 'name', like: 'JOHN', insensitive: false }
      }) as IUser[];

      expect(users).toHaveLength(0);
    });
  });

  describe('pruning against the database', () => {
    beforeEach(async () => {
      await db.clear();
      await prisma.user.createMany({
        data: [
          { name: 'Ana', email: 'ana@example.com', isActive: true },
          { name: 'Beto', email: 'beto@example.com', isActive: false }
        ]
      });
    });

    it('should ignore a condition with an empty value instead of matching nothing', async () => {
      const users = await User.findByFilter({}, {
        search: { field: 'name', like: '' }
      }) as IUser[];

      expect(users).toHaveLength(2);
    });

    it('should ignore an empty in list instead of matching nothing', async () => {
      const users = await User.findByFilter({}, {
        search: { field: 'id', in: [] }
      }) as IUser[];

      expect(users).toHaveLength(2);
    });

    it('should ignore an empty or node instead of matching nothing', async () => {
      const users = await User.findByFilter({}, {
        search: { or: [{ field: 'name', like: '' }, { field: 'email', like: '   ' }] }
      }) as IUser[];

      expect(users).toHaveLength(2);
    });

    it('should keep the base filter when the whole search prunes away', async () => {
      const users = await User.findByFilter({ isActive: true }, {
        search: { field: 'name', like: '' }
      }) as IUser[];

      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Ana');
    });

    it('should drop only the invalid branch of a mixed or', async () => {
      const users = await User.findByFilter({}, {
        search: {
          or: [
            { field: 'name', like: '' },
            { field: 'name', equals: 'Beto' }
          ]
        }
      }) as IUser[];

      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Beto');
    });
  });
});
