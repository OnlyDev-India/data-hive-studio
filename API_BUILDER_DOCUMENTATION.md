# API Builder Documentation for Data Hive Studio

## Overview

The API Builder is a visual drag-and-drop interface integrated into Data Hive Studio that allows users to create custom APIs for their database projects without writing code. Users can design API workflows by connecting nodes that represent different database operations and data transformations, leveraging the existing multi-database support (PostgreSQL, MongoDB, SQLite) and connection management system.

## Current Data Hive Studio Features

Based on the codebase analysis, Data Hive Studio currently provides:

- **Multi-Database Support**: PostgreSQL, MongoDB, SQLite with unified interface
- **Connection Management**: Persistent connection storage with auto-reconnection
- **Query Editor**: Advanced SQL/MongoDB query execution with syntax highlighting
- **Table Management**: CRUD operations, data visualization, filtering, sorting
- **Schema Visualization**: Interactive database schema diagrams
- **Command Palette**: VS Code-style quick access to all features
- **Export/Import**: Data export in multiple formats (CSV, JSON, Excel)
- **Backup System**: Database backup command generation
- **Electron Desktop App**: Cross-platform desktop application

## Architecture

### 1. Screen Layout

#### API Details View (Default)

```
┌─────────────────┬───────────────────────────────────────────────┐
│                 │                                               │
│   Left Sidebar  │              API Details Area                 │
│                 │                                               │
│  - API Endpoints│  ┌─────────────────────────────────────────┐  │
│    List         │  │                                         │  │
│                 │  │        API Dashboard                    │  │
│                 │  │                                         │  │
│                 │  │  📊 Overview: Hit Count, Success Rate   │  │
│                 │  │  📈 Analytics: Response Times, Usage    │  │
│                 │  │  📋 Logs: Request/Response History      │  │
│                 │  │  🔧 Settings: Connection, Auth, etc.    │  │
│                 │  │                                         │  │
│                 │  │  [Edit API] [Test API] [Deploy]         │  │
│                 │  │  [Transfer Api to other connection]     │  │
│                 │  └─────────────────────────────────────────┘  │
└─────────────────┴───────────────────────────────────────────────┘
```

#### API Editor View (New Page - After clicking "Edit API")

```
┌─────────────────┬───────────────────────────────────────────────┐
│                 │                                               │
│   Node Palette  │              Main Editor Area                 │
│   (Drag & Drop) │                                               │
│                 │  ┌─────────────────────────────────────────┐  │
│  [SELECT]       │  │                                         │  │
│  [INSERT]       │  │        Drag & Drop Canvas               │  │
│  [UPDATE]       │  │                                         │  │
│  [DELETE]       │  │  [Node] ──→ [Node] ──→ [Node]           │  │
│  [FILTER]       │  │    │         │         │                │  │
│  [SORT]         │  │    └─────────┴─────────┘                │  │
│  [JOIN]         │  │                                         │  │
│  [TRANSFORM]    │  │                                         │  │
│  [COMPLEX]      │  │                                         │  │
│  [SUBQUERY]     │  │                                         │  │
│  [AGGREGATE]    │  │                                         │  │
│  [CONDITION]    │  │                                         │  │
│  [LOOP]         │  │                                         │  │
│  [PARALLEL]     │  │                                         │  │
│  [RESPONSE]     │  │                                         │  │
│                 │  └─────────────────────────────────────────┘  │
│                 │                                               │
└─────────────────┴───────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │        Properties Panel                 │
                    │        (Overlapping Sheet)              │
                    │                                         │
                    │  Node Configuration:                    │
                    │  - Connection Selection                 │
                    │  - Table/Field Selection                │
                    │  - Query Parameters                     │
                    │  - Validation Rules                     │
                    │                                         │
                    │  [Save] [Cancel] [Test]                 │
                    └─────────────────────────────────────────┘
```

### 2. Component Structure

#### API Details Page Components

- **Left Sidebar**: API Endpoints List with status indicators, hit counts, success rates
- **Connection Selector**: Switch between different database connections for API creation
- **Quick Actions**: Create new API, Import/Export configurations, Test APIs
- **Main Area**: API Dashboard with overview, analytics, logs, and settings

#### API Editor Page Components (New Page)

