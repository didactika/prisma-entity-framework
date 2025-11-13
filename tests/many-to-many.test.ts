import BaseEntity from '../src/core/base-entity';
import DataUtils from '../src/core/data-utils';
import { configurePrisma } from '../src/core/config';

// Mock Prisma Client
const mockPrismaClient = {
    user: {
        name: 'User',
        createMany: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
    },
    _runtimeDataModel: {
        models: {
            User: {
                name: 'User',
                dbName: 'users',
                fields: [
                    { name: 'id', kind: 'scalar', isList: false, type: 'Int' },
                    { name: 'name', kind: 'scalar', isList: false, type: 'String' },
                    { name: 'email', kind: 'scalar', isList: false, type: 'String', isUnique: true },
                    { name: 'posts', kind: 'object', isList: true, type: 'Post', relationName: 'UserPosts' },
                    { name: 'tags', kind: 'object', isList: true, type: 'Tag', relationName: 'UserTags' },
                ],
                uniqueIndexes: [
                    { fields: ['email'] }
                ]
            }
        }
    }
};

class User extends BaseEntity<any> {
    static readonly model = mockPrismaClient.user;
}

describe('DataUtils', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        configurePrisma(mockPrismaClient as any);
    });

    describe('extractManyToManyRelations', () => {
        it('should extract many-to-many relations from items', () => {
            const items = [
                {
                    name: 'John',
                    email: 'john@example.com',
                    posts: [{ id: 1 }, { id: 2 }],
                    tags: [{ id: 10 }, { id: 20 }]
                },
                {
                    name: 'Jane',
                    email: 'jane@example.com',
                    posts: [{ id: 3 }]
                }
            ];

            const modelInfo = mockPrismaClient._runtimeDataModel.models.User;
            const result = DataUtils.extractManyToManyRelations(items, modelInfo);

            expect(result.cleanedItems).toHaveLength(2);
            expect(result.cleanedItems[0]).not.toHaveProperty('posts');
            expect(result.cleanedItems[0]).not.toHaveProperty('tags');
            expect(result.cleanedItems[0]).toHaveProperty('name', 'John');

            expect(result.relations.size).toBe(2);
            expect(result.relations.get(0)).toEqual({
                posts: [{ id: 1 }, { id: 2 }],
                tags: [{ id: 10 }, { id: 20 }]
            });
            expect(result.relations.get(1)).toEqual({
                posts: [{ id: 3 }]
            });

            // Verify relation types are detected (implicit since no relationFromFields)
            expect(result.relationTypes.size).toBe(2);
            expect(result.relationTypes.get('posts')).toBe('implicit');
            expect(result.relationTypes.get('tags')).toBe('implicit');
        });

        it('should handle connect format', () => {
            const items = [
                {
                    name: 'John',
                    posts: { connect: [{ id: 1 }, { id: 2 }] }
                }
            ];

            const modelInfo = mockPrismaClient._runtimeDataModel.models.User;
            const result = DataUtils.extractManyToManyRelations(items, modelInfo);

            expect(result.relations.get(0)).toEqual({
                posts: [{ id: 1 }, { id: 2 }]
            });

            // Verify relation types are included
            expect(result.relationTypes.get('posts')).toBe('implicit');
        });

        it('should return original items if no model info', () => {
            const items = [{ name: 'John', posts: [{ id: 1 }] }];
            const result = DataUtils.extractManyToManyRelations(items);

            expect(result.cleanedItems).toEqual(items);
            expect(result.relations.size).toBe(0);
            expect(result.relationTypes.size).toBe(0);
        });

        it('should skip non-array relation fields', () => {
            const items = [
                {
                    name: 'John',
                    posts: [{ id: 1 }],
                    profile: { id: 100 } // Single relation, not many-to-many
                }
            ];

            const modelInfo = mockPrismaClient._runtimeDataModel.models.User;
            const result = DataUtils.extractManyToManyRelations(items, modelInfo);

            // profile should remain since it's not a many-to-many relation
            expect(result.cleanedItems[0]).toHaveProperty('profile');
            expect(result.cleanedItems[0]).not.toHaveProperty('posts');
        });
    });

    describe('getManyToManyFields', () => {
        it('should return many-to-many fields', () => {
            const modelInfo = mockPrismaClient._runtimeDataModel.models.User;
            const fields = DataUtils.getManyToManyFields(modelInfo);

            expect(fields).toHaveLength(2);
            expect(fields).toContainEqual({ name: 'posts', type: 'Post' });
            expect(fields).toContainEqual({ name: 'tags', type: 'Tag' });
        });

        it('should return empty array if no model info', () => {
            const fields = DataUtils.getManyToManyFields();
            expect(fields).toEqual([]);
        });
    });

    describe('hasManyToManyRelations', () => {
        it('should return true if model has many-to-many relations', () => {
            const modelInfo = mockPrismaClient._runtimeDataModel.models.User;
            expect(DataUtils.hasManyToManyRelations(modelInfo)).toBe(true);
        });

        it('should return false if no model info', () => {
            expect(DataUtils.hasManyToManyRelations()).toBe(false);
        });
    });

    describe('applyManyToManyRelations', () => {
        it('should apply relations to entities', async () => {
            mockPrismaClient.user.update.mockResolvedValue({ id: 1 });

            const entityIds = [1, 2];
            const relations = new Map<number, Record<string, any[]>>([
                [0, { posts: [{ id: 10 }, { id: 20 }] }],
                [1, { posts: [{ id: 30 }], tags: [{ id: 100 }] }]
            ]);

            const modelInfo = mockPrismaClient._runtimeDataModel.models.User;

            const result = await DataUtils.applyManyToManyRelations(
                entityIds,
                relations,
                'User',
                modelInfo
            );

            expect(result.success).toBeGreaterThan(0);
            expect(result.failed).toBe(0);
            expect(mockPrismaClient.user.update).toHaveBeenCalled();
        });

        it('should handle empty relations', async () => {
            const modelInfo = mockPrismaClient._runtimeDataModel.models.User;
            
            const result = await DataUtils.applyManyToManyRelations(
                [1, 2],
                new Map(),
                'User',
                modelInfo
            );

            expect(result.success).toBe(0);
            expect(result.failed).toBe(0);
            expect(mockPrismaClient.user.update).not.toHaveBeenCalled();
        });

        it('should handle errors gracefully', async () => {
            mockPrismaClient.user.update
                .mockResolvedValueOnce({ id: 1 })
                .mockRejectedValueOnce(new Error('Update failed'));

            const entityIds = [1, 2];
            const relations = new Map<number, Record<string, any[]>>([
                [0, { posts: [{ id: 10 }] }],
                [1, { posts: [{ id: 20 }] }]
            ]);

            const modelInfo = mockPrismaClient._runtimeDataModel.models.User;

            const result = await DataUtils.applyManyToManyRelations(
                entityIds,
                relations,
                'User',
                modelInfo,
                undefined,
                { parallel: false }
            );

            expect(result.success).toBeGreaterThanOrEqual(0);
            expect(result.failed).toBeGreaterThanOrEqual(0);
        });

        it('should filter out invalid IDs', async () => {
            const entityIds = [1, 2];
            const relations = new Map<number, Record<string, any[]>>([
                [0, { posts: [{ id: null }, { id: undefined }, { id: 10 }] }]
            ]);

            const modelInfo = mockPrismaClient._runtimeDataModel.models.User;

            await DataUtils.applyManyToManyRelations(
                entityIds,
                relations,
                'User',
                modelInfo
            );

            expect(mockPrismaClient.user.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: {
                    posts: {
                        connect: [{ id: 10 }]
                    }
                }
            });
        });

        it('should batch multiple relations for same entity into single update', async () => {
            mockPrismaClient.user.update.mockResolvedValue({ id: 1 });

            const entityIds = [1];
            const relations = new Map<number, Record<string, any[]>>([
                [0, { 
                    posts: [{ id: 10 }, { id: 20 }],
                    tags: [{ id: 100 }, { id: 200 }]
                }]
            ]);

            const modelInfo = mockPrismaClient._runtimeDataModel.models.User;

            const result = await DataUtils.applyManyToManyRelations(
                entityIds,
                relations,
                'User',
                modelInfo
            );

            // Should make only 1 update call (batched) instead of 2 (one per field)
            expect(mockPrismaClient.user.update).toHaveBeenCalledTimes(1);
            expect(mockPrismaClient.user.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: {
                    posts: {
                        connect: [{ id: 10 }, { id: 20 }]
                    },
                    tags: {
                        connect: [{ id: 100 }, { id: 200 }]
                    }
                }
            });
            expect(result.success).toBe(4); // 2 posts + 2 tags
        });
    });
});

