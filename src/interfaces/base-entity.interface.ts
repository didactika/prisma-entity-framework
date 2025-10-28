/**
 * Represents a base entity with generic CRUD operations.
 * @template TModel - The type of the data model.
 */
export interface IBaseEntity<TModel> {
    /**
     * Unique identifier of the entity (optional).
     * Can be a number (for SQL databases) or string (for MongoDB ObjectId).
     */
    id?: number | string;

    /**
     * Creates a new instance of the entity in the database.
     * @returns A promise that resolves with the created model instance.
     */
    create(): Promise<TModel>;

    /**
     * Updates the entity in the database.
     * @returns A promise that resolves with the updated entity or `null` if the update fails.
     */
    update(): Promise<TModel | null>;

    /**
     * Deletes the entity from the database.
     * @returns A promise that resolves with the id of the deleted record
     * (number for SQL databases, string for MongoDB, or 0 if deletion failed).
     */
    delete(): Promise<number | string>;
}
