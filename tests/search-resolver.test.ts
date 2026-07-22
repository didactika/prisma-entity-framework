/**
 * Test suite for SearchResolver
 *
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import SearchResolver from '../src/core/search-resolver';
import { anyOf, allOf } from '../src/core/search-helpers';
import { Search } from '../src/core/structures/types/search.types';
import { configurePrisma, resetPrismaConfiguration } from '../src/core/config';

/** Model used across the suite: publishedAt nullable, everything else required */
const productModel = {
  fields: [
    { name: 'id', kind: 'scalar', isRequired: true },
    { name: 'name', kind: 'scalar', isRequired: true },
    { name: 'description', kind: 'scalar', isRequired: true },
    { name: 'sku', kind: 'scalar', isRequired: true },
    { name: 'status', kind: 'scalar', isRequired: true },
    { name: 'isActive', kind: 'scalar', isRequired: true },
    { name: 'price', kind: 'scalar', isRequired: true },
    { name: 'tags', kind: 'scalar', isRequired: true, isList: true },
    { name: 'publishedAt', kind: 'scalar', isRequired: false },
    { name: 'updatedAt', kind: 'scalar', isRequired: true },
    { name: 'category', kind: 'object', isList: false, type: 'Category' },
    { name: 'reviews', kind: 'object', isList: true, type: 'Review' }
  ]
};

const CUTOFF = new Date('2026-06-01T00:00:00.000Z');

