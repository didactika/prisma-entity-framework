/**
 * @Property() Decorator - Usage Examples
 * 
 * This file demonstrates the three different ways to define properties
 * in entities that extend BaseEntity.
 */

import { BaseEntity, Property } from '../src/index';

// Example interface
interface IUser {
    id?: number;
    name: string;
    email: string;
    age?: number;
    isActive: boolean;
}

// ============================================================================
// OPTION 1: Using @Property() Decorator (RECOMMENDED - Least code)
// ============================================================================

class UserWithDecorator extends BaseEntity<IUser> implements IUser {
    static override readonly model = null; // Set your Prisma model here

    declare public readonly id?: number;
    
    @Property() declare name: string;
    @Property() declare email: string;
    @Property() declare age?: number;
    @Property() declare isActive: boolean;

    constructor(data: IUser) {
        super(data);
    }

    // Optional: Add custom validation in setters
    // The decorator creates getters/setters automatically, but you can override them:
    /*
    private _email!: string;
    
    get email(): string {
        return this._email;
    }
    
    set email(value: string) {
        if (!value.includes('@')) {
            throw new Error('Invalid email format');
        }
        this._email = value;
    }
    */
}

// ============================================================================
// OPTION 2: Traditional Getters/Setters (More control, more code)
// ============================================================================

class UserTraditional extends BaseEntity<IUser> implements IUser {
    static override readonly model = null;

    declare public readonly id?: number;
    
    private _name!: string;
    private _email!: string;
    private _age?: number;
    private _isActive!: boolean;

    constructor(data: IUser) {
        super(data);
    }

    get name(): string {
        return this._name;
    }

    set name(value: string) {
        // Custom validation
        if (value.length < 3) {
            throw new Error('Name must be at least 3 characters');
        }
        this._name = value;
    }

    get email(): string {
        return this._email;
    }

    set email(value: string) {
        // Custom validation
        if (!value.includes('@')) {
            throw new Error('Invalid email format');
        }
        this._email = value.toLowerCase(); // Normalize
    }

    get age(): number | undefined {
        return this._age;
    }

    set age(value: number | undefined) {
        if (value !== undefined && (value < 0 || value > 150)) {
            throw new Error('Age must be between 0 and 150');
        }
        this._age = value;
    }

    get isActive(): boolean {
        return this._isActive;
    }

    set isActive(value: boolean) {
        this._isActive = value;
    }
}

// ============================================================================
// OPTION 3: Public Properties (Simplest, but no encapsulation)
// ============================================================================

class UserPublic extends BaseEntity<IUser> implements IUser {
    static override readonly model = null;

    declare public readonly id?: number;
    public name: string = "";
    public email: string = "";
    public age?: number;
    public isActive: boolean = false;

    constructor(data: IUser) {
        super(data);
    }
}

// ============================================================================
// OPTION 4: Hybrid Approach (Mix all three styles)
// ============================================================================

class UserHybrid extends BaseEntity<IUser> implements IUser {
    static override readonly model = null;

    declare public readonly id?: number;
    
    // Use decorator for simple properties
    @Property() declare name: string;
    
    // Use traditional getter/setter for properties with validation
    private _email!: string;
    get email(): string {
        return this._email;
    }
    set email(value: string) {
        if (!value.includes('@')) {
            throw new Error('Invalid email format');
        }
        this._email = value.toLowerCase();
    }
    
    // Use public property for simple data
    public age?: number;
    
    // Use decorator for another simple property
    @Property() declare isActive: boolean;

    constructor(data: IUser) {
        super(data);
    }
}

// ============================================================================
// USAGE EXAMPLES
// ============================================================================

async function examples() {
    // Example 1: Decorator approach
    const user1 = new UserWithDecorator({
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
        isActive: true
    });

    console.log(user1.name); // "John Doe"
    user1.name = 'Jane Doe';
    console.log(user1.name); // "Jane Doe"

    // Example 2: Traditional approach with validation
    const user2 = new UserTraditional({
        name: 'John Smith',
        email: 'john@example.com',
        isActive: true
    });

    try {
        user2.name = 'Jo'; // Too short - will throw error
    } catch (error) {
        console.error(error); // Error: Name must be at least 3 characters
    }

    // Example 3: Public properties (simple and direct)
    const user3 = new UserPublic({
        name: 'Alice',
        email: 'alice@example.com',
        age: 25,
        isActive: true
    });

    user3.age = 26; // Direct assignment, no validation
    console.log(user3.age); // 26

    // Example 4: Hybrid approach
    const user4 = new UserHybrid({
        name: 'Bob',
        email: 'bob@example.com',
        age: 35,
        isActive: false
    });

    console.log(user4.name); // "Bob" (from decorator)
    console.log(user4.email); // "bob@example.com" (validated and normalized)
    console.log(user4.age); // 35 (public property)
    console.log(user4.isActive); // false (from decorator)

    // Serialization works with all approaches
    console.log(user1.toObject());
    console.log(user2.toJson());
}

// ============================================================================
// COMPARISON TABLE
// ============================================================================

/*
┌─────────────────────┬──────────────────┬────────────────┬───────────────────┐
│ Feature             │ @Property()      │ Getter/Setter  │ Public Property   │
├─────────────────────┼──────────────────┼────────────────┼───────────────────┤
│ Code Lines          │ 1 per property   │ ~7 per property│ 1 per property    │
│ Encapsulation       │ ✅ Yes           │ ✅ Yes         │ ❌ No             │
│ Validation          │ ⚠️ Manual*       │ ✅ Easy        │ ❌ No             │
│ Transformation      │ ⚠️ Manual*       │ ✅ Easy        │ ❌ No             │
│ Type Safety         │ ✅ Full          │ ✅ Full        │ ✅ Full           │
│ Serialization       │ ✅ Works         │ ✅ Works       │ ✅ Works          │
│ Learning Curve      │ ⚠️ Medium        │ ✅ Easy        │ ✅ Very Easy      │
│ Performance         │ ✅ Fast          │ ✅ Fast        │ ✅ Fastest        │
│ Recommended For     │ Most cases       │ Complex logic  │ Simple DTOs       │
└─────────────────────┴──────────────────┴────────────────┴───────────────────┘

* You can add validation by creating custom getters/setters even with @Property()
*/

// ============================================================================
// RECOMMENDATIONS
// ============================================================================

/*
1. Use @Property() for most entity properties
   - Reduces boilerplate significantly
   - Maintains encapsulation
   - Easy to read and maintain

2. Use traditional getters/setters when you need:
   - Complex validation logic
   - Data transformation (normalization, formatting)
   - Computed properties
   - Lazy loading

3. Use public properties when:
   - Creating simple DTOs (Data Transfer Objects)
   - You don't need validation or encapsulation
   - Maximum performance is critical

4. Use hybrid approach when:
   - Your entity has mixed requirements
   - Some properties need validation, others don't
   - You want flexibility
*/

export {
    UserWithDecorator,
    UserTraditional,
    UserPublic,
    UserHybrid
};
