import { Search } from "./structures/types/search.types";
import { isValidValue } from "./utils/validation-utils";
import { getPrismaInstance, isCaseInsensitiveSearch, isPrismaConfigured } from "./config";
import { getDatabaseProviderCached } from "./utils/database-utils";

/** Providers that accept Prisma's explicit `mode: 'insensitive'` */
const PROVIDERS_WITH_CASE_MODE = new Set(["postgresql", "mongodb"]);

/** Internal view of a condition with every operator optional, for reading without narrowing */
type LooseCondition = Search.Target & {
    equals?: unknown;
    like?: string;
    startsWith?: string;
    endsWith?: string;
    in?: readonly unknown[];
    notIn?: readonly unknown[];
    hasSome?: readonly unknown[];
    hasEvery?: readonly unknown[];
    gte?: Search.Comparable;
    lte?: Search.Comparable;
    between?: readonly [Search.Comparable, Search.Comparable];
    isNull?: true;
};

/**
 * Resolves a search tree into a Prisma `where` fragment
 *
 * @remarks
 * The tree is the only grouping mechanism: `{ and: [...] }` and `{ or: [...] }` map to Prisma's
 * `AND`/`OR`, and a condition maps to a single field constraint. Resolution rules:
 *
 * - **R1** an array at the root is treated as `{ and: [...] }`
 * - **R2** `{ and }` → `{ AND: [...] }`; a single surviving child is emitted directly
 * - **R3** `{ or }` → `{ OR: [...] }`; a single surviving child is emitted directly
 * - **R4** `{ not }` → `{ NOT: ... }`
 * - **R5** a condition → `{ <expanded path>: <prisma operator> }`
 * - **R6** `orNull: true` wraps the condition in `{ OR: [cond, { field: { equals: null } }] }`
 * - **R7** dotted paths expand with `is` for to-one relations and `relation` for to-many
 * - **R8** invalid conditions and empty nodes are pruned; `OR: []` / `AND: []` are never emitted
 * - **R9** if nothing survives, the resolver returns `null` and `search` adds no clause
 * - **R10** order comparisons on a nullable column carry an implicit `not: null`
 *
 * @class SearchResolver
 */
export default class SearchResolver {
    /**
     * Resolves a search tree into a Prisma `where` fragment
     *
     * @param input - Search tree, or an array of nodes (treated as AND)
     * @param modelInfo - Prisma model information, used for relation and nullability detection
     * @returns The `where` fragment, or null when nothing survives pruning
     *
     * @example
     * ```typescript
     * SearchResolver.resolve({ or: [
     *   { field: 'name', like: 'john' },
     *   { field: 'email', like: 'john' }
     * ]});
     * // { OR: [ { name: { contains: 'john' } }, { email: { contains: 'john' } } ] }
     * ```
     */
    public static resolve(
        input: Search.Input,
        modelInfo?: any
    ): Record<string, any> | null {
        // R1 - an array at the root behaves like an `and` node
        const root: Search.Node = Array.isArray(input)
            ? { and: input as readonly Search.Node[] }
            : (input as Search.Node);

        return this.resolveNode(root, modelInfo);
    }

    /**
     * Merges a resolved search fragment into a base filter
     *
     * @param baseFilter - Already-resolved base filter (plain equality conditions)
     * @param input - Search tree
     * @param modelInfo - Prisma model information
     * @returns The combined `where` clause
     *
     * @remarks
     * The search fragment is merged key by key. When both sides declare the same boolean key
     * (`AND` / `OR` / `NOT`) the base filter's value is preserved and the search fragment is
     * nested under `AND`, so neither side is silently widened or dropped.
     */
    public static merge(
        baseFilter: Record<string, any>,
        input: Search.Input,
        modelInfo?: any
    ): Record<string, any> {
        const resolved = this.resolve(input, modelInfo);
        if (!resolved) return { ...baseFilter };

        const filter = { ...baseFilter };
        const collides = Object.keys(resolved).some(key => key in filter);

        if (!collides) return { ...filter, ...resolved };

        const existingAnd = Array.isArray(filter.AND)
            ? filter.AND
            : (filter.AND === undefined ? [] : [filter.AND]);

        filter.AND = [...existingAnd, resolved];
        return filter;
    }

