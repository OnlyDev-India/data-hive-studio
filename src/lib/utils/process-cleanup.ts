import { EnhancedConnectionManager } from '@/lib/databases/connection-manager';

// Handle process cleanup for serverless environments
export async function setupProcessCleanup() {
  // Handle process exit
  process.on('exit', async () => {
    const connectionManager = await EnhancedConnectionManager.getInstance();
    const connection = connectionManager.getConnection();
    if (connection) {
      await connection.disconnect();
    }
  });

  // Handle SIGTERM (graceful shutdown)
  process.on('SIGTERM', async () => {
    const connectionManager = await EnhancedConnectionManager.getInstance();
    const connection = connectionManager.getConnection();
    if (connection) {
      await connection.disconnect();
    }
    process.exit(0);
  });

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', async () => {
    const connectionManager = await EnhancedConnectionManager.getInstance();
    const connection = connectionManager.getConnection();
    if (connection) {
      await connection.disconnect();
    }
    process.exit(0);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    const connectionManager = await EnhancedConnectionManager.getInstance();
    const connection = connectionManager.getConnection();
    if (connection) {
      await connection.disconnect();
    }
    await connectionManager.disconnect();
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason, promise) => {
    const connectionManager = await EnhancedConnectionManager.getInstance();
    const connection = connectionManager.getConnection();
    if (connection) {
      await connection.disconnect();
    }
    await connectionManager.disconnect();
    process.exit(1);
  });
}

// Cleanup function that can be called manually
export async function cleanupConnections() {
  try {
    const connectionManager = await EnhancedConnectionManager.getInstance();
    const connection = connectionManager.getConnection();
    if (connection) {
      await connection.disconnect();
    }
    await connectionManager.disconnect();
  } catch (error) {
    // Silent error handling
  }
}
