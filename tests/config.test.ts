/**
 * Test suite for config module
 * Tests Prisma configuration and instance management
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { configurePrisma, getPrismaInstance, isPrismaConfigured, resetPrismaConfiguration } from '../src/config';
import { mockPrismaClient } from './__mocks__/prisma-client.mock';

describe('Config Module', () => {
  beforeEach(() => {
    resetPrismaConfiguration();
  });

  afterEach(() => {
    resetPrismaConfiguration();
  });

  describe('configurePrisma', () => {
    /**
     * Test: should configure Prisma instance successfully
     */
    it('should configure Prisma instance successfully', () => {
      expect(() => configurePrisma(mockPrismaClient as any)).not.toThrow();
      expect(isPrismaConfigured()).toBe(true);
    });

    /**
     * Test: should throw error when prisma is null
     */
    it('should throw error when prisma is null', () => {
      expect(() => configurePrisma(null as any)).toThrow('Prisma client instance is required');
    });

    /**
     * Test: should throw error when prisma is undefined
     */
    it('should throw error when prisma is undefined', () => {
      expect(() => configurePrisma(undefined as any)).toThrow('Prisma client instance is required');
    });

    /**
     * Test: should allow reconfiguration
     */
    it('should allow reconfiguration', () => {
      configurePrisma(mockPrismaClient as any);
      expect(() => configurePrisma(mockPrismaClient as any)).not.toThrow();
    });
  });

  describe('getPrismaInstance', () => {
    /**
     * Test: should return configured Prisma instance
     */
    it('should return configured Prisma instance', () => {
      configurePrisma(mockPrismaClient as any);
      const instance = getPrismaInstance();
      expect(instance).toBe(mockPrismaClient);
    });

    /**
     * Test: should throw error when not configured
     */
    it('should throw error when not configured', () => {
      expect(() => getPrismaInstance()).toThrow(
        'Prisma instance not configured. Call configurePrisma(prisma) before using any entity operations.'
      );
    });
  });

  describe('isPrismaConfigured', () => {
    /**
     * Test: should return false when not configured
     */
    it('should return false when not configured', () => {
      expect(isPrismaConfigured()).toBe(false);
    });

    /**
     * Test: should return true when configured
     */
    it('should return true when configured', () => {
      configurePrisma(mockPrismaClient as any);
      expect(isPrismaConfigured()).toBe(true);
    });
  });

  describe('resetPrismaConfiguration', () => {
    /**
     * Test: should reset configuration
     */
    it('should reset configuration', () => {
      configurePrisma(mockPrismaClient as any);
      expect(isPrismaConfigured()).toBe(true);

      resetPrismaConfiguration();
      expect(isPrismaConfigured()).toBe(false);
    });

    /**
     * Test: should not throw when resetting unconfigured instance
     */
    it('should not throw when resetting unconfigured instance', () => {
      expect(() => resetPrismaConfiguration()).not.toThrow();
    });
  });
});