    /**
     * Splits a search tree whose list condition exceeds a size limit into one tree per chunk
     *
     * @param input - Search tree to inspect
     * @param chunkSize - Maximum number of values a single query should carry
     * @returns One tree per chunk, or null when no condition exceeds the limit
     *
     * @remarks
     * Databases reject or choke on `IN` lists with tens of thousands of values, so the query has
     * to be split and the results merged. Only the first oversized condition is split — splitting
     * two at once would multiply into a cartesian product of queries.
     *
     * @example
     * ```typescript
     * const trees = SearchResolver.chunkLargeLists(
     *   { field: 'id', in: veryLongArray },
     *   10_000
     * );
     * // one tree per 10k slice, each otherwise identical
     * ```
     */
    public static chunkLargeLists(input: Search.Input, chunkSize: number): Search.Input[] | null {
        const root: Search.Node = Array.isArray(input)
            ? { and: input as readonly Search.Node[] }
            : (input as Search.Node);

        const oversized = this.findLargeList(root, chunkSize);
        if (!oversized) return null;

        const { key, values } = oversized;
        const chunks: unknown[][] = [];
        for (let index = 0; index < values.length; index += chunkSize) {
            chunks.push(values.slice(index, index + chunkSize));
        }

        return chunks.map(chunk => this.replaceFirstLargeList(root, chunkSize, key, chunk, { done: false }));
    }

    /**
     * Finds the first condition carrying an `in`/`notIn` list longer than the limit
     * @private
     */
    private static findLargeList(
        node: Search.Node,
        chunkSize: number
    ): { key: "in" | "notIn"; values: unknown[] } | null {
        if (!node || typeof node !== "object") return null;

        if (this.isAndNode(node)) return this.findLargeListIn(node.and, chunkSize);
        if (this.isOrNode(node)) return this.findLargeListIn(node.or, chunkSize);
        if (this.isNotNode(node)) return this.findLargeList(node.not, chunkSize);

        const condition = node as LooseCondition;
        for (const key of ["in", "notIn"] as const) {
            const values = condition[key];
            if (Array.isArray(values) && values.length > chunkSize) {
                return { key, values: [...values] };
            }
        }

        return null;
    }

    /** @private */
    private static findLargeListIn(
        children: readonly Search.Node[],
        chunkSize: number
    ): { key: "in" | "notIn"; values: unknown[] } | null {
        for (const child of children) {
            const found = this.findLargeList(child, chunkSize);
            if (found) return found;
        }
        return null;
    }

    /**
     * Rebuilds the tree with the first oversized list replaced by one chunk
     *
     * @param state - Carries the "already replaced" flag across the recursion
     * @private
     */
    private static replaceFirstLargeList(
        node: Search.Node,
        chunkSize: number,
        key: "in" | "notIn",
        chunk: unknown[],
        state: { done: boolean }
    ): Search.Node {
        if (this.isAndNode(node)) {
            return { and: node.and.map(child => this.replaceFirstLargeList(child, chunkSize, key, chunk, state)) };
        }

        if (this.isOrNode(node)) {
            return { or: node.or.map(child => this.replaceFirstLargeList(child, chunkSize, key, chunk, state)) };
        }

        if (this.isNotNode(node)) {
            return { not: this.replaceFirstLargeList(node.not, chunkSize, key, chunk, state) };
        }

        const condition = node as LooseCondition;
        const values = condition[key];

        if (!state.done && Array.isArray(values) && values.length > chunkSize) {
            state.done = true;
            return { ...condition, [key]: chunk } as Search.Condition;
        }

        return node;
    }

