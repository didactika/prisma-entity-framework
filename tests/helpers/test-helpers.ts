/**
 * Test Helper Utilities
 * Common utilities for capability-based testing
 * 
 * This module provides a comprehensive set of utilities for writing database-agnostic tests
 * that automatically adapt to different database capabilities.
 * 
 * ## Capability-Based Test Skipping
 * - `skipIfNotSupported()` - Skip test suites based on database capabilities
 * - `testIf()` - Conditionally run individual tests
 * - `describeIf()` - Conditionally run test suites
 * 
 * ## Database Detection
 * - `isProvider()` - Check if current database matches a specific provider
 * - `getIdType()` - Get expected ID type (number or string)
 * - `getMaxConcurrency()` - Get maximum recommended concurrency
 * - `getDatabaseConfig()` - Get comprehensive database configuration
 * 
 * ## Assertions
 * - `assertCorrectIdType()` - Assert ID has correct type for database
 * - `assertJSONEquals()` - Assert JSON values match (handles string/object differences)
 * - `assertArrayEquals()` - Assert arrays match exactly
 * - `assertPerformance()` - Assert operation completed within time limit
 * 
 * ## Test Data Helpers
 * - `createTestDataHelper()` - Create database-specific test data generator
 * - `createTestBatch()` - Generate batch of test records
 * 
 * ## Performance Utilities
 * - `PerformanceMetrics` - Class for collecting and reporting performance metrics
 * - `measureTime()` - Measure execution time of async operations
 * 
 * ## Async Utilities
 * - `waitFor()` - Wait for condition with timeout
 * - `retryWithBackoff()` - Retry operations with exponential backoff
 * 
 * ## Debugging
 * - `logTestContext()` - Log test execution context for debugging
 * 
 * @example
 * ```typescript
 * import { skipIfNotSupported, measureTime, PerformanceMetrics } from './test-helpers';
 * 
 * describe('JSON Field Tests', () => {
 *   beforeAll(() => {
 *     if (skipIfNotSupported('supportsJSON', 'JSON Field Tests')) {
 *       return;
 *     }
 *   });
 *   
 *   it('should create with JSON', async () => {
 *     const { duration } = await measureTime(async () => {
 *       await client.product.create({ data: { metadata: { key: 'value' } } });
 *     });
 *     console.log(`Created in ${duration}ms`);
 *   });
 * });
 * ```
 */

import { 
  detectDatabaseCapabilities, 
  shouldSkipTest as shouldSkipTestBase,
  type DatabaseCapabilities 
} from './database-detector';

/**
 * Skips a test suite if the required capability is not supported
 * Use this in beforeAll to conditionally skip entire test suites
 * 
 * @param capability - The required capability
 * @param suiteName - Name of the test suite
 * @returns true if the suite should be skipped
 * 
 * @example
 * ```typescript
 * describe('JSON Field Tests', () => {
 *   beforeAll(() => {
 *     if (skipIfNotSupported('supportsJSON', 'JSON Field Tests')) {
 *       return;
 *     }
 *   });
 *   
 *   it('should handle JSON data', () => {
 *     // Test implementation
 *   });
 * });
 * ```
 */
export function skipIfNotSupported(
  capability: keyof DatabaseCapabilities,
  suiteName?: string
): boolean {
  return shouldSkipTestBase(capability, suiteName);
}

/**
 * Conditionally runs a test based on database capability
 * Wrapper around Jest's test.skipIf for capability-based testing
 * 
 * @param capability - The required capability
 * @returns Jest test function (it or it.skip)
 * 
 * @example
 * ```typescript
 * testIf('supportsJSON')('should create with JSON fields', async () => {
 *   // Test implementation
 * });
 * ```
 */
export function testIf(capability: keyof DatabaseCapabilities) {
  const capabilities = detectDatabaseCapabilities();
  const value = capabilities[capability];
  const isSupported = typeof value === 'boolean' ? value : true;
  
  return isSupported ? it : it.skip;
}

