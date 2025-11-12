/**
 * Tests for database capability detection
 */

import {
  detectDatabaseCapabilities,
  supportsJSON,
  supportsScalarArrays,
  supportsSkipDuplicates,
  supportsManyToMany,
  supportsParallel,
  getMaxConcurrency,
  getIdType,
  hasCapability,
  shouldSkipTest,
} from '../helpers/database-detector';

describe('Database Capability Detection', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    // Restore original DATABASE_URL
    if (originalDatabaseUrl) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  describe('detectDatabaseCapabilities', () => {
    it('should detect MySQL capabilities', () => {
      process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/test';
      const capabilities = detectDatabaseCapabilities();

      expect(capabilities.provider).toBe('mysql');
      expect(capabilities.supportsJSON).toBe(true);
      expect(capabilities.supportsScalarArrays).toBe(false);
      expect(capabilities.supportsSkipDuplicates).toBe(true);
      expect(capabilities.supportsManyToMany).toBe(true);
      expect(capabilities.supportsParallel).toBe(true);
      expect(capabilities.maxConcurrency).toBe(8);
      expect(capabilities.idType).toBe('number');
      expect(capabilities.schemaFile).toBe('schema.mysql.prisma');
    });

    it('should detect PostgreSQL capabilities', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
      const capabilities = detectDatabaseCapabilities();

      expect(capabilities.provider).toBe('postgresql');
      expect(capabilities.supportsJSON).toBe(true);
      expect(capabilities.supportsScalarArrays).toBe(true);
      expect(capabilities.supportsSkipDuplicates).toBe(true);
      expect(capabilities.supportsManyToMany).toBe(true);
      expect(capabilities.supportsParallel).toBe(true);
      expect(capabilities.maxConcurrency).toBe(8);
      expect(capabilities.idType).toBe('number');
      expect(capabilities.schemaFile).toBe('schema.postgresql.prisma');
    });

    it('should detect MongoDB capabilities', () => {
      process.env.DATABASE_URL = 'mongodb://user:pass@localhost:27017/test';
      const capabilities = detectDatabaseCapabilities();

      expect(capabilities.provider).toBe('mongodb');
      expect(capabilities.supportsJSON).toBe(true);
      expect(capabilities.supportsScalarArrays).toBe(true);
      expect(capabilities.supportsSkipDuplicates).toBe(false);
      expect(capabilities.supportsManyToMany).toBe(false);
      expect(capabilities.supportsParallel).toBe(true);
      expect(capabilities.maxConcurrency).toBe(2);
      expect(capabilities.idType).toBe('string');
      expect(capabilities.schemaFile).toBe('schema.mongodb.prisma');
    });

    it('should detect SQLite capabilities (default)', () => {
      process.env.DATABASE_URL = 'file:./test.db';
      const capabilities = detectDatabaseCapabilities();

      expect(capabilities.provider).toBe('sqlite');
      expect(capabilities.supportsJSON).toBe(false);
      expect(capabilities.supportsScalarArrays).toBe(false);
      expect(capabilities.supportsSkipDuplicates).toBe(false);
      expect(capabilities.supportsManyToMany).toBe(true);
      expect(capabilities.supportsParallel).toBe(false);
      expect(capabilities.maxConcurrency).toBe(1);
      expect(capabilities.idType).toBe('number');
      expect(capabilities.schemaFile).toBe('schema.test.prisma');
    });

    it('should default to SQLite when DATABASE_URL is not set', () => {
      delete process.env.DATABASE_URL;
      const capabilities = detectDatabaseCapabilities();

      expect(capabilities.provider).toBe('sqlite');
    });
  });

  describe('capability check functions', () => {
    it('should check JSON support correctly', () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';
      expect(supportsJSON()).toBe(true);

      process.env.DATABASE_URL = 'file:./test.db';
      expect(supportsJSON()).toBe(false);
    });

    it('should check scalar array support correctly', () => {
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      expect(supportsScalarArrays()).toBe(true);

      process.env.DATABASE_URL = 'mysql://localhost/test';
      expect(supportsScalarArrays()).toBe(false);
    });

    it('should check skip duplicates support correctly', () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';
      expect(supportsSkipDuplicates()).toBe(true);

      process.env.DATABASE_URL = 'mongodb://localhost/test';
      expect(supportsSkipDuplicates()).toBe(false);
    });

    it('should check many-to-many support correctly', () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';
      expect(supportsManyToMany()).toBe(true);

      process.env.DATABASE_URL = 'mongodb://localhost/test';
      expect(supportsManyToMany()).toBe(false);
    });

    it('should check parallel support correctly', () => {
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      expect(supportsParallel()).toBe(true);

      process.env.DATABASE_URL = 'file:./test.db';
      expect(supportsParallel()).toBe(false);
    });

    it('should get correct max concurrency', () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';
      expect(getMaxConcurrency()).toBe(8);

      process.env.DATABASE_URL = 'mongodb://localhost/test';
      expect(getMaxConcurrency()).toBe(2);

      process.env.DATABASE_URL = 'file:./test.db';
      expect(getMaxConcurrency()).toBe(1);
    });

    it('should get correct ID type', () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';
      expect(getIdType()).toBe('number');

      process.env.DATABASE_URL = 'mongodb://localhost/test';
      expect(getIdType()).toBe('string');
    });
  });

  describe('hasCapability', () => {
    it('should check boolean capabilities', () => {
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      expect(hasCapability('supportsJSON')).toBe(true);
      expect(hasCapability('supportsScalarArrays')).toBe(true);

      process.env.DATABASE_URL = 'file:./test.db';
      expect(hasCapability('supportsJSON')).toBe(false);
      expect(hasCapability('supportsParallel')).toBe(false);
    });

    it('should return true for non-boolean capabilities', () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';
      expect(hasCapability('provider')).toBe(true);
      expect(hasCapability('maxConcurrency')).toBe(true);
      expect(hasCapability('idType')).toBe(true);
    });
  });

  describe('shouldSkipTest', () => {
    it('should return true when capability is not supported', () => {
      process.env.DATABASE_URL = 'file:./test.db';
      expect(shouldSkipTest('supportsJSON')).toBe(true);
      expect(shouldSkipTest('supportsScalarArrays')).toBe(true);
    });

    it('should return false when capability is supported', () => {
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      expect(shouldSkipTest('supportsJSON')).toBe(false);
      expect(shouldSkipTest('supportsScalarArrays')).toBe(false);
    });

    it('should return false for non-boolean capabilities', () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';
      expect(shouldSkipTest('provider')).toBe(false);
      expect(shouldSkipTest('maxConcurrency')).toBe(false);
    });
  });

});
