/**
 * Logger levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger configuration
 */
interface LoggerConfig {
  level: LogLevel;
  enableTimestamp: boolean;
  enableColors: boolean;
}

/**
 * Default logger configuration
 */
const DEFAULT_CONFIG: LoggerConfig = {
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  enableTimestamp: true,
  enableColors: typeof window !== 'undefined',
};

/**
 * Log levels hierarchy
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Colors for different log levels (for browser console)
 */
const LOG_COLORS: Record<LogLevel, string> = {
  debug: '#6B7280', // gray
  info: '#3B82F6',  // blue
  warn: '#F59E0B',  // yellow
  error: '#EF4444', // red
};

/**
 * Simple logger utility
 */
class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  private formatMessage(level: LogLevel, component: string, message: string, data?: unknown): string {
    const timestamp = this.config.enableTimestamp ? new Date().toISOString() : '';
    const prefix = timestamp ? `[${timestamp}]` : '';
    return `${prefix} [${level.toUpperCase()}] [${component}] ${message}${data ? ` ${JSON.stringify(data)}` : ''}`;
  }

  private log(level: LogLevel, component: string, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    const formattedMessage = this.formatMessage(level, component, message, data);

    if (this.config.enableColors && typeof window !== 'undefined') {
      console.log(`%c${formattedMessage}`, `color: ${LOG_COLORS[level]}`);
    } else {
      switch (level) {
        case 'debug':
          console.debug(formattedMessage);
          break;
        case 'info':
          console.info(formattedMessage);
          break;
        case 'warn':
          console.warn(formattedMessage);
          break;
        case 'error':
          console.error(formattedMessage);
          break;
      }
    }
  }

  debug(component: string, message: string, data?: unknown): void {
    this.log('debug', component, message, data);
  }

  info(component: string, message: string, data?: unknown): void {
    this.log('info', component, message, data);
  }

  warn(component: string, message: string, data?: unknown): void {
    this.log('warn', component, message, data);
  }

  error(component: string, message: string, data?: unknown): void {
    this.log('error', component, message, data);
  }

  /**
   * Update logger configuration
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): LoggerConfig {
    return { ...this.config };
  }
}

// Export singleton instance
export const logger = new Logger();

// Export Logger class for custom instances
export { Logger };

// Export types
export type { LoggerConfig };