/**
 * Conditionally runs a describe block based on database capability
 * 
 * @param capability - The required capability
 * @returns Jest describe function (describe or describe.skip)
 * 
 * @example
 * ```typescript
 * describeIf('supportsJSON')('JSON Field Operations', () => {
 *   it('should create with JSON', () => {
 *     // Test implementation
 *   });
 * });
 * ```
 */
export function describeIf(capability: keyof DatabaseCapabilities) {
  const capabilities = detectDatabaseCapabilities();
  const value = capabilities[capability];
  const isSupported = typeof value === 'boolean' ? value : true;
  
  return isSupported ? describe : describe.skip;
}

/**
 * Checks if the current database is a specific provider
 * 
 * @param provider - The provider to check
 * @returns true if current database matches the provider
 * 
 * @example
 * ```typescript
 * if (isProvider('postgresql')) {
 *   // PostgreSQL-specific test logic
 * }
 * ```
 */
export function isProvider(provider: DatabaseCapabilities['provider']): boolean {
  const capabilities = detectDatabaseCapabilities();
  return capabilities.provider === provider;
}

/**
 * Gets the expected ID type for assertions
 * 
 * @returns 'number' or 'string' based on database provider
 * 
 * @example
 * ```typescript
 * const user = await client.user.create({ data: { name: 'Test' } });
 * if (getIdType() === 'number') {
 *   expect(typeof user.id).toBe('number');
 * } else {
 *   expect(typeof user.id).toBe('string');
 * }
 * ```
 */
export function getIdType(): 'number' | 'string' {
  const capabilities = detectDatabaseCapabilities();
  return capabilities.idType;
}

/**
 * Gets the maximum concurrency for the current database
 * 
 * @returns Maximum recommended concurrency level
 * 
 * @example
 * ```typescript
 * const concurrency = getMaxConcurrency();
 * configurePrisma(client, { maxConcurrency: concurrency });
 * ```
 */
export function getMaxConcurrency(): number {
  const capabilities = detectDatabaseCapabilities();
  return capabilities.maxConcurrency;
}

/**
 * Asserts that an ID has the correct type for the current database
 * 
 * @param id - The ID to check
 * @param message - Optional custom error message
 * 
 * @example
 * ```typescript
 * const user = await client.user.create({ data: { name: 'Test' } });
 * assertCorrectIdType(user.id);
 * ```
 */
export function assertCorrectIdType(id: any, message?: string): void {
  const expectedType = getIdType();
  const actualType = typeof id;
  
  if (actualType !== expectedType) {
    throw new Error(
      message || 
      `Expected ID type '${expectedType}' but got '${actualType}' for database ${detectDatabaseCapabilities().provider}`
    );
  }
}

/**
 * Creates a database-specific test data generator
 * Handles ID type differences between databases
 * 
 * @returns Object with helper functions for test data
 * 
 * @example
 * ```typescript
 * const testData = createTestDataHelper();
 * const userId = testData.generateId(); // Returns appropriate type for DB
 * ```
 */
export function createTestDataHelper() {
  const capabilities = detectDatabaseCapabilities();
  
  return {
    /**
     * Generates a mock ID appropriate for the current database
     */
    generateId(): number | string {
      if (capabilities.idType === 'string') {
        // Generate a mock ObjectId-like string for MongoDB
        return '507f1f77bcf86cd799439011';
      }
      return Math.floor(Math.random() * 1000000);
    },
    
    /**
     * Checks if ID type matches database expectations
     */
    isValidId(id: any): boolean {
      return typeof id === capabilities.idType;
    },
    
    /**
     * Gets the current database capabilities
     */
    getCapabilities(): DatabaseCapabilities {
      return capabilities;
    }
  };
}

/**
 * Performance metric collector for test reporting
 */
export class PerformanceMetrics {
  private metrics: Map<string, number[]> = new Map();
  
  /**
   * Records a metric value
   * @param name - Metric name
   * @param value - Metric value (typically time in ms or count)
   */
  record(name: string, value: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(value);
  }
  
