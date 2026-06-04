import { PrismaClient } from "@prisma/client";
import { getPrismaInstance } from "./config";
import { getDatabaseProviderCached, quoteIdentifier, type DatabaseProvider } from "./utils/database-utils";
import { getOptimalBatchSize, processBatches } from "./utils/batch-utils";
import { logError, withErrorHandling } from "./utils/error-utils";
import { isNonEmptyArray } from "./utils/validation-utils";
import BaseEntityHelpers from "./base-entity-helpers";
import ModelUtils from "./model-utils";
import { resolvePrismaForRaw, shouldDisableParallel } from "./utils/transaction-utils";

type ModelInfo = ReturnType<typeof ModelUtils.getModelInformationCached>;

// ---------------------------------------------------------------------------
// Column metadata for upsert operations
// ---------------------------------------------------------------------------

export interface UpsertColumnMeta {
    prismaName: string;
    dbName: string;
    type: string;
    isId: boolean;
    hasDefault: boolean;
    isUpdatedAt: boolean;
    isRequired: boolean;
}

export interface UpsertMetadata {
    tableName: string;
    allColumns: UpsertColumnMeta[];
    /** Columns that form the unique constraint used for ON CONFLICT */
    uniqueConflictColumns: UpsertColumnMeta[];
    /** Columns to SET on conflict (excludes id, unique, createdAt) */
    updatableColumns: UpsertColumnMeta[];
    /** Columns used for IS DISTINCT FROM (updatable minus updatedAt) */
    comparableColumns: UpsertColumnMeta[];
    /** Set of JSON/Bytes field names for proper escaping */
    jsonFields: Set<string>;
}

// ---------------------------------------------------------------------------
// Metadata cache
// ---------------------------------------------------------------------------

const upsertMetadataCache = new Map<string, UpsertMetadata>();

const CREATED_AT_NAMES = new Set(['createdAt', 'created_at', 'createdat']);
const UPDATED_AT_NAMES = new Set(['updatedAt', 'updated_at', 'updatedat']);

/**
 * Extracts column metadata needed for raw upsert SQL generation.
 */
export function getUpsertMetadata(modelName: string, modelInfo: ModelInfo): UpsertMetadata {
    const cached = upsertMetadataCache.get(modelName);
    if (cached) return cached;

    const tableName = (modelInfo as any).dbName || modelName;

    const uniqueConstraints = ModelUtils.getUniqueConstraints(modelName);
    if (!uniqueConstraints || uniqueConstraints.length === 0) {
        throw new Error(`No unique constraints found for model ${modelName}. Cannot perform upsert.`);
    }
    const uniqueFieldNames = new Set(uniqueConstraints[0]);

    const allColumns: UpsertColumnMeta[] = [];
    const jsonFields = new Set<string>();

    for (const field of modelInfo.fields) {
        if (field.kind !== 'scalar' && field.kind !== 'enum') continue;

        const isUpdatedAt = !!(field as any).isUpdatedAt || UPDATED_AT_NAMES.has(field.name.toLowerCase());
        const isId = !!(field as any).isId || field.name === 'id';
        const hasDefault = !!(field as any).hasDefaultValue || isId;
        const isRequired = (field as any).isRequired !== false;

        if (field.type === 'Json' || field.type === 'Bytes') {
            jsonFields.add(field.name);
        }

        allColumns.push({
            prismaName: field.name,
            dbName: (field as any).dbName || field.name,
            type: field.type,
            isId,
            hasDefault,
            isUpdatedAt,
            isRequired,
        });
    }

    const uniqueConflictColumns = allColumns.filter(c => uniqueFieldNames.has(c.prismaName));
    const isCreatedAt = (name: string) => CREATED_AT_NAMES.has(name.toLowerCase());
    const updatableColumns = allColumns.filter(c =>
        !c.isId && !uniqueFieldNames.has(c.prismaName) && !isCreatedAt(c.prismaName)
    );
    const comparableColumns = updatableColumns.filter(c => !c.isUpdatedAt);

    const meta: UpsertMetadata = {
        tableName,
        allColumns,
        uniqueConflictColumns,
        updatableColumns,
        comparableColumns,
        jsonFields,
    };

    upsertMetadataCache.set(modelName, meta);
    return meta;
}

/**
 * Clears the metadata cache (for testing).
 * @internal
 */
