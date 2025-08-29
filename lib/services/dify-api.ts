"use client";

import { logger } from '../logger';
import {
  DIFY_CONFIG,
  validateDifyConfig,
  getDifyUrl,
  getDifyHeaders,
  difyRateLimiter,
  difyCache,
  difyPerformanceTracker,
  mapDifyError
} from '../config/dify';
import type {
  DifyChatRequest,
  DifyChatResponse,
  DifyStreamingCallbacks,
  DifyError,
  DifyErrorType
} from '../types/dify';

// ==================== PERFORMANCE UTILITIES ====================

/**
 * Enhanced request deduplication to prevent duplicate API calls
 */
class RequestDeduplicator {
  private pendingRequests = new Map<string, Promise<unknown>>();

  async deduplicate<T>(key: string, requestFn: () => Promise<T>): Promise<T> {
    if (this.pendingRequests.has(key)) {
      logger.info("DIFY_API", "Deduplicating request", { key });
      const existingPromise = this.pendingRequests.get(key);
      return existingPromise as Promise<T>;
    }

    const promise = requestFn().finally(() => {
      this.pendingRequests.delete(key);
    });

    this.pendingRequests.set(key, promise);
    return promise as Promise<T>;
  }

  clear() {
    this.pendingRequests.clear();
  }
}

const requestDeduplicator = new RequestDeduplicator();

/**
 * Enhanced text chunking for better streaming performance
 */
class StreamingChunkManager {
  private chunks: string[] = [];
  private lastFlushTime = 0;
  private flushInterval = 50; // 50ms batching

  addChunk(chunk: string) {
    this.chunks.push(chunk);
  }

  flush(): string {
    const result = this.chunks.join("");
    this.chunks = [];
    this.lastFlushTime = Date.now();
    return result;
  }

  shouldFlush(): boolean {
    return (
      this.chunks.length > 0 &&
      Date.now() - this.lastFlushTime >= this.flushInterval
    );
  }

  getPendingChunks(): string[] {
    return [...this.chunks];
  }

  clear() {
    this.chunks = [];
    this.lastFlushTime = 0;
  }

