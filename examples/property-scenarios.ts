/**
 * Comprehensive test of all property initialization scenarios
 * This file demonstrates how initializeProperties handles different property types
 */

import { BaseEntity, Property } from '../src/index';

interface ITest {
    id?: number;
    decorated: string;
    withGetter: string;
    publicProp: string;
    privateNoUnderscore: string;
    privateWithUnderscore: string;
}

// ============================================================================
// Scenario 1: Decorated property ✅
// ============================================================================
console.log('\n=== Scenario 1: @Property() decorator ===');

class Test1 extends BaseEntity<ITest> implements ITest {
    static override readonly model = null;
    
    @Property() declare decorated!: string;
    @Property() declare withGetter!: string;
    @Property() declare publicProp!: string;
    @Property() declare privateNoUnderscore!: string;
    @Property() declare privateWithUnderscore!: string;
}

const test1 = new Test1({
    decorated: "value1",
    withGetter: "value2",
    publicProp: "value3",
    privateNoUnderscore: "value4",
    privateWithUnderscore: "value5"
});

console.log('✅ test1.decorated:', test1.decorated);              // "value1"
console.log('✅ test1._decorated:', (test1 as any)._decorated);   // "value1" (stored privately)

// ============================================================================
// Scenario 2: Manual getter/setter ✅
// ============================================================================
console.log('\n=== Scenario 2: Manual getter/setter ===');

class Test2 extends BaseEntity<ITest> implements ITest {
    static override readonly model = null;
    
    private _decorated!: string;
    private _withGetter!: string;
    private _publicProp!: string;
    private _privateNoUnderscore!: string;
    private _privateWithUnderscore!: string;
    
    get decorated() { return this._decorated; }
    set decorated(v: string) { this._decorated = v; }
    
    get withGetter() { return this._withGetter; }
    set withGetter(v: string) { this._withGetter = v; }
    
    get publicProp() { return this._publicProp; }
    set publicProp(v: string) { this._publicProp = v; }
    
    get privateNoUnderscore() { return this._privateNoUnderscore; }
    set privateNoUnderscore(v: string) { this._privateNoUnderscore = v; }
    
    get privateWithUnderscore() { return this._privateWithUnderscore; }
    set privateWithUnderscore(v: string) { this._privateWithUnderscore = v; }
}

const test2 = new Test2({
    decorated: "value1",
    withGetter: "value2",
    publicProp: "value3",
    privateNoUnderscore: "value4",
    privateWithUnderscore: "value5"
});

console.log('✅ test2.decorated:', test2.decorated);              // "value1"
console.log('✅ test2._decorated:', (test2 as any)._decorated);   // "value1" (stored privately)

// ============================================================================
// Scenario 3: Public properties ✅
// ============================================================================
console.log('\n=== Scenario 3: Public properties ===');

class Test3 extends BaseEntity<ITest> implements ITest {
    static override readonly model = null;
    
    public decorated!: string;
    public withGetter!: string;
    public publicProp!: string;
    public privateNoUnderscore!: string;
    public privateWithUnderscore!: string;
}

const test3 = new Test3({
    decorated: "value1",
    withGetter: "value2",
    publicProp: "value3",
    privateNoUnderscore: "value4",
    privateWithUnderscore: "value5"
});

console.log('✅ test3.decorated:', test3.decorated);              // "value1"
console.log('✅ test3._decorated:', (test3 as any)._decorated);   // undefined (no private storage)

// ============================================================================
// Scenario 4: Private without underscore (⚠️ Works but not recommended)
// ============================================================================
console.log('\n=== Scenario 4: Private without underscore ===');

class Test4 extends BaseEntity<ITest> implements ITest {
    static override readonly model = null;
    
    private decorated!: string;
    private withGetter!: string;
    private publicProp!: string;
    private privateNoUnderscore!: string;
    private privateWithUnderscore!: string;
}

const test4 = new Test4({
    decorated: "value1",
    withGetter: "value2",
    publicProp: "value3",
    privateNoUnderscore: "value4",
    privateWithUnderscore: "value5"
});

