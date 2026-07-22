import type { TransactionClient } from '../../transaction-context';

/**
 * Search contract: a tree of boolean nodes.
 *
 * @remarks
 * Nesting *is* grouping. There are three concepts and no flags:
 * - `{ and: [...] }` — every child must match
 * - `{ or: [...] }` — at least one child must match
 * - a condition — one field, one operator
 *
 * To answer "is this AND or OR?" you look at the parent node. Always, with no exceptions.
 */
export namespace Search {
    /** Values that support order comparison */
    export type Comparable = number | Date | string;

    /**
     * Quantifier applied to the list relations a path traverses.
     *
     * @remarks
     * Only meaningful when the path crosses a to-many relation (`reviews.rating`).
     * - `'some'` (default) — at least one related row matches
     * - `'every'` — all related rows match (vacuously true when there are none)
     * - `'none'` — no related row matches
     *
     * To-one relations are always traversed with `is` and ignore this field.
     */
    export type RelationQuantifier = 'some' | 'every' | 'none';

    /** Every operator key the contract knows about */
    type OperatorKey =
        | "equals"
        | "like"
        | "startsWith"
        | "endsWith"
        | "in"
        | "notIn"
        | "hasSome"
        | "hasEvery"
        | "gte"
        | "lte"
        | "between"
        | "isNull";

    /**
     * Marks every operator key this union member does *not* own as forbidden.
     *
     * @remarks
     * Without this, TypeScript accepts `{ like: 'a', gte: 5 }`: excess-property checking against
     * a union allows any key that exists in *some* member. Declaring the others as `?: never`
     * makes a second operator a compile error, which is what "exactly one operator" should mean.
     */
    type Only<TOperator, TKeys extends OperatorKey> =
        TOperator & Partial<Record<Exclude<OperatorKey, TKeys>, never>>;

    /**
     * The operator of a condition. Exactly one per condition, enforced by the type.
     *
     * @remarks
     * `gte` and `lte` are the one pair that may be combined; `between` is sugar for both at once.
     */
    export type Operator =
        | Only<{ equals: unknown }, "equals">
        | Only<{ like: string }, "like">
        | Only<{ startsWith: string }, "startsWith">
        | Only<{ endsWith: string }, "endsWith">
        | Only<{ in: readonly unknown[] }, "in">
        | Only<{ notIn: readonly unknown[] }, "notIn">
        | Only<{ hasSome: readonly unknown[] }, "hasSome">
        | Only<{ hasEvery: readonly unknown[] }, "hasEvery">
        | Only<{ gte: Comparable; lte?: Comparable }, "gte" | "lte">
        | Only<{ lte: Comparable; gte?: Comparable }, "gte" | "lte">
        | Only<{ between: readonly [Comparable, Comparable] }, "between">
        | Only<{ isNull: true }, "isNull">;

    /** What a condition points at, and how the path is resolved */
    export type Target = {
        /**
         * A single field. Dots traverse relations: `'author.profile.name'`.
         *
         * @remarks
         * A condition targets one field and nothing else. To apply the same operator to several
         * fields use several conditions inside an `or`/`and` node — grouping always lives in the
         * tree, never inside the leaf. See {@link anyOf} / {@link allOf} for the shorthand.
         */
        field: string;

        /** Quantifier for the list relations in the path. Defaults to `'some'`. */
        relation?: RelationQuantifier;

        /**
         * Also match rows where the field is NULL.
         *
         * @remarks
         * Wraps the condition in `{ OR: [ <cond>, { field: { equals: null } } ] }`.
         * On order comparisons it also suppresses the implicit `not: null` (see the resolver).
         */
        orNull?: boolean;

        /**
         * Whether this condition ignores letter case.
         *
         * @remarks
         * Overrides the global `caseInsensitiveSearch` setting for this condition alone. Applies
         * to `like`, `startsWith`, `endsWith` and `equals`. When omitted, the three text operators
         * follow the global setting (insensitive by default) and `equals` stays exact.
         *
         * @remarks
         * How far this reaches depends on the provider, because only PostgreSQL and MongoDB accept
         * Prisma's explicit case mode:
         *
         * - `like` / `startsWith` / `endsWith` behave consistently **everywhere**: PostgreSQL and
         *   MongoDB get the explicit mode, and SQLite and MySQL already match case-insensitively.
         * - `insensitive` on `equals` is honoured on **PostgreSQL and MongoDB only**. SQLite
         *   compares with `=` case-sensitively and offers no per-query override; MySQL follows the
         *   column collation. Treat it as a no-op there.
         * - `insensitive: false` can only be *enforced* on PostgreSQL and MongoDB, for the same
         *   reason — SQLite's `LIKE` is case-insensitive and cannot be made otherwise per query.
         *
         * @example
         * ```typescript
         * { field: 'sku', equals: 'abc-1', insensitive: true }   // match ABC-1 too
         * { field: 'code', like: 'X9', insensitive: false }      // exact casing only
         * ```
         */
        insensitive?: boolean;
    };

    /** A leaf of the tree */
    export type Condition = Target & Operator;

    /** Every child must match */
    export type AndNode = { and: readonly Node[] };

    /** At least one child must match */
    export type OrNode = { or: readonly Node[] };

    /** The child must not match */
    export type NotNode = { not: Node };

    /** Any node of the tree */
    export type Node = Condition | AndNode | OrNode | NotNode;

    /**
     * What `options.search` accepts.
     *
     * @remarks
     * An array at the root is equivalent to `{ and: [...] }`.
     *
     * @example
     * ```typescript
     * // one condition
     * { field: 'name', like: 'john' }
     *
     * // array at the root = AND
     * [ { field: 'isActive', equals: true }, { field: 'price', gte: 100 } ]
     *
     * // (name LIKE a AND lastname LIKE a) OR status = 'X'
     * { or: [
     *     { and: [ { field: 'name', like: 'a' }, { field: 'lastname', like: 'a' } ] },
     *     { field: 'status', equals: 'X' }
     * ] }
     * ```
     */
    export type Input = Node | readonly Node[];
}

export namespace FindByFilterOptions {
    export type PaginationOptions = {
        page: number;
        pageSize: number;
        take: number;
        skip: number;
    }

    export type PaginatedResponse<T> = {
        total: number;
        page: number;
        pageSize: number;
        data: T[];
    }

    export type NestedRelations = Array<{ [relation: string]: NestedRelations }> | "*";

    export type OrderByItem = Record<string, 'asc' | 'desc'>;
    export type OrderBy = OrderByItem | OrderByItem[];

    export type Options = {
        onlyOne?: boolean;
        relationsToInclude?: NestedRelations;
        /** Boolean search tree. See {@link Search.Input}. */
        search?: Search.Input;
        pagination?: PaginationOptions;
        orderBy?: OrderBy;
        parallel?: boolean;
        concurrency?: number;
        rateLimit?: number;
        /** Explicit transactional client for running inside a transaction */
        tx?: TransactionClient;
    };

    export const defaultOptions: Options = {
        onlyOne: false,
        relationsToInclude: [],
        search: undefined,
        pagination: undefined,
        orderBy: undefined,
        parallel: undefined,
        concurrency: undefined,
        rateLimit: undefined
    }
}
