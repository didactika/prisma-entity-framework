
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
        pageSize: 20
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
import {
    createOptimalBatches,
    createBatchMetrics,
    withRetry
} from 'prisma-entity-framework';

const metrics = createBatchMetrics();
const batches = createOptimalBatches(largeDataset, 'createMany');

for (const batch of batches) {
    const startTime = Date.now();

    await withRetry(
        () => User.createMany(batch),
        { maxRetries: 3, initialDelayMs: 100 }
    );

    metrics.recordBatch(batch.length, Date.now() - startTime);
}

console.log('Performance:', metrics.getStats());
// {
//   totalBatches: 10,
//   totalItems: 10000,
//   totalTime: 45000,
//   avgBatchSize: 1000,
//   avgBatchTime: 4500,
//   itemsPerSecond: 222
// }
```