describe('SearchResolver', () => {
  describe('R1 - an array at the root is AND', () => {
    it('should treat a root array as an and node', () => {
      const result = SearchResolver.resolve([
        { field: 'name', like: 'a' },
        { field: 'sku', equals: 'b' }
      ]);

      expect(result).toEqual({
        AND: [{ name: { contains: 'a' } }, { sku: { equals: 'b' } }]
      });
    });

    it('should accept a bare condition as the root', () => {
      expect(SearchResolver.resolve({ field: 'name', like: 'a' }))
        .toEqual({ name: { contains: 'a' } });
    });

    it('should unwrap a root array holding a single node', () => {
      expect(SearchResolver.resolve([{ field: 'name', like: 'a' }]))
        .toEqual({ name: { contains: 'a' } });
    });
  });

  describe('R2 / R3 - and / or nodes', () => {
    it('should map an and node to AND', () => {
      const result = SearchResolver.resolve({
        and: [{ field: 'name', like: 'a' }, { field: 'sku', equals: 'b' }]
      });

      expect(result).toEqual({
        AND: [{ name: { contains: 'a' } }, { sku: { equals: 'b' } }]
      });
    });

    it('should map an or node to OR', () => {
      const result = SearchResolver.resolve({
        or: [{ field: 'name', like: 'a' }, { field: 'sku', equals: 'b' }]
      });

      expect(result).toEqual({
        OR: [{ name: { contains: 'a' } }, { sku: { equals: 'b' } }]
      });
    });

    it('should emit a lone surviving child directly, without a wrapper', () => {
      expect(SearchResolver.resolve({ or: [{ field: 'name', like: 'a' }] }))
        .toEqual({ name: { contains: 'a' } });

      expect(SearchResolver.resolve({ and: [{ field: 'name', like: 'a' }] }))
        .toEqual({ name: { contains: 'a' } });
    });

    it('should nest to arbitrary depth', () => {
      const result = SearchResolver.resolve({
        or: [
          { and: [{ field: 'status', equals: 'A' }, { field: 'price', gte: 100 }] },
          { and: [{ field: 'status', equals: 'B' }, { field: 'price', gte: 500 }] }
        ]
      }, productModel);

      expect(result).toEqual({
        OR: [
          { AND: [{ status: { equals: 'A' } }, { price: { gte: 100 } }] },
          { AND: [{ status: { equals: 'B' } }, { price: { gte: 500 } }] }
        ]
      });
    });

    it('should keep an and nested inside an or as one branch', () => {
      const result = SearchResolver.resolve({
        or: [
          { and: [{ field: 'name', like: 'a' }, { field: 'description', like: 'a' }] },
          { field: 'status', equals: 'X' }
        ]
      }, productModel);

      expect(result).toEqual({
        OR: [
          { AND: [{ name: { contains: 'a' } }, { description: { contains: 'a' } }] },
          { status: { equals: 'X' } }
        ]
      });
    });
  });

  describe('R4 - not', () => {
    it('should map a not node to NOT', () => {
      const result = SearchResolver.resolve({
        not: { field: 'status', in: ['DRAFT', 'ARCHIVED'] }
      });

      expect(result).toEqual({ NOT: { status: { in: ['DRAFT', 'ARCHIVED'] } } });
    });

    it('should drop a not whose child contributes nothing', () => {
      expect(SearchResolver.resolve({ not: { field: 'name', like: '' } })).toBeNull();
    });

    it('should negate a whole subtree', () => {
      const result = SearchResolver.resolve({
        not: { or: [{ field: 'name', like: 'a' }, { field: 'sku', equals: 'b' }] }
      });

      expect(result).toEqual({
        NOT: { OR: [{ name: { contains: 'a' } }, { sku: { equals: 'b' } }] }
      });
    });

    it('should not confuse a condition with a not node', () => {
      expect(SearchResolver.resolve({ field: 'status', notIn: ['A'] }))
        .toEqual({ status: { notIn: ['A'] } });
    });
  });

  describe('R6 - orNull', () => {
    it('should wrap the condition in an OR with the null check', () => {
      const result = SearchResolver.resolve(
        { field: 'publishedAt', lte: CUTOFF, orNull: true },
        productModel
      );

      expect(result).toEqual({
        OR: [
          { publishedAt: { lte: CUTOFF } },
          { publishedAt: { equals: null } }
        ]
      });
    });

    it('should suppress the implicit not:null on a range', () => {
      const withNull = SearchResolver.resolve(
        { field: 'publishedAt', gte: CUTOFF, orNull: true },
        productModel
      ) as any;

      expect(withNull.OR[0].publishedAt).not.toHaveProperty('not');
    });

    it('should work on non-range operators too', () => {
      const result = SearchResolver.resolve({ field: 'name', like: 'a', orNull: true });

      expect(result).toEqual({
        OR: [{ name: { contains: 'a' } }, { name: { equals: null } }]
      });
    });

    it('should not leak orNull into sibling conditions', () => {
      const result = SearchResolver.resolve([
        { field: 'publishedAt', lte: CUTOFF, orNull: true },
        { field: 'price', lte: 3 }
      ], productModel);

      expect(result).toEqual({
        AND: [
          { OR: [{ publishedAt: { lte: CUTOFF } }, { publishedAt: { equals: null } }] },
          { price: { lte: 3 } }
        ]
      });
    });
  });

  describe('R7 - relation paths', () => {
    it('should wrap a to-one relation with is', () => {
      const result = SearchResolver.resolve(
        { field: 'category.name', equals: 'Elec' },
        productModel
      );

      expect(result).toEqual({ category: { is: { name: { equals: 'Elec' } } } });
    });

    /**
     * The related model is only reachable through a configured Prisma instance, so in these
     * unit tests `reviews.rating` has no field metadata and R10 assumes it is nullable —
     * hence the `not: null` on the range conditions below.
     */
    it('should wrap a to-many relation with some by default', () => {
      const result = SearchResolver.resolve(
        { field: 'reviews.rating', gte: 4 },
        productModel
      );

      expect(result).toEqual({ reviews: { some: { rating: { gte: 4, not: null } } } });
    });

    it('should honour relation: every', () => {
      const result = SearchResolver.resolve(
        { field: 'reviews.rating', gte: 4, relation: 'every' },
        productModel
      );

      expect(result).toEqual({ reviews: { every: { rating: { gte: 4, not: null } } } });
    });

    it('should honour relation: none', () => {
      const result = SearchResolver.resolve(
        { field: 'reviews.rating', lte: 2, relation: 'none' },
        productModel
      );

      expect(result).toEqual({ reviews: { none: { rating: { lte: 2, not: null } } } });
    });

    it('should ignore the quantifier on a to-one relation', () => {
      const result = SearchResolver.resolve(
        { field: 'category.name', equals: 'Elec', relation: 'every' },
        productModel
      );

      expect(result).toEqual({ category: { is: { name: { equals: 'Elec' } } } });
    });

    it('should produce a plain nested object without model info', () => {
      const result = SearchResolver.resolve({ field: 'category.name', equals: 'Elec' });

      expect(result).toEqual({ category: { name: { equals: 'Elec' } } });
    });

    it('should apply the quantifier inside a group', () => {
      const result = SearchResolver.resolve({
        or: [
          { field: 'reviews.title', like: 'good' },
          { field: 'name', like: 'x' }
        ]
      }, productModel);

      expect(result).toEqual({
        OR: [
          { reviews: { some: { title: { contains: 'good' } } } },
          { name: { contains: 'x' } }
        ]
      });
    });
  });

  describe('R8 / R9 - pruning', () => {
    it('should drop a condition with an empty string value', () => {
      expect(SearchResolver.resolve({ field: 'name', like: '' })).toBeNull();
      expect(SearchResolver.resolve({ field: 'name', like: '   ' })).toBeNull();
    });

    it('should drop a condition with an empty list', () => {
      expect(SearchResolver.resolve({ field: 'status', in: [] })).toBeNull();
      expect(SearchResolver.resolve({ field: 'tags', hasEvery: [] })).toBeNull();
    });

    it('should drop a range with neither bound', () => {
      expect(SearchResolver.resolve({ field: 'price', gte: undefined } as any)).toBeNull();
    });

    it('should drop a condition with an empty field', () => {
      expect(SearchResolver.resolve({ field: '', like: 'a' })).toBeNull();
      expect(SearchResolver.resolve({ field: '   ', like: 'a' })).toBeNull();
    });

    it('should never emit an empty OR', () => {
      const result = SearchResolver.resolve({
        or: [{ field: 'name', like: '' }, { field: 'sku', equals: '' }]
      });

      expect(result).toBeNull();
    });

    it('should never emit an empty AND', () => {
      expect(SearchResolver.resolve({ and: [] })).toBeNull();
      expect(SearchResolver.resolve({ or: [] })).toBeNull();
      expect(SearchResolver.resolve([])).toBeNull();
    });

    it('should keep the surviving siblings of a pruned condition', () => {
      const result = SearchResolver.resolve({
        or: [
          { field: 'name', like: '' },
          { field: 'sku', equals: 'b' },
          { field: 'status', in: [] }
        ]
      });

      expect(result).toEqual({ sku: { equals: 'b' } });
    });

    it('should collapse a group whose children all prune away, deep in the tree', () => {
      const result = SearchResolver.resolve({
        and: [
          { field: 'isActive', equals: true },
          { or: [{ field: 'name', like: '' }, { field: 'sku', equals: '' }] }
        ]
      });

      expect(result).toEqual({ isActive: { equals: true } });
    });
  });

  describe('R10 - implicit not:null on order comparisons', () => {
    it('should add not:null on a nullable column', () => {
      expect(SearchResolver.resolve({ field: 'publishedAt', gte: CUTOFF }, productModel))
        .toEqual({ publishedAt: { gte: CUTOFF, not: null } });
    });

    it('should not add not:null on a required column', () => {
      expect(SearchResolver.resolve({ field: 'updatedAt', gte: CUTOFF }, productModel))
        .toEqual({ updatedAt: { gte: CUTOFF } });
    });

    it('should assume nullable when there is no model info', () => {
      expect(SearchResolver.resolve({ field: 'anything', gte: 1 }))
        .toEqual({ anything: { gte: 1, not: null } });
    });

    it('should not add not:null to non-range operators', () => {
      expect(SearchResolver.resolve({ field: 'publishedAt', equals: CUTOFF }, productModel))
        .toEqual({ publishedAt: { equals: CUTOFF } });
    });

    it('should apply to between as well', () => {
      expect(SearchResolver.resolve({ field: 'publishedAt', between: [CUTOFF, CUTOFF] }, productModel))
        .toEqual({ publishedAt: { gte: CUTOFF, lte: CUTOFF, not: null } });
    });
  });

  describe('operators', () => {
    const cases: Array<[string, Search.Condition, Record<string, any>]> = [
      ['equals', { field: 'sku', equals: 'ABC' }, { sku: { equals: 'ABC' } }],
      ['equals false', { field: 'isActive', equals: false }, { isActive: { equals: false } }],
      ['equals 0', { field: 'price', equals: 0 }, { price: { equals: 0 } }],
      ['equals null', { field: 'publishedAt', equals: null }, { publishedAt: { equals: null } }],
      ['like', { field: 'name', like: 'lap' }, { name: { contains: 'lap' } }],
      ['startsWith', { field: 'name', startsWith: 'lap' }, { name: { startsWith: 'lap' } }],
      ['endsWith', { field: 'name', endsWith: 'top' }, { name: { endsWith: 'top' } }],
      ['in', { field: 'status', in: ['A', 'B'] }, { status: { in: ['A', 'B'] } }],
      ['notIn', { field: 'status', notIn: ['A'] }, { status: { notIn: ['A'] } }],
      ['hasSome', { field: 'tags', hasSome: ['x'] }, { tags: { hasSome: ['x'] } }],
      ['hasEvery', { field: 'tags', hasEvery: ['x', 'y'] }, { tags: { hasEvery: ['x', 'y'] } }],
      ['isNull', { field: 'publishedAt', isNull: true }, { publishedAt: { equals: null } }],
      ['gte only', { field: 'price', gte: 10 }, { price: { gte: 10 } }],
      ['lte only', { field: 'price', lte: 20 }, { price: { lte: 20 } }],
      ['gte + lte', { field: 'price', gte: 10, lte: 20 }, { price: { gte: 10, lte: 20 } }],
      ['between', { field: 'price', between: [10, 20] }, { price: { gte: 10, lte: 20 } }]
    ];

    it.each(cases)('should map %s', (_label, condition, expected) => {
      expect(SearchResolver.resolve(condition, productModel)).toEqual(expected);
    });

    it('should treat between as sugar for gte + lte', () => {
      const sugar = SearchResolver.resolve({ field: 'price', between: [10, 20] }, productModel);
      const explicit = SearchResolver.resolve({ field: 'price', gte: 10, lte: 20 }, productModel);

      expect(sugar).toEqual(explicit);
    });

    it('should copy list values instead of aliasing the caller array', () => {
      const values = ['A', 'B'];
      const result = SearchResolver.resolve({ field: 'status', in: values }, productModel) as any;

      values.push('C');

      expect(result.status.in).toEqual(['A', 'B']);
    });
  });

  describe('merge with a base filter', () => {
    it('should merge disjoint keys', () => {
      const result = SearchResolver.merge(
        { isActive: { equals: true } },
        { field: 'name', like: 'a' },
        productModel
      );

      expect(result).toEqual({
        isActive: { equals: true },
        name: { contains: 'a' }
      });
    });

    it('should return the base filter untouched when the search prunes away', () => {
      const result = SearchResolver.merge(
        { isActive: { equals: true } },
        { field: 'name', like: '' },
        productModel
      );

      expect(result).toEqual({ isActive: { equals: true } });
    });

    it('should not clobber a base filter key of the same name', () => {
      const result = SearchResolver.merge(
        { name: { equals: 'base' } },
        { field: 'name', like: 'search' },
        productModel
      );

      expect(result).toEqual({
        name: { equals: 'base' },
        AND: [{ name: { contains: 'search' } }]
      });
    });

    it('should nest under AND when the base filter already has an OR', () => {
      const result = SearchResolver.merge(
        { OR: [{ ownerId: 1 }] },
        { or: [{ field: 'name', like: 'a' }, { field: 'sku', equals: 'b' }] },
        productModel
      );

      expect(result).toEqual({
        OR: [{ ownerId: 1 }],
        AND: [{ OR: [{ name: { contains: 'a' } }, { sku: { equals: 'b' } }] }]
      });
    });

    it('should append to an existing AND rather than replacing it', () => {
      const result = SearchResolver.merge(
        { AND: [{ tenantId: 7 }], OR: [{ x: 1 }] },
        { or: [{ field: 'name', like: 'a' }, { field: 'sku', equals: 'b' }] },
        productModel
      );

      expect(result).toEqual({
        AND: [{ tenantId: 7 }, { OR: [{ name: { contains: 'a' } }, { sku: { equals: 'b' } }] }],
        OR: [{ x: 1 }]
      });
    });

    it('should not mutate the base filter it was given', () => {
      const base = { isActive: { equals: true } };
      SearchResolver.merge(base, { field: 'name', like: 'a' }, productModel);

      expect(base).toEqual({ isActive: { equals: true } });
    });
  });

  describe('chunkLargeLists', () => {
    it('should return null when no list exceeds the limit', () => {
      expect(SearchResolver.chunkLargeLists({ field: 'id', in: [1, 2, 3] }, 10)).toBeNull();
    });

    it('should split an oversized in list into one tree per chunk', () => {
      const values = Array.from({ length: 25 }, (_, i) => i);
      const trees = SearchResolver.chunkLargeLists({ field: 'id', in: values }, 10);

      expect(trees).toHaveLength(3);
      expect((trees![0] as any).in).toHaveLength(10);
      expect((trees![2] as any).in).toHaveLength(5);
      expect(trees!.flatMap(t => (t as any).in)).toEqual(values);
    });

    it('should split notIn as well', () => {
      const values = Array.from({ length: 12 }, (_, i) => i);
      const trees = SearchResolver.chunkLargeLists({ field: 'id', notIn: values }, 10);

      expect(trees).toHaveLength(2);
      expect((trees![0] as any).notIn).toHaveLength(10);
    });

    it('should find an oversized list nested deep in the tree', () => {
      const values = Array.from({ length: 15 }, (_, i) => i);
      const trees = SearchResolver.chunkLargeLists({
        and: [
          { field: 'isActive', equals: true },
          { or: [{ field: 'id', in: values }, { field: 'name', like: 'x' }] }
        ]
      }, 10);

      expect(trees).toHaveLength(2);

      const firstOr = (trees![0] as any).and[1].or;
      expect(firstOr[0].in).toHaveLength(10);
      expect(firstOr[1]).toEqual({ field: 'name', like: 'x' });
    });

    it('should preserve every other condition in each chunk', () => {
      const values = Array.from({ length: 15 }, (_, i) => i);
      const trees = SearchResolver.chunkLargeLists({
        and: [{ field: 'isActive', equals: true }, { field: 'id', in: values }]
      }, 10)!;

      for (const tree of trees) {
        expect((tree as any).and[0]).toEqual({ field: 'isActive', equals: true });
      }
    });

    it('should split only the first oversized list, avoiding a cartesian product', () => {
      const a = Array.from({ length: 15 }, (_, i) => i);
      const b = Array.from({ length: 15 }, (_, i) => i + 100);
      const trees = SearchResolver.chunkLargeLists({
        and: [{ field: 'id', in: a }, { field: 'ownerId', in: b }]
      }, 10)!;

      expect(trees).toHaveLength(2);
      expect((trees[0] as any).and[1].in).toHaveLength(15);
    });

    it('should not mutate the tree it was given', () => {
      const values = Array.from({ length: 15 }, (_, i) => i);
      const tree: Search.Input = { field: 'id', in: values };

      SearchResolver.chunkLargeLists(tree, 10);

      expect((tree as any).in).toHaveLength(15);
    });

    it('should produce chunks that resolve to valid where clauses', () => {
      const values = Array.from({ length: 15 }, (_, i) => i);
      const trees = SearchResolver.chunkLargeLists({ field: 'id', in: values }, 10)!;

      const resolved = trees.map(tree => SearchResolver.resolve(tree, productModel));

      expect(resolved[0]).toEqual({ id: { in: values.slice(0, 10) } });
      expect(resolved[1]).toEqual({ id: { in: values.slice(10) } });
    });
  });

  describe('anyOf / allOf helpers', () => {
    it('should build an or node from several fields', () => {
      expect(anyOf(['name', 'email'], { like: 'john' })).toEqual({
        or: [
          { field: 'name', like: 'john' },
          { field: 'email', like: 'john' }
        ]
      });
    });

    it('should build an and node from several fields', () => {
      expect(allOf(['name', 'lastname'], { like: 'a' })).toEqual({
        and: [
          { field: 'name', like: 'a' },
          { field: 'lastname', like: 'a' }
        ]
      });
    });

    it('should return the bare condition for a single field', () => {
      expect(anyOf(['name'], { like: 'john' })).toEqual({ field: 'name', like: 'john' });
      expect(allOf(['name'], { like: 'john' })).toEqual({ field: 'name', like: 'john' });
    });

    it('should carry modifiers through to every condition', () => {
      expect(anyOf(['publishedAt', 'updatedAt'], { gte: CUTOFF, orNull: true })).toEqual({
        or: [
          { field: 'publishedAt', gte: CUTOFF, orNull: true },
          { field: 'updatedAt', gte: CUTOFF, orNull: true }
        ]
      });
    });

    it('should produce a node the resolver handles like any other', () => {
      const viaHelper = SearchResolver.resolve(anyOf(['name', 'sku'], { like: 'a' }), productModel);
      const byHand = SearchResolver.resolve({
        or: [{ field: 'name', like: 'a' }, { field: 'sku', like: 'a' }]
      }, productModel);

      expect(viaHelper).toEqual(byHand);
    });

    it('should prune to nothing when the list of fields is empty', () => {
      expect(SearchResolver.resolve(anyOf([], { like: 'a' }))).toBeNull();
    });
  });

  /**
   * A search tree usually arrives as JSON from a client, where TypeScript cannot enforce the
   * contract. These pin what happens with input the type system would have rejected.
   */
  describe('untrusted runtime input', () => {
    it('should ignore a null or undefined tree', () => {
      expect(SearchResolver.resolve(null as any)).toBeNull();
      expect(SearchResolver.resolve(undefined as any)).toBeNull();
    });

    it('should ignore a primitive where a node was expected', () => {
      expect(SearchResolver.resolve('nope' as any)).toBeNull();
      expect(SearchResolver.resolve(42 as any)).toBeNull();
    });

    it('should ignore an object that is neither a node nor a condition', () => {
      expect(SearchResolver.resolve({} as any)).toBeNull();
      expect(SearchResolver.resolve({ foo: 'bar' } as any)).toBeNull();
    });

    it('should ignore a condition whose field is not a string', () => {
      expect(SearchResolver.resolve({ field: 123, equals: 'x' } as any)).toBeNull();
      expect(SearchResolver.resolve({ field: ['a', 'b'], equals: 'x' } as any)).toBeNull();
    });

    it('should ignore a group whose children are not an array', () => {
      expect(SearchResolver.resolve({ and: 'nope' } as any)).toBeNull();
      expect(SearchResolver.resolve({ or: null } as any)).toBeNull();
    });

    it('should ignore garbage children but keep the valid ones', () => {
      const result = SearchResolver.resolve({
        or: [
          null as any,
          'nope' as any,
          { field: 'name', like: 'a' },
          {} as any
        ]
      });

      expect(result).toEqual({ name: { contains: 'a' } });
    });

    it('should ignore a not node whose child is not an object', () => {
      expect(SearchResolver.resolve({ not: 'nope' } as any)).toBeNull();
      expect(SearchResolver.resolve({ not: null } as any)).toBeNull();
    });

    /**
     * The contract allows exactly one operator per condition and the type enforces it, but raw
     * JSON can carry several. The resolver picks the first match in a fixed order rather than
     * failing, so the outcome is at least deterministic.
     */
    it('should apply a deterministic precedence when several operators are present', () => {
      expect(SearchResolver.resolve({ field: 'x', like: 'a', gte: 5 } as any))
        .toEqual({ x: { contains: 'a' } });

      expect(SearchResolver.resolve({ field: 'x', equals: 'a', like: 'b' } as any))
        .toEqual({ x: { equals: 'a' } });

      expect(SearchResolver.resolve({ field: 'x', isNull: true, like: 'b' } as any))
        .toEqual({ x: { equals: null } });
    });

    it('should fall through to the next operator when the first one is unusable', () => {
      // `like` is present but empty, so the condition is dropped rather than silently
      // falling back to the range - precedence is decided by key presence, not by validity
      expect(SearchResolver.resolve({ field: 'x', like: '', gte: 5 } as any)).toBeNull();
    });

    it('should ignore a between that is not a two-element tuple', () => {
      expect(SearchResolver.resolve({ field: 'x', between: [1] } as any)).toBeNull();
      expect(SearchResolver.resolve({ field: 'x', between: [] } as any)).toBeNull();
      expect(SearchResolver.resolve({ field: 'x', between: 'nope' } as any)).toBeNull();
    });

    it('should accept a between with a null bound as an open-ended range', () => {
      expect(SearchResolver.resolve({ field: 'x', between: [10, null] } as any))
        .toEqual({ x: { gte: 10, not: null } });

      expect(SearchResolver.resolve({ field: 'x', between: [null, 20] } as any))
        .toEqual({ x: { lte: 20, not: null } });
    });

    it('should survive a deeply nested tree', () => {
      const result = SearchResolver.resolve({
        and: [
          { field: 'a', equals: 1 },
          {
            or: [
              { field: 'b', equals: 2 },
              {
                and: [
                  { field: 'c', equals: 3 },
                  { not: { field: 'd', equals: 4 } }
                ]
              }
            ]
          }
        ]
      });

      expect(result).toEqual({
        AND: [
          { a: { equals: 1 } },
          {
            OR: [
              { b: { equals: 2 } },
              { AND: [{ c: { equals: 3 } }, { NOT: { d: { equals: 4 } } }] }
            ]
          }
        ]
      });
    });

    it('should combine orNull with a relation quantifier', () => {
      const result = SearchResolver.resolve(
        { field: 'reviews.rating', gte: 4, relation: 'every', orNull: true },
        productModel
      );

      expect(result).toEqual({
        OR: [
          { reviews: { every: { rating: { gte: 4 } } } },
          { reviews: { every: { rating: { equals: null } } } }
        ]
      });
    });
  });

  /**
   * Case handling is provider-dependent: only PostgreSQL and MongoDB accept Prisma's explicit
   * `mode`, so the flag is emitted there and omitted everywhere else.
   */
  describe('case sensitivity', () => {
    /** Minimal stub that makes getDatabaseProvider report the given provider */
    const configureProvider = (provider: string, config?: Record<string, unknown>) => {
      configurePrisma({
        _engineConfig: { datasources: [{ activeProvider: provider }] },
        _runtimeDataModel: { models: {} }
      } as any, config as any);
    };

    afterEach(() => {
      resetPrismaConfiguration();
    });

    it('should emit mode:insensitive for like on PostgreSQL by default', () => {
      configureProvider('postgresql');

      expect(SearchResolver.resolve({ field: 'name', like: 'john' }))
        .toEqual({ name: { contains: 'john', mode: 'insensitive' } });
    });

    it('should apply the default to startsWith and endsWith too', () => {
      configureProvider('postgresql');

      expect(SearchResolver.resolve({ field: 'name', startsWith: 'jo' }))
        .toEqual({ name: { startsWith: 'jo', mode: 'insensitive' } });

      expect(SearchResolver.resolve({ field: 'name', endsWith: 'hn' }))
        .toEqual({ name: { endsWith: 'hn', mode: 'insensitive' } });
    });

    it('should leave equals case-sensitive by default', () => {
      configureProvider('postgresql');

      expect(SearchResolver.resolve({ field: 'sku', equals: 'ABC' }))
        .toEqual({ sku: { equals: 'ABC' } });
    });

    it('should honour insensitive:true on equals', () => {
      configureProvider('postgresql');

      expect(SearchResolver.resolve({ field: 'sku', equals: 'abc', insensitive: true }))
        .toEqual({ sku: { equals: 'abc', mode: 'insensitive' } });
    });

    it('should honour insensitive:false on a text operator', () => {
      configureProvider('postgresql');

      expect(SearchResolver.resolve({ field: 'code', like: 'X9', insensitive: false }))
        .toEqual({ code: { contains: 'X9' } });
    });

    it('should respect the global caseInsensitiveSearch setting', () => {
      configureProvider('postgresql', { caseInsensitiveSearch: false });

      expect(SearchResolver.resolve({ field: 'name', like: 'john' }))
        .toEqual({ name: { contains: 'john' } });
    });

    it('should let a condition override the global setting', () => {
      configureProvider('postgresql', { caseInsensitiveSearch: false });

      expect(SearchResolver.resolve({ field: 'name', like: 'john', insensitive: true }))
        .toEqual({ name: { contains: 'john', mode: 'insensitive' } });
    });

    it('should not emit mode on SQLite, which rejects it and is already insensitive', () => {
      configureProvider('sqlite');

      expect(SearchResolver.resolve({ field: 'name', like: 'john' }))
        .toEqual({ name: { contains: 'john' } });
    });

    it('should not emit mode on MySQL, where collation decides', () => {
      configureProvider('mysql');

      expect(SearchResolver.resolve({ field: 'name', like: 'john' }))
        .toEqual({ name: { contains: 'john' } });
    });

    it('should emit mode on MongoDB', () => {
      configureProvider('mongodb');

      expect(SearchResolver.resolve({ field: 'name', like: 'john' }))
        .toEqual({ name: { contains: 'john', mode: 'insensitive' } });
    });

    it('should not emit mode when Prisma is not configured', () => {
      expect(SearchResolver.resolve({ field: 'name', like: 'john' }))
        .toEqual({ name: { contains: 'john' } });
    });

    it('should carry the case mode through helpers and nested nodes', () => {
      configureProvider('postgresql');

      expect(SearchResolver.resolve(anyOf(['name', 'email'], { like: 'john' }))).toEqual({
        OR: [
          { name: { contains: 'john', mode: 'insensitive' } },
          { email: { contains: 'john', mode: 'insensitive' } }
        ]
      });
    });

    it('should not touch non-text operators', () => {
      configureProvider('postgresql');

      expect(SearchResolver.resolve({ field: 'status', in: ['A'] }))
        .toEqual({ status: { in: ['A'] } });

      expect(SearchResolver.resolve({ field: 'price', gte: 10 }))
        .toEqual({ price: { gte: 10, not: null } });
    });
  });

  describe('end-to-end shapes', () => {
    it('should build a multi-field text search', () => {
      const result = SearchResolver.merge(
        { isActive: { equals: true } },
        anyOf(['name', 'description'], { like: 'laptop' }),
        productModel
      );

      expect(result).toEqual({
        isActive: { equals: true },
        OR: [
          { name: { contains: 'laptop' } },
          { description: { contains: 'laptop' } }
        ]
      });
    });

    it('should build two independent groups', () => {
      const result = SearchResolver.merge(
        { isActive: { equals: true } },
        {
          and: [
            anyOf(['name', 'description'], { like: 'laptop' }),
            anyOf(['publishedAt', 'updatedAt'], { gte: CUTOFF })
          ]
        },
        productModel
      );

      expect(result).toEqual({
        isActive: { equals: true },
        AND: [
          { OR: [{ name: { contains: 'laptop' } }, { description: { contains: 'laptop' } }] },
          { OR: [{ publishedAt: { gte: CUTOFF, not: null } }, { updatedAt: { gte: CUTOFF } }] }
        ]
      });
    });

    it('should build the job-queue pattern', () => {
      const result = SearchResolver.merge(
        { status: { equals: 'PENDING' } },
        [
          { field: 'publishedAt', lte: CUTOFF, orNull: true },
          { field: 'price', lte: 3 }
        ],
        productModel
      );

      expect(result).toEqual({
        status: { equals: 'PENDING' },
        AND: [
          { OR: [{ publishedAt: { lte: CUTOFF } }, { publishedAt: { equals: null } }] },
          { price: { lte: 3 } }
        ]
      });
    });
  });
});
