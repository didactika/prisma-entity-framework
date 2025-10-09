/**
 * Mock Prisma Client for testing
 * Provides mock implementations of Prisma models and operations
 */

/**
 * Mock User model data
 */
export const mockUsers = [
  {
    id: 1,
    name: 'John Doe',
    email: 'john@example.com',
    age: 30,
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 2,
    name: 'Jane Smith',
    email: 'jane@example.com',
    age: 25,
    isActive: true,
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-02'),
  },
  {
    id: 3,
    name: 'Bob Johnson',
    email: 'bob@example.com',
    age: 35,
    isActive: false,
    createdAt: new Date('2024-01-03'),
    updatedAt: new Date('2024-01-03'),
  },
];

/**
 * Mock Post model data
 */
export const mockPosts = [
  {
    id: 1,
    title: 'First Post',
    content: 'This is the first post',
    published: true,
    authorId: 1,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 2,
    title: 'Second Post',
    content: 'This is the second post',
    published: false,
    authorId: 1,
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-02'),
  },
  {
    id: 3,
    title: 'Third Post',
    content: 'This is the third post',
    published: true,
    authorId: 2,
    createdAt: new Date('2024-01-03'),
    updatedAt: new Date('2024-01-03'),
  },
];

/**
 * Mock Comment model data
 */
export const mockComments = [
  {
    id: 1,
    text: 'Great post!',
    postId: 1,
    authorId: 2,
    createdAt: new Date('2024-01-01'),
  },
  {
    id: 2,
    text: 'Thanks for sharing',
    postId: 1,
    authorId: 3,
    createdAt: new Date('2024-01-02'),
  },
  {
    id: 3,
    text: 'Interesting perspective',
    postId: 2,
    authorId: 2,
    createdAt: new Date('2024-01-03'),
  },
];

/**
 * Mock Prisma runtime data model structure
 */
export const mockRuntimeDataModel = {
  models: {
    User: {
      fields: [
        { name: 'id', kind: 'scalar', isList: false },
        { name: 'name', kind: 'scalar', isList: false },
        { name: 'email', kind: 'scalar', isList: false },
        { name: 'age', kind: 'scalar', isList: false },
        { name: 'isActive', kind: 'scalar', isList: false },
        { name: 'posts', kind: 'object', isList: true, type: 'Post', relationName: 'UserPosts' },
        { name: 'comments', kind: 'object', isList: true, type: 'Comment', relationName: 'UserComments' },
        { name: 'createdAt', kind: 'scalar', isList: false },
        { name: 'updatedAt', kind: 'scalar', isList: false },
      ],
      dbName: 'users',
      name: 'User',
    },
    Post: {
      fields: [
        { name: 'id', kind: 'scalar', isList: false },
        { name: 'title', kind: 'scalar', isList: false },
        { name: 'content', kind: 'scalar', isList: false },
        { name: 'published', kind: 'scalar', isList: false },
        { name: 'author', kind: 'object', isList: false, type: 'User', relationName: 'UserPosts' },
        { name: 'authorId', kind: 'scalar', isList: false },
        { name: 'comments', kind: 'object', isList: true, type: 'Comment', relationName: 'PostComments' },
        { name: 'createdAt', kind: 'scalar', isList: false },
        { name: 'updatedAt', kind: 'scalar', isList: false },
      ],
      dbName: 'posts',
      name: 'Post',
    },
    Comment: {
      fields: [
        { name: 'id', kind: 'scalar', isList: false },
        { name: 'text', kind: 'scalar', isList: false },
        { name: 'post', kind: 'object', isList: false, type: 'Post', relationName: 'PostComments' },
        { name: 'postId', kind: 'scalar', isList: false },
        { name: 'author', kind: 'object', isList: false, type: 'User', relationName: 'UserComments' },
        { name: 'authorId', kind: 'scalar', isList: false },
        { name: 'createdAt', kind: 'scalar', isList: false },
      ],
      dbName: 'comments',
      name: 'Comment',
    },
  },
};

/**
 * Creates a mock Prisma model with common operations
 * @param data - Array of mock data for the model
 * @param modelName - Name of the model for identification
 * @returns Mock model with CRUD operations
 */