- **Left Sidebar**: Node Palette with draggable node types for different operations
- **Main Canvas**: React Flow-based drag and drop interface
- **Connection Lines**: Visual representation of data flow with multiple outputs
- **Right Properties Panel**: Overlapping sheet for node configuration (appears when node is selected)
- **Connection Context**: Shows which database connection the API will use

## Navigation Flow

### 1. API Selection

```
Left Sidebar → Select API Endpoint → API Details View (Default)
```

### 2. API Details View (Default Landing Page)

- **Overview**: Hit count, success/failure rates, response times, connection info
- **Analytics**: Usage patterns, popular endpoints, connection-specific metrics
- **Logs**: Request/response logs with filtering by connection
- **Settings**: Connection details, authentication, rate limiting
- **Actions**: Edit API, Test API, Deploy, Transfer API, Export/Import

### 3. API Editor (New Page - After clicking "Edit API")

```
API Details View → Edit API Button → New Page: Drag & Drop Editor → Save/Deploy → Return to API Details
```

### 4. Complete Flow

```
Left Sidebar → API Endpoint → API Details Page → Edit API → New Page: API Editor → Save → Return to API Details
```

## Enhanced Node Types

### Database Operation Nodes

#### 1. SELECT Node

- **Purpose**: Query data from database
- **Configuration**:
  - Connection selection (from available connections)
  - Table/Collection selection
  - Column/Field selection
  - WHERE conditions
  - LIMIT and OFFSET
- **Output**: Array of records
- **Multiple Outputs**: Can connect to multiple downstream nodes

#### 2. INSERT Node

- **Purpose**: Insert new records
- **Configuration**:
  - Connection selection
  - Target table/collection
  - Field mappings
  - Data validation rules
- **Output**: Inserted record(s) with generated IDs

#### 3. UPDATE Node

- **Purpose**: Modify existing records
- **Configuration**:
  - Connection selection
  - Target table/collection
  - WHERE conditions
  - Field updates
- **Output**: Updated record count

#### 4. DELETE Node

- **Purpose**: Remove records
- **Configuration**:
  - Connection selection
  - Target table/collection
  - WHERE conditions
- **Output**: Deleted record count

### Advanced Query Nodes

#### 5. COMPLEX QUERY Node

- **Purpose**: Execute complex queries with joins, subqueries, CTEs
- **Configuration**:
  - Connection selection
  - Raw SQL/MongoDB aggregation pipeline
  - Parameter binding
  - Query validation
- **Examples**:
  ```sql
  -- PostgreSQL Complex Query
  WITH user_stats AS (
    SELECT u.id, u.name, COUNT(o.id) as order_count
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.created_at > $1
    GROUP BY u.id, u.name
  )
  SELECT * FROM user_stats WHERE order_count > $2;
  ```
  ```javascript
  // MongoDB Aggregation Pipeline
  [
    { $match: { status: "active" } },
    {
      $lookup: {
        from: "orders",
        localField: "_id",
        foreignField: "user_id",
        as: "orders",
      },
    },
    { $addFields: { order_count: { $size: "$orders" } } },
    { $match: { order_count: { $gt: 0 } } },
  ];
  ```

#### 6. SUBQUERY Node

- **Purpose**: Execute nested queries
- **Configuration**:
  - Connection selection
  - Subquery definition
  - Parent query integration
- **Output**: Results from subquery execution

#### 7. AGGREGATE Node

- **Purpose**: Perform aggregation operations
- **Configuration**:
  - Connection selection
  - Group by fields
  - Aggregation functions (COUNT, SUM, AVG, MIN, MAX)
  - Having conditions
- **Output**: Aggregated results

### Data Processing Nodes

#### 8. FILTER Node

- **Purpose**: Filter data based on conditions
- **Configuration**:
  - Filter conditions
  - Logical operators (AND, OR)
- **Input**: Array of records
- **Output**: Filtered array
- **Multiple Outputs**: Can branch to different filters

#### 9. SORT Node

- **Purpose**: Sort data by specified fields
- **Configuration**:
  - Sort fields
  - Sort direction (ASC/DESC)
- **Input**: Array of records
- **Output**: Sorted array

#### 10. JOIN Node

- **Purpose**: Combine data from multiple sources
- **Configuration**:
  - Connection selection for each source
  - Join type (INNER, LEFT, RIGHT, FULL)
  - Join conditions
  - Source tables/collections
