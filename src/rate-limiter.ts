/**
 * Rate Limiter for controlling query throughput
 * 
 * Implements token bucket algorithm to prevent database overload
 * by limiting the number of queries per second.
 */

/**
 * Configuration options for rate limiter
 */
export interface RateLimiterOptions {
    /**
     * Maximum number of queries allowed per second
     */
    maxQueriesPerSecond: number;
    
    /**
     * Algorithm to use for rate limiting
     * - token-bucket: Allows bursts up to bucket capacity
     * - sliding-window: Strict limit over rolling time window
     */
    algorithm: 'token-bucket' | 'sliding-window';
}

/**
 * Status information about the rate limiter
 */
export interface RateLimiterStatus {
    /**
     * Number of available tokens/queries
     */
    available: number;
    
    /**
     * Total capacity
     */
    total: number;
    
    /**
     * Current utilization (0-1)
     */
    utilization: number;
}

/**
 * Abstract base class for rate limiters
 */
export abstract class RateLimiter {
    protected options: RateLimiterOptions;
    
    constructor(options: RateLimiterOptions) {
        if (options.maxQueriesPerSecond <= 0) {
            throw new Error('maxQueriesPerSecond must be positive');
        }
        this.options = options;
    }
    
    /**
     * Acquire permission to execute a query
     * Will wait if rate limit is exceeded
     * 
     * @returns Promise that resolves when permission is granted
     */
    abstract acquire(): Promise<void>;
    
    /**
     * Get current status of the rate limiter
     * 
     * @returns Status information
     */
    abstract getStatus(): RateLimiterStatus;
    
    /**
     * Reset the rate limiter state
     */
    abstract reset(): void;
}

/**
 * Token Bucket Rate Limiter
 * 
 * Implements the token bucket algorithm:
 * - Tokens are added to the bucket at a constant rate
 * - Each query consumes one token
 * - If no tokens available, request waits until tokens are refilled
 * - Allows bursts up to bucket capacity
 */
export class TokenBucketRateLimiter extends RateLimiter {
    private tokens: number;
    private lastRefill: number;
    private readonly refillRate: number; // tokens per millisecond
    private readonly bucketCapacity: number;
    
    constructor(options: RateLimiterOptions) {
        super(options);
        
        // Calculate refill rate (tokens per millisecond)
        this.refillRate = options.maxQueriesPerSecond / 1000;
        
        // Bucket capacity is the max queries per second
        // This allows bursts up to this amount
        this.bucketCapacity = options.maxQueriesPerSecond;
        
        // Start with full bucket
        this.tokens = this.bucketCapacity;
        this.lastRefill = Date.now();
    }
    
    /**
     * Refill tokens based on elapsed time
     */
    private refill(): void {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        
        // Calculate tokens to add based on elapsed time
        const tokensToAdd = elapsed * this.refillRate;
        
        // Add tokens but don't exceed capacity
        this.tokens = Math.min(this.bucketCapacity, this.tokens + tokensToAdd);
        
        this.lastRefill = now;
    }
    
    /**
     * Acquire permission to execute a query
     * Waits if no tokens are available
     */
    async acquire(): Promise<void> {
        this.refill();
        
        // If we have tokens, consume one and return immediately
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return;
        }
        
        // No tokens available, calculate wait time
        const tokensNeeded = 1 - this.tokens;
        const waitTime = Math.ceil(tokensNeeded / this.refillRate);
        
        // Wait for tokens to be refilled
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        // After waiting, refill and consume token
        this.refill();
        this.tokens -= 1;
    }
    
    /**
     * Get current status
     */
    getStatus(): RateLimiterStatus {
        this.refill();
        
        return {
            available: Math.floor(this.tokens),
            total: this.bucketCapacity,
            utilization: 1 - (this.tokens / this.bucketCapacity)
        };
    }
    
    /**
     * Reset the rate limiter
     */
    reset(): void {
        this.tokens = this.bucketCapacity;
        this.lastRefill = Date.now();
    }
}

/**
 * Create a rate limiter instance
 * 
 * @param options - Rate limiter configuration
 * @returns RateLimiter instance
 * 
 * @example
 * ```typescript
 * const limiter = createRateLimiter({
 *   maxQueriesPerSecond: 100,
 *   algorithm: 'token-bucket'
 * });
 * 
 * // Acquire permission before query
 * await limiter.acquire();
 * await prisma.user.findMany();
 * ```
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
    switch (options.algorithm) {
        case 'token-bucket':
            return new TokenBucketRateLimiter(options);
        case 'sliding-window':
            // For now, use token bucket for both
            // Sliding window can be implemented later if needed
            return new TokenBucketRateLimiter(options);
        default:
            throw new Error(`Unknown algorithm: ${options.algorithm}`);
    }
}
