import { PrismaClient } from '@prisma/client';

/**
 * Global Prisma instance for the framework
 */
let globalPrismaInstance: PrismaClient | null = null;

/**
 * Configure the Prisma client instance to be used by all entities
 * This must be called once at application startup before using any entity operations
 * 
 * @param prisma - PrismaClient instance
 * @throws Error if prisma is null or undefined
 * 
 * @example
 * ```typescript
 * import { PrismaClient } from '@prisma/client';
 * import { configurePrisma } from 'prisma-entity-framework';
 * 
 * const prisma = new PrismaClient();
 * configurePrisma(prisma);
 * ```
 */
export function configurePrisma(prisma: PrismaClient): void {
    if (!prisma) {
        throw new Error('Prisma client instance is required');
    }
    globalPrismaInstance = prisma;
}

/**
 * Get the configured Prisma instance
 * 
 * @returns PrismaClient instance
 * @throws Error if Prisma has not been configured
 * @internal
 */
export function getPrismaInstance(): PrismaClient {
    if (!globalPrismaInstance) {
        throw new Error(
            'Prisma instance not configured. Call configurePrisma(prisma) before using any entity operations.'
        );
    }
    return globalPrismaInstance;
}

/**
 * Check if Prisma has been configured
 * 
 * @returns boolean indicating if Prisma is configured
 */
export function isPrismaConfigured(): boolean {
    return globalPrismaInstance !== null;
}

/**
 * Reset the Prisma configuration
 * Useful for testing scenarios where you need to reconfigure Prisma
 */
export function resetPrismaConfiguration(): void {
    globalPrismaInstance = null;
}
