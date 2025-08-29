import type { ConfigValidationResult, DifyPerformanceMetrics } from '../types/dify';

// ==================== CONFIGURATION ====================

/**
 * Enhanced Dify API Configuration
 * Optimized for voice-chat application
 */
export const DIFY_CONFIG = {
  // Base URL cho Dify API
  BASE_URL: process.env.NEXT_PUBLIC_DIFY_API_BASE_URL,
  
  // API Key
  API_KEY: process.env.NEXT_PUBLIC_DIFY_API_KEY,
  
  // Các endpoint Dify API
  ENDPOINTS: {
    CHAT_MESSAGES: '/v1/chat-messages',
    CHAT_COMPLETIONS: '/v1/chat/completions',
    MESSAGES: '/v1/messages',
    COMPLETIONS: '/v1/completions',
    CONVERSATIONS: '/v1/conversations',
    WORKFLOWS: '/v1/workflows'
  },
  
  // Headers mặc định
  DEFAULT_HEADERS: {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  },

  // Performance settings
  TIMEOUT: 30000, // 30 seconds
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 second
  BATCH_SIZE: 50, // Chunk batching size
  STREAM_BUFFER_SIZE: 1024, // Stream buffer size

  // Rate limiting
  RATE_LIMIT: {
    REQUESTS_PER_MINUTE: 60,
    BURST_SIZE: 10
  },

  // Caching
  CACHE: {
    ENABLED: true,
    TTL: 5 * 60 * 1000, // 5 minutes
    MAX_SIZE: 100
  }
} as const;

// ==================== VALIDATION FUNCTIONS ====================

/**
 * Enhanced configuration validation with detailed error reporting
 */
export const validateDifyConfig = (): ConfigValidationResult => {
  const issues: string[] = [];
  const warnings: string[] = [];
  
  if (!DIFY_CONFIG.BASE_URL) {
    issues.push('NEXT_PUBLIC_DIFY_API_BASE_URL chưa được cấu hình');
  } else if (!DIFY_CONFIG.BASE_URL.startsWith('http')) {
    issues.push('NEXT_PUBLIC_DIFY_API_BASE_URL phải là URL hợp lệ (bắt đầu bằng http/https)');
  }
  
  if (!DIFY_CONFIG.API_KEY) {
    issues.push('NEXT_PUBLIC_DIFY_API_KEY chưa được cấu hình');
  } else if (DIFY_CONFIG.API_KEY.length < 10) {
    warnings.push('NEXT_PUBLIC_DIFY_API_KEY có vẻ quá ngắn, có thể không hợp lệ');
  }

  // Validate environment
  if (typeof window === 'undefined' && !DIFY_CONFIG.BASE_URL) {
    issues.push('Dify API không thể hoạt động trên server-side mà không có BASE_URL');
  }
  
  return {
    isValid: issues.length === 0,
    issues,
    warnings,
    hasWarnings: warnings.length > 0
  };
};

// ==================== UTILITY FUNCTIONS ====================

/**
 * Enhanced URL builder with validation
 */
export const getDifyUrl = (endpoint: string): string => {
  if (!DIFY_CONFIG.BASE_URL) {
    throw new Error('DIFY_CONFIG.BASE_URL chưa được cấu hình');
  }
  
  // Ensure endpoint starts with /
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  
  return `${DIFY_CONFIG.BASE_URL}${normalizedEndpoint}`;
};

/**
 * Enhanced headers builder with optimizations
 */
export const getDifyHeaders = (additionalHeaders?: Record<string, string>) => {
  if (!DIFY_CONFIG.API_KEY) {
    throw new Error('DIFY_CONFIG.API_KEY chưa được cấu hình');
  }
  
  const headers: Record<string, string> = {
    ...DIFY_CONFIG.DEFAULT_HEADERS,
    'Authorization': `Bearer ${DIFY_CONFIG.API_KEY}`,
    ...additionalHeaders
  };

  // Add performance headers
  if (additionalHeaders?.['Accept'] === 'text/event-stream') {
    headers['Accept-Encoding'] = 'gzip, deflate, br';
  }

  return headers;
};

/**
 * Enhanced configuration validation
 */
export const isDifyConfigValid = (): boolean => {
  return validateDifyConfig().isValid;
};

/**
 * Enhanced configuration info with performance metrics
 */