  /**
   * Gets average value for a metric
   * @param name - Metric name
   * @returns Average value or 0 if no data
   */
  getAverage(name: string): number {
    const values = this.metrics.get(name);
    if (!values || values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  
  /**
   * Gets all recorded values for a metric
   * @param name - Metric name
   * @returns Array of values
   */
  getValues(name: string): number[] {
    return this.metrics.get(name) || [];
  }
  
  /**
   * Clears all metrics
   */
  clear(): void {
    this.metrics.clear();
  }
  
  /**
   * Gets a summary report of all metrics
   * @returns Formatted string with metric statistics
   */
  getSummary(): string {
    const lines: string[] = ['\nPerformance Metrics Summary:'];
    lines.push('-'.repeat(50));
    
    for (const [name, values] of this.metrics.entries()) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      
      lines.push(`${name}:`);
      lines.push(`  Count: ${values.length}`);
      lines.push(`  Average: ${avg.toFixed(2)}ms`);
      lines.push(`  Min: ${min.toFixed(2)}ms`);
      lines.push(`  Max: ${max.toFixed(2)}ms`);
    }
    
    lines.push('-'.repeat(50));
    return lines.join('\n');
  }
}

/**
 * Measures execution time of an async function
 * 
 * @param fn - Async function to measure
 * @returns Object with result and execution time
 * 
 * @example
 * ```typescript
 * const { result, duration } = await measureTime(async () => {
 *   return await client.user.createMany({ data: users });
 * });
 * console.log(`Created ${result.count} users in ${duration}ms`);
 * ```
 */
export async function measureTime<T>(
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = Date.now();
  const result = await fn();
  const duration = Date.now() - start;
  return { result, duration };
}

/**
 * Waits for a condition to be true with timeout
 * Useful for testing async operations
 * 
 * @param condition - Function that returns true when condition is met
 * @param timeout - Maximum time to wait in ms (default: 5000)
 * @param interval - Check interval in ms (default: 100)
 * @returns Promise that resolves when condition is met or rejects on timeout
 * 
 * @example
 * ```typescript
 * await waitFor(async () => {
 *   const user = await client.user.findUnique({ where: { id: 1 } });
 *   return user !== null;
 * }, 3000);
 * ```
 */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Asserts that a value matches the expected type for JSON fields
 * Handles database-specific JSON storage differences
 * 
 * @param value - The value to check
 * @param expectedValue - The expected value
 * @param message - Optional custom error message
 * 
 * @example
 * ```typescript
 * const product = await client.product.findUnique({ where: { id: 1 } });
 * assertJSONEquals(product.metadata, { key: 'value' });
 * ```
 */
export function assertJSONEquals(value: any, expectedValue: any, message?: string): void {
  const normalizedValue = typeof value === 'string' ? JSON.parse(value) : value;
  const normalizedExpected = typeof expectedValue === 'string' ? JSON.parse(expectedValue) : expectedValue;
  
  if (JSON.stringify(normalizedValue) !== JSON.stringify(normalizedExpected)) {
    throw new Error(
      message || 
      `JSON values do not match.\nExpected: ${JSON.stringify(normalizedExpected)}\nReceived: ${JSON.stringify(normalizedValue)}`
    );
  }
}

/**
 * Asserts that an array field contains the expected values
 * Handles database-specific array storage differences
 * 
 * @param actual - The actual array value
 * @param expected - The expected array value
 * @param message - Optional custom error message
 * 
 * @example
 * ```typescript
 * const product = await client.product.findUnique({ where: { id: 1 } });
 * assertArrayEquals(product.tags, ['tag1', 'tag2']);
 * ```
 */
export function assertArrayEquals(actual: any[], expected: any[], message?: string): void {
  if (!Array.isArray(actual)) {
    throw new Error(message || `Expected array but got ${typeof actual}`);
  }
  
  if (actual.length !== expected.length) {
    throw new Error(
      message || 
      `Array length mismatch. Expected ${expected.length} but got ${actual.length}`
    );
  }
  
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        message || 
        `Array element mismatch at index ${i}. Expected ${expected[i]} but got ${actual[i]}`
      );
    }
  }
}