    /**
     * Resolves any node of the tree
     *
     * @returns The Prisma fragment, or null when the node contributes nothing
     * @private
     */
    private static resolveNode(node: Search.Node, modelInfo?: any): Record<string, any> | null {
        if (!node || typeof node !== "object") return null;

        if (this.isAndNode(node)) return this.resolveGroup(node.and, "AND", modelInfo);
        if (this.isOrNode(node)) return this.resolveGroup(node.or, "OR", modelInfo);

        if (this.isNotNode(node)) {
            const inner = this.resolveNode(node.not, modelInfo);
            return inner ? { NOT: inner } : null;
        }

        return this.resolveCondition(node as LooseCondition, modelInfo);
    }

    /**
     * Resolves an `and`/`or` node, pruning children that contribute nothing
     *
     * @returns null when no child survives; the lone child when only one does (R2/R3/R8)
     * @private
     */
    private static resolveGroup(
        children: readonly Search.Node[],
        operator: "AND" | "OR",
        modelInfo?: any
    ): Record<string, any> | null {
        if (!Array.isArray(children)) return null;

        const resolved = children
            .map(child => this.resolveNode(child, modelInfo))
            .filter((fragment): fragment is Record<string, any> => fragment !== null);

        if (resolved.length === 0) return null;
        if (resolved.length === 1) return resolved[0];

        return { [operator]: resolved };
    }

    /**
     * Resolves a single condition into a field constraint
     * @private
     */
    private static resolveCondition(
        condition: LooseCondition,
        modelInfo?: any
    ): Record<string, any> | null {
        const path = condition.field;
        if (typeof path !== "string" || path.trim() === "") return null;

        // A path that dives into a JSON column becomes a Prisma JSON filter instead of nesting.
        const json = modelInfo ? this.splitJsonPath(path, modelInfo) : null;
        if (json) {
            const jsonOperator = this.buildJsonOperator(condition, json.segments);
            if (!jsonOperator) return null;
            return this.expandPath(json.column, jsonOperator, modelInfo, condition.relation ?? "some");
        }

        const fieldInfo = modelInfo ? this.getFieldInfoForPath(path, modelInfo) : null;
        const operator = this.buildOperator(condition, fieldInfo);
        if (!operator) return null;

        const quantifier = condition.relation ?? "some";
        const constraint = this.expandPath(path, operator, modelInfo, quantifier);

        // R6 - "...or the field is null"
        if (condition.orNull) {
            return {
                OR: [
                    constraint,
                    this.expandPath(path, { equals: null }, modelInfo, quantifier)
                ]
            };
        }

        return constraint;
    }

    /**
     * Splits a dotted path where it enters a JSON column
     *
     * @param path - The condition's `field`, e.g. `'author.metadata.dimensions.width'`
     * @param modelInfo - Model information for the root of the path
     * @returns `{ column, segments }` when a `Json` field is crossed with a path remaining after
     * it — `column` is the path to the JSON column (relations included), `segments` the path
     * inside the JSON value with numeric-looking parts coerced to array indices. Null otherwise.
     * @private
     *
     * @remarks
     * A `Json` field with nothing after it is not a JSON *attribute* query — it is a plain
     * whole-column condition — so it returns null and the normal path applies.
     */
    private static splitJsonPath(
        path: string,
        modelInfo: any
    ): { column: string; segments: (string | number)[] } | null {
        const keys = path.split(".");
        let current = modelInfo;

        for (let index = 0; index < keys.length; index++) {
            const field = current?.fields?.find((f: any) => f.name === keys[index]);
            if (!field) return null;

            if (field.type === "Json") {
                const segments = keys.slice(index + 1);
                if (segments.length === 0) return null;

                return {
                    column: keys.slice(0, index + 1).join("."),
                    segments: segments.map(segment => this.toPathSegment(segment))
                };
            }

            if (field.kind !== "object") return null;

            current = this.getRelatedModelInfo(keys[index], current);
            if (!current) return null;
        }

        return null;
    }

    /** Coerces a numeric-looking JSON path segment to an array index */
    private static toPathSegment(segment: string): string | number {
        return /^\d+$/.test(segment) ? Number(segment) : segment;
    }