export const getDifyConfigInfo = () => {
  const validation = validateDifyConfig();
  
  return {
    hasBaseUrl: !!DIFY_CONFIG.BASE_URL,
    hasApiKey: !!DIFY_CONFIG.API_KEY,
    baseUrl: DIFY_CONFIG.BASE_URL,
    endpoints: DIFY_CONFIG.ENDPOINTS,
    isValid: validation.isValid,
    issues: validation.issues,
    warnings: validation.warnings,
    timeout: DIFY_CONFIG.TIMEOUT,
    maxRetries: DIFY_CONFIG.MAX_RETRIES,
    cacheEnabled: DIFY_CONFIG.CACHE.ENABLED
  };
};

// ==================== PERFORMANCE UTILITIES ====================

/**
 * Rate limiting utility
 */
class RateLimiter {
  private requests: number[] = [];
  private readonly limit: number;
  private readonly window: number;

  constructor(limit: number, windowMs: number = 60000) {
    this.limit = limit;
    this.window = windowMs;
  }

  canMakeRequest(): boolean {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.window);
    return this.requests.length < this.limit;
  }

  recordRequest(): void {
    this.requests.push(Date.now());
  }

  getRemainingRequests(): number {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.window);
    return Math.max(0, this.limit - this.requests.length);
  }

  reset(): void {
    this.requests = [];
  }
}

export const difyRateLimiter = new RateLimiter(
  DIFY_CONFIG.RATE_LIMIT.REQUESTS_PER_MINUTE,
  60000
);

/**
 * Cache utility for API responses
 */
class DifyCache {
  private cache = new Map<string, { data: unknown; expiresAt: number }>();
  private readonly maxSize: number;
  private readonly ttl: number;

  constructor(maxSize: number = DIFY_CONFIG.CACHE.MAX_SIZE, ttl: number = DIFY_CONFIG.CACHE.TTL) {
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  set(key: string, data: unknown): void {
    if (!DIFY_CONFIG.CACHE.ENABLED) return;

    // Cleanup expired entries
    this.cleanup();

    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.ttl
    });
  }

  get(key: string): unknown | null {
    if (!DIFY_CONFIG.CACHE.ENABLED) return null;

    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }
}

export const difyCache = new DifyCache();

// ==================== ERROR HANDLING ====================

/**
 * Enhanced error mapping with Vietnamese messages
 */
export const mapDifyError = (status: number, message?: string): Error => {
  const errorMessages: Record<number, string> = {
    400: 'Yêu cầu không hợp lệ. Vui lòng kiểm tra dữ liệu đầu vào.',
    401: 'API Key không hợp lệ hoặc chưa được cấu hình. Vui lòng kiểm tra NEXT_PUBLIC_DIFY_API_KEY.',
    403: 'Bạn không có quyền truy cập chức năng này. Vui lòng kiểm tra quyền hạn.',
    404: 'Không thể kết nối đến trợ lý AI. Vui lòng kiểm tra URL API.',
    429: 'Xin lỗi! Tôi đang nhận quá nhiều yêu cầu. Hãy đợi một lát và thử lại.',
    500: 'Hệ thống AI tạm thời không phản hồi. Tôi sẽ sớm hoạt động trở lại!',
    502: 'Hệ thống AI tạm thời không phản hồi. Tôi sẽ sớm hoạt động trở lại!',
    503: 'Hệ thống AI tạm thời không phản hồi. Tôi sẽ sớm hoạt động trở lại!',
    504: 'Hệ thống AI tạm thời không phản hồi. Tôi sẽ sớm hoạt động trở lại!',
  };

  const defaultMessage = 'Đã xảy ra lỗi khi xử lý yêu cầu của bạn. Vui lòng thử lại sau.';
  const errorMessage = errorMessages[status] || message || defaultMessage;

  return new Error(`Dify API Error ${status}: ${errorMessage}`);
};

// ==================== PERFORMANCE MONITORING ====================

/**
 * Performance metrics tracking
 */
class PerformanceTracker {
  private metrics: DifyPerformanceMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    cacheHits: 0,
    cacheMisses: 0,
    rateLimitHits: 0
  };

  recordRequest(success: boolean, responseTime: number, cacheHit: boolean = false): void {
    this.metrics.totalRequests++;
    
    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    // Update average response time
    const totalTime = this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) + responseTime;
    this.metrics.averageResponseTime = totalTime / this.metrics.totalRequests;

    if (cacheHit) {
      this.metrics.cacheHits++;
    } else {
      this.metrics.cacheMisses++;
    }
  }

  recordRateLimitHit(): void {
    this.metrics.rateLimitHits++;
  }

  getMetrics(): DifyPerformanceMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      cacheHits: 0,
      cacheMisses: 0,
      rateLimitHits: 0
    };
  }
}

export const difyPerformanceTracker = new PerformanceTracker();