export function clearUpsertMetadataCache(): void {
    upsertMetadataCache.clear();
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function escapeVal(value: unknown, prisma: PrismaClient, isJson: boolean): string {
    return BaseEntityHelpers.escapeValue(value, prisma, isJson);
}

function q(identifier: string, prisma: PrismaClient): string {
    return quoteIdentifier(identifier, prisma);
}

/**
 * Determines which columns from the item should be included in the INSERT.
 * Always includes: unique conflict columns, updatedAt/createdAt (since Prisma handles
 * these at application level, raw SQL must provide them), and any column present in items.
 */
function getInsertableColumns(
    meta: UpsertMetadata,
    items: Record<string, unknown>[]
): UpsertColumnMeta[] {
    // Collect all fields that appear in at least one item
    const presentFields = new Set<string>();
    for (const item of items) {
        for (const key of Object.keys(item)) {
            presentFields.add(key);
        }
    }

    return meta.allColumns.filter(col => {
        // Always include unique conflict columns (needed for ON CONFLICT)
        if (meta.uniqueConflictColumns.some(u => u.prismaName === col.prismaName)) return true;
        // Always include updatedAt/createdAt — Prisma handles these at app level,
        // raw SQL must provide explicit values since the DB has no DEFAULT for them
        if (col.isUpdatedAt || CREATED_AT_NAMES.has(col.prismaName.toLowerCase())) return true;
        // Include if any item provides a value for this column
        if (presentFields.has(col.prismaName)) return true;
        // Skip columns with defaults that no item provides (let DB set them)
        return false;
    });
}

/**
 * Returns the database-specific SQL expression for "current timestamp".
 */
function nowExpression(provider: DatabaseProvider): string {
    switch (provider) {
        case 'mysql': return 'NOW()';
        case 'postgresql': return 'NOW()';
        case 'sqlite': return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
        case 'sqlserver': return 'GETDATE()';
        default: return 'NOW()';
    }
}

/**
 * Returns the appropriate SQL value for a column in an INSERT row.
 * Handles missing timestamp columns by providing the current timestamp expression.
 */
function columnInsertValue(
    col: UpsertColumnMeta,
    val: unknown,
    provider: DatabaseProvider,
    prisma: PrismaClient,
    jsonFields: Set<string>,
    useDefault: boolean
): string {
    // If value is provided, use it
    if (val !== undefined) {
        if (val === null) return 'NULL';
        let escaped = escapeVal(val, prisma, jsonFields.has(col.prismaName));
        if (jsonFields.has(col.prismaName) && provider === 'postgresql') {
            escaped = `${escaped}::jsonb`;
        }
        return escaped;
    }

    // Value not provided — check if it's a timestamp column that needs a default
    if (col.isUpdatedAt || CREATED_AT_NAMES.has(col.prismaName.toLowerCase())) {
        return nowExpression(provider);
    }

    // For other columns, use DEFAULT (PostgreSQL) or NULL (others)
    return useDefault ? 'DEFAULT' : 'NULL';
}

/**
 * Deduplicates items by unique conflict key. When multiple items share the same
 * unique key, the LAST occurrence wins (last-write-wins semantics).
 * This prevents PostgreSQL "ON CONFLICT DO UPDATE cannot affect row a second time" errors.
 */
function deduplicateByUniqueKey(
    items: Record<string, unknown>[],
    uniqueColumns: UpsertColumnMeta[]
): Record<string, unknown>[] {
    const seen = new Map<string, Record<string, unknown>>();
    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        let hasAllUniqueValues = true;
        const keyParts: string[] = [];

        for (const column of uniqueColumns) {
            const value = item[column.prismaName];
            if (value === undefined || value === null) {
                hasAllUniqueValues = false;
                break;
            }
            const serializedValue = typeof value === 'object'
                ? JSON.stringify(value)
                : String(value);
            keyParts.push(`${column.prismaName}:${serializedValue}`);
        }

        const key = hasAllUniqueValues && keyParts.length > 0
            ? keyParts.join('\x00')
            : `__row_${index}`;

        seen.set(key, item);
    }
    return Array.from(seen.values());
}

/**
 * Filters updatable/comparable columns to only those present in the INSERT columns.
 * This ensures SET/WHERE clauses only reference columns that exist in the VALUES,
 * preventing incorrect overwrites of columns the user didn't provide.
 */
function getEffectiveColumns(meta: UpsertMetadata, insertCols: UpsertColumnMeta[]) {
    const insertColNames = new Set(insertCols.map(c => c.prismaName));
    return {
        updatable: meta.updatableColumns.filter(c => insertColNames.has(c.prismaName)),
        comparable: meta.comparableColumns.filter(c => insertColNames.has(c.prismaName)),
    };
}

// ---------------------------------------------------------------------------
// PostgreSQL builder
// ---------------------------------------------------------------------------

