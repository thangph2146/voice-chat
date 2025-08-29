"use client";

import { useState, useCallback, useRef, useEffect } from 'react';
import { logger } from '../logger';
import { postDifyChatStream, postDifyChatBlocking, getDifyPerformanceMetrics } from '../services/dify-api';
import type {
  ChatMessage,
  DifyChatRequest,
  DifyStreamingCallbacks,
  UseChatReturn,
  ChatServiceOptions,
  DifyPerformanceMetrics
} from '../types/dify';

/**
 * Enhanced React hook for Dify chat functionality
 * Provides clean API for voice-chat application
 */
export const useChat = (): UseChatReturn => {
  // State management
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DifyPerformanceMetrics>(getDifyPerformanceMetrics());

  // Refs for managing state
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentMessageIdRef = useRef<string | null>(null);

  // Update metrics periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(getDifyPerformanceMetrics());
    }, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, []);

  /**
   * Generate unique message ID
   */
  const generateMessageId = useCallback(() => {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  /**
   * Add a new message to the chat
   */
  const addMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const newMessage: ChatMessage = {
      ...message,
      id: generateMessageId(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, newMessage]);
    return newMessage.id;
  }, [generateMessageId]);

  /**
   * Update an existing message
   */
  const updateMessage = useCallback((messageId: string, updates: Partial<ChatMessage>) => {
    setMessages(prev => prev.map(msg => 
      msg.id === messageId ? { ...msg, ...updates } : msg
    ));
  }, []);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Cancel current request
   */
  const cancelRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    clearError();
    
    if (currentMessageIdRef.current) {
      updateMessage(currentMessageIdRef.current, { isLoading: false });
      currentMessageIdRef.current = null;
    }
    
    logger.info("CHAT_HOOK", "Request cancelled by user");
  }, [updateMessage, clearError]);

  /**
   * Send a message to Dify API
   */
  const sendMessage = useCallback(async (
    message: string,
    options: ChatServiceOptions = {}
  ) => {
    if (!message.trim()) {
      setError("Tin nhắn không được để trống");
      return;
    }

    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Clear previous error
    clearError();
    setIsLoading(true);

    // Add user message
    addMessage({
      content: message.trim(),
      role: 'user'
    });

    // Add assistant message placeholder
    const assistantMessageId = addMessage({
      content: '',
      role: 'assistant',
      isLoading: true
    });

    currentMessageIdRef.current = assistantMessageId;

    // Create abort controller
    abortControllerRef.current = new AbortController();

    // Prepare request data
    const requestData: DifyChatRequest = {
      query: message.trim(),
      response_mode: options.streaming !== false ? "streaming" : "blocking",
      conversation_id: options.conversationId || conversationId || undefined,
      inputs: options.inputs || {},
    };

    try {
      if (options.streaming !== false) {
        // Streaming mode (default)
        let accumulatedMessage = '';

        const callbacks: DifyStreamingCallbacks = {
          onStart: () => {
            logger.info("CHAT_HOOK", "Streaming started");
          },

          onMessage: (chunk: string) => {
            accumulatedMessage += chunk;
            updateMessage(assistantMessageId, {
              content: accumulatedMessage,
              isLoading: true
            });
          },

          onComplete: (result) => {
            setConversationId(result.conversationId);
            updateMessage(assistantMessageId, {
              content: result.fullMessage,
              isLoading: false
            });
            setIsLoading(false);
            currentMessageIdRef.current = null;
            
            logger.info("CHAT_HOOK", "Streaming completed", {
              messageLength: result.fullMessage.length,
              latency: result.latency
            });
          },

          onError: (error) => {
            const errorMessage = error.message || "Đã xảy ra lỗi khi gửi tin nhắn";
            setError(errorMessage);
            updateMessage(assistantMessageId, {
              content: '',
              isLoading: false,
              error: errorMessage
            });
            setIsLoading(false);
            currentMessageIdRef.current = null;
            
            logger.error("CHAT_HOOK", "Streaming error", error);
          },

          onProgress: (progress) => {
            logger.debug("CHAT_HOOK", `Streaming progress: ${progress}%`);
          }
        };

        await postDifyChatStream(requestData, callbacks, {
          signal: options.signal || abortControllerRef.current.signal
        });
      } else {
        // Blocking mode
        const result = await postDifyChatBlocking(requestData);
        
        setConversationId(result.conversationId);
        updateMessage(assistantMessageId, {
          content: result.fullMessage,
          isLoading: false
        });
        setIsLoading(false);
        currentMessageIdRef.current = null;
        
        logger.info("CHAT_HOOK", "Blocking request completed", {
          messageLength: result.fullMessage.length,
          latency: result.latency
        });
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was cancelled, don't treat as error
        logger.info("CHAT_HOOK", "Request was cancelled");
        return;
      }

      const errorMessage = error instanceof Error 
        ? error.message 
        : "Đã xảy ra lỗi không xác định";
      
      setError(errorMessage);
      updateMessage(assistantMessageId, {
        content: '',
        isLoading: false,
        error: errorMessage
      });
      setIsLoading(false);
      currentMessageIdRef.current = null;
      
      logger.error("CHAT_HOOK", "Send message error", error);
    } finally {
      abortControllerRef.current = null;
    }
  }, [
    addMessage,
    updateMessage,
    clearError,
    conversationId
  ]);

  /**
   * Clear all messages and reset conversation
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setError(null);
    setIsLoading(false);
    
    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    currentMessageIdRef.current = null;
    
    logger.info("CHAT_HOOK", "Messages cleared");
  }, []);

  /**
   * Retry the last message
   */
  const retryLastMessage = useCallback(async () => {
    if (messages.length === 0) return;

    // Find the last user message
    const lastUserMessage = [...messages]
      .reverse()
      .find(msg => msg.role === 'user');

    if (!lastUserMessage) {
      setError("Không tìm thấy tin nhắn để thử lại");
      return;
    }

    // Remove the last assistant message if it has an error
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'assistant' && (lastMessage.error || lastMessage.content === '')) {
      setMessages(prev => prev.slice(0, -1));
    }

    // Resend the last user message
    await sendMessage(lastUserMessage.content);
  }, [messages, sendMessage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    // State
    messages,
    isLoading,
    error,
    conversationId,
    metrics,

    // Actions
    sendMessage,
    clearMessages,
    retryLastMessage,
    cancelRequest,
  };
};

// Export hook with performance optimizations
export default useChat;
