# Database Auto-Reconnection System

A comprehensive auto-reconnection system for Data Hive Studio that ensures database connections remain stable and automatically recover from disconnections.

## 🔧 Features

### Core Functionality
- **🔄 Automatic Reconnection**: Detects connection loss and automatically attempts to reconnect
- **❤️ Health Monitoring**: Continuously monitors connection health with configurable intervals
- **📈 Exponential Backoff**: Smart retry strategy that increases delay between attempts
- **🎯 Connection State Management**: Tracks connection status, errors, and retry attempts
- **🔧 Manual Override**: Force reconnection through UI controls
- **📱 Real-time Notifications**: Toast notifications for connection events

### Health Monitoring
- **Interval**: 30 seconds (configurable)
- **Health Checks**: Simple queries to verify connection validity
- **Error Detection**: Automatic detection of connection failures
- **State Tracking**: Real-time connection state updates

### Retry Strategy
- **Max Attempts**: 3 retries per disconnection
- **Backoff Strategy**: Exponential backoff (5s, 10s, 20s)
- **Timeout Handling**: Configurable connection timeouts
- **Circuit Breaker**: Stops attempts after max retries reached

## 🏗 Architecture

### Enhanced Connection Manager
The `EnhancedConnectionManager` class provides:

```typescript
interface ConnectionConfig {
  maxRetries: number;        // Default: 3
  retryDelay: number;        // Default: 5000ms
  healthCheckInterval: number; // Default: 30000ms
  connectionTimeout: number;   // Default: 10000ms
  keepAliveInterval: number;   // Default: 60000ms
}
```

### Connection State Interface
```typescript
interface ConnectionState {
  isConnected: boolean;
  lastHealthCheck: Date;
  connectionAttempts: number;
  lastError: string | null;
  isReconnecting: boolean;
}
```

## 🚀 Usage

### Basic Implementation
```typescript
import { EnhancedConnectionManager } from "@/lib/databases/connection-manager";

const connectionManager = EnhancedConnectionManager.getInstance();

// Connect with auto-reconnection enabled
await connectionManager.connect({
  connectionDetails,
  dbType: "pgSql" // or "mongodb"
});

// Check connection health
const isHealthy = connectionManager.isConnectionHealthy(connectionId);

// Get detailed connection state
const state = connectionManager.getConnectionState(connectionId);

// Force manual reconnection
await connectionManager.forceReconnect(connectionId);
```

### Configuration
```typescript
// Customize connection behavior
connectionManager.setConfig({
  maxRetries: 5,           // Increase retry attempts
  retryDelay: 3000,        // Faster initial retry
  healthCheckInterval: 15000, // More frequent health checks
});
```

## 🔗 Integration Points

### 1. Fetch Data Actions
All database operations in `src/lib/actions/fetch-data.ts` now use the enhanced connection manager:

```typescript
export async function executeQuery(query: string) {
  const connectionManager = EnhancedConnectionManager.getInstance();
  const connection = connectionManager.getCurrentConnection();
  if (!connection) return { error: "No connection to the database" };
  
  return await connection.executeQuery(query);
}
```

### 2. Connection Status UI
Real-time connection status displayed in the menu bar:

```typescript
import { ConnectionStatus } from "@/components/ui/connection-status";

// Simple badge view
<ConnectionStatus />

// Detailed view with controls
<ConnectionStatus showDetails={true} />
```

### 3. API Endpoints
RESTful API for connection management:

```
GET  /api/connection/status  - Get current connection state
POST /api/connection/status  - Force reconnection or get state
```

### 4. Event System
Custom events for UI notifications:

```typescript
// Listen for connection events
window.addEventListener('database-reconnected', (event) => {
  console.log('Connection restored:', event.detail.connectionId);
});

window.addEventListener('database-connection-lost', (event) => {
  console.log('Connection lost:', event.detail.connectionId);
});
```

## 🎛 Configuration Options

### Environment Variables
```env
# Connection timeout in milliseconds
DB_CONNECTION_TIMEOUT=10000

# Health check interval in milliseconds  
DB_HEALTH_CHECK_INTERVAL=30000

# Maximum retry attempts
DB_MAX_RETRIES=3

# Initial retry delay in milliseconds
DB_RETRY_DELAY=5000
```

