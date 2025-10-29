export namespace FindByFilterOptions {
    export type StringSearch = {
        keys?: string[];
        value: string;
        mode?: "EXACT" | "LIKE" | "STARTS_WITH" | "ENDS_WITH";
        grouping?: "and" | "or";
    };

    export type RangeSearch = {
        keys?: string[];
        min?: number | Date;
        max?: number | Date;
        grouping?: "and" | "or";
    };

    export type ListSearch = {
        keys?: string[];
        values: any[];
        mode?: "IN" | "NOT_IN" | "HAS_SOME" | "HAS_EVERY";
        grouping?: "and" | "or";
    };

    export type SearchOptions = {
        stringSearch?: StringSearch[];
        rangeSearch?: RangeSearch[];
        listSearch?: ListSearch[];
        grouping?: "and" | "or";
    };

    export type PaginationOptions = {
        page: number;
        pageSize: number;
        take: number;
        skip: number;
    }

    export type PaginatedResponse<T> = {
        total: number;
        page: number;
        pageSize: number;
        data: T[];
    }

    export type NestedRelations = Array<{ [relation: string]: NestedRelations }> | "*";


    export type Options = {
        onlyOne?: boolean;
        relationsToInclude?: NestedRelations;
        search?: SearchOptions;
        pagination?: PaginationOptions;
        orderBy?: Record<string, 'asc' | 'desc'>;
        parallel?: boolean;
        concurrency?: number;
        rateLimit?: number;
    };

    export const defaultOptions: Options = {
        onlyOne: false,
        relationsToInclude: [],
        search: undefined,
        pagination: undefined,
        orderBy: undefined,
        parallel: undefined,
        concurrency: undefined,
        rateLimit: undefined
    }
}