- **Input**: Multiple data streams
- **Output**: Combined dataset

#### 11. TRANSFORM Node

- **Purpose**: Transform data structure
- **Configuration**:
  - Field mappings
  - Data type conversions
  - Calculated fields
- **Input**: Array of records
- **Output**: Transformed array

### Control Flow Nodes

#### 12. CONDITION Node

- **Purpose**: Conditional branching
- **Configuration**:
  - Condition expressions
  - True/false paths
- **Input**: Data + condition
- **Output**: Multiple branched data streams

#### 13. LOOP Node

- **Purpose**: Iterate over data
- **Configuration**:
  - Iteration logic
  - Loop conditions
- **Input**: Array of items
- **Output**: Processed items

#### 14. PARALLEL Node

- **Purpose**: Execute multiple operations in parallel
- **Configuration**:
  - Multiple operation definitions
  - Parallel execution settings
- **Input**: Single data stream
- **Output**: Multiple parallel results

### Response Nodes

#### 15. RESPONSE Node

- **Purpose**: Format final API response
- **Configuration**:
  - Response format (JSON, XML, CSV)
  - Status codes
  - Headers
  - Error handling
- **Input**: Final processed data
- **Output**: HTTP response

## Enhanced Data Flow System

### Multiple Output Connections

- **Single Input, Multiple Outputs**: Most nodes can connect to multiple downstream nodes
- **Data Broadcasting**: Output data is broadcast to all connected nodes
- **Independent Processing**: Each connected node processes the data independently
- **Example Flow**:
  ```
  SELECT → [UPDATE, TRANSFORM, RESPONSE]
            ↓        ↓         ↓
         Update   Transform  Response
         Count    Data       JSON
  ```

### Connection-Aware Data Flow

```javascript
// Example data flow with connection context
SELECT (Connection: PostgreSQL-Prod) → FILTER → [UPDATE (Connection: PostgreSQL-Prod), LOG (Connection: MongoDB-Logs)]
  ↓        ↓        ↓                    ↓
Array   Array    Array              [Update Count, Log Entry]
```

### Error Handling

- **Node-level**: Each node can handle its own errors
- **Connection-level**: Errors specific to database connections
- **Flow-level**: Global error handling for the entire API
- **Fallback**: Default responses for failed operations

## Next.js API Serving Solution

### Option 1: Next.js API Routes (Recommended)

```javascript
// pages/api/custom/[connectionId]/[endpoint].js
export default async function handler(req, res) {
  const { connectionId, endpoint } = req.query;

  try {
    // Get connection details from stored connections
    const connection = await getConnectionById(connectionId);
    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    // Execute API flow with specific connection
    const result = await executeAPIFlow(endpoint, req.body, connection);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
```

**Pros:**

- Integrated with existing Next.js setup
- Leverages existing connection management
- Easy deployment with the desktop app
- Built-in middleware support
- Automatic API documentation

**Cons:**

- Limited to Next.js deployment
- Server-side execution only

### Option 2: Next.js Middleware + API Routes

```javascript
// middleware.js
export function middleware(request) {
  const connectionId = request.headers.get("x-connection-id");
  if (!connectionId) {
    return new Response("Connection ID required", { status: 400 });
  }
  // Add connection context to request
  request.connectionId = connectionId;
}

// pages/api/custom/[endpoint].js
export default async function handler(req, res) {
  const connectionId = req.connectionId;
  const connection = await getConnectionById(connectionId);
  // Execute with connection context
}
```

### Option 3: Dynamic API Generation

```javascript
// lib/api-generator.js
export async function generateAPIRoutes() {
  const connections = await getAllConnections();
  const apis = await getAllAPIConfigurations();

  apis.forEach((api) => {
    // Generate dynamic route for each API
    const route = `/api/${api.connectionId}/${api.endpoint}`;
    // Register route handler
  });
}
```

## Connection Management Integration

### Connection Context in APIs

```javascript
// API execution with connection context
const executeAPIFlow = async (apiId, requestData, connectionId) => {
  const connection = await getConnectionById(connectionId);
  const apiConfig = await getAPIConfiguration(apiId);

  // Execute flow with specific connection
  return await executeFlow(apiConfig.flow, requestData, connection);
};
```