describe('BaseEntity with Many-to-Many Relations', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        configurePrisma(mockPrismaClient as any);
    });

    describe('createMany with handleRelations', () => {
        it('should create entities and apply many-to-many relations', async () => {
            mockPrismaClient.user.createMany.mockResolvedValue({ count: 2 });
            mockPrismaClient.user.findMany.mockResolvedValue([
                { id: 1, name: 'John', email: 'john@example.com' },
                { id: 2, name: 'Jane', email: 'jane@example.com' }
            ]);
            mockPrismaClient.user.update.mockResolvedValue({ id: 1 });

            const items = [
                {
                    name: 'John',
                    email: 'john@example.com',
                    posts: [{ id: 10 }, { id: 20 }]
                },
                {
                    name: 'Jane',
                    email: 'jane@example.com',
                    posts: [{ id: 30 }]
                }
            ];

            const count = await User.createMany(items, false, undefined, {
                handleRelations: true,
                parallel: false
            });

            expect(count).toBe(2);
            expect(mockPrismaClient.user.createMany).toHaveBeenCalled();
            expect(mockPrismaClient.user.findMany).toHaveBeenCalled();
            expect(mockPrismaClient.user.update).toHaveBeenCalled();
        });

        it('should work without relations', async () => {
            mockPrismaClient.user.createMany.mockResolvedValue({ count: 1 });

            const items = [
                {
                    name: 'John',
                    email: 'john@example.com'
                }
            ];

            const count = await User.createMany(items, false, undefined, {
                handleRelations: true
            });

            expect(count).toBe(1);
            expect(mockPrismaClient.user.update).not.toHaveBeenCalled();
        });

        it('should skip relation handling when handleRelations is false', async () => {
            mockPrismaClient.user.createMany.mockResolvedValue({ count: 1 });

            const items = [
                {
                    name: 'John',
                    email: 'john@example.com',
                    posts: [{ id: 10 }]
                }
            ];

            const count = await User.createMany(items, false, undefined, {
                handleRelations: false
            });

            expect(count).toBe(1);
            expect(mockPrismaClient.user.findMany).not.toHaveBeenCalled();
            expect(mockPrismaClient.user.update).not.toHaveBeenCalled();
        });
    });
});