/**
 * Creates a batch of test records with appropriate IDs for the database
 * 
 * @param count - Number of records to create
 * @param template - Template function that generates record data
 * @returns Array of test records
 * 
 * @example
 * ```typescript
 * const users = createTestBatch(10, (i) => ({
 *   name: `User ${i}`,
 *   email: `user${i}@example.com`
 * }));
 * await client.user.createMany({ data: users });
 * ```
 */
export function createTestBatch<T>(
  count: number,
  template: (index: number) => T
): T[] {
  return Array.from({ length: count }, (_, i) => template(i));
}

/**
 * Retries an async operation with exponential backoff
 * Useful for handling transient database errors
 * 
 * @param fn - Async function to retry
 * @param maxAttempts - Maximum number of attempts (default: 3)
 * @param baseDelay - Base delay in ms (default: 100)
 * @returns Result of the function
 * 
 * @example
 * ```typescript
 * const result = await retryWithBackoff(async () => {
 *   return await client.user.create({ data: { name: 'Test' } });
 * });
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelay = 100
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxAttempts) {
        throw lastError;
      }
      
      // Exponential backoff: 100ms, 200ms, 400ms, etc.
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Asserts that a database operation completed within expected time
 * 
 * @param duration - Actual duration in ms
 * @param maxDuration - Maximum expected duration in ms
 * @param operationName - Name of the operation for error message
 * 
 * @example
 * ```typescript
 * const { duration } = await measureTime(async () => {
 *   await client.user.createMany({ data: users });
 * });
 * assertPerformance(duration, 1000, 'createMany');
 * ```
 */
export function assertPerformance(
  duration: number,
  maxDuration: number,
  operationName: string
): void {
  if (duration > maxDuration) {
    throw new Error(
      `Performance assertion failed: ${operationName} took ${duration}ms, expected < ${maxDuration}ms`
    );
  }
}

/**
 * Gets database-specific configuration for tests
 * 
 * @returns Configuration object with database-specific settings
 * 
 * @example
 * ```typescript
 * const config = getDatabaseConfig();
 * const batchSize = config.recommendedBatchSize;
 * ```
 */
export function getDatabaseConfig() {
  const capabilities = detectDatabaseCapabilities();
  
  return {
    provider: capabilities.provider,
    maxConcurrency: capabilities.maxConcurrency,
    idType: capabilities.idType,
    
    // Recommended batch sizes for different operations
    recommendedBatchSize: capabilities.provider === 'sqlite' ? 100 : 1000,
    
    // Recommended timeout for operations
    operationTimeout: capabilities.provider === 'mongodb' ? 10000 : 5000,
    
    // Whether to use transactions for batch operations
    useTransactions: capabilities.supportsTransactions,
    
    // Connection pool settings
    connectionPool: {
      min: capabilities.provider === 'sqlite' ? 1 : 2,
      max: capabilities.maxConcurrency,
    },
  };
}

/**
 * Logs test execution context for debugging
 * 
 * @param testName - Name of the test
 * @param additionalInfo - Additional information to log
 * 
 * @example
 * ```typescript
 * logTestContext('JSON Field Creation', { recordCount: 100 });
 * ```
 */
export function logTestContext(testName: string, additionalInfo?: Record<string, any>): void {
  const capabilities = detectDatabaseCapabilities();
  
  console.log(`\n📋 Test: ${testName}`);
  console.log(`   Database: ${capabilities.provider}`);
  console.log(`   ID Type: ${capabilities.idType}`);
  console.log(`   Max Concurrency: ${capabilities.maxConcurrency}`);
  
  if (additionalInfo) {
    console.log('   Additional Info:');
    for (const [key, value] of Object.entries(additionalInfo)) {
      console.log(`     ${key}: ${JSON.stringify(value)}`);
    }
  }
}