    /**
     * Translates the condition's operator into its Prisma equivalent
     *
     * @param condition - The condition being resolved
     * @param fieldInfo - Prisma field metadata for the target path, when resolvable
     * @returns The Prisma operator object, or null when the value is not usable
     * @private
     *
     * @remarks
     * Values that cannot produce a meaningful constraint — empty strings, empty arrays,
     * undefined bounds — return null so the caller can prune the condition (R8).
     */
    private static buildOperator(condition: LooseCondition, fieldInfo?: any): Record<string, any> | null {
        if (condition.isNull === true) return { equals: null };

        if ("equals" in condition) {
            if (condition.equals === null) return { equals: null };
            if (!isValidValue(condition.equals)) return null;

            // `equals` stays case-sensitive unless the condition asks otherwise
            return this.withCaseMode({ equals: condition.equals }, condition, condition.insensitive === true);
        }

        if ("like" in condition) {
            if (!isValidValue(condition.like)) return null;
            return this.withCaseMode({ contains: condition.like }, condition);
        }

        if ("startsWith" in condition) {
            if (!isValidValue(condition.startsWith)) return null;
            return this.withCaseMode({ startsWith: condition.startsWith }, condition);
        }

        if ("endsWith" in condition) {
            if (!isValidValue(condition.endsWith)) return null;
            return this.withCaseMode({ endsWith: condition.endsWith }, condition);
        }

        if ("in" in condition) {
            return isValidValue(condition.in) ? { in: [...condition.in!] } : null;
        }

        if ("notIn" in condition) {
            return isValidValue(condition.notIn) ? { notIn: [...condition.notIn!] } : null;
        }

        if ("hasSome" in condition) {
            return isValidValue(condition.hasSome) ? { hasSome: [...condition.hasSome!] } : null;
        }

        if ("hasEvery" in condition) {
            return isValidValue(condition.hasEvery) ? { hasEvery: [...condition.hasEvery!] } : null;
        }

        return this.buildRangeOperator(condition, fieldInfo);
    }

    /**
     * Adds Prisma's case mode to a text operator when it is wanted and the provider supports it
     *
     * @param operator - The Prisma operator built so far
     * @param condition - The condition being resolved, for its `insensitive` override
     * @param fallback - What to do when the condition says nothing; defaults to the global setting
     * @private
     *
     * @remarks
     * Only PostgreSQL and MongoDB accept `mode`. SQLite and MySQL reject it outright and are
     * already case-insensitive by default, so there the flag is simply not emitted and the
     * behaviour matches anyway. Without a configured Prisma client the provider is unknown, so
     * nothing is emitted — a query that never runs is better than one Prisma refuses.
     */
    private static withCaseMode(
        operator: Record<string, any>,
        condition: LooseCondition,
        fallback: boolean = isCaseInsensitiveSearch()
    ): Record<string, any> {
        const wantsInsensitive = condition.insensitive ?? fallback;
        if (!wantsInsensitive) return operator;
        if (!this.providerSupportsCaseMode()) return operator;

        return { ...operator, mode: "insensitive" };
    }

    /**
     * Whether the configured provider accepts Prisma's `mode: 'insensitive'`
     * @private
     */
    private static providerSupportsCaseMode(): boolean {
        if (!isPrismaConfigured()) return false;

        try {
            return PROVIDERS_WITH_CASE_MODE.has(getDatabaseProviderCached());
        } catch {
            return false;
        }
    }