export function buildPostgreSQLUpsert(
    meta: UpsertMetadata,
    items: Record<string, unknown>[],
    prisma: PrismaClient
): string {
    const insertCols = getInsertableColumns(meta, items);
    const { updatable, comparable } = getEffectiveColumns(meta, insertCols);

    const colList = insertCols.map(c => q(c.dbName, prisma)).join(', ');
    const idCol = meta.allColumns.find(c => c.isId);
    const qId = idCol ? q(idCol.dbName, prisma) : q('id', prisma);

    const valueRows = items.map(item => {
        const vals = insertCols.map(col =>
            columnInsertValue(col, item[col.prismaName], 'postgresql', prisma, meta.jsonFields, true)
        );
        return `(${vals.join(', ')})`;
    });

    const conflictCols = meta.uniqueConflictColumns.map(c => q(c.dbName, prisma)).join(', ');

    // Models like pure pivot tables may have no non-unique mutable columns.
    // In that case, DO NOTHING is the correct conflict behavior.
    if (updatable.length === 0) {
        return [
            `INSERT INTO ${q(meta.tableName, prisma)} (${colList})`,
            `VALUES ${valueRows.join(', ')}`,
            `ON CONFLICT (${conflictCols}) DO NOTHING`,
            `RETURNING ${qId}, TRUE AS "_was_inserted"`
        ].join('\n');
    }

    const setClauses: string[] = [];
    for (const col of updatable) {
        if (col.isUpdatedAt) {
            setClauses.push(`${q(col.dbName, prisma)} = NOW()`);
        } else {
            const qCol = q(col.dbName, prisma);
            setClauses.push(`${qCol} = EXCLUDED.${qCol}`);
        }
    }

    // WHERE clause: only update if at least one comparable column is different
    let whereClause = '';
    if (comparable.length > 0) {
        const tableName = q(meta.tableName, prisma);
        const tCols = comparable.map(c => `${tableName}.${q(c.dbName, prisma)}`).join(', ');
        const eCols = comparable.map(c => `EXCLUDED.${q(c.dbName, prisma)}`).join(', ');
        whereClause = `\nWHERE (${tCols}) IS DISTINCT FROM (${eCols})`;
    }

    // RETURNING to distinguish inserts from updates

    return [
        `INSERT INTO ${q(meta.tableName, prisma)} (${colList})`,
        `VALUES ${valueRows.join(', ')}`,
        `ON CONFLICT (${conflictCols}) DO UPDATE SET`,
        setClauses.join(', '),
        whereClause,
        `RETURNING ${qId}, (xmax = 0) AS "_was_inserted"`
    ].join('\n');
}

// ---------------------------------------------------------------------------
// MySQL builder
// ---------------------------------------------------------------------------

export function buildMySQLUpsert(
    meta: UpsertMetadata,
    items: Record<string, unknown>[],
    prisma: PrismaClient
): string {
    const insertCols = getInsertableColumns(meta, items);
    const { updatable, comparable } = getEffectiveColumns(meta, insertCols);

    const colList = insertCols.map(c => q(c.dbName, prisma)).join(', ');

    const valueRows = items.map(item => {
        const vals = insertCols.map(col =>
            columnInsertValue(col, item[col.prismaName], 'mysql', prisma, meta.jsonFields, true)
        );
        return `(${vals.join(', ')})`;
    });

    // Build SET clauses — updatedAt IF must come FIRST because MySQL evaluates
    // SET assignments left-to-right. If other columns are SET before the IF,
    // the <=> comparison would see already-updated values (always TRUE).
    const setClauses: string[] = [];
    const updatedAtCol = updatable.find(c => c.isUpdatedAt);
    if (updatedAtCol) {
        const qCol = q(updatedAtCol.dbName, prisma);
        if (comparable.length > 0) {
            const nullSafeChecks = comparable
                .map(c => `${q(c.dbName, prisma)} <=> VALUES(${q(c.dbName, prisma)})`)
                .join(' AND ');
            setClauses.push(`${qCol} = IF(${nullSafeChecks}, ${qCol}, NOW())`);
        } else {
            setClauses.push(`${qCol} = NOW()`);
        }
    }
    for (const col of updatable) {
        if (col.isUpdatedAt) continue;
        const qCol = q(col.dbName, prisma);
        setClauses.push(`${qCol} = VALUES(${qCol})`);
    }

    if (setClauses.length === 0) {
        const noOpCol = meta.uniqueConflictColumns[0] ?? insertCols[0];
        if (!noOpCol) {
            throw new Error(`No columns available for MySQL ON DUPLICATE KEY UPDATE in model ${meta.tableName}`);
        }
        const qNoOp = q(noOpCol.dbName, prisma);
        setClauses.push(`${qNoOp} = ${qNoOp}`);
    }

    return [
        `INSERT INTO ${q(meta.tableName, prisma)} (${colList})`,
        `VALUES ${valueRows.join(', ')}`,
        `ON DUPLICATE KEY UPDATE`,
        setClauses.join(', ')
    ].join('\n');
}

