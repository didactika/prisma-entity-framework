import { describe, it, expect } from '@jest/globals';
import BaseEntity from '../src/core/base-entity';
import { Property } from '../src/core/decorators/property.decorator';

// Mock interface for testing
interface ITestEntity {
    id?: number;
    name: string;
    email: string;
    age?: number;
    isActive: boolean;
}

// Test entity using @Property() decorator
class TestEntityWithDecorator extends BaseEntity<ITestEntity> implements ITestEntity {
    static override readonly model = null; // Mock model for testing

    public declare readonly id?: number;
    
    @Property() declare name: string;
    @Property() declare email: string;
    @Property() declare age?: number;
    @Property() declare isActive: boolean;

    constructor(data: ITestEntity) {
        super(data);
    }
}

// Test entity using traditional getters/setters (for comparison)
class TestEntityTraditional extends BaseEntity<ITestEntity> implements ITestEntity {
    static override readonly model = null;

    public readonly id?: number;
    private _name!: string;
    private _email!: string;
    private _age?: number;
    private _isActive!: boolean;

    constructor(data: ITestEntity) {
        super(data);
    }

    get name() { return this._name; }
    set name(value: string) { this._name = value; }

    get email() { return this._email; }
    set email(value: string) { this._email = value; }

    get age() { return this._age; }
    set age(value: number | undefined) { this._age = value; }

    get isActive() { return this._isActive; }
    set isActive(value: boolean) { this._isActive = value; }
}