export function createMockModel(data: any[], modelName: string = 'Model') {
  let dataset = [...data];

  const mockModel = {
    name: modelName,
    
    findMany: jest.fn().mockImplementation(async (args?: any) => {
      let result = [...dataset];

      if (args?.where) {
        result = result.filter((item) => {
          return Object.entries(args.where).every(([key, value]: [string, any]) => {
            if (value && typeof value === 'object' && 'equals' in value) {
              return item[key] === value.equals;
            }
            if (value && typeof value === 'object' && 'contains' in value) {
              return item[key]?.toLowerCase().includes(value.contains.toLowerCase());
            }
            if (value && typeof value === 'object' && 'gte' in value) {
              return item[key] >= value.gte;
            }
            if (value && typeof value === 'object' && 'lte' in value) {
              return item[key] <= value.lte;
            }
            if (value && typeof value === 'object' && 'in' in value) {
              return value.in.includes(item[key]);
            }
            return item[key] === value;
          });
        });
      }

      if (args?.skip) {
        result = result.slice(args.skip);
      }

      if (args?.take) {
        result = result.slice(0, args.take);
      }

      if (args?.orderBy) {
        const [[field, direction]] = Object.entries(args.orderBy);
        result.sort((a, b) => {
          const aVal = a[field];
          const bVal = b[field];
          if (direction === 'asc') {
            return aVal > bVal ? 1 : -1;
          }
          return aVal < bVal ? 1 : -1;
        });
      }

      return result;
    }),

    count: jest.fn().mockImplementation(async (args?: any) => {
      if (!args?.where) return dataset.length;

      const filtered = dataset.filter((item) => {
        return Object.entries(args.where).every(([key, value]: [string, any]) => {
          if (value && typeof value === 'object' && 'equals' in value) {
            return item[key] === value.equals;
          }
          return item[key] === value;
        });
      });

      return filtered.length;
    }),

    create: jest.fn().mockImplementation(async (args: any) => {
      const newItem = {
        id: dataset.length + 1,
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dataset.push(newItem);
      return newItem;
    }),

    createMany: jest.fn().mockImplementation(async (args: any) => {
      const items = args.data.map((data: any, index: number) => ({
        id: dataset.length + index + 1,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      dataset.push(...items);
      return { count: items.length };
    }),

    update: jest.fn().mockImplementation(async (args: any) => {
      const index = dataset.findIndex((item) => item.id === args.where.id);
      if (index === -1) return null;

      dataset[index] = {
        ...dataset[index],
        ...args.data,
        updatedAt: new Date(),
      };

      return dataset[index];
    }),

    delete: jest.fn().mockImplementation(async (args: any) => {
      const index = dataset.findIndex((item) => item.id === args.where.id);
      if (index === -1) return null;

      const deleted = dataset[index];
      dataset.splice(index, 1);
      return deleted;
    }),

    deleteMany: jest.fn().mockImplementation(async (args?: any) => {
      if (!args?.where) {
        const count = dataset.length;
        dataset = [];
        return { count };
      }

      const initialLength = dataset.length;
      dataset = dataset.filter((item) => {
        return !Object.entries(args.where).every(([key, value]) => item[key] === value);
      });

      return { count: initialLength - dataset.length };
    }),

    // Reset mock data
    _reset: () => {
      dataset = [...data];
    },
  };

  return mockModel;
}

/**
 * Creates a complete mock Prisma Client
 * @returns Mock PrismaClient with all models
 */
export function createMockPrismaClient() {
  const mockUser = createMockModel(mockUsers, 'user');
  const mockPost = createMockModel(mockPosts, 'post');
  const mockComment = createMockModel(mockComments, 'comment');

  return {
    user: mockUser,
    post: mockPost,
    comment: mockComment,
    _runtimeDataModel: mockRuntimeDataModel,
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([]),
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    _reset: () => {
      mockUser._reset();
      mockPost._reset();
      mockComment._reset();
    },
  };
}

/**
 * Global mock Prisma Client instance
 */
export const mockPrismaClient = createMockPrismaClient();
