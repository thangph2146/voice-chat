"use client";

import { useState } from "react";
import { Trash2, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ChatBubble,
  ChatBubbleAvatar,
  ChatBubbleMessage,
} from "@/components/ui/chat-bubble";
import { ChatMessageList } from "@/components/ui/chat-message-list";
import { WaveformVisualizer } from "@/components/ui/waveform-visualizer";
import { useChat } from "@/lib/hooks/useChat";
import { logger } from "@/lib/logger";

export function ChatInterface() {
  const {
    messages,
    isLoading,
    error,
    conversationId,
    sendMessage,
    clearMessages,
    retryLastMessage,
    cancelRequest,
    metrics
  } = useChat();

  const [speechError, setSpeechError] = useState<string | null>(null);

  // Handle transcript from speech recognition
  const handleTranscript = async (text: string) => {
    if (!text.trim()) return;

    logger.info("CHAT_INTERFACE", "Received speech transcript", { text });
    setSpeechError(null);

    try {
      await sendMessage(text);
    } catch (error) {
      logger.error("CHAT_INTERFACE", "Error sending message", error);
    }
  };

  // Handle speech recognition errors
  const handleSpeechError = (errorMessage: string) => {
    setSpeechError(errorMessage);
    logger.error("CHAT_INTERFACE", "Speech recognition error", { error: errorMessage });
  };

  // Clear speech error
  const clearSpeechError = () => {
    setSpeechError(null);
  };

  return (
    <div className="h-[100dvh] border bg-background rounded-lg flex flex-col">
      {/* Header with controls */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center space-x-2">
          <h2 className="text-lg font-semibold">Voice Chat</h2>
          {conversationId && (
            <span className="text-xs text-gray-500">ID: {conversationId.slice(-8)}</span>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          {/* Performance metrics */}
          <div className="text-xs text-gray-500">
            {metrics.totalRequests > 0 && (
              <span>
                {metrics.successfulRequests}/{metrics.totalRequests} 
                ({Math.round(metrics.averageResponseTime)}ms avg)
              </span>
            )}
          </div>

          {/* Clear conversation */}
          <Button
            variant="outline"
            size="sm"
            onClick={clearMessages}
            disabled={isLoading || messages.length === 0}
          >
            <Trash2 className="w-4 h-4 mr-1" />
            Xóa
          </Button>

          {/* Retry last message */}
          {error && (
            <Button
              variant="outline"
              size="sm"
              onClick={retryLastMessage}
              disabled={isLoading}
            >
              <RefreshCw className="w-4 h-4 mr-1" />
              Thử lại
            </Button>
          )}

          {/* Cancel request */}
          {isLoading && (
            <Button
              variant="destructive"
              size="sm"
              onClick={cancelRequest}
            >
              Hủy
            </Button>
          )}
        </div>
      </div>

      {/* Error display */}
      {(error || speechError) && (
        <div className="p-4 border-b bg-red-50 border-red-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center text-red-800">
              <AlertCircle className="w-4 h-4 mr-2" />
              <span className="text-sm">
                {speechError || error}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={speechError ? clearSpeechError : () => {}}
              className="text-red-600 hover:text-red-800"
            >
              ✕
            </Button>
          </div>
        </div>
      )}

      {/* Chat messages */}
      <div className="flex-1 overflow-hidden">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <div className="text-6xl mb-4">🎤</div>
              <h3 className="text-lg font-medium mb-2">Chào mừng đến với Voice Chat</h3>
              <p className="text-sm">Nhấn nút micro để bắt đầu trò chuyện bằng giọng nói</p>
            </div>
          </div>
        ) : (
          <ChatMessageList>
            {messages.map((message) => (
              <ChatBubble
                key={message.id}
                variant={message.role === "user" ? "sent" : "received"}
              >
                <ChatBubbleAvatar
                  className="h-8 w-8 shrink-0"
                  src={
                    message.role === "user"
                      ? "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=64&h=64&q=80&crop=faces&fit=crop"
                      : "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=64&h=64&q=80&crop=faces&fit=crop"
                  }
                  fallback={message.role === "user" ? "U" : "AI"}
                />
                <ChatBubbleMessage
                  variant={message.role === "user" ? "sent" : "received"}
                  isLoading={message.isLoading}
                >
                  {message.error ? (
                    <div className="text-red-600">
                      <AlertCircle className="w-4 h-4 inline mr-1" />
                      {message.error}
                    </div>
                  ) : (
                    message.content
                  )}
                </ChatBubbleMessage>
              </ChatBubble>
            ))}
          </ChatMessageList>
        )}
      </div>

      {/* Voice input with waveform visualizer */}
      <div className="p-4 border-t">
        <WaveformVisualizer
          onTranscript={handleTranscript}
          onError={handleSpeechError}
          disabled={isLoading}
          className="w-full"
        />
        
        {/* Status indicator */}
        <div className="flex items-center justify-center mt-3 text-xs text-gray-500">
          {isLoading ? (
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600 mr-2"></div>
              Đang xử lý...
            </div>
          ) : messages.length > 0 ? (
            <span>Sẵn sàng cho câu hỏi tiếp theo</span>
          ) : (
            <span>Hãy nói để bắt đầu cuộc trò chuyện</span>
          )}
        </div>
      </div>
    </div>
  );
}
