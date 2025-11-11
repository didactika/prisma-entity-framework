/**
 * Example demonstrating database capability detection usage
 * This file serves as documentation and a working example
 */

import { createTestDb, type TestDbInstance } from './test-db';
import { 
  skipIfNotSupported, 
  testIf, 
  describeIf,
  getMaxConcurrency,
  PerformanceMetrics 
} from './test-helpers';

/**
 * Example 1: Using TestDbInstance with full capability detection
 */
describe('Example: Capability-Based Testing', () => {
  let db: TestDbInstance;

  beforeAll(async () => {
    // Create test database with capability logging
    db = await createTestDb(false); // Set to true to see capability details
    
    console.log(`\n📊 Testing with ${db.provider.toUpperCase()}`);
    console.log(`   JSON Support: ${db.capabilities.supportsJSON ? '✅' : '❌'}`);
    console.log(`   Scalar Arrays: ${db.capabilities.supportsScalarArrays ? '✅' : '❌'}`);
    console.log(`   Many-to-Many: ${db.capabilities.supportsManyToMany ? '✅' : '❌'}`);
    console.log(`   Max Concurrency: ${db.capabilities.maxConcurrency}\n`);
  });

  afterAll(async () => {
    await db.cleanup();
  });

  /**
   * Example 2: Skip entire test suite if capability not supported
   */
  describe('JSON Field Operations', () => {
    it('should handle JSON data', async () => {
      if (skipIfNotSupported('supportsJSON', 'JSON Field Operations')) {
        return; // Skip this test
      }
      
      // This test only runs on databases that support JSON
      expect(db.capabilities.supportsJSON).toBe(true);
    });
  });

  /**
   * Example 3: Conditional test using testIf helper
   */
  testIf('supportsScalarArrays')('should handle scalar arrays', async () => {
    // This test only runs on PostgreSQL
    expect(db.capabilities.supportsScalarArrays).toBe(true);
  });

  /**
   * Example 4: Conditional describe block using describeIf
   */
  describeIf('supportsManyToMany')('Many-to-Many Relationships', () => {
    it('should create entities with relations', async () => {
      // This suite only runs on relational databases
      expect(db.capabilities.supportsManyToMany).toBe(true);
    });
  });

  /**
   * Example 5: Database-specific behavior
   */
  it('should use correct ID type', async () => {
    await db.clear();
    
    const user = await db.client.user.create({
      data: {
        name: 'Test User',
        email: 'test@example.com',
      },
    });

    // ID type varies by database
    if (db.capabilities.idType === 'number') {
      expect(typeof user.id).toBe('number');
    } else {
      expect(typeof user.id).toBe('string');
    }
  });

  /**
   * Example 6: Parallel operations with database-specific concurrency
   */
  it('should respect database concurrency limits', async () => {
    const maxConcurrency = getMaxConcurrency();
    
    // Different databases have different optimal concurrency
    if (db.provider === 'sqlite') {
      expect(maxConcurrency).toBe(1); // Sequential only
    } else if (db.provider === 'mongodb') {
      expect(maxConcurrency).toBe(2); // Conservative
    } else {
      expect(maxConcurrency).toBe(8); // High concurrency for MySQL/PostgreSQL
    }
  });

  /**
   * Example 7: Performance metrics collection
   */
  it('should collect performance metrics', async () => {
    const metrics = new PerformanceMetrics();
    
    await db.clear();
    
    // Measure operation time
    const start = Date.now();
    await db.seed();
    const duration = Date.now() - start;
    
    metrics.record('seed-operation', duration);
    
    expect(metrics.getAverage('seed-operation')).toBeGreaterThan(0);
    expect(metrics.getValues('seed-operation')).toHaveLength(1);
  });

  /**
   * Example 8: Capability-aware test logic
   */
  it('should adapt test behavior based on capabilities', async () => {
    await db.clear();
    
    const users = [
      { name: 'User 1', email: 'user1@example.com' },
      { name: 'User 2', email: 'user2@example.com' },
    ];

    if (db.capabilities.supportsSkipDuplicates) {
      // Use skipDuplicates on databases that support it
      const result = await db.client.user.createMany({
        data: users,
        skipDuplicates: true,
      });
      expect(result.count).toBe(2);
    } else {
      // Fall back to individual creates on databases that don't
      for (const user of users) {
        await db.client.user.create({ data: user });
      }
      const count = await db.client.user.count();
      expect(count).toBe(2);
    }
  });
});

/**
 * Example 9: Provider-specific test suite
 */
describe('Example: Provider-Specific Tests', () => {
  let db: TestDbInstance;

  beforeAll(async () => {
    db = await createTestDb(false);
  });

  afterAll(async () => {
    await db.cleanup();
  });

  it('should test provider-specific features', async () => {
    // This test adapts based on the current provider
    if (db.provider === 'postgresql') {
      expect(db.capabilities.supportsScalarArrays).toBe(true);
    } else if (db.provider === 'mongodb') {
      expect(db.capabilities.idType).toBe('string');
    } else if (db.provider === 'sqlite') {
      expect(db.capabilities.maxConcurrency).toBe(1);
    } else if (db.provider === 'mysql') {
      expect(db.capabilities.supportsJSON).toBe(true);
    }
  });
});
