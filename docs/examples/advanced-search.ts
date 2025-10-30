/**
 * Example: Advanced Search with Prisma Entity Framework
 * 
 * Demonstrates the powerful search capabilities including:
 * - Complex filters with AND/OR logic
 * - Text search (contains, startsWith, endsWith)
 * - Range queries (gte, lte, gt, lt)
 * - List operations (in, notIn)
 * - Nested relation searches
 * - Pagination and sorting
 */

import { PrismaClient } from '@prisma/client';
import { configurePrisma, BaseEntity, SearchUtils } from 'prisma-entity-framework';

const prisma = new PrismaClient();
configurePrisma(prisma);

class Product extends BaseEntity<Product> {
  id!: number;
  name!: string;
  description?: string;
  price!: number;
  stock!: number;
  categoryId!: number;
  createdAt!: Date;
  updatedAt!: Date;

  static model = prisma.product;

  constructor(data: Partial<Product>) {
    super();
    Object.assign(this, data);
  }
}

async function advancedSearchExamples() {

  // ====== TEXT SEARCH ======
  
  // Search products with names containing "laptop"
  const laptops = await Product.findByFilter(
    { name: { contains: 'laptop' } },
    { returnType: 'list' }
  );

  // Search products with names starting with "Apple"
  const appleProducts = await Product.findByFilter(
    { name: { startsWith: 'Apple' } },
    { returnType: 'list' }
  );

  // Case-insensitive search
  const products = await Product.findByFilter(
    { name: { contains: 'LAPTOP', mode: 'insensitive' } },
    { returnType: 'list' }
  );


  // ====== RANGE QUERIES ======
  
  // Products priced between $100 and $500
  const affordableProducts = await Product.findByFilter(
    {
      price: { gte: 100, lte: 500 }
    },
    { returnType: 'list' }
  );

  // Products with low stock (less than 10)
  const lowStockProducts = await Product.findByFilter(
    { stock: { lt: 10 } },
    {
      returnType: 'list',
      orderBy: { stock: 'asc' }
    }
  );

  // Recent products (created in last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentProducts = await Product.findByFilter(
    { createdAt: { gte: thirtyDaysAgo } },
    {
      returnType: 'list',
      orderBy: { createdAt: 'desc' }
    }
  );


  // ====== LIST OPERATIONS ======
  
  // Products in specific categories
  const categoryProducts = await Product.findByFilter(
    { categoryId: { in: [1, 2, 3] } },
    { returnType: 'list' }
  );

  // Products NOT in certain categories
  const excludedProducts = await Product.findByFilter(
    { categoryId: { notIn: [4, 5] } },
    { returnType: 'list' }
  );


  // ====== COMPLEX FILTERS (OR LOGIC) ======
  
  // Products that are either expensive OR low stock
  const urgentProducts = await Product.findByFilter(
    {
      OR: [
        { price: { gte: 1000 } },
        { stock: { lt: 5 } }
      ]
    },
    { returnType: 'list' }
  );

  // Multiple OR conditions
  const specialProducts = await Product.findByFilter(
    {
      OR: [
        { name: { contains: 'Premium' } },
        { name: { contains: 'Deluxe' } },
        { price: { gte: 2000 } }
      ]
    },
    { returnType: 'list' }
  );


  // ====== PAGINATION ======
  
  // Get page 2 with 20 items per page
  const page2 = await Product.findByFilter(
    {},
    {
      returnType: 'paginated',
      page: 2,
      pageSize: 20,
      orderBy: { name: 'asc' }
    }
  );
  
  console.log('Paginated result:', {
    currentPage: page2.currentPage,
    totalPages: page2.totalPages,
    totalItems: page2.totalItems,
    items: page2.data.length
  });


  // ====== NESTED RELATION SEARCHES ======
  
  // Get products with their category and reviews
  const productsWithRelations = await Product.findByFilter(
    { price: { gte: 100 } },
    {
      returnType: 'list',
      relationsToInclude: [
        'category',
        { reviews: ['user'] }  // Nested: include reviews with their users
      ]
    }
  );


  // ====== COMBINED COMPLEX QUERY ======
  
  // Find premium laptops with good stock, recently updated, 
  // in specific categories, sorted by price
  const complexQuery = await Product.findByFilter(
    {
      name: { contains: 'laptop', mode: 'insensitive' },
      price: { gte: 800, lte: 2000 },
      stock: { gte: 5 },
      categoryId: { in: [1, 2, 3] },
      updatedAt: { gte: thirtyDaysAgo },
      OR: [
        { name: { contains: 'Gaming' } },
        { name: { contains: 'Professional' } }
      ]
    },
    {
      returnType: 'paginated',
      page: 1,
      pageSize: 10,
      orderBy: { price: 'desc' },
      relationsToInclude: ['category', 'reviews']
    }
  );

  console.log('Complex query result:', complexQuery);


  // ====== USING SearchUtils DIRECTLY ======
  
  // Build dynamic filters programmatically
  const dynamicFilters = SearchUtils.buildDynamicFilters({
    searchText: 'gaming laptop',  // Will search in multiple text fields
    priceMin: 500,
    priceMax: 1500,
    categories: [1, 2],
    inStock: true
  });

  const dynamicResults = await Product.findByFilter(
    dynamicFilters,
    { returnType: 'list' }
  );
}

advancedSearchExamples()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
