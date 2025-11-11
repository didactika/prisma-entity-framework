/**
 * Example: Many-to-Many Relations in Batch Operations
 * 
 * This example demonstrates how to use many-to-many relations
 * with createMany and upsertMany operations.
 */

import { PrismaClient } from '@prisma/client';
import BaseEntity from '../../src/base-entity';
import { configurePrisma } from '../../src/config';

const prisma = new PrismaClient();
configurePrisma(prisma);

// Define your entity classes
class Post extends BaseEntity<any> {
    static readonly model = prisma.post;
}

class User extends BaseEntity<any> {
    static readonly model = prisma.user;
}

// Example 1: Create posts with tags (many-to-many)
async function createPostsWithTags() {
    console.log('Creating posts with tags...');

    const posts = [
        {
            title: 'Getting Started with TypeScript',
            content: 'TypeScript is a typed superset of JavaScript...',
            tags: [
                { id: 1 },  // TypeScript tag
                { id: 2 }   // Programming tag
            ]
        },
        {
            title: 'Node.js Best Practices',
            content: 'Here are some best practices for Node.js...',
            tags: [
                { id: 2 },  // Programming tag
                { id: 3 }   // Node.js tag
            ]
        },
        {
            title: 'Database Design Patterns',
            content: 'Learn about common database design patterns...',
            tags: [
                { id: 4 },  // Database tag
                { id: 2 }   // Programming tag
            ]
        }
    ];

    // Create posts with automatic many-to-many relation handling
    const count = await Post.createMany(posts, false, undefined, {
        handleRelations: true,  // Enable many-to-many handling
        parallel: true,         // Use parallel execution
        concurrency: 5          // Control concurrency
    });

    console.log(`✅ Created ${count} posts with their tags`);
}

// Example 2: Upsert users with roles (many-to-many)
async function upsertUsersWithRoles() {
    console.log('Upserting users with roles...');

    const users = [
        {
            email: 'admin@example.com',
            name: 'Admin User',
            roles: [
                { id: 1 },  // Admin role
                { id: 2 }   // Editor role
            ]
        },
        {
            email: 'editor@example.com',
            name: 'Editor User',
            roles: [
                { id: 2 }   // Editor role
            ]
        },
        {
            email: 'viewer@example.com',
            name: 'Viewer User',
            roles: [
                { id: 3 }   // Viewer role
            ]
        }
    ];

    // Upsert users with automatic many-to-many relation handling
    const result = await User.upsertMany(users, undefined, {
        handleRelations: true,
        parallel: true
    });

    console.log(`✅ Created: ${result.created}, Updated: ${result.updated}, Unchanged: ${result.unchanged}`);
}

// Example 3: Using connect format
async function createWithConnectFormat() {
    console.log('Creating with connect format...');

    const posts = [
        {
            title: 'Advanced TypeScript',
            content: 'Deep dive into TypeScript features...',
            tags: {
                connect: [
                    { id: 1 },
                    { id: 2 }
                ]
            }
        }
    ];

    const count = await Post.createMany(posts, false, undefined, {
        handleRelations: true
    });

    console.log(`✅ Created ${count} posts`);
}

// Example 4: Batch operation without relation handling (for comparison)
async function createWithoutRelations() {
    console.log('Creating without relation handling...');

    const posts = [
        {
            title: 'Simple Post',
            content: 'This post has no tags...'
            // No tags specified
        }
    ];

    // Faster execution when no relations are needed
    const count = await Post.createMany(posts, false, undefined, {
        handleRelations: false  // Disable for better performance
    });

    console.log(`✅ Created ${count} posts (no relations)`);
}

// Example 5: Error handling
async function createWithErrorHandling() {
    console.log('Creating with error handling...');

    const posts = [
        {
            title: 'Post with Invalid Tags',
            content: 'Some tags might not exist...',
            tags: [
                { id: 999 },  // This tag might not exist
                { id: 1 }
            ]
        }
    ];

    try {
        const count = await Post.createMany(posts, false, undefined, {
            handleRelations: true
        });

        console.log(`✅ Created ${count} posts`);
        // Check console for warnings about failed relations
    } catch (error) {
        console.error('❌ Error creating posts:', error);
    }
}

// Example 6: Large batch with parallel execution
async function createLargeBatch() {
    console.log('Creating large batch with parallel execution...');

    // Generate 1000 posts with tags
    const posts = Array.from({ length: 1000 }, (_, i) => ({
        title: `Post ${i + 1}`,
        content: `Content for post ${i + 1}`,
        tags: [
            { id: (i % 5) + 1 }  // Distribute across 5 tags
        ]
    }));

    const startTime = Date.now();

    const count = await Post.createMany(posts, false, undefined, {
        handleRelations: true,
        parallel: true,
        concurrency: 10  // Process 10 relation updates at a time
    });

    const duration = Date.now() - startTime;

    console.log(`✅ Created ${count} posts in ${duration}ms`);
    console.log(`   Average: ${(duration / count).toFixed(2)}ms per post`);
}

// Run examples
async function main() {
    try {
        await createPostsWithTags();
        console.log('---');

        await upsertUsersWithRoles();
        console.log('---');

        await createWithConnectFormat();
        console.log('---');

        await createWithoutRelations();
        console.log('---');

        await createWithErrorHandling();
        console.log('---');

        await createLargeBatch();
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

// Uncomment to run
// main();

export {
    createPostsWithTags,
    upsertUsersWithRoles,
    createWithConnectFormat,
    createWithoutRelations,
    createWithErrorHandling,
    createLargeBatch
};
