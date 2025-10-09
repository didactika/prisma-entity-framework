/**
 * Prisma Entity Framework
 * 
 * Complete entity framework for Prisma combining Active Record pattern,
 * advanced Query Builder, graph traversal utilities, and batch operations.
 * 
 * @packageDocumentation
 */

// Configuration
export {
    configurePrisma,
    getPrismaInstance,
    isPrismaConfigured,
    resetPrismaConfiguration
} from './config';

// Core classes
export { default as BaseEntity } from './base-entity';
export { default as ModelUtils } from './model-utils';
export { default as DataUtils } from './data-utils';

// Search utilities
export { default as SearchUtils } from './search/search-utils';
export { default as SearchBuilder } from './search/search-builder';
export { default as ConditionUtils } from './search/condition-utils';
export { default as ObjectUtils } from './search/object-utils';

// Types
export * from './types/search.types';

// Interfaces
export * from './interfaces/base-entity.interface';
