/**
 * Utility class for processing relational data structures.
 */
export default class DataUtils {
    /**
     * Processes relational data by transforming nested objects and arrays into Prisma-compatible formats.
     * Converts objects into `connect` or `create` structures for relational integrity.
     * JSON fields are preserved as-is without wrapping in connect/create.
     * @param data The original data object containing relations.
     * @param modelInfo Optional model information to detect JSON fields
     * @returns A transformed object formatted for Prisma operations.
     */
    public static processRelations(data: Record<string, any>, modelInfo?: any): Record<string, any> {
        const processedData = { ...data };

        // Build a set of JSON field names for quick lookup
        const jsonFields = new Set<string>();
        if (modelInfo?.fields) {
            for (const field of modelInfo.fields) {
                if (field.kind === 'scalar' && (field.type === 'Json' || field.type === 'Bytes')) {
                    jsonFields.add(field.name);
                }
            }
        }

        for (const key of Object.keys(data)) {
            const value = data[key];

            if (!this.isObject(value)) continue;

            // Skip processing if this is a JSON field
            if (jsonFields.has(key)) {
                // Keep JSON fields as-is
                processedData[key] = value;
                continue;
            }

            if (Array.isArray(value)) {
                const relationArray = this.processRelationArray(value);
                if (relationArray.length > 0) {
                    processedData[key] = { connect: relationArray };
                }
            } else {
                processedData[key] = this.processRelationObject(value);
            }
        }

        return processedData;
    }

    private static isObject(val: unknown): val is Record<string, any> {
        return typeof val === 'object' && val !== null;
    }

    private static processRelationArray(array: any[]): Array<{ id: any }> {
        return array
            .map((item) => (item?.id !== undefined ? { id: item.id } : null))
            .filter(Boolean) as Array<{ id: any }>;
    }

    private static processRelationObject(obj: any): { connect: any } | { create: any } {
        if (obj?.id !== undefined) {
            return { connect: { id: obj.id } };
        }
        return { create: { ...obj } };
    }


    public static normalizeRelationsToFK(
        data: Record<string, any>,
        keyTransformTemplate: (relationName: string) => string = (key) => `${key}Id`
    ): Record<string, any> {
        const flatData = {...data};

        for (const [key, value] of Object.entries(flatData)) {
            if (
                typeof value === 'object' &&
                value !== null &&
                'connect' in value &&
                value.connect &&
                typeof value.connect === 'object' &&
                'id' in value.connect
            ) {
                const newKey = keyTransformTemplate(key);
                // Only set the FK if it doesn't already exist (FK takes precedence)
                if (!(newKey in flatData)) {
                    flatData[newKey] = value.connect.id;
                }
                delete flatData[key];
            }
        }

        return flatData;
    }

}
