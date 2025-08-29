"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Volume2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WaveformVisualizerProps {
  onTranscript: (text: string) => void;
  onStart?: () => void;
  onStop?: () => void;
  onError?: (error: string) => void;
  disabled?: boolean;
  className?: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
  onTranscript,
  onStart,
  onStop,
  onError,
  disabled = false,
  className,
}) => {
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const microphoneRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Cleanup audio resources
  const cleanupAudio = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    microphoneRef.current = null;
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  // Stop listening
  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
    }
  }, [isListening]);

  // Generate waveform bars based on audio level
  const generateWaveformBars = useCallback(() => {
    const bars = [];
    const barCount = 20;

    for (let i = 0; i < barCount; i++) {
      const height = isListening ? Math.random() * (audioLevel * 100) + 10 : 5;

      bars.push(
        <div
          key={i}
          className={cn(
            "w-1 bg-gradient-to-t transition-all duration-100 rounded-full",
            isListening
              ? "from-blue-400 to-blue-600 animate-pulse"
              : "from-gray-300 to-gray-400"
          )}
          style={{
            height: `${Math.max(height, 5)}px`,
            animationDelay: `${i * 50}ms`,
          }}
        />
      );
    }

    return bars;
  }, [audioLevel, isListening]);

  // Setup audio visualization
  const setupAudioVisualization = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      audioContextRef.current = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      microphoneRef.current =
        audioContextRef.current.createMediaStreamSource(stream);

      analyserRef.current.fftSize = 256;
      microphoneRef.current.connect(analyserRef.current);

      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);

      const updateAudioLevel = () => {
        if (analyserRef.current && isListening) {
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          setAudioLevel(average / 255);

          animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
        }
      };

      updateAudioLevel();
    } catch (_err) {
      // eslint-disable-line @typescript-eslint/no-unused-vars
      onError?.("Không thể truy cập microphone");
    }
  }, [isListening, onError]);

  // Start listening
  const startListening = useCallback(async () => {
    if (!isSupported || !recognitionRef.current || disabled) return;

    try {
      await setupAudioVisualization();
      recognitionRef.current.start();
    } catch (_err) {
      // eslint-disable-line @typescript-eslint/no-unused-vars
      onError?.("Không thể bắt đầu nhận dạng giọng nói");
    }
  }, [isSupported, disabled, setupAudioVisualization, onError]);

  // Initialize speech recognition
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
      setIsSupported(true);
      recognitionRef.current = new SpeechRecognition();

      const recognition = recognitionRef.current;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "vi-VN"; // Vietnamese

      recognition.addEventListener("start", () => {
        setIsListening(true);
        onStart?.();
      });

      recognition.addEventListener("end", () => {
        setIsListening(false);
        onStop?.();
        cleanupAudio();
      });

      recognition.addEventListener("result", (event: Event) => {
        const speechEvent = event as SpeechRecognitionEvent;
        let finalTranscript = "";
        let interimTranscript = "";

        for (
          let i = speechEvent.resultIndex;
          i < speechEvent.results.length;
          i++
        ) {
          const transcript = speechEvent.results[i][0].transcript;

          if (speechEvent.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        const fullTranscript = finalTranscript || interimTranscript;
        setTranscript(fullTranscript);

        if (finalTranscript) {
          onTranscript(finalTranscript.trim());
          setTranscript("");
          stopListening();
        }
      });

      recognition.addEventListener("error", (event: Event) => {
        const errorEvent = event as SpeechRecognitionErrorEvent;
        let errorMessage = "Lỗi nhận dạng giọng nói";

        switch (errorEvent.error) {
          case "no-speech":
            errorMessage = "Không phát hiện giọng nói";
            break;
          case "audio-capture":
            errorMessage = "Không thể truy cập microphone";
            break;
          case "not-allowed":
            errorMessage = "Quyền truy cập microphone bị từ chối";
            break;
          case "network":
            errorMessage = "Lỗi kết nối mạng";
            break;
          default:
            errorMessage = errorEvent.message || errorMessage;
        }

        onError?.(errorMessage);
        setIsListening(false);
        cleanupAudio();
      });
    } else {
      setIsSupported(false);
      onError?.("Trình duyệt không hỗ trợ nhận dạng giọng nói");
    }

    return () => {
      cleanupAudio();
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, [onStart, onStop, onError, onTranscript, stopListening, cleanupAudio]);

  // Toggle listening
  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  if (!isSupported) {
    return (
      <div
        className={cn(
          "flex items-center justify-center p-4 border rounded-lg bg-gray-50",
          className
        )}
      >
        <div className="text-center text-gray-500">
          <MicOff className="w-8 h-8 mx-auto mb-2" />
          <p className="text-sm">
            Trình duyệt không hỗ trợ nhận dạng giọng nói
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("relative border rounded-lg bg-background p-4", className)}
    >
      {/* Waveform Visualization */}
      <div className="flex items-center justify-center space-x-1 h-20 mb-4">
        {generateWaveformBars()}
      </div>

      {/* Transcript Display */}
      {transcript && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            <Volume2 className="w-4 h-4 inline mr-2" />
            {transcript}
          </p>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-center space-x-4">
        <Button
          onClick={toggleListening}
          disabled={disabled}
          variant={isListening ? "destructive" : "default"}
          size="lg"
          className={cn(
            "rounded-full transition-all duration-200",
            isListening && "animate-pulse"
          )}
        >
          {isListening ? (
            <>
              <Square className="w-5 h-5 mr-2" />
              Dừng nghe
            </>
          ) : (
            <>
              <Mic className="w-5 h-5 mr-2" />
              Bắt đầu nói
            </>
          )}
        </Button>
      </div>

      {/* Status Indicator */}
      <div className="flex items-center justify-center mt-4">
        <div
          className={cn(
            "w-3 h-3 rounded-full transition-colors duration-200",
            isListening ? "bg-green-500 animate-pulse" : "bg-gray-300"
          )}
        />
        <span className="ml-2 text-sm text-gray-600">
          {isListening ? "Đang nghe..." : "Nhấn để bắt đầu nói"}
        </span>
      </div>
    </div>
  );
};

export default WaveformVisualizer;
