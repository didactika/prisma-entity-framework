<!-- Assume Product and User entities are defined as shown in the main README.md -->

### Array Filters with OR/AND Grouping

```typescript
// Find jobs that are PENDING OR FAILED using array filters
const jobs = await Job.findByFilter(
    [{ status: 'PENDING' }, { status: 'FAILED' }],
    { filterGrouping: 'or' }  // 'and' is default
);

// Combine with rangeSearch and includeNull for nullable DateTime
const pendingJobs = await Job.findByFilter(
    { status: 'PENDING' },
    {
        search: {
            rangeSearch: [{
                keys: ['scheduledFor'],
                max: new Date(),
                includeNull: true  // Matches: scheduledFor <= now OR scheduledFor IS NULL
            }]
        },
        orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }]
    }
);
```

### Complex Search Query

```typescript
const products = await Product.findByFilter({
    // Base filter
    isActive: true
    //search by relations
    category: {
        name: "Electronics"
    }
}, {
    onlyOne: true, // Return only the first match, by default is false
    search: {
        // Text search across multiple fields
        stringSearch: [
            {
                keys: ['name', 'description'],
                value: 'laptop',
                mode: 'LIKE',
                grouping: 'or'
            }
        ],

        // Price range
        rangeSearch: [
            {
                keys: ['price'],
                min: 500,
                max: 2000
            }
        ],

        // Stock status
        listSearch: [
            {
                keys: ['status'],
                values: ['in_stock', 'low_stock'],
                mode: 'IN'
            }
        ],

        grouping: 'and'  // AND between search types
    },

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
