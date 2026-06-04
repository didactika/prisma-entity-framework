import type { TransactionClient } from '../../transaction-context';

/**
 * Options for entity operations that support transactions.
 */
export interface EntityOperationOptions {
    /**
     * Explicit transactional client.
     * When provided, the operation runs inside this transaction.
     * When omitted, the operation uses the active AsyncLocalStorage
     * transaction context (if any) or the global PrismaClient.
     */
    tx?: TransactionClient;
}

/**
 * Represents a base entity with generic CRUD operations.
 * @template TModel - The type of the data model.
 */
export interface IBaseEntity<TModel extends object = Record<string, unknown>> {

    /**
     * Unique identifier of the entity (optional).
     * Can be a number (for SQL databases) or string (for MongoDB ObjectId).
     */
    id?: number | string;

    /**
     * Creates a new instance of the entity in the database.
     * @param options - Optional operation options (e.g., transactional client)
     * @returns A promise that resolves with the created model instance.
     */
    create(options?: EntityOperationOptions): Promise<TModel>;

    /**
     * Updates the entity in the database.
     * @param options - Optional operation options (e.g., transactional client)
     * @returns A promise that resolves with the updated entity or `null` if the update fails.
     */
    update(options?: EntityOperationOptions): Promise<TModel>;

    /**
     * Deletes the entity from the database.
     * @param options - Optional operation options (e.g., transactional client)
     * @returns A promise that resolves with the id of the deleted record
     * (number for SQL databases, string for MongoDB, or 0 if deletion failed).
     */
    delete(options?: EntityOperationOptions): Promise<number | string>;
}
