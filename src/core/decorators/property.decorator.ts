/**
 * @Property() Decorator
 * 
 * Automatically creates private properties with getters and setters for entity fields.
 * This decorator uses the legacy decorator specification for maximum compatibility.
 * 
 * @example
 * ```typescript
 * class User extends BaseEntity<IUser> {
 *   @Property() declare name: string;
 *   @Property() declare email: string;
 * }
 * 
 * // Equivalent to:
 * class User extends BaseEntity<IUser> {
 *   private _name: string;
 *   get name() { return this._name; }
 *   set name(value: string) { this._name = value; }
 * }
 * ```
 * 
 * @returns PropertyDecorator function
 */
export function Property(): PropertyDecorator {
    return function (target: any, propertyKey: string | symbol): void {
        const privateKey = `_${String(propertyKey)}`;
        
        // Store decorated properties metadata for initialization
        if (!target.constructor._decoratedProperties) {
            target.constructor._decoratedProperties = new Set<string>();
        }
        target.constructor._decoratedProperties.add(String(propertyKey));

        // Define getter and setter
        Object.defineProperty(target, propertyKey, {
            get: function (this: any): any {
                return this[privateKey];
            },
            set: function (this: any, value: any): void {
                this[privateKey] = value;
            },
            enumerable: true,
            configurable: true
        });
    };
}

/**
 * Helper function to check if a property is decorated with @Property()
 * @internal
 */
export function isDecoratedProperty(target: any, propertyKey: string): boolean {
    const decoratedProperties = target.constructor._decoratedProperties;
    return decoratedProperties ? decoratedProperties.has(propertyKey) : false;
}

/**
 * Helper function to get all decorated properties of a class
 * @internal
 */
export function getDecoratedProperties(target: any): Set<string> {
    return target.constructor._decoratedProperties || new Set<string>();
}
