# 🔍 Property Initialization Behavior Guide

## Quick Reference Table

```
┌────────────────────────────────────┬──────────────┬──────────────┬────────────────┬──────────┐
│ Property Declaration               │ Has Getter   │ Decorated    │ Stores In      │ Result   │
├────────────────────────────────────┼──────────────┼──────────────┼────────────────┼──────────┤
│ @Property() declare name!: string  │ ✅ Auto      │ ✅ Yes       │ this._name     │ ✅ Works │
│ private _name; get/set name        │ ✅ Manual    │ ❌ No        │ this._name     │ ✅ Works │
│ public name!: string               │ ❌ No        │ ❌ No        │ this.name      │ ✅ Works │
│ private name!: string (no _)       │ ❌ No        │ ❌ No        │ this.name      │ ⚠️  Works*│
│ private _name!: string (no getter) │ ❌ No        │ ❌ No        │ this.name**    │ ❌ Broken│
└────────────────────────────────────┴──────────────┴──────────────┴────────────────┴──────────┘

* Works but no encapsulation benefit
** Creates wrong property - data lost!
```

---

## Detailed Scenarios

### ✅ Scenario 1: @Property() Decorator (RECOMMENDED)

```typescript
class User extends BaseEntity<IUser> {
    @Property() declare name!: string;
}

const user = new User({ name: "John" });
```

**What happens:**
1. Decorator creates getter/setter at class definition
2. `initializeProperties` detects decorated property
3. Uses the setter: `this.name = "John"`
4. Setter stores in: `this._name = "John"`

**Result:**
```typescript
user.name     // ✅ "John" (via getter → reads this._name)
user._name    // ✅ "John" (stored privately)
```

**Lines of code:** 1
**Encapsulation:** ✅ Yes
**Validation:** Can add custom setter

---

### ✅ Scenario 2: Manual Getter/Setter

```typescript
class User extends BaseEntity<IUser> {
    private _name!: string;
    
    get name(): string {
        return this._name;
    }
    
    set name(value: string) {
        if (!value) throw new Error("Required");
        this._name = value;
    }
}

const user = new User({ name: "John" });
```

**What happens:**
1. `initializeProperties` detects getter/setter exists
2. Assigns directly to private: `this._name = "John"`

**Result:**
```typescript
user.name     // ✅ "John" (via getter → reads this._name)
user._name    // ✅ "John" (stored privately)
```

**Lines of code:** ~7
**Encapsulation:** ✅ Yes
**Validation:** ✅ Full control

---

### ✅ Scenario 3: Public Property

```typescript
class User extends BaseEntity<IUser> {
    public name!: string;
}

const user = new User({ name: "John" });
```

**What happens:**
1. `initializeProperties` doesn't find getter/setter
2. Assigns directly: `this.name = "John"`

**Result:**
```typescript
user.name     // ✅ "John" (direct public property)
user._name    // ❌ undefined (doesn't exist)
```

**Lines of code:** 1
**Encapsulation:** ❌ No
**Validation:** ❌ No

---

### ⚠️ Scenario 4: Private Without Underscore (NOT RECOMMENDED)

```typescript
class User extends BaseEntity<IUser> {
    private name!: string;  // ⚠️ No underscore, no getter/setter
}

const user = new User({ name: "John" });
```

**What happens:**
1. `initializeProperties` doesn't find getter/setter
2. Assigns directly: `this.name = "John"`
3. Works, but defeats purpose of `private`

**Result:**
```typescript
user.name     // ⚠️ "John" (works but why use private?)
user._name    // ❌ undefined (doesn't exist)
```

**Problem:** TypeScript shows it as `private`, but you access it directly. No encapsulation benefit.

**Lines of code:** 1
**Encapsulation:** ❌ No (fake)
**Validation:** ❌ No

---

### ❌ Scenario 5: Private With Underscore, No Getter (BROKEN)

```typescript
class User extends BaseEntity<IUser> {
    private _name!: string;  // ❌ Has underscore but NO getter/setter
}

const user = new User({ name: "John" });  // Note: key is "name", not "_name"
```

**What happens:**
1. Data comes as `{ name: "John" }` (not `{ _name: "John" }`)
2. `initializeProperties` looks for property `name`
3. Doesn't find getter/setter for `name`
4. Assigns to: `this.name = "John"` (creates NEW property!)
5. Your `_name` property stays `undefined`

**Result:**
```typescript
user.name     // ❌ "John" (wrong - created new public property!)
user._name    // ❌ undefined (data lost!)
```

**This is BROKEN!** ❌

**Lines of code:** 1
**Encapsulation:** ❌ Broken
**Validation:** ❌ No

**Fix:** Add getter/setter:
```typescript
private _name!: string;
get name() { return this._name; }
set name(v: string) { this._name = v; }
```

---

## Decision Tree

```
Start: Do you need this property?
│
├─ Need validation/transformation?
│  │
│  ├─ YES → Use manual getter/setter
│  │         private _name!: string;
│  │         get name() { return this._name; }
│  │         set name(v) { /* validate */ this._name = v; }
│  │
│  └─ NO → Continue ↓
│
├─ Need encapsulation (hide implementation)?
│  │
│  ├─ YES → Use @Property() decorator
│  │         @Property() declare name!: string;
│  │
│  └─ NO → Use public property
│            public name!: string;
```

---

## Common Mistakes

### ❌ Mistake 1: Private property without getter
```typescript
private _email!: string;  // ❌ Can't access from outside
```
**Problem:** `initializeProperties` receives `{ email: "..." }` but looks for `_email`.

**Fix:** Add getter/setter for `email` that accesses `_email`.

---

### ❌ Mistake 2: Initializing decorated property
```typescript
@Property() name: string = "";  // ❌ Overwrites decorator!
```
**Problem:** Constructor initializes `name = ""` AFTER decorator, breaking it.

**Fix:** Use `declare`:
```typescript
@Property() declare name!: string;  // ✅ Correct
```

---

### ❌ Mistake 3: Mixing underscore conventions
```typescript
private _name!: string;      // Has underscore
@Property() declare email!: string;  // No underscore in declaration

// Confusion: which properties use _ and which don't?
```

**Fix:** Be consistent - use decorator for all, or manual getters for all.

---

## Best Practices

### ✅ DO: Use @Property() for most properties
```typescript
@Property() declare name!: string;
@Property() declare email!: string;
@Property() declare age?: number;
```

### ✅ DO: Use manual getter/setter when you need validation
```typescript
private _email!: string;
get email() { return this._email; }
set email(v: string) {
    if (!v.includes('@')) throw new Error();
    this._email = v.toLowerCase();
}
```

### ✅ DO: Use public for simple DTOs
```typescript
public name!: string;
public age!: number;
```

### ❌ DON'T: Use private with underscore without getter
```typescript
private _name!: string;  // ❌ No getter - won't work
```

### ❌ DON'T: Use private without underscore
```typescript
private name!: string;  // ⚠️ Works but pointless
```

---

## Summary

| Pattern | Code | Encapsulation | Validation | Recommended |
|---------|------|---------------|------------|-------------|
| `@Property() declare` | 1 line | ✅ Yes | ⚠️ Manual | ✅ **Best** |
| `private _; get/set` | 7 lines | ✅ Yes | ✅ Easy | ✅ **Good** |
| `public` | 1 line | ❌ No | ❌ No | ⚠️ Simple DTOs only |
| `private` (no _) | 1 line | ❌ Fake | ❌ No | ❌ Avoid |
| `private _` (no getter) | 1 line | ❌ Broken | ❌ No | ❌ **Never** |

---

**Use `@Property()` for 90% of your properties.** ⭐