  hasPendingChunks(): boolean {
    return this.chunks.length > 0;
  }
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Enhanced user ID generation with better uniqueness
 */
const generateUserId = (): string => {
  if (typeof window !== "undefined") {
    const existingUserId = sessionStorage.getItem("dify_user_id");
    if (existingUserId) {
      return existingUserId;
    }

    const newUserId = `user_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    sessionStorage.setItem("dify_user_id", newUserId);
    return newUserId;
  }

  // Fallback cho server-side
  return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Enhanced streaming data parser với better error handling
 */
const parseStreamingData = (data: string): Record<string, unknown> | null => {
  if (!data.startsWith("data: ")) {
    return null;
  }

  const jsonData = data.substring(6).trim();
  if (!jsonData || jsonData === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(jsonData);
  } catch (e) {
    logger.error("DIFY_API", "Error parsing JSON line", {
      error: e,
      data: jsonData.substring(0, 100),
    });
    return null;
  }
};

/**
 * Enhanced request preparation với validation
 */
const prepareRequestData = (data: DifyChatRequest) => {
  // Validate required fields
  if (!data.query || data.query.trim().length === 0) {
    throw new Error("Query is required and cannot be empty");
  }

  return {
    ...data,
    user: data.user || generateUserId(),
    inputs: data.inputs || {},
    query: data.query.trim(),
  };
};

/**
 * Create enhanced error with type information
 */
const createDifyError = (
  type: DifyErrorType,
  message: string,
  status?: number,
  code?: string,
  details?: unknown
): DifyError => {
  const error = new Error(message) as DifyError;
  error.type = type;
  error.status = status;
  error.code = code;
  error.details = details;
  error.name = 'DifyError';
  return error;
};

/**
 * Enhanced streaming response processor với performance optimizations
 */
const processStreamingResponse = async (
  response: Response,
  callbacks: DifyStreamingCallbacks
): Promise<DifyChatResponse> => {
  let fullMessage = "";
  let latestConversationId: string | null = null;
  let messageId: string | null = null;
  let chunkCount = 0;
  const startTime = Date.now();

  if (!response.body) {
    throw createDifyError('NETWORK_ERROR', 'Response body is not readable');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const chunkManager = new StreamingChunkManager();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n");

      while (boundary !== -1) {
        const eventString = buffer.substring(0, boundary).trim();
        buffer = buffer.substring(boundary + 1);

        if (eventString.startsWith("data: ")) {
          const parsedData = parseStreamingData(eventString);
          if (parsedData) {
            if (parsedData.event === "message") {
              const chunkText = (parsedData.answer as string) || "";
              if (chunkText) {
                chunkCount++;
                fullMessage += chunkText;
                chunkManager.addChunk(chunkText);

                // Flush chunks periodically for better performance
                if (chunkManager.shouldFlush()) {
                  const flushedChunks = chunkManager.flush();
                  callbacks.onMessage(flushedChunks);
                }
              }
            }

            // Update conversation and message IDs
            if (parsedData.conversation_id) {
              latestConversationId = parsedData.conversation_id as string;
            }
            if (parsedData.message_id || parsedData.id) {
              messageId = (parsedData.message_id || parsedData.id) as string;
            }

            // Report progress
            if (callbacks.onProgress && parsedData.event === "message") {
              const progress = Math.min(100, (chunkCount / 10) * 100); // Estimate progress
              callbacks.onProgress(progress);
            }
          }
        }
        boundary = buffer.indexOf("\n");
      }
    }

    // Process remaining buffer
    if (buffer.trim().startsWith("data: ")) {
      const parsedData = parseStreamingData(buffer.trim());
      if (parsedData) {
        if (parsedData.event === "message") {
          const chunkText = (parsedData.answer as string) || "";
          if (chunkText) {
            fullMessage += chunkText;
            chunkManager.addChunk(chunkText);
          }
        }

        if (parsedData.conversation_id) {
          latestConversationId = parsedData.conversation_id as string;
        }
        if (parsedData.message_id || parsedData.id) {
          messageId = (parsedData.message_id || parsedData.id) as string;
        }
      }
    }

    // Flush any remaining chunks
    if (chunkManager.hasPendingChunks()) {
      const remainingChunks = chunkManager.flush();
      callbacks.onMessage(remainingChunks);
    }

    const latency = Date.now() - startTime;
    logger.info("DIFY_API", "Streaming completed", {
      chunkCount,
      latency,
      messageLength: fullMessage.length,
    });

    return {
      fullMessage,
      conversationId: latestConversationId,
      messageId,
      latency,
      tokens: Math.ceil(fullMessage.length / 4), // Rough token estimation
    };
  } catch (error) {
    logger.error("DIFY_API", "Error processing streaming response", error);
    if (error instanceof Error) {
      throw createDifyError('PARSE_ERROR', `Streaming error: ${error.message}`, undefined, undefined, error);
    }
    throw createDifyError('PARSE_ERROR', 'Unknown streaming error');
  }
};

// ==================== API FUNCTIONS ====================

/**
 * Enhanced streaming API với performance optimizations
 */
export const postDifyChatStream = async (
  data: DifyChatRequest,
  callbacks: DifyStreamingCallbacks,
  options?: { signal?: AbortSignal }
): Promise<void> => {
  const startTime = Date.now();
  const requestKey = `stream_${data.query}_${Date.now()}`;

  return requestDeduplicator.deduplicate(requestKey, async () => {
    try {
      // Validate configuration
      const configValidation = validateDifyConfig();
      if (!configValidation.isValid) {
        throw createDifyError(
          'CONFIG_ERROR',
          `Cấu hình không hợp lệ: ${configValidation.issues.join(", ")}`
        );
      }

      // Check rate limiting
      if (!difyRateLimiter.canMakeRequest()) {
        const error = createDifyError(
          'RATE_LIMIT_ERROR',
          "Rate limit exceeded. Please wait before making another request."
        );
        callbacks.onError(error);
        return;
      }

      callbacks.onStart?.();

      const requestData = prepareRequestData(data);
      const url = getDifyUrl(DIFY_CONFIG.ENDPOINTS.CHAT_MESSAGES);
      const headers = getDifyHeaders({ Accept: "text/event-stream" });

      logger.info("DIFY_API", "Starting streaming request", {
        url,
        queryLength: requestData.query.length,
        hasConversationId: !!requestData.conversation_id,
      });

      difyRateLimiter.recordRequest();

      const controller = options?.signal
        ? { abort: () => undefined, signal: options.signal as AbortSignal }
        : new AbortController();
      const timeoutId = options?.signal
        ? undefined
        : setTimeout(
            () => (controller as AbortController).abort(),
            DIFY_CONFIG.TIMEOUT
          );

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...requestData,
          response_mode: "streaming",
        }),
        signal: controller.signal,
      });

      if (timeoutId) clearTimeout(timeoutId);

      const responseTime = Date.now() - startTime;
      logger.info("DIFY_API", "Streaming response received", {
        status: response.status,
        responseTime,
      });

      if (!response.ok) {
        const error = mapDifyError(response.status);
        difyPerformanceTracker.recordRequest(false, responseTime);
        callbacks.onError(createDifyError('API_ERROR', error.message, response.status));
        return;
      }

      const result = await processStreamingResponse(response, callbacks);
      difyPerformanceTracker.recordRequest(true, responseTime);
      callbacks.onComplete(result);
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      difyPerformanceTracker.recordRequest(false, responseTime);

      logger.error("DIFY_API", "Streaming error", error);

      if (error instanceof Error && 'type' in error) {
        callbacks.onError(error as DifyError);
      } else if (error instanceof Error) {
        callbacks.onError(createDifyError('NETWORK_ERROR', error.message));
      } else {
        callbacks.onError(createDifyError('NETWORK_ERROR', "Đã xảy ra lỗi không xác định khi gọi API streaming"));
      }
    }
  });
};

/**
 * Enhanced blocking API với caching và performance tracking
 */
export const postDifyChatBlocking = async (
  data: DifyChatRequest
): Promise<DifyChatResponse> => {
  const startTime = Date.now();
  const cacheKey = `blocking_${data.query}_${data.conversation_id || "new"}`;

  return requestDeduplicator.deduplicate<DifyChatResponse>(
    cacheKey,
    async (): Promise<DifyChatResponse> => {
      try {
        // Check cache first
        const cached = difyCache.get(cacheKey);
        if (cached) {
          logger.info("DIFY_API", "Cache hit for blocking request", {
            cacheKey,
          });
          difyPerformanceTracker.recordRequest(true, 0, true);
          return cached as DifyChatResponse;
        }

        // Validate configuration
        const configValidation = validateDifyConfig();
        if (!configValidation.isValid) {
          throw createDifyError(
            'CONFIG_ERROR',
            `Cấu hình không hợp lệ: ${configValidation.issues.join(", ")}`
          );
        }

        // Check rate limiting
        if (!difyRateLimiter.canMakeRequest()) {
          throw createDifyError(
            'RATE_LIMIT_ERROR',
            "Rate limit exceeded. Please wait before making another request."
          );
        }

        const requestData = prepareRequestData(data);
        const url = getDifyUrl(DIFY_CONFIG.ENDPOINTS.CHAT_MESSAGES);
        const headers = getDifyHeaders();

        logger.info("DIFY_API", "Starting blocking request", {
          url,
          queryLength: requestData.query.length,
        });

        difyRateLimiter.recordRequest();

        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          DIFY_CONFIG.TIMEOUT
        );

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...requestData,
            response_mode: "blocking",
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const responseTime = Date.now() - startTime;
        logger.info("DIFY_API", "Blocking response received", {
          status: response.status,
          responseTime,
        });

        if (!response.ok) {
          const error = mapDifyError(response.status);
          difyPerformanceTracker.recordRequest(false, responseTime);
          throw createDifyError('API_ERROR', error.message, response.status);
        }

        const responseText = await response.text();
        logger.info("DIFY_API", "Raw blocking response", {
          responseLength: responseText.length,
        });

        let responseData: Record<string, unknown>;
        try {
          responseData = JSON.parse(responseText);
        } catch (e) {
          logger.error(
            "DIFY_API",
            "Failed to parse blocking response as JSON",
            e
          );
          throw createDifyError('PARSE_ERROR', "Invalid JSON response from API");
        }

        const answer = (responseData.answer as string) || "";
        const result: DifyChatResponse = {
          fullMessage: answer,
          conversationId: (responseData.conversation_id as string) || null,
          messageId:
            (responseData.message_id as string) ||
            (responseData.id as string) ||
            null,
          latency: responseTime,
          tokens: Math.ceil(answer.length / 4), // Rough token estimation
        };

        // Cache the result
        difyCache.set(cacheKey, result);
        difyPerformanceTracker.recordRequest(true, responseTime);

        logger.info("DIFY_API", "Blocking request completed", {
          answerLength: answer.length,
          latency: responseTime,
        });

        return result;
      } catch (error: unknown) {
        const responseTime = Date.now() - startTime;
        difyPerformanceTracker.recordRequest(false, responseTime);

        logger.error("DIFY_API", "Blocking request error", error);
        
        if (error instanceof Error && 'type' in error) {
          throw error;
        }
        
        if (error instanceof Error) {
          throw createDifyError('NETWORK_ERROR', error.message);
        }
        
        throw createDifyError('NETWORK_ERROR', 'Unknown error occurred');
      }
    }
  );
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Enhanced API wrapper với mode selection
 */
export const callDifyApi = async (
  mode: "streaming" | "blocking",
  data: DifyChatRequest,
  callbacks?: DifyStreamingCallbacks
) => {
  if (mode === "streaming") {
    if (!callbacks) {
      throw createDifyError('CONFIG_ERROR', "Callbacks are required for streaming mode");
    }
    return await postDifyChatStream(data, callbacks);
  } else {
    return await postDifyChatBlocking(data);
  }
};

/**
 * Debug function với performance tracking
 */
export const debugDifyApi = async (query: string) => {
  const startTime = Date.now();

  try {
    const configValidation = validateDifyConfig();
    if (!configValidation.isValid) {
      logger.error(
        "DIFY_API",
        "Config validation failed",
        configValidation.issues
      );
      return;
    }

    // Check rate limiting
    if (!difyRateLimiter.canMakeRequest()) {
      logger.warn("DIFY_API", "Rate limit exceeded");
      return { error: "Rate limit exceeded" };
    }

    const requestData = {
      query,
      response_mode: "blocking" as const,
      user: `debug_user_${Date.now()}`,
      inputs: {},
    };

    const url = getDifyUrl(DIFY_CONFIG.ENDPOINTS.CHAT_MESSAGES);
    const headers = getDifyHeaders();

    logger.info("DIFY_API", "Dify Chat API call", {
      url,
      headers: Object.keys(headers),
      requestData,
    });

    difyRateLimiter.recordRequest();

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestData),
      signal: AbortSignal.timeout(DIFY_CONFIG.TIMEOUT),
    });

    const responseTime = Date.now() - startTime;
    logger.info("DIFY_API", "Response received", {
      status: response.status,
      responseTime,
    });

    if (!response.ok) {
      const error = mapDifyError(response.status);
      difyPerformanceTracker.recordRequest(false, responseTime);
      throw error;
    }

    const responseText = await response.text();
    logger.info("DIFY_API", "Raw response", {
      responseText: responseText.substring(0, 200),
    });

    let responseData;
    try {
      responseData = JSON.parse(responseText);
      logger.info("DIFY_API", "Parsed response", {
        answerLength: responseData.answer?.length || 0,
      });
    } catch (e) {
      logger.error("DIFY_API", "Failed to parse response as JSON", e);
      difyPerformanceTracker.recordRequest(false, responseTime);
      return { error: "Invalid JSON response" };
    }

    difyPerformanceTracker.recordRequest(true, responseTime);

    return {
      success: response.ok,
      status: response.status,
      data: responseData,
      answer: responseData.answer,
      answerLength: responseData.answer?.length || 0,
      responseTime,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    difyPerformanceTracker.recordRequest(false, responseTime);
    logger.error("DIFY_API", "Debug API error", error);
    throw error;
  }
};

/**
 * Get performance metrics
 */
export const getDifyPerformanceMetrics = () => {
  return {
    ...difyPerformanceTracker.getMetrics(),
    rateLimitRemaining: difyRateLimiter.getRemainingRequests(),
    cacheSize: difyCache.size(),
  };
};

/**
 * Clear all caches and reset performance tracking
 */
export const resetDifyPerformance = () => {
  difyCache.clear();
  difyPerformanceTracker.reset();
  requestDeduplicator.clear();
  logger.info("DIFY_API", "Performance data reset");
};

// ==================== BACKWARD COMPATIBILITY ====================

/**
 * Alias cho backward compatibility
 */
export const postDifyChat = postDifyChatBlocking;

/**
 * Legacy API wrapper để tương thích với code cũ
 */
export const callDifyApiRoute = {
  postChatStream: async (
    data: DifyChatRequest,
    onMessage: (message: string) => void,
    onComplete: (result: DifyChatResponse) => void,
    onError: (error: Error) => void,
    onStart?: () => void
  ) => {
    await postDifyChatStream(data, { onMessage, onComplete, onError, onStart });
  },

  postChat: async (data: DifyChatRequest): Promise<DifyChatResponse> => {
    return await postDifyChatBlocking(data);
  },
};
