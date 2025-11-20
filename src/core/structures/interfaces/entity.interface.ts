export interface EntityPrismaModel<T extends object = Record<string, unknown>> {
    name?: string;
    $parent?: unknown;

    findMany(args?: any): Promise<Array<T & { id: number | string }>>;

    findFirst(args?: any): Promise<(T & { id: number | string }) | null>;

    findUnique(args: any): Promise<(T & { id: number | string }) | null>;

    count(args?: any): Promise<number>;

    deleteMany(args?: any): Promise<{ count: number }>;

    delete(args: any): Promise<T & { id: number | string }>;

    createMany(args: any): Promise<{ count: number }>;

    create(args: any): Promise<T & { id: number | string }>;

    update(args: any): Promise<T & { id: number | string }>;

    updateMany(args: any): Promise<{ count: number }>;

    upsert(args: any): Promise<T & { id: number | string }>;
}