    /**
     * Builds a Prisma JSON filter for a path that dives into a JSON column
     *
     * @returns The `{ path, <json operator> }` object, or null when the operator is unusable
     * or has no JSON equivalent
     * @private
     *
     * @param condition - The condition being resolved
     * @param segments - The path inside the JSON value, from {@link splitJsonPath}
     *
     * @remarks
     * The path format follows the provider: PostgreSQL takes an array of segments, MySQL a
     * `$.a.b` JSONPath string. The string operators map to Prisma's `string_contains` family and
     * `hasEvery` to `array_contains` (does the JSON array hold all of these values) — all of which
     * only PostgreSQL implements. MySQL supports `equals` alone. `in` / `notIn` / `hasSome` /
     * `isNull` have no JSON equivalent and return null so the condition is pruned.
     */
    private static buildJsonOperator(
        condition: LooseCondition,
        segments: (string | number)[]
    ): Record<string, any> | null {
        const path = this.formatJsonPath(segments);
        const insensitive = (condition.insensitive ?? isCaseInsensitiveSearch()) && this.providerSupportsCaseMode();
        const mode = insensitive ? { mode: "insensitive" } : {};

        if ("equals" in condition) {
            if (condition.equals === null) return { path, equals: null };
            return isValidValue(condition.equals) ? { path, equals: condition.equals } : null;
        }

        if ("like" in condition) {
            return isValidValue(condition.like) ? { path, string_contains: condition.like, ...mode } : null;
        }

        if ("startsWith" in condition) {
            return isValidValue(condition.startsWith) ? { path, string_starts_with: condition.startsWith, ...mode } : null;
        }

        if ("endsWith" in condition) {
            return isValidValue(condition.endsWith) ? { path, string_ends_with: condition.endsWith, ...mode } : null;
        }

        // A JSON array holding all the listed values
        if ("hasEvery" in condition) {
            return isValidValue(condition.hasEvery) ? { path, array_contains: [...condition.hasEvery!] } : null;
        }

        const range = this.rangeBounds(condition);
        if (range) return { path, ...range };

        // No JSON equivalent for in / notIn / hasSome / isNull
        return null;
    }

    /**
     * Formats a JSON path for the configured provider
     *
     * @remarks
     * PostgreSQL wants an array of **string** segments — an array index is a numeric string like
     * `'0'`, and Prisma rejects an actual number here. MySQL wants a `$.a.b` JSONPath string with
     * array indices rendered as `[n]`. Without a configured provider the string-array form is
     * used, which is what PostgreSQL and MongoDB expect.
     * @private
     */
    private static formatJsonPath(segments: readonly (string | number)[]): string | string[] {
        if (this.currentProvider() === "mysql") {
            return segments.reduce<string>((acc, segment) => {
                return typeof segment === "number" ? `${acc}[${segment}]` : `${acc}.${segment}`;
            }, "$");
        }

        return segments.map(segment => String(segment));
    }

    /**
     * The configured database provider, or null when it cannot be determined
     * @private
     */
    private static currentProvider(): string | null {
        if (!isPrismaConfigured()) return null;

        try {
            return getDatabaseProviderCached();
        } catch {
            return null;
        }
    }

    /**
     * Extracts the gte/lte bounds of a condition from `between`, `gte` and/or `lte`
     *
     * @returns The bounds object, or null when neither bound is present
     * @private
     */
    private static rangeBounds(condition: LooseCondition): Record<string, any> | null {
        const range: Record<string, any> = {};

        if (Array.isArray(condition.between) && condition.between.length === 2) {
            const [min, max] = condition.between;
            if (min !== undefined && min !== null) range.gte = min;
            if (max !== undefined && max !== null) range.lte = max;
        } else {
            if (condition.gte !== undefined && condition.gte !== null) range.gte = condition.gte;
            if (condition.lte !== undefined && condition.lte !== null) range.lte = condition.lte;
        }

        return Object.keys(range).length === 0 ? null : range;
    }

    /**
     * Builds a range operator from `between`, `gte` and/or `lte`
     * @private
     */
    private static buildRangeOperator(condition: LooseCondition, fieldInfo?: any): Record<string, any> | null {
        const range = this.rangeBounds(condition);
        if (!range) return null;

        // R10 - an order comparison on a nullable column excludes NULL rows explicitly,
        // unless the caller asked for them back with orNull
        if (!condition.orNull && this.shouldExcludeNull(fieldInfo)) {
            range.not = null;
        }

        return range;
    }

    /**
     * Whether an implicit `not: null` should be added for an order comparison
     *
     * @remarks
     * Without model information the column is assumed nullable, which keeps the generated
     * clause explicit rather than relying on the database's three-valued logic.
     * @private
     */
    private static shouldExcludeNull(fieldInfo?: any): boolean {
        if (!fieldInfo) return true;
        return fieldInfo.isRequired === false;
    }

