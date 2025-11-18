export interface EntityPrismaModel<T extends Record<string, unknown>> {
    name: string;
    $parent?: unknown;

    findMany(args: {
        where: Record<string, unknown>;
        include?: Record<string, unknown>;
        take?: number;
        skip?: number;
        orderBy?: Record<string, unknown>;
    }): Promise<Array<T & { id: number | string }>>;

    findMany(args: {
        where: Record<string, unknown>;
    }): Promise<Array<T & { id: number | string }>>;

    findFirst(args: {
        where?: Record<string, unknown>;
        include?: Record<string, unknown>;
        orderBy?: Record<string, unknown>;
        skip?: number;
        take?: number;
    }): Promise<(T & { id: number | string }) | null>;

    findUnique(args: {
        where: Record<string, unknown>;
        include?: Record<string, unknown>;
    }): Promise<(T & { id: number | string }) | null>;

    count(args: { where: Record<string, unknown> }): Promise<number>;

    deleteMany(args: {
        where: Record<string, unknown>;
    }): Promise<{ count: number }>;

    delete(args: {
        where: { id: number | string } | Record<string, unknown>;
    }): Promise<T & { id: number | string }>;

    createMany(args: {
        data: Array<Record<string, unknown>>;
        skipDuplicates?: boolean;
    }): Promise<{ count: number }>;

    create(args: {
        data: Record<string, unknown>;
    }): Promise<T & { id: number | string }>;

    update(args: {
        where: { id: number | string } | Record<string, unknown>;
        data: Record<string, unknown>;
    }): Promise<T & { id: number | string }>;

    updateMany(args: {
        where?: Record<string, unknown>;
        data: Record<string, unknown>;
    }): Promise<{ count: number }>;

    upsert(args: {
        where: Record<string, unknown>;
        create: Record<string, unknown>;
        update: Record<string, unknown>;
        include?: Record<string, unknown>;
    }): Promise<T & { id: number | string }>;
}