describe('@Property() Decorator', () => {
    describe('Basic Functionality', () => {
        it('should create getter and setter for decorated properties', () => {
            const entity = new TestEntityWithDecorator({
                name: 'John Doe',
                email: 'john@example.com',
                isActive: true
            });

            expect(entity.name).toBe('John Doe');
            expect(entity.email).toBe('john@example.com');
            expect(entity.isActive).toBe(true);
        });

        it('should allow updating decorated properties', () => {
            const entity = new TestEntityWithDecorator({
                name: 'John Doe',
                email: 'john@example.com',
                isActive: true
            });

            entity.name = 'Jane Doe';
            entity.email = 'jane@example.com';
            entity.isActive = false;

            expect(entity.name).toBe('Jane Doe');
            expect(entity.email).toBe('jane@example.com');
            expect(entity.isActive).toBe(false);
        });

        it('should handle optional properties', () => {
            const entity = new TestEntityWithDecorator({
                name: 'John Doe',
                email: 'john@example.com',
                isActive: true
            });

            expect(entity.age).toBeUndefined();

            entity.age = 30;
            expect(entity.age).toBe(30);

            entity.age = undefined;
            expect(entity.age).toBeUndefined();
        });

        it('should initialize properties in constructor', () => {
            const entity = new TestEntityWithDecorator({
                id: 1,
                name: 'John Doe',
                email: 'john@example.com',
                age: 25,
                isActive: true
            });

            expect(entity.id).toBe(1);
            expect(entity.name).toBe('John Doe');
            expect(entity.email).toBe('john@example.com');
            expect(entity.age).toBe(25);
            expect(entity.isActive).toBe(true);
        });
    });

    describe('Compatibility with Traditional Approach', () => {
        it('should behave identically to traditional getters/setters', () => {
            const dataDecorated = {
                name: 'John Doe',
                email: 'john@example.com',
                age: 30,
                isActive: true
            };

            const dataTraditional = { ...dataDecorated };

            const entityDecorated = new TestEntityWithDecorator(dataDecorated);
            const entityTraditional = new TestEntityTraditional(dataTraditional);

            // Check initial values
            expect(entityDecorated.name).toBe(entityTraditional.name);
            expect(entityDecorated.email).toBe(entityTraditional.email);
            expect(entityDecorated.age).toBe(entityTraditional.age);
            expect(entityDecorated.isActive).toBe(entityTraditional.isActive);

            // Update values
            entityDecorated.name = 'Jane Doe';
            entityTraditional.name = 'Jane Doe';

            expect(entityDecorated.name).toBe(entityTraditional.name);
        });
    });

    describe('Private Property Storage', () => {
        it('should store values in private properties with underscore prefix', () => {
            const entity = new TestEntityWithDecorator({
                name: 'John Doe',
                email: 'john@example.com',
                isActive: true
            });

            // Access private properties directly (for testing purposes)
            expect((entity as any)._name).toBe('John Doe');
            expect((entity as any)._email).toBe('john@example.com');
            expect((entity as any)._isActive).toBe(true);
        });

        it('should not expose private properties in public API', () => {
            const entity = new TestEntityWithDecorator({
                name: 'John Doe',
                email: 'john@example.com',
                isActive: true
            });

            // Check that the public API works correctly
            expect(entity.name).toBeDefined();
            expect(entity.email).toBeDefined();
            expect(entity.isActive).toBeDefined();
            
            // Private properties exist but are accessed through getters
            expect((entity as any)._name).toBe('John Doe');
        });
    });

    describe('Serialization', () => {
        it('should serialize decorated properties correctly with toObject()', () => {
            const entity = new TestEntityWithDecorator({
                id: 1,
                name: 'John Doe',
                email: 'john@example.com',
                age: 30,
                isActive: true
            });

            const obj = entity.toObject();

            expect(obj).toEqual({
                id: 1,
                name: 'John Doe',
                email: 'john@example.com',
                age: 30,
                isActive: true
            });
        });

        it('should serialize decorated properties correctly with toJson()', () => {
            const entity = new TestEntityWithDecorator({
                id: 1,
                name: 'John Doe',
                email: 'john@example.com',
                age: 30,
                isActive: true
            });

            const json = entity.toJson();
            const parsed = JSON.parse(json);

            expect(parsed).toEqual({
                id: 1,
                name: 'John Doe',
                email: 'john@example.com',
                age: 30,
                isActive: true
            });
        });
    });

    describe('Edge Cases', () => {
        it('should handle null values', () => {
            const entity = new TestEntityWithDecorator({
                name: 'John Doe',
                email: 'john@example.com',
                isActive: true
            });

            entity.age = null as any;
            expect(entity.age).toBeNull();
        });

        it('should handle empty strings', () => {
            const entity = new TestEntityWithDecorator({
                name: '',
                email: '',
                isActive: false
            });

            expect(entity.name).toBe('');
            expect(entity.email).toBe('');
        });

        it('should handle boolean false correctly', () => {
            const entity = new TestEntityWithDecorator({
                name: 'John Doe',
                email: 'john@example.com',
                isActive: false
            });

            expect(entity.isActive).toBe(false);
            expect(entity.isActive).not.toBeUndefined();
            expect(entity.isActive).not.toBeNull();
        });

        it('should handle zero values correctly', () => {
            const entity = new TestEntityWithDecorator({
                name: 'John Doe',
                email: 'john@example.com',
                age: 0,
                isActive: true
            });

            expect(entity.age).toBe(0);
            expect(entity.age).not.toBeUndefined();
        });
    });

    describe('Metadata Storage', () => {
        it('should store decorated properties metadata', () => {
            const decoratedProps = (TestEntityWithDecorator as any)._decoratedProperties;
            
            expect(decoratedProps).toBeInstanceOf(Set);
            expect(decoratedProps.has('name')).toBe(true);
            expect(decoratedProps.has('email')).toBe(true);
            expect(decoratedProps.has('age')).toBe(true);
            expect(decoratedProps.has('isActive')).toBe(true);
        });

        it('should not include id in decorated properties', () => {
            const decoratedProps = (TestEntityWithDecorator as any)._decoratedProperties;
            expect(decoratedProps.has('id')).toBe(false);
        });
    });

    describe('Mixed Usage (Decorated + Traditional)', () => {
        class MixedEntity extends BaseEntity<ITestEntity> implements ITestEntity {
            static override readonly model = null;

            public readonly id?: number;
            
            @Property() declare name: string;
            
            private _email!: string;
            get email() { return this._email; }
            set email(value: string) { this._email = value; }

            @Property() declare age?: number;
            @Property() declare isActive: boolean;

            constructor(data: ITestEntity) {
                super(data);
            }
        }

        it('should support mixing decorated and traditional properties', () => {
            const entity = new MixedEntity({
                name: 'John Doe',
                email: 'john@example.com',
                age: 30,
                isActive: true
            });

            expect(entity.name).toBe('John Doe');
            expect(entity.email).toBe('john@example.com');
            expect(entity.age).toBe(30);
            expect(entity.isActive).toBe(true);

            entity.name = 'Jane Doe';
            entity.email = 'jane@example.com';

            expect(entity.name).toBe('Jane Doe');
            expect(entity.email).toBe('jane@example.com');
        });
    });

    describe('Public Properties Support', () => {
        class PublicEntity extends BaseEntity<ITestEntity> implements ITestEntity {
            static override readonly model = null;

            declare public readonly id?: number;
            public name!: string;  // Use ! to avoid default initialization
            public email!: string;
            public age?: number;
            public isActive!: boolean;

            constructor(data: ITestEntity) {
                super(data);
            }
        }

        it('should initialize public properties correctly', () => {
            const entity = new PublicEntity({
                name: 'John Doe',
                email: 'john@example.com',
                age: 30,
                isActive: true
            });

            expect(entity.name).toBe('John Doe');
            expect(entity.email).toBe('john@example.com');
            expect(entity.age).toBe(30);
            expect(entity.isActive).toBe(true);
        });

        it('should allow updating public properties', () => {
            const entity = new PublicEntity({
                name: 'John Doe',
                email: 'john@example.com',
                isActive: true
            });

            entity.name = 'Jane Doe';
            entity.email = 'jane@example.com';
            entity.isActive = false;

            expect(entity.name).toBe('Jane Doe');
            expect(entity.email).toBe('jane@example.com');
            expect(entity.isActive).toBe(false);
        });

        it('should serialize public properties correctly', () => {
            const entity = new PublicEntity({
                id: 1,
                name: 'John Doe',
                email: 'john@example.com',
                age: 30,
                isActive: true
            });

            const obj = entity.toObject();

            expect(obj).toEqual({
                id: 1,
                name: 'John Doe',
                email: 'john@example.com',
                age: 30,
                isActive: true
            });
        });
    });

    describe('All Property Types Together', () => {
        class HybridEntity extends BaseEntity<ITestEntity> implements ITestEntity {
            static override readonly model = null;

            declare public readonly id?: number;
            
            // Decorated property
            @Property() declare name: string;
            
            // Traditional getter/setter
            private _email!: string;
            get email() { return this._email; }
            set email(value: string) { this._email = value; }
            
            // Public property
            public age?: number;
            
            // Another decorated property
            @Property() declare isActive: boolean;

            constructor(data: ITestEntity) {
                super(data);
            }
        }

        it('should handle all three property types correctly', () => {
            const entity = new HybridEntity({
                id: 1,
                name: 'John Doe',
                email: 'john@example.com',
                age: 30,
                isActive: true
            });

            // All properties should be initialized
            expect(entity.id).toBe(1);
            expect(entity.name).toBe('John Doe');
            expect(entity.email).toBe('john@example.com');
            expect(entity.age).toBe(30);
            expect(entity.isActive).toBe(true);

            // All properties should be updatable
            entity.name = 'Jane Doe';
            entity.email = 'jane@example.com';
            entity.age = 25;
            entity.isActive = false;

            expect(entity.name).toBe('Jane Doe');
            expect(entity.email).toBe('jane@example.com');
            expect(entity.age).toBe(25);
            expect(entity.isActive).toBe(false);
        });

        it('should serialize all property types correctly', () => {
            const entity = new HybridEntity({
                id: 1,
                name: 'John Doe',
                email: 'john@example.com',
                age: 30,
                isActive: true
            });

            const obj = entity.toObject();

            expect(obj).toEqual({
                id: 1,
                name: 'John Doe',
                email: 'john@example.com',
                age: 30,
                isActive: true
            });
        });
    });
});
