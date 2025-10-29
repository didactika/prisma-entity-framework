import { describe, it, expect } from '@jest/globals';
import {
    TokenBucketRateLimiter,
    createRateLimiter,
    type RateLimiterOptions
} from '../src/index';

describe('Rate Limiter', () => {
    describe('TokenBucketRateLimiter', () => {
        describe('Constructor and validation', () => {
            it('should create rate limiter with valid options', () => {
                const options: RateLimiterOptions = {
                    maxQueriesPerSecond: 100,
                    algorithm: 'token-bucket'
                };
                
                expect(() => new TokenBucketRateLimiter(options)).not.toThrow();
            });
            
            it('should throw error for zero maxQueriesPerSecond', () => {
                const options: RateLimiterOptions = {
                    maxQueriesPerSecond: 0,
                    algorithm: 'token-bucket'
                };
                
                expect(() => new TokenBucketRateLimiter(options))
                    .toThrow('maxQueriesPerSecond must be positive');
            });
            
            it('should throw error for negative maxQueriesPerSecond', () => {
                const options: RateLimiterOptions = {
                    maxQueriesPerSecond: -10,
                    algorithm: 'token-bucket'
                };
                
                expect(() => new TokenBucketRateLimiter(options))
                    .toThrow('maxQueriesPerSecond must be positive');
            });
        });
        
        describe('Token bucket algorithm', () => {
            it('should allow immediate acquisition when tokens available', async () => {
                const limiter = new TokenBucketRateLimiter({
                    maxQueriesPerSecond: 10,
                    algorithm: 'token-bucket'
                });
                
                const startTime = Date.now();
                await limiter.acquire();
                const endTime = Date.now();
                
                // Should be nearly instant (< 10ms)
                expect(endTime - startTime).toBeLessThan(10);
            });
            
            it('should consume tokens on acquisition', async () => {
                const limiter = new TokenBucketRateLimiter({
                    maxQueriesPerSecond: 10,
                    algorithm: 'token-bucket'
                });
                
                const initialStatus = limiter.getStatus();
                expect(initialStatus.available).toBe(10);
                
                await limiter.acquire();
                
                const afterStatus = limiter.getStatus();
                expect(afterStatus.available).toBe(9);
            });
            
            it('should wait when no tokens available', async () => {
                const limiter = new TokenBucketRateLimiter({
                    maxQueriesPerSecond: 10, // 10 tokens per second = 100ms per token
                    algorithm: 'token-bucket'
                });
                
                // Consume all tokens
                for (let i = 0; i < 10; i++) {
                    await limiter.acquire();
                }
                
                // Next acquisition should wait
                const startTime = Date.now();
                await limiter.acquire();
                const endTime = Date.now();
                
                // Should wait approximately 100ms for one token to refill
                expect(endTime - startTime).toBeGreaterThanOrEqual(50); // Allow some variance
            }, 10000);
            
            it('should refill tokens over time', async () => {
                const limiter = new TokenBucketRateLimiter({
                    maxQueriesPerSecond: 100, // Fast refill for testing
                    algorithm: 'token-bucket'
                });
                
                // Consume some tokens
                await limiter.acquire();
                await limiter.acquire();
                await limiter.acquire();
                
                const statusBefore = limiter.getStatus();
                expect(statusBefore.available).toBe(97);
                
                // Wait for refill (100ms should add ~10 tokens)
                await new Promise(resolve => setTimeout(resolve, 100));
                
                const statusAfter = limiter.getStatus();
                // Should have refilled (but capped at capacity)
                expect(statusAfter.available).toBeGreaterThan(statusBefore.available);
            });
            
            it('should not exceed bucket capacity', async () => {
                const limiter = new TokenBucketRateLimiter({
                    maxQueriesPerSecond: 10,
                    algorithm: 'token-bucket'
                });
                
                // Wait for potential refill
                await new Promise(resolve => setTimeout(resolve, 200));
                
                const status = limiter.getStatus();
                // Should not exceed capacity of 10
                expect(status.available).toBeLessThanOrEqual(10);
            });
        });
        
        describe('getStatus', () => {
            it('should return correct status information', () => {
                const limiter = new TokenBucketRateLimiter({
                    maxQueriesPerSecond: 50,
                    algorithm: 'token-bucket'
                });
                
                const status = limiter.getStatus();
                
                expect(status).toHaveProperty('available');
                expect(status).toHaveProperty('total');
                expect(status).toHaveProperty('utilization');
                
                expect(status.total).toBe(50);
                expect(status.available).toBeLessThanOrEqual(status.total);
                expect(status.utilization).toBeGreaterThanOrEqual(0);
                expect(status.utilization).toBeLessThanOrEqual(1);
            });
            
            it('should show correct utilization', async () => {
                const limiter = new TokenBucketRateLimiter({
                    maxQueriesPerSecond: 10,
                    algorithm: 'token-bucket'
                });
                
                // Initially, utilization should be 0 (full bucket)
                const initialStatus = limiter.getStatus();
                expect(initialStatus.utilization).toBe(0);
                
                // Consume half the tokens
                for (let i = 0; i < 5; i++) {
                    await limiter.acquire();
                }
                
                const halfStatus = limiter.getStatus();
                expect(halfStatus.utilization).toBeCloseTo(0.5, 1);
                
                // Consume all remaining tokens
                for (let i = 0; i < 5; i++) {
                    await limiter.acquire();
                }
                
                const fullStatus = limiter.getStatus();
                expect(fullStatus.utilization).toBeCloseTo(1, 1);
            });
        });
        
        describe('reset', () => {
            it('should reset tokens to full capacity', async () => {
                const limiter = new TokenBucketRateLimiter({
                    maxQueriesPerSecond: 10,
                    algorithm: 'token-bucket'
                });
                
                // Consume some tokens
                await limiter.acquire();
                await limiter.acquire();
                await limiter.acquire();
                
                const beforeReset = limiter.getStatus();
                expect(beforeReset.available).toBe(7);
                
                // Reset
                limiter.reset();
                
                const afterReset = limiter.getStatus();
                expect(afterReset.available).toBe(10);
                expect(afterReset.utilization).toBe(0);
            });
        });
        
        describe('Rate limiting behavior', () => {
            it('should enforce rate limit over time', async () => {
                const limiter = new TokenBucketRateLimiter({
                    maxQueriesPerSecond: 10,
                    algorithm: 'token-bucket'
                });
                
                const acquisitions: number[] = [];
                const startTime = Date.now();
                
                // Try to acquire 15 tokens (more than capacity)
                for (let i = 0; i < 15; i++) {
                    await limiter.acquire();
                    acquisitions.push(Date.now() - startTime);
                }
                
                const totalTime = Date.now() - startTime;
                
                // First 10 should be fast (burst)
                expect(acquisitions[9]).toBeLessThan(100);
                
                // Remaining 5 should take time (rate limited)
                // At 10 queries/sec, 5 extra queries should take ~500ms
                expect(totalTime).toBeGreaterThanOrEqual(400);
            }, 10000);
            
            it('should handle concurrent acquisitions', async () => {
                const limiter = new TokenBucketRateLimiter({
                    maxQueriesPerSecond: 20,
                    algorithm: 'token-bucket'
                });
                
                // Start multiple acquisitions concurrently
                const promises = Array.from({ length: 10 }, () => limiter.acquire());
                
                const startTime = Date.now();
                await Promise.all(promises);
                const endTime = Date.now();
                
                // All 10 should complete quickly (within burst capacity)
                expect(endTime - startTime).toBeLessThan(100);
                
                const status = limiter.getStatus();
                expect(status.available).toBe(10); // 20 - 10 = 10
            });
        });
        
        describe('Edge cases', () => {
            it('should handle very high rate limits', async () => {
                const limiter = new TokenBucketRateLimiter({
                    maxQueriesPerSecond: 1000,
                    algorithm: 'token-bucket'
                });
                
                // Should handle many rapid acquisitions
                for (let i = 0; i < 100; i++) {
                    await limiter.acquire();
                }
                
                const status = limiter.getStatus();
                // Allow some variance due to timing
                expect(status.available).toBeGreaterThanOrEqual(895);
                expect(status.available).toBeLessThanOrEqual(905);
            });
            
            it('should handle very low rate limits', async () => {
                const limiter = new TokenBucketRateLimiter({
                    maxQueriesPerSecond: 1, // 1 query per second
                    algorithm: 'token-bucket'
                });
                
                await limiter.acquire(); // First one is immediate
                
                const startTime = Date.now();
                await limiter.acquire(); // Second one should wait ~1 second
                const endTime = Date.now();
                
                expect(endTime - startTime).toBeGreaterThanOrEqual(900); // Allow some variance
            }, 5000);
            
            it('should handle fractional rates', async () => {
                const limiter = new TokenBucketRateLimiter({
                    maxQueriesPerSecond: 2.5, // 2.5 queries per second
                    algorithm: 'token-bucket'
                });
                
                const status = limiter.getStatus();
                expect(status.total).toBe(2.5);
                
                // Should allow burst of 2 queries
                await limiter.acquire();
                await limiter.acquire();
                
                const afterBurst = limiter.getStatus();
                // Allow some variance due to timing and refill
                expect(afterBurst.available).toBeGreaterThanOrEqual(0);
                expect(afterBurst.available).toBeLessThanOrEqual(1);
            });
        });
    });
    
    describe('createRateLimiter factory', () => {
        it('should create TokenBucketRateLimiter for token-bucket algorithm', () => {
            const limiter = createRateLimiter({
                maxQueriesPerSecond: 100,
                algorithm: 'token-bucket'
            });
            
            expect(limiter).toBeInstanceOf(TokenBucketRateLimiter);
        });
        
        it('should create TokenBucketRateLimiter for sliding-window algorithm (fallback)', () => {
            const limiter = createRateLimiter({
                maxQueriesPerSecond: 100,
                algorithm: 'sliding-window'
            });
            
            // Currently falls back to token bucket
            expect(limiter).toBeInstanceOf(TokenBucketRateLimiter);
        });
        
        it('should throw error for unknown algorithm', () => {
            expect(() => createRateLimiter({
                maxQueriesPerSecond: 100,
                algorithm: 'unknown' as any
            })).toThrow('Unknown algorithm');
        });
    });
    
    describe('Performance characteristics', () => {
        it('should have minimal overhead for acquisition', async () => {
            const limiter = new TokenBucketRateLimiter({
                maxQueriesPerSecond: 1000,
                algorithm: 'token-bucket'
            });
            
            const iterations = 100;
            const startTime = Date.now();
            
            for (let i = 0; i < iterations; i++) {
                await limiter.acquire();
            }
            
            const endTime = Date.now();
            const avgTime = (endTime - startTime) / iterations;
            
            // Average acquisition time should be very low (< 1ms)
            expect(avgTime).toBeLessThan(1);
        });
        
        it('should accurately track utilization under load', async () => {
            const limiter = new TokenBucketRateLimiter({
                maxQueriesPerSecond: 50,
                algorithm: 'token-bucket'
            });
            
            // Consume 25 tokens (50% utilization)
            for (let i = 0; i < 25; i++) {
                await limiter.acquire();
            }
            
            const status = limiter.getStatus();
            expect(status.utilization).toBeCloseTo(0.5, 1);
            expect(status.available).toBe(25);
        });
    });
});
