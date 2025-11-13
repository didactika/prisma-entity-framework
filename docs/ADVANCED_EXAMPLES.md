<!-- Assume Product and User entities are defined as shown in the main README.md -->

### Complex Search Query

```typescript
const products = await Product.findByFilter({
    // Base filter
    categoryId: { in: [1, 2, 3] },
    isActive: true
}, {
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

    // Sort by relevance
    orderBy: {
        price: 'asc',
        name: 'asc'
    },

    // Include relations
    relationsToInclude: [
        'category',
        { reviews: ['user'] }
    ]
});
```

### Batch Operations with Performance Monitoring

```typescript
import { processBatches, getOptimalBatchSize } from 'prisma-entity-framework';

// Assume User entity is defined as in the README
const largeDataset = Array.from({ length: 10000 }, (_, i) => ({
    name: `User ${i}`,
    email: `user${i}@example.com`,
}));

const batchSize = getOptimalBatchSize('createMany');
const startTime = Date.now();

const result = await processBatches(
    largeDataset,
    batchSize,
    async (batch) => {
        return User.createMany(batch);
    },
    { parallel: true, concurrency: 4 }
);

const totalTime = Date.now() - startTime;
console.log(`Processed ${largeDataset.length} items in ${totalTime}ms`);
console.log(`Successful batches: ${result.successfulBatches}, Failed batches: ${result.failedBatches}`);
```