console.log('⚠️  test4.decorated:', (test4 as any).decorated);       // "value1" (works but direct access)
console.log('⚠️  test4._decorated:', (test4 as any)._decorated);      // undefined

// ============================================================================
// Scenario 5: Private with underscore but NO getter/setter (❌ BROKEN)
// ============================================================================
console.log('\n=== Scenario 5: Private with underscore, no getter ===');

class Test5 extends BaseEntity<ITest> implements ITest {
    static override readonly model = null;
    
    private _decorated!: string;
    private _withGetter!: string;
    private _publicProp!: string;
    private _privateNoUnderscore!: string;
    private _privateWithUnderscore!: string;
}

const test5 = new Test5({
    decorated: "value1",      // Note: key is "decorated", not "_decorated"
    withGetter: "value2",
    publicProp: "value3",
    privateNoUnderscore: "value4",
    privateWithUnderscore: "value5"
});

console.log('❌ test5._decorated:', (test5 as any)._decorated);      // undefined (NOT assigned)
console.log('❌ test5.decorated:', (test5 as any).decorated);        // "value1" (created new public property!)

// ============================================================================
// Scenario 6: Mixed approach (✅ RECOMMENDED)
// ============================================================================
console.log('\n=== Scenario 6: Mixed approach (decorator + manual) ===');

class Test6 extends BaseEntity<ITest> implements ITest {
    static override readonly model = null;
    
    // Use decorator for simple properties
    @Property() declare decorated!: string;
    @Property() declare publicProp!: string;
    
    // Use manual getter/setter for properties with validation
    private _withGetter!: string;
    get withGetter() { return this._withGetter; }
    set withGetter(v: string) {
        if (!v) throw new Error("Cannot be empty");
        this._withGetter = v;
    }
    
    // Use public for simple data
    public privateNoUnderscore!: string;
    public privateWithUnderscore!: string;
}

const test6 = new Test6({
    decorated: "value1",
    withGetter: "value2",
    publicProp: "value3",
    privateNoUnderscore: "value4",
    privateWithUnderscore: "value5"
});

console.log('✅ test6.decorated:', test6.decorated);                    // "value1" (from decorator)
console.log('✅ test6.withGetter:', test6.withGetter);                  // "value2" (manual getter)
console.log('✅ test6.publicProp:', test6.publicProp);                  // "value3" (from decorator)
console.log('✅ test6.privateNoUnderscore:', test6.privateNoUnderscore); // "value4" (public)

// ============================================================================
// Summary Table
// ============================================================================

console.log('\n=== SUMMARY TABLE ===\n');

const table = `
┌────────────────────────────────────┬──────────────┬──────────────┬────────────────┬──────────┐
│ Property Type                      │ Getter/Setter│ Decorated    │ Stores In      │ Works    │
├────────────────────────────────────┼──────────────┼──────────────┼────────────────┼──────────┤
│ @Property() declare name           │ Yes (auto)   │ Yes          │ this._name     │ ✅ Yes   │
│ private _name; get/set name        │ Yes (manual) │ No           │ this._name     │ ✅ Yes   │
│ public name                        │ No           │ No           │ this.name      │ ✅ Yes   │
│ private name (no _)                │ No           │ No           │ this.name      │ ⚠️  Yes*  │
│ private _name (no getter)          │ No           │ No           │ this.name**    │ ❌ No    │
└────────────────────────────────────┴──────────────┴──────────────┴────────────────┴──────────┘

* Works but defeats the purpose of encapsulation
** Creates new public property instead of using _name

RECOMMENDATIONS:
✅ Use @Property() for most properties (clean & encapsulated)
✅ Use manual getter/setter when you need validation
✅ Use public properties for simple DTOs without business logic
❌ Never use "private _name" without getter/setter
⚠️  Avoid "private name" without getter/setter (no encapsulation benefit)
`;

console.log(table);

// ============================================================================
// Export for testing
// ============================================================================

export { Test1, Test2, Test3, Test4, Test5, Test6 };