    /**
     * Expands a dotted path into a nested Prisma constraint
     *
     * @param path - Dot-separated path, e.g. `'author.profile.name'`
     * @param leaf - The operator object to place at the end of the path
     * @param modelInfo - Model information for the root of the path
     * @param quantifier - Quantifier applied to every to-many relation in the path
     * @private
     *
     * @remarks
     * Without model information the path becomes a plain nested object, with no relation wrappers.
     */
    private static expandPath(
        path: string,
        leaf: Record<string, any>,
        modelInfo: any,
        quantifier: Search.RelationQuantifier
    ): Record<string, any> {
        const keys = path.split(".");

        // Map the model that owns each segment, walking left to right
        const modelPerKey: Array<any> = [modelInfo ?? null];
        for (let index = 0; index < keys.length - 1; index++) {
            modelPerKey.push(this.getRelatedModelInfo(keys[index], modelPerKey[index]));
        }

        // Build from the inside out
        let result: Record<string, any> = leaf;
        for (let index = keys.length - 1; index >= 0; index--) {
            result = this.wrapSegment(keys[index], result, modelPerKey[index], quantifier);
        }

        return result;
    }

    /**
     * Wraps one path segment, adding a relation operator when the segment is a relation
     * @private
     */
    private static wrapSegment(
        key: string,
        value: Record<string, any>,
        modelInfo: any,
        quantifier: Search.RelationQuantifier
    ): Record<string, any> {
        const field = modelInfo?.fields?.find((f: any) => f.name === key);

        if (!field || field.kind !== "object") return { [key]: value };

        // To-one relations are always traversed with `is`; the quantifier is for lists
        return field.isList
            ? { [key]: { [quantifier]: value } }
            : { [key]: { is: value } };
    }

    /**
     * Resolves the Prisma field metadata for a dotted path
     *
     * @returns The field definition, or null when the path cannot be resolved
     * @private
     */
    private static getFieldInfoForPath(path: string, modelInfo: any): any | null {
        const keys = path.split(".");
        let current = modelInfo;

        for (let index = 0; index < keys.length; index++) {
            const field = current?.fields?.find((f: any) => f.name === keys[index]);
            if (!field) return null;

            if (index === keys.length - 1) return field;
            if (field.kind !== "object") return null;

            current = this.getRelatedModelInfo(keys[index], current);
            if (!current) return null;
        }

        return null;
    }

    /**
     * Resolves the field metadata for the model or embedded type a field points at
     *
     * @remarks
     * Relations point at models; MongoDB embedded/composite fields point at *types*. Prisma keeps
     * those in separate maps (`models` and `types`) of the runtime data model, so both are checked.
     * Without this, an embedded subfield's nullability could not be read, and R10 would add a
     * spurious `not: null` that MongoDB rejects on a required subfield.
     * @private
     */
    private static getRelatedModelInfo(fieldName: string, modelInfo: any): any | null {
        const field = modelInfo?.fields?.find((f: any) => f.name === fieldName);
        if (!field || field.kind !== "object") return null;

        try {
            const runtimeDataModel = (getPrismaInstance() as any)?._runtimeDataModel;
            return runtimeDataModel?.models?.[field.type]
                ?? runtimeDataModel?.types?.[field.type]
                ?? null;
        } catch {
            return null;
        }
    }

    private static isAndNode(node: Search.Node): node is Search.AndNode {
        return Array.isArray((node as Search.AndNode).and);
    }

    private static isOrNode(node: Search.Node): node is Search.OrNode {
        return Array.isArray((node as Search.OrNode).or);
    }

    private static isNotNode(node: Search.Node): node is Search.NotNode {
        // A condition always carries `field`; only a NOT node has `not` without it
        if (typeof (node as LooseCondition).field === "string") return false;

        const candidate = (node as Search.NotNode).not;
        return candidate !== undefined && candidate !== null && typeof candidate === "object";
    }
}
