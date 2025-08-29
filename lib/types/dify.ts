/**
 * Dify Chat Request interface
 */
export interface DifyChatRequest {
  /** Input variables for the conversation */
  inputs?: Record<string, unknown>;
  /** User query/message */
  query: string;
  /** Response mode: streaming for real-time, blocking for complete response */
  response_mode: "streaming" | "blocking";
  /** Optional conversation ID to continue existing conversation */
  conversation_id?: string;
  /** User identifier */
  user?: string;
  /** File attachments */
  files?: Array<{
    type: string;
    transfer_method: string;
    url: string;
  }>;
}

/**
 * Dify Chat Response interface
 */
export interface DifyChatResponse {
  /** Complete message content */
  fullMessage: string;
  /** Conversation ID for maintaining context */
  conversationId: string | null;
  /** Message ID for reference */
  messageId: string | null;
  /** Response time in milliseconds */
  latency: number;
  /** Estimated token count */
  tokens: number;
}

/**
 * Callbacks for streaming responses
 */
export interface DifyStreamingCallbacks {
  /** Called when a message chunk is received */
  onMessage: (message: string) => void;
  /** Called when the streaming is complete */
  onComplete: (result: DifyChatResponse) => void;
  /** Called when an error occurs */
  onError: (error: Error) => void;
  /** Called when streaming starts */
  onStart?: () => void;
  /** Called to report progress (0-100) */
  onProgress?: (progress: number) => void;
}

/**
 * Chat message interface for UI
 */
export interface ChatMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  isLoading?: boolean;
  error?: string;
}

/**
 * Chat conversation interface
 */
export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Dify API configuration
 */
export interface DifyConfig {
  baseUrl: string;
  apiKey: string;
  timeout: number;
  maxRetries: number;
  rateLimitPerMinute: number;
  cacheEnabled: boolean;
  cacheTTL: number;
}

/**
 * Performance metrics interface
 */
export interface DifyPerformanceMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  cacheHits: number;
  cacheMisses: number;
  rateLimitHits: number;
}

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  isValid: boolean;
  issues: string[];
  warnings: string[];
  hasWarnings: boolean;
}

/**
 * Chat service options
 */
export interface ChatServiceOptions {
  /** Whether to use streaming mode */
  streaming?: boolean;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Additional input variables */
  inputs?: Record<string, unknown>;
  /** Continue existing conversation */
  conversationId?: string;
}

/**
 * Error types
 */
export type DifyErrorType = 
  | 'CONFIG_ERROR'
  | 'NETWORK_ERROR'
  | 'API_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'TIMEOUT_ERROR'
  | 'PARSE_ERROR';

/**
 * Enhanced error interface
 */
export interface DifyError extends Error {
  type: DifyErrorType;
  status?: number;
  code?: string;
  details?: unknown;
}

/**
 * Hook state for chat functionality
 */
export interface UseChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  conversationId: string | null;
}

/**
 * Hook actions for chat functionality
 */
export interface UseChatActions {
  sendMessage: (message: string, options?: ChatServiceOptions) => Promise<void>;
  clearMessages: () => void;
  retryLastMessage: () => Promise<void>;
  cancelRequest: () => void;
}

/**
 * Complete hook return type
 */
export interface UseChatReturn extends UseChatState, UseChatActions {
  /** Performance metrics */
  metrics: DifyPerformanceMetrics;
}
