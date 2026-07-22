import { Search } from "./structures/types/search.types";

/**
 * `Omit` that distributes over a union instead of collapsing it
 *
 * @remarks
 * A condition is `Target & Operator`, and `Operator` is a union. A plain `Omit` would flatten
 * that union into a single object type and lose every operator key, so each member has to be
 * mapped on its own.
 */
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

/** A condition without its target field — the operator plus the per-field modifiers */
type FieldlessCondition = DistributiveOmit<Search.Condition, "field">;

/**
 * Applies the same condition to several fields, combined with OR
 *
 * @param fields - Field paths to apply the condition to
 * @param condition - The condition without its `field`
 * @returns A plain `{ or: [...] }` node — or the lone condition when a single field is given
 *
 * @remarks
 * Pure sugar: the result is an ordinary node, so it stays JSON-serializable and the resolver
 * knows nothing about this helper. Writing the `or` by hand is exactly equivalent.
 *
 * @example
 * ```typescript
 * anyOf(['name', 'email'], { like: 'john' })
 * // { or: [ { field: 'name', like: 'john' }, { field: 'email', like: 'john' } ] }
 * ```
 */
export function anyOf(fields: readonly string[], condition: FieldlessCondition): Search.Node {
    return combine(fields, condition, "or");
}

/**
 * Applies the same condition to several fields, combined with AND
 *
 * @param fields - Field paths to apply the condition to
 * @param condition - The condition without its `field`
 * @returns A plain `{ and: [...] }` node — or the lone condition when a single field is given
 *
 * @example
 * ```typescript
 * allOf(['name', 'lastname'], { like: 'a' })
 * // { and: [ { field: 'name', like: 'a' }, { field: 'lastname', like: 'a' } ] }
 * ```
 */
export function allOf(fields: readonly string[], condition: FieldlessCondition): Search.Node {
    return combine(fields, condition, "and");
}

/**
 * Builds one condition per field and wraps them in the requested node
 *
 * @remarks
 * A single field needs no wrapper, and an empty list produces an empty node that the resolver
 * prunes — so neither case can leak an `OR: []` into the query.
 */
function combine(
    fields: readonly string[],
    condition: FieldlessCondition,
    operator: "and" | "or"
): Search.Node {
    const conditions = fields.map(field => ({ ...condition, field }) as Search.Condition);

    if (conditions.length === 1) return conditions[0];

    return operator === "or" ? { or: conditions } : { and: conditions };
}
