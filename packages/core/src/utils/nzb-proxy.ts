import { z } from 'zod';
import { Env } from './env.js';
import { createLogger } from './index.js';
import { getSimpleTextHash } from './crypto.js';
import bytes from 'bytes';

/**
 * In-memory rate limiter for NZB fetches
 * Simple implementation that resets on server restart
 */
class NzbRateLimiter {
  private userCounts = new Map<string, { count: number; resetAt: number }>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly windowMs: number;

  constructor() {
    // Cleanup old entries every 10 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 600000);
    this.windowMs = Env.EASYNEWS_NZB_RATE_LIMIT_WINDOW * 1000;
  }

  /**
   * Check if a request is allowed under rate limits
   */
  check(
    userKey: string,
    perUserLimit: number
  ): { allowed: boolean; reason?: string } {
    const now = Date.now();

    // Reset user counter if window expired
    let userData = this.userCounts.get(userKey);
    if (!userData || userData.resetAt < now) {
      userData = { count: 0, resetAt: now + this.windowMs };
      this.userCounts.set(userKey, userData);
    }
    if (userData.count >= perUserLimit) {
      return { allowed: false, reason: 'User NZB rate limit exceeded' };
    }

    return { allowed: true };
  }

  /**
   * Increment counters after successful request
   */
  increment(userKey: string): void {
    const now = Date.now();

    let userData = this.userCounts.get(userKey);
    if (!userData || userData.resetAt < now) {
      userData = { count: 1, resetAt: now + this.windowMs };
    } else {
      userData.count++;
    }
    this.userCounts.set(userKey, userData);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, data] of this.userCounts.entries()) {
      if (data.resetAt < now) {
        this.userCounts.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Global rate limiter instance
const nzbRateLimiter = new NzbRateLimiter();

/**
 * NZB Proxy Manager
 *
 * Provides unified rate limiting, URL generation, and validation for NZB proxying.
 */
export class NzbProxyManager {
  /**
   * Check if the public/generic NZB proxy is enabled
   */
  static isPublicProxyEnabled(): boolean {
    return Env.NZB_PROXY_PUBLIC_ENABLED === true;
  }

  /**
   * Check if the Easynews NZB proxy is enabled
   */
  static isEasynewsProxyEnabled(aiostreamsAuth?: {
    username: string;
    password: string;
  }): boolean {
    if (
      aiostreamsAuth &&
      this.isAuthorised(aiostreamsAuth.username, aiostreamsAuth.password)
    ) {
      return true;
    }
    return Env.NZB_PROXY_EASYNEWS_ENABLED !== false;
  }

  /**
   * Check if a user has admin bypass (via AIOSTREAMS_AUTH)
   */
  static isAuthorised(username: string, password: string): boolean {
    const authMap = Env.AIOSTREAMS_AUTH;
    if (!authMap || authMap.size === 0) return false;
    return authMap.get(username) === password;
  }

  /**
   * Generate a user key for rate limiting (hashed to avoid storing PII)
   */
  static getUserKey(identifier: string): string {
    return getSimpleTextHash(identifier);
  }

  /**
   * Check rate limits for NZB fetch
   *
   * @param userKey - Hashed user identifier
   * @param aiostreamsAuth - Optional credentials to check for admin bypass
   * @returns Rate limit check result
   */
  static checkRateLimit(
    userKey: string,
    aiostreamsAuth?: { username: string; password: string }
  ): { allowed: boolean; reason?: string; authorised?: boolean } {
    if (
      aiostreamsAuth &&
      this.isAuthorised(aiostreamsAuth.username, aiostreamsAuth.password)
    ) {
      return { allowed: true, authorised: true };
    }

    const perUserLimit = Env.NZB_PROXY_RATE_LIMIT_PER_USER;

    return nzbRateLimiter.check(userKey, perUserLimit);
  }

  /**
   * Increment rate limit counters after successful fetch
   */
  static incrementRateLimit(userKey: string): void {
    nzbRateLimiter.increment(userKey);
  }

  /**
   * Get the maximum allowed NZB size
   */
  static getMaxSize(): number {
    return Env.NZB_PROXY_MAX_SIZE;
  }

  /**
   * Check if content size exceeds the limit
   */
  static checkSizeLimit(
    size: number,
    aiostreamsAuth?: { username: string; password: string }
  ): { allowed: boolean; reason?: string } {
    if (
      aiostreamsAuth &&
      this.isAuthorised(aiostreamsAuth.username, aiostreamsAuth.password)
    ) {
      return { allowed: true };
    }
    const maxSize = this.getMaxSize();
    if (size > maxSize) {
      return {
        allowed: false,
        reason: `NZB size ${bytes(size)} exceeds limit of ${bytes(maxSize)}`,
      };
    }
    return { allowed: true };
  }
}

export default NzbProxyManager;
