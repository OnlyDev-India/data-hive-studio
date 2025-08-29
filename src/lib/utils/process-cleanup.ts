import { EnhancedConnectionManager } from '@/lib/databases/connection-manager';

// Handle process cleanup for serverless environments
export function setupProcessCleanup() {
  // Handle process exit
  process.on('exit', () => {
    const connectionManager = EnhancedConnectionManager.getInstance();
    connectionManager.cleanup();
  });

  // Handle SIGTERM (graceful shutdown)
  process.on('SIGTERM', () => {
    const connectionManager = EnhancedConnectionManager.getInstance();
    connectionManager.cleanup();
    process.exit(0);
  });

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', () => {
    const connectionManager = EnhancedConnectionManager.getInstance();
    connectionManager.cleanup();
    process.exit(0);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    const connectionManager = EnhancedConnectionManager.getInstance();
    connectionManager.cleanup();
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    const connectionManager = EnhancedConnectionManager.getInstance();
    connectionManager.cleanup();
    process.exit(1);
  });
}

// Cleanup function that can be called manually
export function cleanupConnections() {
  try {
    const connectionManager = EnhancedConnectionManager.getInstance();
    connectionManager.cleanup();
  } catch (error) {
    // Silent error handling
  }
}
