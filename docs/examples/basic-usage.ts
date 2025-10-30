/**
 * Example: Basic Usage of Prisma Entity Framework
 * 
 * This example demonstrates how to set up and use the framework
 * with your Prisma models.
 */

import { PrismaClient } from '@prisma/client';
import { configurePrisma, BaseEntity } from 'prisma-entity-framework';

// 1. Initialize Prisma Client
const prisma = new PrismaClient();

// 2. Configure the framework with your Prisma instance
configurePrisma(prisma);

// 3. Define your entity classes extending BaseEntity
class User extends BaseEntity<User> {
  id!: number;
  email!: string;
  name?: string;
  createdAt!: Date;
  updatedAt!: Date;

  // Specify the Prisma model
  static model = prisma.user;

  constructor(data: Partial<User>) {
    super();
    Object.assign(this, data);
  }
}

// 4. Use the Active Record pattern
async function examples() {
  
  // ====== CREATE ======
  
  // Create a new user
  const newUser = new User({
    email: 'john@example.com',
    name: 'John Doe'
  });
  await newUser.create();
  console.log('Created user:', newUser);

  // Create multiple users at once
  const usersData = [
    { email: 'alice@example.com', name: 'Alice' },
    { email: 'bob@example.com', name: 'Bob' }
  ];
  const createdUsers = await User.createMany(usersData);
  console.log('Created users:', createdUsers);

  
  // ====== FIND ======
  
  // Find users with filters
  const users = await User.findByFilter(
    { email: 'john@example.com' },
    { returnType: 'list' }
  );
  console.log('Found users:', users);

  // Find with pagination
  const paginatedResult = await User.findByFilter(
    {},
    {
      returnType: 'paginated',
      page: 1,
      pageSize: 10
    }
  );
  console.log('Paginated result:', paginatedResult);

  // Find with relations
  const userWithPosts = await User.findByFilter(
    { id: 1 },
    {
      returnType: 'single',
      relationsToInclude: ['posts', 'profile']
    }
  );
  console.log('User with posts:', userWithPosts);

  // Advanced search with SearchUtils
  const searchResult = await User.findByFilter(
    {
      name: { contains: 'John' },
      email: { endsWith: '@example.com' },
      createdAt: { gte: new Date('2024-01-01') }
    },
    {
      returnType: 'list',
      orderBy: { createdAt: 'desc' }
    }
  );
  console.log('Search result:', searchResult);

  
  // ====== UPDATE ======
  
  // Update an entity instance
  const user = await User.findByFilter({ id: 1 }, { returnType: 'single' });
  if (user) {
    user.name = 'John Updated';
    await user.update();
    console.log('Updated user:', user);
  }

  // Batch update multiple records
  const updates = [
    { id: 1, name: 'User 1 Updated' },
    { id: 2, name: 'User 2 Updated' },
    { id: 3, name: 'User 3 Updated' }
  ];
  const updatedCount = await User.updateManyById(updates);
  console.log(`Updated ${updatedCount} users`);

  
  // ====== DELETE ======
  
  // Delete an entity instance
  if (user) {
    await user.delete();
    console.log('Deleted user');
  }

  // Delete multiple by IDs
  const deleteCount = await User.deleteByIds([1, 2, 3]);
  console.log(`Deleted ${deleteCount} users`);
}

// Run examples
examples()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
