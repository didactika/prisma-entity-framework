<!-- Assume Product and User entities are defined as shown in the main README.md -->

### The search tree in one minute

`search` is a boolean expression made of four shapes:

```typescript
{ field: 'name', like: 'x' }  // a condition: one field, one operator
{ and: [ … ] }                // every child must match
{ or:  [ … ] }                // at least one child must match
{ not: … }                    // the child must not match
```

They compose to any depth, and an array at the root is shorthand for `and`.

```typescript
// name LIKE %john% OR email LIKE %john%
search: { or: [ { field: 'name', like: 'john' }, { field: 'email', like: 'john' } ] }

// same thing, with the shorthand
search: anyOf(['name', 'email'], { like: 'john' })

// (name LIKE a AND lastname LIKE a) OR status = 'X'
search: {
    or: [
        allOf(['name', 'lastname'], { like: 'a' }),
        { field: 'status', equals: 'X' }
    ]
}
```

| Operator | Matches |
| --- | --- |
| `equals` | exact value, or `null` |
| `like` | contains the substring |
| `startsWith` / `endsWith` | prefix / suffix |
| `in` / `notIn` | value is (not) one of a list |
| `hasSome` / `hasEvery` | a scalar-list column shares some / all values |
| `gte` / `lte` / `between` | order comparison; `between` is inclusive on both ends |
| `isNull` | the column is NULL |

Modifiers that can accompany a condition: `orNull` (also match NULL rows), `relation`
(`'some'` \| `'every'` \| `'none'`, for paths crossing a to-many relation) and `insensitive`
(override the global case setting).

### JSON columns and embedded documents

A dotted path reaches inside a JSON column the same way it crosses a relation: when a segment names
a `Json` column, the rest of the path addresses the value within it.

```typescript
// WHERE metadata->>'color' = 'red'   (PostgreSQL)
await Product.findByFilter({}, {
    search: { field: 'metadata.color', equals: 'red' }
});

// nested attribute, comparison, and a JSON array
await Product.findByFilter({}, {
    search: {
        and: [
            { field: 'metadata.dimensions.width', gte: 10 },
            { field: 'metadata.tags.0', equals: 'sale' },     // array element by index
            { field: 'metadata.tags', hasEvery: ['sale'] }     // array contains
        ]
    }
});
```

The rich operators (`like`, comparisons, `hasEvery`) are PostgreSQL-only — that is as far as Prisma's
JSON filtering reaches; MySQL supports `equals`, and SQLite has no JSON column type.

On **MongoDB**, model nested data as an embedded (composite) type and use an ordinary dotted path.
It resolves to Prisma's composite filter — `is` for one, the quantifier for a list — and you can
create the embedded data in the same call:

```typescript
await new Product({ name: 'X', dimensions: { width: 10, height: 5 }, specs: [{ key: 'cpu', value: 'x86' }] }).create();

await Product.findByFilter({}, {
    search: { field: 'dimensions.width', gte: 10 }          // single embedded → is
});

await Product.findByFilter({}, {
    search: { field: 'specs.value', equals: 'x86', relation: 'some' }  // list → some/every/none
});
```

### Typing a search

Searches are plain data, so they can be built anywhere and typed:

```typescript
import type { Search } from 'prisma-entity-framework';

const recent: Search.Condition = { field: 'createdAt', gte: cutoff };

function buildUserSearch(query: string): Search.Input {
    return [
        { field: 'isActive', equals: true },
        anyOf(['name', 'email'], { like: query })
    ];
}

await User.findByFilter({}, { search: buildUserSearch(input) });
```

Because a search is JSON, a client can send one over HTTP and the server can pass it straight to
`findByFilter`. Invalid conditions are dropped rather than trusted — see *Ignored input* below.

### Case sensitivity

`like`, `startsWith` and `endsWith` **ignore letter case by default on every provider**. Databases
disagree out of the box — PostgreSQL and MongoDB are case-sensitive, SQLite is not, MySQL depends on
the column collation — so the framework normalises it.

```typescript
// matches 'John', 'JOHN' and 'john' everywhere
await User.findByFilter({}, { search: { field: 'name', like: 'john' } });

// turn it off globally
configurePrisma(prisma, { caseInsensitiveSearch: false });

// or per condition, in either direction
{ field: 'code', like: 'X9', insensitive: false }    // exact casing
{ field: 'sku', equals: 'abc-1', insensitive: true } // equals is case-sensitive unless asked
```

`equals` stays case-sensitive by default; set `insensitive: true` when you want otherwise.

### Ignored input

A condition that cannot produce a meaningful constraint is dropped, and a group left with no
children is dropped with it:

```typescript
{ field: 'name', like: '' }        // empty or whitespace-only value
{ field: 'status', in: [] }        // empty list
{ field: 'price' }                 // range with neither bound
{ or: [] }                         // no children
```

This matters because an empty `OR` in Prisma matches *no* rows. A search built from a half-filled
form narrows the query by the fields that were filled and ignores the rest, instead of silently
returning nothing.

### Alternatives and null handling

```typescript
// Jobs that are PENDING or FAILED
const jobs = await Job.findByFilter({}, {
    search: { field: 'status', in: ['PENDING', 'FAILED'] }
});

// Due jobs: scheduled time passed OR never scheduled, and still within retries
const pendingJobs = await Job.findByFilter({ status: 'PENDING' }, {
    search: [
        { field: 'scheduledFor', lte: new Date(), orNull: true },
        { field: 'attempts', lte: 3 }
    ],
    orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }]
});
// status = 'PENDING'
//   AND (scheduledFor <= now OR scheduledFor IS NULL)
//   AND attempts <= 3
```

### Relation quantifiers

A dotted path crosses relations. To-one relations always use `is`; for to-many relations you pick
the quantifier:

```typescript
// at least one review scores 4+ (the default)
search: { field: 'reviews.rating', gte: 4 }

// every review scores 4+
search: { field: 'reviews.rating', gte: 4, relation: 'every' }

// no review scores 2 or less
search: { field: 'reviews.rating', lte: 2, relation: 'none' }
```

### Complex Search Query

```typescript
const products = await Product.findByFilter({
    // Base filter
    isActive: true,
    //search by relations
    category: {
        name: "Electronics"
    }
}, {
    onlyOne: true, // Return only the first match, by default is false
    search: [
        // Text search across multiple fields
        anyOf(['name', 'description'], { like: 'laptop' }),

        // Price range
        { field: 'price', between: [500, 2000] },

        // Stock status
        { field: 'status', in: ['in_stock', 'low_stock'] }
    ],

    // Pagination
    pagination: {
        page: 1,
        pageSize: 20,
        take: 20,
        skip: 0
    },

    // Sort by multiple fields (array format for multiple orderBy)
    orderBy: [
        { price: 'asc' },
        { name: 'asc' }
    ],  

    // Include relations
    relationsToInclude: [
        'category',
        { reviews: ['user'] }
    ]
});
```