### Connection-Specific API Endpoints

```
/api/custom/{connectionId}/{endpoint}
/api/custom/prod-postgres/users
/api/custom/dev-mongodb/products
/api/custom/staging-sqlite/analytics
```

### Connection Validation

```javascript
// Validate connection before API execution
const validateConnection = async (connectionId) => {
  const connection = await getConnectionById(connectionId);
  if (!connection) {
    throw new Error("Connection not found");
  }

  // Test connection health
  const isHealthy = await testConnection(connection);
  if (!isHealthy) {
    throw new Error("Connection is not healthy");
  }

  return connection;
};
```

## Implementation Plan

### Phase 1: Core Infrastructure (Weeks 1-2)

- [ ] Set up React Flow canvas in `/app/custom-api`
- [ ] Create basic node types (SELECT, INSERT, UPDATE, DELETE)
- [ ] Implement multiple output connection system
- [ ] Build left sidebar with API list and connection selector
- [ ] Create API dashboard with connection-aware metrics

### Phase 2: Advanced Nodes (Weeks 3-4)

- [ ] Add complex query nodes (COMPLEX QUERY, SUBQUERY, AGGREGATE)
- [ ] Implement data processing nodes (FILTER, SORT, JOIN, TRANSFORM)
- [ ] Add control flow nodes (CONDITION, LOOP, PARALLEL)
- [ ] Create connection-aware node property panels

### Phase 3: Next.js API Integration (Weeks 5-6)

- [ ] Build Next.js API route generator
- [ ] Implement connection context management
- [ ] Add API execution engine with connection support
- [ ] Create API testing interface with connection selection

### Phase 4: Advanced Features (Weeks 7-8)

- [ ] Add connection health monitoring
- [ ] Implement API versioning per connection
- [ ] Create connection-specific logging
- [ ] Add import/export capabilities

### Phase 5: Production Features (Weeks 9-10)

- [ ] Add authentication and authorization
- [ ] Implement rate limiting per connection
- [ ] Create API documentation generator
- [ ] Add collaborative editing

## Database Schema Extensions

### API Configurations

```sql
CREATE TABLE api_configurations (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  endpoint VARCHAR(255) NOT NULL,
  method VARCHAR(10) NOT NULL,
  connection_id UUID NOT NULL REFERENCES connections(id),
  flow_config JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);
```

### API Logs with Connection Context

```sql
CREATE TABLE api_logs (
  id UUID PRIMARY KEY,
  api_id UUID REFERENCES api_configurations(id),
  connection_id UUID REFERENCES connections(id),
  request_data JSONB,
  response_data JSONB,
  status_code INTEGER,
  execution_time INTEGER,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Security Considerations

### Connection-Based Security

- **Connection Isolation**: APIs can only access their assigned connections
- **Connection Validation**: Verify connection health before API execution
- **Connection Permissions**: Role-based access to different connections
- **Connection Logging**: Track which connection was used for each API call

### API Security

- **Input Validation**: Validate all incoming data per connection type
- **SQL Injection Prevention**: Use parameterized queries
- **Rate Limiting**: Per-connection rate limiting
- **CORS Configuration**: Connection-specific CORS settings

## Future Enhancements

### Advanced Features

- **Cross-Connection Queries**: Join data from multiple connections
- **Connection Pooling**: Optimize connection usage
- **Real-time APIs**: WebSocket support with connection context
- **API Documentation**: Auto-generated docs per connection
- **Testing Suite**: Connection-aware API testing
- **Version Control**: API version management per connection

### Integrations

- **External APIs**: Connect to third-party services
- **Webhooks**: Trigger external systems with connection context
- **Message Queues**: Async processing with connection awareness
- **File Storage**: Handle file uploads/downloads per connection

## Conclusion

The API Builder for Data Hive Studio will provide a powerful, connection-aware interface for creating custom APIs without coding. The integration with the existing multi-database support and connection management system makes it a natural extension of the current functionality. The drag-and-drop approach with multiple output connections allows for complex data workflows while maintaining the flexibility needed for various use cases.

The recommended serving solution is Next.js API Routes integrated with the existing connection management system, providing seamless integration with the current architecture while maintaining the flexibility to serve APIs for different database connections.