// ---------------------------------------------------------------------------
// SQLite builder
// ---------------------------------------------------------------------------

export function buildSQLiteUpsert(
    meta: UpsertMetadata,
    items: Record<string, unknown>[],
    prisma: PrismaClient
): string {
    const insertCols = getInsertableColumns(meta, items);
    const { updatable, comparable } = getEffectiveColumns(meta, insertCols);

    const colList = insertCols.map(c => q(c.dbName, prisma)).join(', ');

    const valueRows = items.map(item => {
        const vals = insertCols.map(col =>
            columnInsertValue(col, item[col.prismaName], 'sqlite', prisma, meta.jsonFields, false)
        );
        return `(${vals.join(', ')})`;
    });

    const conflictCols = meta.uniqueConflictColumns.map(c => q(c.dbName, prisma)).join(', ');

    if (updatable.length === 0) {
        return [
            `INSERT INTO ${q(meta.tableName, prisma)} (${colList})`,
            `VALUES ${valueRows.join(', ')}`,
            `ON CONFLICT (${conflictCols}) DO NOTHING`
        ].join('\n');
    }

    const setClauses: string[] = [];
    for (const col of updatable) {
        const qCol = q(col.dbName, prisma);
        if (col.isUpdatedAt) {
            setClauses.push(`${qCol} = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`);
        } else {
            setClauses.push(`${qCol} = excluded.${qCol}`);
        }
    }

    // WHERE: only update when at least one comparable column differs
    // SQLite uses IS NOT for NULL-safe inequality
    let whereClause = '';
    if (comparable.length > 0) {
        const conditions = comparable.map(c => {
            const qCol = q(c.dbName, prisma);
            return `${qCol} IS NOT excluded.${qCol}`;
        });
        whereClause = `\nWHERE ${conditions.join(' OR ')}`;
    }

    return [
        `INSERT INTO ${q(meta.tableName, prisma)} (${colList})`,
        `VALUES ${valueRows.join(', ')}`,
        `ON CONFLICT (${conflictCols}) DO UPDATE SET`,
        setClauses.join(', '),
        whereClause
    ].join('\n');
}

// ---------------------------------------------------------------------------
// SQL Server builder
// ---------------------------------------------------------------------------

