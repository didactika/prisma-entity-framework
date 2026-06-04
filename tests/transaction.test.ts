/**
 * Test suite for Transaction Support
 * Tests runTransaction, getActiveTransaction, isInTransaction,
 * and integration with BaseEntity CRUD operations.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import BaseEntity from '../src/core/base-entity';
import { configurePrisma, resetPrismaConfiguration } from '../src/core/config';
import { mockPrismaClient } from './__mocks__/prisma-client.mock';
import {
    runTransaction,
    getActiveTransaction,
    isInTransaction
} from '../src/core/transaction-context';
import { resolveClient, resolveModel, shouldDisableParallel } from '../src/core/utils/transaction-utils';

interface IUser {
    id?: number;
    name: string;
    email: string;
    age?: number;
    isActive?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

class User extends BaseEntity<IUser> implements IUser {
    static override readonly model = mockPrismaClient.user;

    public declare readonly id: IUser['id'];
    private _name!: IUser['name'];
    private _email!: IUser['email'];
    private _age!: IUser['age'];
    private _isActive!: IUser['isActive'];

    constructor(data: Partial<IUser>) {
        super(data);
    }

    get name(): string { return this._name!; }
    set name(value: string) { this._name = value; }

    get email(): string { return this._email!; }
    set email(value: string) { this._email = value; }

    get age(): number | undefined { return this._age; }
    set age(value: number | undefined) { this._age = value; }

    get isActive(): boolean | undefined { return this._isActive; }
    set isActive(value: boolean | undefined) { this._isActive = value; }
}

describe('Transaction Support', () => {
    beforeEach(() => {
        configurePrisma(mockPrismaClient as any);
        mockPrismaClient._reset();
    });

    afterEach(() => {
        resetPrismaConfiguration();
    });

    // -----------------------------------------------------------------------
    // TransactionContext: runTransaction, getActiveTransaction, isInTransaction
    // -----------------------------------------------------------------------
    describe('TransactionContext', () => {
        it('should execute callback inside a transaction', async () => {
            const result = await runTransaction(async (tx) => {
                expect(tx).toBeDefined();
                return 'transaction-result';
            });

            expect(result).toBe('transaction-result');
            expect(mockPrismaClient.$transaction).toHaveBeenCalled();
        });

        it('should detect active transaction inside callback', async () => {
            // Outside transaction
            expect(isInTransaction()).toBe(false);
            expect(getActiveTransaction()).toBeNull();

            await runTransaction(async (_tx) => {
                // Inside transaction
                expect(isInTransaction()).toBe(true);
                expect(getActiveTransaction()).not.toBeNull();
            });

            // After transaction
            expect(isInTransaction()).toBe(false);
            expect(getActiveTransaction()).toBeNull();
        });

        it('should reject nested transactions', async () => {
            await expect(
                runTransaction(async (_tx) => {
                    // Try to start a nested transaction
                    await runTransaction(async (_innerTx) => {
                        return 'should-not-reach';
                    });
                })
            ).rejects.toThrow('Nested transactions are not supported');
        });

        it('should rollback on error (via Prisma $transaction)', async () => {
            const error = new Error('Test error');

            await expect(
                runTransaction(async (_tx) => {
                    throw error;
                })
            ).rejects.toThrow('Test error');
        });

        it('should pass transaction options to Prisma', async () => {
            await runTransaction(async (_tx) => {
                return 'ok';
            }, {
                maxWait: 5000,
                timeout: 10000
            });

            expect(mockPrismaClient.$transaction).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    maxWait: 5000,
                    timeout: 10000
                })
            );
        });
    });

    // -----------------------------------------------------------------------
    // Transaction Utils: resolveClient, resolveModel, shouldDisableParallel
    // -----------------------------------------------------------------------
    describe('Transaction Utils', () => {
        it('resolveClient should return PrismaClient when no tx active', () => {
            const client = resolveClient();
            expect(client).toBeDefined();
        });

        it('resolveClient should prefer explicit tx over AsyncLocalStorage', async () => {
            const explicitTx = { marker: 'explicit' } as any;

            await runTransaction(async (_asyncTx) => {
                const resolved = resolveClient(explicitTx);
                expect(resolved).toBe(explicitTx);
            });
        });

        it('resolveClient should use AsyncLocalStorage tx when no explicit tx', async () => {
            await runTransaction(async (_tx) => {
                const resolved = resolveClient();
                // Should be the transactional client from AsyncLocalStorage
                expect(resolved).not.toBeNull();
            });
        });

        it('resolveModel should return original model when no tx active', () => {
            const model = resolveModel(mockPrismaClient.user as any);
            expect(model).toBe(mockPrismaClient.user);
        });

        it('resolveModel should prefer explicit tx model delegate', async () => {
            const txMockUser = { findMany: jest.fn(), name: 'user' };
            const explicitTx = { user: txMockUser } as any;

            const resolved = resolveModel(mockPrismaClient.user as any, explicitTx);
            expect(resolved).toBe(txMockUser);
        });

        it('shouldDisableParallel should return false outside transaction', () => {
            expect(shouldDisableParallel()).toBe(false);
        });

        it('shouldDisableParallel should return true inside transaction', async () => {
            await runTransaction(async (_tx) => {
                expect(shouldDisableParallel()).toBe(true);
            });
        });

        it('shouldDisableParallel should return true with explicit tx', () => {
            const tx = {} as any;
            expect(shouldDisableParallel(tx)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // BaseEntity CRUD integration with transactions
    // -----------------------------------------------------------------------
    describe('BaseEntity CRUD with transactions', () => {
        it('create() should accept tx option', async () => {
            const user = new User({ name: 'Test User', email: 'test@example.com' });

            jest.spyOn(mockPrismaClient.user, 'create').mockResolvedValueOnce({
                id: 10,
                name: 'Test User',
                email: 'test@example.com',
                age: null,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // Should work without error when tx option is passed
            await user.create({ tx: mockPrismaClient as any });
            expect(mockPrismaClient.user.create).toHaveBeenCalled();
        });

        it('update() should accept tx option', async () => {
            const user = new User({ id: 1, name: 'Updated', email: 'updated@example.com' });

            jest.spyOn(mockPrismaClient.user, 'update').mockResolvedValueOnce({
                id: 1,
                name: 'Updated',
                email: 'updated@example.com',
                age: 30,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await user.update({ tx: mockPrismaClient as any });
            expect(mockPrismaClient.user.update).toHaveBeenCalled();
        });

        it('delete() should accept tx option', async () => {
            const user = new User({ id: 1, name: 'John', email: 'john@example.com' });

            jest.spyOn(mockPrismaClient.user, 'delete').mockResolvedValueOnce({
                id: 1,
                name: 'John',
                email: 'john@example.com',
                age: 30,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await user.delete({ tx: mockPrismaClient as any });
            expect(mockPrismaClient.user.delete).toHaveBeenCalled();
            expect(result).toBe(1);
        });

        it('operations inside runTransaction should use the active tx automatically', async () => {
            await runTransaction(async (_tx) => {
                const user = new User({ name: 'TxUser', email: 'txuser@example.com' });

                // create() should automatically use the active transaction
                // (via AsyncLocalStorage)
                const created = await user.create();
                expect(created).toBeDefined();
            });

            expect(mockPrismaClient.$transaction).toHaveBeenCalled();
        });

        it('findByFilter should work with tx option', async () => {
            await User.findByFilter({}, { tx: mockPrismaClient as any });
            expect(mockPrismaClient.user.findMany).toHaveBeenCalled();
        });

        it('countByFilter should work with tx option', async () => {
            await User.countByFilter({}, { tx: mockPrismaClient as any });
            expect(mockPrismaClient.user.count).toHaveBeenCalled();
        });

        it('createMany should work with tx option', async () => {
            jest.spyOn(mockPrismaClient.user, 'createMany').mockResolvedValueOnce({ count: 2 });

            const result = await User.createMany(
                [
                    { name: 'User1', email: 'user1@example.com' },
                    { name: 'User2', email: 'user2@example.com' },
                ],
                { tx: mockPrismaClient as any }
            );

            expect(mockPrismaClient.user.createMany).toHaveBeenCalled();
            expect(result).toBe(2);
        });

        it('deleteByFilter should work with tx option', async () => {
            await User.deleteByFilter({ isActive: false }, { tx: mockPrismaClient as any });
            expect(mockPrismaClient.user.deleteMany).toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // End-to-end: Multiple operations in a single transaction
    // -----------------------------------------------------------------------
    describe('End-to-end transaction scenarios', () => {
        it('should execute multiple create operations atomically', async () => {
            const result = await runTransaction(async (_tx) => {
                const user1 = new User({ name: 'Alice', email: 'alice@example.com' });
                const created1 = await user1.create();

                const user2 = new User({ name: 'Bob', email: 'bob2@example.com' });
                const created2 = await user2.create();

                return [created1, created2];
            });

            expect(result).toHaveLength(2);
            expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(1);
        });

        it('should rollback all operations on failure', async () => {
            // The mock $transaction passes through, so the error should propagate
            await expect(
                runTransaction(async (_tx) => {
                    const user = new User({ name: 'Alice', email: 'alice@example.com' });
                    await user.create();

                    // Simulate an error after the first operation
                    throw new Error('Simulated failure');
                })
            ).rejects.toThrow('Simulated failure');
        });

        it('should support explicit tx parameter alongside AsyncLocalStorage', async () => {
            const createSpy = jest.spyOn(mockPrismaClient.user, 'create');

            await runTransaction(async (tx) => {
                const user = new User({ name: 'ExplicitTx', email: 'explicit@example.com' });

                // Use explicit tx (should take priority)
                await user.create({ tx: tx as any });

                expect(createSpy).toHaveBeenCalled();
            });
        });
    });
});