### Runtime Configuration
```typescript
const connectionManager = EnhancedConnectionManager.getInstance();

connectionManager.setConfig({
  maxRetries: 5,
  retryDelay: 2000,
  healthCheckInterval: 20000,
  connectionTimeout: 15000,
  keepAliveInterval: 45000,
});
```

## 📊 Monitoring & Debugging

### Connection State Monitoring
```typescript
// Get all connection states
const allStates = connectionManager.getAllConnectionStates();

// Check specific connection
const connectionId = "your-connection-id";
const state = connectionManager.getConnectionState(connectionId);
const lastError = connectionManager.getLastError(connectionId);
const isHealthy = connectionManager.isConnectionHealthy(connectionId);
```

### Debug Logging
The system provides comprehensive logging for debugging:

```
✅ Successfully connected to connection-id with auto-reconnection enabled
⚠️  Health check failed for connection-id: Connection timeout
🔄 Scheduling reconnection attempt 1/3 for connection-id in 5000ms
🔄 Attempting to reconnect connection-id...
✅ Successfully reconnected to connection-id
❌ All reconnection attempts failed for connection-id
```

## 🔧 Database-Specific Implementation

### PostgreSQL
- **Health Check**: `SELECT 1` query
- **Connection Pool**: Uses pg Pool for connection management
- **Error Detection**: Catches connection and query errors

### MongoDB  
- **Health Check**: `listDatabases()` operation
- **Connection**: MongoClient with auto-reconnection
- **Error Detection**: MongoDB driver error handling

## 🚨 Error Handling

### Connection Errors
- **Network Issues**: Automatic retry with exponential backoff
- **Authentication**: Reports auth errors without retry
- **Timeout**: Configurable timeout with retry logic
- **DNS Issues**: Network-level error handling

### UI Error Display
- **Toast Notifications**: Real-time error and success messages
- **Status Badge**: Visual connection state indicator
- **Error Details**: Detailed error information in status panel

## 🔄 Migration from Old System

### Before (ConnectionManager)
```typescript
const connectionManager = ConnectionManager.getInstance();
const connection = connectionManager.getCurrentConnection();
```

### After (EnhancedConnectionManager)
```typescript
const connectionManager = EnhancedConnectionManager.getInstance();
const connection = connectionManager.getCurrentConnection();
// Now includes auto-reconnection, health monitoring, and state tracking
```

### Benefits of Migration
- ✅ **Zero Downtime**: Automatic reconnection prevents manual intervention
- ✅ **Better UX**: Users see connection status and automatic recovery
- ✅ **Reliability**: Exponential backoff prevents connection storms
- ✅ **Monitoring**: Real-time connection health visibility
- ✅ **Error Recovery**: Graceful handling of network issues

## 🧪 Testing

### Manual Testing
1. **Disconnect Network**: Verify auto-reconnection triggers
2. **Database Restart**: Test recovery from database restarts  
3. **Timeout Simulation**: Verify timeout handling
4. **Force Reconnect**: Test manual reconnection feature

### Automated Testing
```typescript
// Mock connection failure
const connectionManager = EnhancedConnectionManager.getInstance();
await connectionManager.connect({ connectionDetails, dbType });

// Simulate network failure
// Verify auto-reconnection behavior
// Check state transitions
```

## 📝 Best Practices

### 1. Connection Configuration
- Set appropriate timeout values for your network
- Configure retry attempts based on your use case
- Monitor connection health in production

### 2. Error Handling
- Always check connection state before operations
- Handle reconnection events in your UI
- Provide user feedback during reconnection

### 3. Performance
- Don't set health check intervals too low
- Use connection pooling for high-traffic applications
- Monitor connection overhead

### 4. Security
- Store connection credentials securely
- Use SSL/TLS for database connections
- Validate connection parameters

## 🔮 Future Enhancements

- **Connection Pooling**: Multiple connection management
- **Load Balancing**: Distribute connections across replicas
- **Metrics Collection**: Connection performance metrics
- **Advanced Retry**: Custom retry strategies per database type
- **Cluster Support**: Multi-node database cluster support

---

**Note**: The auto-reconnection system is now enabled by default for all new connections. Existing applications will need to be updated to use the `EnhancedConnectionManager` instead of the legacy `ConnectionManager`. 