export function buildSQLServerUpsert(
    meta: UpsertMetadata,
    items: Record<string, unknown>[],
    prisma: PrismaClient
): string {
    const insertCols = getInsertableColumns(meta, items);
    const { updatable, comparable } = getEffectiveColumns(meta, insertCols);

    const sourceColList = insertCols.map(c => `[${c.dbName}]`).join(', ');

    const valueRows = items.map(item => {
        const vals = insertCols.map(col =>
            columnInsertValue(col, item[col.prismaName], 'sqlserver', prisma, meta.jsonFields, false)
        );
        return `(${vals.join(', ')})`;
    });

    // ON clause for matching
    const onConditions = meta.uniqueConflictColumns
        .map(c => `target.[${c.dbName}] = source.[${c.dbName}]`)
        .join(' AND ');

    // WHEN MATCHED with change detection using EXCEPT
    let matchedClause = '';
    if (updatable.length > 0) {
        const updateSets = updatable.map(col => {
            if (col.isUpdatedAt) {
                return `target.[${col.dbName}] = GETDATE()`;
            }
            return `target.[${col.dbName}] = source.[${col.dbName}]`;
        });

        let changeDetection = '';
        if (comparable.length > 0) {
            const targetCols = comparable.map(c => `target.[${c.dbName}]`).join(', ');
            const sourceCols = comparable.map(c => `source.[${c.dbName}]`).join(', ');
            changeDetection = ` AND EXISTS (SELECT ${targetCols} EXCEPT SELECT ${sourceCols})`;
        }

        matchedClause = `WHEN MATCHED${changeDetection} THEN\n  UPDATE SET ${updateSets.join(', ')}`;
    }

    // WHEN NOT MATCHED
    const insertColsForMerge = insertCols.filter(c => !c.isId || !c.hasDefault);
    const notMatchedCols = insertColsForMerge.map(c => `[${c.dbName}]`).join(', ');
    const notMatchedVals = insertColsForMerge.map(c => `source.[${c.dbName}]`).join(', ');
    const notMatchedClause = `WHEN NOT MATCHED THEN\n  INSERT (${notMatchedCols}) VALUES (${notMatchedVals})`;

    // OUTPUT
    const idCol = meta.allColumns.find(c => c.isId);
    const idName = idCol ? idCol.dbName : 'id';

    return [
        `MERGE INTO [${meta.tableName}] AS target`,
        `USING (VALUES ${valueRows.join(', ')}) AS source (${sourceColList})`,
        `ON ${onConditions}`,
        matchedClause,
        notMatchedClause,
        `OUTPUT $action, inserted.[${idName}];`
    ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Pre-count query for MySQL / SQLite
// ---------------------------------------------------------------------------

export function buildPreCountQuery(
    meta: UpsertMetadata,
    items: Record<string, unknown>[],
    prisma: PrismaClient
): string {
    const tableName = q(meta.tableName, prisma);

    if (meta.uniqueConflictColumns.length === 1) {
        const col = meta.uniqueConflictColumns[0];
        const qCol = q(col.dbName, prisma);
        const vals = items
            .map(item => escapeVal(item[col.prismaName], prisma, false))
            .join(', ');
        return `SELECT COUNT(*) AS cnt FROM ${tableName} WHERE ${qCol} IN (${vals})`;
    }

    // Composite unique key: use OR conditions
    const conditions = items.map(item => {
        const parts = meta.uniqueConflictColumns.map(col => {
            const val = item[col.prismaName];
            const escaped = escapeVal(val, prisma, false);
            return `${q(col.dbName, prisma)} = ${escaped}`;
        });
        return `(${parts.join(' AND ')})`;
    });

    return `SELECT COUNT(*) AS cnt FROM ${tableName} WHERE ${conditions.join(' OR ')}`;
}

// ---------------------------------------------------------------------------
// Result parsing
// ---------------------------------------------------------------------------

export interface UpsertResult {
    created: number;
    updated: number;
    unchanged: number;
    /** Entity IDs from RETURNING/OUTPUT (PostgreSQL, SQL Server) */
    returnedIds?: Array<{ id: number | string; wasInserted: boolean }>;
}

export interface UpsertDetailedCounts {
    created: number;
    updated: number;
    unchanged: number;
    total: number;
}

export interface UpsertDetailedItems {
    createdIds: Array<number | string>;
    updatedIds: Array<number | string>;
    unchangedIds: Array<number | string>;
}

export interface UpsertDetailedResult {
    counts: UpsertDetailedCounts;
    items: UpsertDetailedItems;
}

function toSafeNonNegativeInteger(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.floor(numeric);
}

function parseInsertedFlag(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === 't' || normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y';
    }
    return false;
}

function normalizeUpsertCounts(
    provider: DatabaseProvider,
    counts: { created: number; updated: number; unchanged: number },
    totalItems: number
): { created: number; updated: number; unchanged: number } {
    const total = toSafeNonNegativeInteger(totalItems);
    let created = toSafeNonNegativeInteger(counts.created);
    let updated = toSafeNonNegativeInteger(counts.updated);
    let unchanged = toSafeNonNegativeInteger(counts.unchanged);

    if (created > total) {
        created = total;
    }

    if (created + updated > total) {
        updated = Math.max(0, total - created);
    }

    const maxUnchanged = Math.max(0, total - created - updated);
    if (unchanged > maxUnchanged) {
        unchanged = maxUnchanged;
    }

    if (
        created !== counts.created ||
        updated !== counts.updated ||
        unchanged !== counts.unchanged
    ) {
        logError(
            'parseUpsertResults - normalized anomalous counts',
            new Error('Upsert result counts were normalized to maintain non-negative invariants'),
            {
                provider,
                totalItems: total,
                original: counts,
                normalized: { created, updated, unchanged }
            }
        );
    }

    return { created, updated, unchanged };
}

function parseJsonIdArray(value: unknown): Array<number | string> {
    if (typeof value === 'string') {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed as Array<number | string> : [];
    }

    return Array.isArray(value) ? value as Array<number | string> : [];
}

export function parseUpsertResults(
    provider: DatabaseProvider,
    rawResult: unknown,
    totalItems: number,
    existingCount?: number
): UpsertResult {
    switch (provider) {
        case 'postgresql': {
            // $queryRawUnsafe returns array of rows with { id, _was_inserted }
            const rows = rawResult as Array<{ id: number | string; _was_inserted: boolean }>;
            let created = 0;
            let updated = 0;
            const returnedIds: Array<{ id: number | string; wasInserted: boolean }> = [];

            for (const row of rows) {
                const wasInserted = parseInsertedFlag(row._was_inserted);
                if (wasInserted) {
                    created++;
                } else {
                    updated++;
                }
                returnedIds.push({ id: row.id, wasInserted });
            }

            const normalized = normalizeUpsertCounts(
                provider,
                {
                    created,
                    updated,
                    unchanged: totalItems - created - updated,
                },
                totalItems
            );

            return { ...normalized, returnedIds };
        }

        case 'mysql': {
            // $executeRawUnsafe returns affectedRows.
            // Prisma's MySQL connector uses CLIENT_FOUND_ROWS, so per-row counts are:
            //   insert=1, update(changed)=2, match(unchanged)=1
            // Total: affectedRows = totalItems + realUpdates
            // Therefore: realUpdates = affectedRows - totalItems
            const affectedRows = toSafeNonNegativeInteger(rawResult);
            const existing = toSafeNonNegativeInteger(existingCount ?? 0);
            const inserted = Math.max(0, totalItems - existing);
            const realUpdates = Math.max(0, affectedRows - totalItems);
            const unchanged = Math.max(0, existing - realUpdates);
            return normalizeUpsertCounts(
                provider,
                { created: inserted, updated: realUpdates, unchanged },
                totalItems
            );
        }

        case 'sqlite': {
            // $executeRawUnsafe returns changes() — inserts + true-updates (unchanged excluded by WHERE)
            const affectedRows = toSafeNonNegativeInteger(rawResult);
            const existing = toSafeNonNegativeInteger(existingCount ?? 0);
            const inserted = Math.max(0, totalItems - existing);
            const realUpdates = Math.max(0, affectedRows - inserted);
            const unchanged = Math.max(0, existing - realUpdates);
            return normalizeUpsertCounts(
                provider,
                { created: inserted, updated: realUpdates, unchanged },
                totalItems
            );
        }

        case 'sqlserver': {
            // $queryRawUnsafe returns array of { $action, id }
            const rows = rawResult as Array<{ $action: string; id: number | string }>;
            let created = 0;
            let updated = 0;
            const returnedIds: Array<{ id: number | string; wasInserted: boolean }> = [];

            for (const row of rows) {
                const action = row.$action || (row as any)['$action'];
                if (action === 'INSERT') {
                    created++;
                    returnedIds.push({ id: row.id, wasInserted: true });
                } else {
                    updated++;
                    returnedIds.push({ id: row.id, wasInserted: false });
                }
            }

            const normalized = normalizeUpsertCounts(
                provider,
                {
                    created,
                    updated,
                    unchanged: totalItems - created - updated,
                },
                totalItems
            );

            return { ...normalized, returnedIds };
        }

        default:
            return { created: 0, updated: 0, unchanged: totalItems };
    }
}

// ---------------------------------------------------------------------------
// PostgreSQL massive upsert (staging table + CTE)
// ---------------------------------------------------------------------------

export async function executeMassivePostgresUpsert(
    meta: UpsertMetadata,
    items: Record<string, unknown>[],
    prisma: PrismaClient
): Promise<UpsertDetailedResult> {
    const emptyResult: UpsertDetailedResult = {
        counts: { created: 0, updated: 0, unchanged: 0, total: items.length },
        items: { createdIds: [], updatedIds: [], unchangedIds: [] }
    };

    if (!isNonEmptyArray(items)) {
        return emptyResult;
    }

    const dedupedItems = deduplicateByUniqueKey(items, meta.uniqueConflictColumns);
    const duplicatesRemoved = items.length - dedupedItems.length;

    const tableName = q(meta.tableName, prisma);
    const tempTableIdentifier = `temp_staging_${meta.tableName}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const tempTableName = q(tempTableIdentifier, prisma);

    const insertCols = getInsertableColumns(meta, dedupedItems).filter(col => {
        if (!col.isId || !col.hasDefault) return true;
        // If any row omits id, let the database default generate it for all new rows.
        return dedupedItems.every(item => item[col.prismaName] !== undefined && item[col.prismaName] !== null);
    });
    const colList = insertCols.map(c => q(c.dbName, prisma)).join(', ');
    const idCol = meta.allColumns.find(c => c.isId) || { dbName: 'id', prismaName: 'id' };
    const qId = q(idCol.dbName, prisma);

    const matchConditions = meta.uniqueConflictColumns
        .map(c => `t.${q(c.dbName, prisma)} = s.${q(c.dbName, prisma)}`)
        .join(' AND ');

    const { updatable, comparable } = getEffectiveColumns(meta, insertCols);

    let diffConditions = 'FALSE';
    if (comparable.length > 0) {
        const tCols = comparable.map(c => `t.${q(c.dbName, prisma)}`).join(', ');
        const sCols = comparable.map(c => `s.${q(c.dbName, prisma)}`).join(', ');
        diffConditions = `(${tCols}) IS DISTINCT FROM (${sCols})`;
    }

    const setClauses = updatable.map(col => {
        if (col.isUpdatedAt) {
            return `${q(col.dbName, prisma)} = NOW()`;
        }
        return `${q(col.dbName, prisma)} = s.${q(col.dbName, prisma)}`;
    }).join(', ');

    return await prisma.$transaction(async (tx: any) => {
        let tempTableCreated = false;

        try {
            await tx.$executeRawUnsafe(
                `CREATE TEMP TABLE ${tempTableName} ON COMMIT DROP AS SELECT * FROM ${tableName} WHERE FALSE`
            );
            tempTableCreated = true;

            const chunkSize = 5000;
            for (let i = 0; i < dedupedItems.length; i += chunkSize) {
                const chunk = dedupedItems.slice(i, i + chunkSize);
                const valueRows = chunk.map(item => {
                    const vals = insertCols.map(col =>
                        columnInsertValue(
                            col,
                            item[col.prismaName],
                            'postgresql',
                            prisma,
                            meta.jsonFields,
                            true
                        )
                    );
                    return `(${vals.join(', ')})`;
                });

                await tx.$executeRawUnsafe(
                    `INSERT INTO ${tempTableName} (${colList}) VALUES ${valueRows.join(', ')}`
                );
            }

            const tempConflictCols = meta.uniqueConflictColumns.map(c => q(c.dbName, prisma)).join(', ');
            await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX ON ${tempTableName} (${tempConflictCols});`);
            await tx.$executeRawUnsafe(`ANALYZE ${tempTableName};`);

            let superQuery = '';
            if (updatable.length === 0) {
                superQuery = `
                    WITH
                    unchanged_records AS (
                        SELECT t.${qId} FROM ${tableName} t INNER JOIN ${tempTableName} s ON ${matchConditions}
                    ),
                    inserted_records AS (
                        INSERT INTO ${tableName} (${colList})
                        SELECT ${colList} FROM ${tempTableName} s
                        WHERE NOT EXISTS (SELECT 1 FROM ${tableName} t WHERE ${matchConditions})
                        ON CONFLICT DO NOTHING
                        RETURNING ${qId}
                    )
                    SELECT
                        (SELECT COALESCE(json_agg(${qId}), '[]'::json) FROM unchanged_records) AS unchanged_ids,
                        '[]'::json AS updated_ids,
                        (SELECT COALESCE(json_agg(${qId}), '[]'::json) FROM inserted_records) AS inserted_ids;
                `;
            } else {
                superQuery = `
                    WITH
                    unchanged_records AS (
                        SELECT t.${qId} FROM ${tableName} t INNER JOIN ${tempTableName} s ON ${matchConditions} WHERE NOT (${diffConditions})
                    ),
                    updated_records AS (
                        UPDATE ${tableName} t SET ${setClauses} FROM ${tempTableName} s WHERE ${matchConditions} AND (${diffConditions})
                        RETURNING t.${qId}
                    ),
                    inserted_records AS (
                        INSERT INTO ${tableName} (${colList})
                        SELECT ${colList} FROM ${tempTableName} s
                        WHERE NOT EXISTS (SELECT 1 FROM ${tableName} t WHERE ${matchConditions})
                        ON CONFLICT DO NOTHING
                        RETURNING ${qId}
                    )
                    SELECT
                        (SELECT COALESCE(json_agg(${qId}), '[]'::json) FROM unchanged_records) AS unchanged_ids,
                        (SELECT COALESCE(json_agg(${qId}), '[]'::json) FROM updated_records) AS updated_ids,
                        (SELECT COALESCE(json_agg(${qId}), '[]'::json) FROM inserted_records) AS inserted_ids;
                `;
            }

            const result = (await tx.$queryRawUnsafe(superQuery)) as Array<{
                unchanged_ids: unknown;
                updated_ids: unknown;
                inserted_ids: unknown;
            }>;
            const row = result[0] ?? { unchanged_ids: [], updated_ids: [], inserted_ids: [] };

            const unchangedIds = parseJsonIdArray(row.unchanged_ids);
            const updatedIds = parseJsonIdArray(row.updated_ids);
            const createdIds = parseJsonIdArray(row.inserted_ids);

            return {
                counts: {
                    created: createdIds.length,
                    updated: updatedIds.length,
                    unchanged: unchangedIds.length + duplicatesRemoved,
                    total: items.length
                },
                items: {
                    createdIds,
                    updatedIds,
                    unchangedIds
                }
            };
        } finally {
            if (tempTableCreated) {
                try {
                    await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS ${tempTableName}`);
                } catch {
                    // Table is auto-dropped via ON COMMIT DROP when the transaction ends.
                    // If we're already in an aborted transaction state, ignore the error.
                }
            }
        }
    }, {
        timeout: 300000
    });
}

// ---------------------------------------------------------------------------
// SQL builder dispatch
// ---------------------------------------------------------------------------

function buildUpsertSQL(
    provider: DatabaseProvider,
    meta: UpsertMetadata,
    items: Record<string, unknown>[],
    prisma: PrismaClient
): string {
    switch (provider) {
        case 'postgresql':
            return buildPostgreSQLUpsert(meta, items, prisma);
        case 'mysql':
            return buildMySQLUpsert(meta, items, prisma);
        case 'sqlite':
            return buildSQLiteUpsert(meta, items, prisma);
        case 'sqlserver':
            return buildSQLServerUpsert(meta, items, prisma);
        default:
            throw new Error(`Raw upsert not supported for provider: ${provider}`);
    }
}

// ---------------------------------------------------------------------------
// Batch execution orchestrator
// ---------------------------------------------------------------------------

export interface RawUpsertOptions {
    parallel?: boolean;
    concurrency?: number;
    /**
     * When true (default), splits items by field signature before building raw SQL
     * so omitted fields in one row never overwrite existing values due to other rows
     * in the same batch that include that field.
     */
    patchSafeRaw?: boolean;
}

function getFieldSignature(item: Record<string, unknown>): string {
    const keys = Object.keys(item).sort((a, b) => a.localeCompare(b));
    return keys.join('\x1f');
}

function groupByFieldSignature(items: Record<string, unknown>[]): Record<string, unknown>[][] {
    const groups = new Map<string, Record<string, unknown>[]>();

    for (const item of items) {
        const signature = getFieldSignature(item);
        const existing = groups.get(signature);
        if (existing) {
            existing.push(item);
        } else {
            groups.set(signature, [item]);
        }
    }

    return Array.from(groups.values());
}

export async function executeRawUpsertBatch(
    modelName: string,
    modelInfo: ModelInfo,
    items: Record<string, unknown>[],
    options?: RawUpsertOptions
): Promise<UpsertResult> {
    if (!isNonEmptyArray(items)) {
        return { created: 0, updated: 0, unchanged: 0 };
    }

    const prisma = resolvePrismaForRaw() as unknown as PrismaClient;
    const provider = getDatabaseProviderCached(getPrismaInstance());
    const meta = getUpsertMetadata(modelName, modelInfo);
    const dedupedItems = deduplicateByUniqueKey(items, meta.uniqueConflictColumns);
    const duplicatesRemoved = items.length - dedupedItems.length;
    const batchSize = getOptimalBatchSize('createMany', provider);
    const needsPreCount = provider === 'mysql' || provider === 'sqlite';
    const usesQueryRaw = provider === 'postgresql' || provider === 'sqlserver';
    const patchSafeRaw = options?.patchSafeRaw !== false;
    const itemGroups = patchSafeRaw ? groupByFieldSignature(dedupedItems) : [dedupedItems];

    const allBatchResults: UpsertResult[] = [];
    const allBatchErrors: Array<{ error: Error }> = [];

    for (const group of itemGroups) {
        const groupResult = await processBatches(
            group,
            batchSize,
            async (batch): Promise<UpsertResult> => {
                return await withErrorHandling<UpsertResult>(
                    async () => {
                        let existingCount: number | undefined;

                        if (needsPreCount) {
                            const countQuery = buildPreCountQuery(meta, batch, prisma);
                            const countResult = (await prisma.$queryRawUnsafe(countQuery)) as Array<{ cnt: unknown }>;
                            existingCount = Number(countResult?.[0]?.cnt ?? 0);
                        }

                        const sql = buildUpsertSQL(provider, meta, batch, prisma);

                        let rawResult: unknown;
                        if (usesQueryRaw) {
                            rawResult = await prisma.$queryRawUnsafe(sql);
                        } else {
                            rawResult = await prisma.$executeRawUnsafe(sql);
                        }

                        return parseUpsertResults(provider, rawResult, batch.length, existingCount);
                    },
                    "raw upsert batch"
                );
            },
            {
                parallel: options?.parallel !== false && !shouldDisableParallel(),
                concurrency: options?.concurrency
            }
        );

        allBatchResults.push(...groupResult.results);
        allBatchErrors.push(...groupResult.errors.map(e => ({ error: e.error })));
    }

    // Aggregate batch results
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalUnchanged = 0;
    const allReturnedIds: Array<{ id: number | string; wasInserted: boolean }> = [];

    for (const batchResult of allBatchResults) {
        totalCreated += batchResult.created;
        totalUpdated += batchResult.updated;
        totalUnchanged += batchResult.unchanged;
        if (batchResult.returnedIds) {
            allReturnedIds.push(...batchResult.returnedIds);
        }
    }

    if (allBatchErrors.length > 0) {
        logError(
            "executeRawUpsertBatch",
            new Error(`${allBatchErrors.length} batches failed`),
            { failedCount: allBatchErrors.length }
        );

        if (allBatchResults.length === 0) {
            throw allBatchErrors[0].error;
        }
    }

    return {
        created: totalCreated,
        updated: totalUpdated,
        unchanged: totalUnchanged + duplicatesRemoved,
        returnedIds: allReturnedIds.length > 0 ? allReturnedIds : undefined,
    };
}
