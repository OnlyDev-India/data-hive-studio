import { WorkbenchNode, EndpointNodeData, ResponseNodeData, ConditionalNodeData } from '@/features/custom-api/types/custom-api.type';
import { Edge } from '@xyflow/react';

export interface FlowExecutionContext {
  params: Record<string, any>;
  query: Record<string, any>;
  body: any;
  headers: Record<string, string>;
  [key: string]: any;
}

export interface FlowExecutionResult {
  statusCode: number;
  data?: any;
  message?: string;
  error?: string;
  executionSteps?: NodeExecutionStep[];
}

export interface NodeExecutionStep {
  nodeId: string;
  nodeType: string;
  nodeName: string;
  status: 'pending' | 'executing' | 'completed' | 'error';
  input?: any;
  output?: any;
  error?: string;
  executionTime?: number;
}

export class EndpointFlowExecutor {
  private endpointId: string;
  private nodes: WorkbenchNode[] = [];
  private edges: Edge[] = [];
  private context: FlowExecutionContext;
  private executionSteps: NodeExecutionStep[] = [];
  private onStepUpdate?: (steps: NodeExecutionStep[]) => void;

  constructor(endpointId: string) {
    this.endpointId = endpointId;
    this.context = {
      params: {},
      query: {},
      body: null,
      headers: {},
    };
  }

  /**
   * Initialize the flow with nodes and edges for the endpoint
   */
  public initializeFlow(nodes: WorkbenchNode[], edges: Edge[]): void {
    this.nodes = nodes;
    this.edges = edges;
    this.initializeExecutionSteps();
  }

  /**
   * Set callback for step updates
   */
  public setStepUpdateCallback(callback: (steps: NodeExecutionStep[]) => void): void {
    this.onStepUpdate = callback;
  }

  /**
   * Initialize execution steps from the flow
   */
  private initializeExecutionSteps(): void {
    this.executionSteps = [];
    const visited = new Set<string>();

    // Find the starting node (endpoint node)
    const startNode = this.nodes.find(
      (node) => node.id === this.endpointId && (node.data as any).type === 'endpointNode'
    );

    if (!startNode) return;

    // Recursively traverse the flow
    const traverseFlow = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = this.nodes.find(n => n.id === nodeId);
      if (!node) return;

      // Add current node to steps
      this.executionSteps.push({
        nodeId: node.id,
        nodeType: (node.data as any).type,
        nodeName: (node.data as any).type === 'endpointNode' 
          ? (node.data as EndpointNodeData).endpoint.name 
          : (node.data as any).type === 'responseNode'
          ? 'Response Node'
          : (node.data as any).type === 'conditionalNode'
          ? (node.data as ConditionalNodeData).name || 'Conditional'
          : (node.data as any).type,
        status: 'pending',
      });

      // Find next nodes
      const outgoingEdges = this.edges.filter(edge => edge.source === nodeId);
      outgoingEdges.forEach(edge => {
        traverseFlow(edge.target);
      });
    };

    traverseFlow(this.endpointId);
    this.notifyStepUpdate();
  }

  /**
   * Set the initial context from the endpoint request
   */
  public setContext(context: Partial<FlowExecutionContext>): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Notify step update callback
   */
  private notifyStepUpdate(): void {
    if (this.onStepUpdate) {
      this.onStepUpdate([...this.executionSteps]);
    }
  }

  /**
   * Update step status
   */
  private updateStepStatus(nodeId: string, status: NodeExecutionStep['status'], data?: Partial<NodeExecutionStep>): void {
    const stepIndex = this.executionSteps.findIndex(step => step.nodeId === nodeId);
    if (stepIndex !== -1) {
      this.executionSteps[stepIndex] = {
        ...this.executionSteps[stepIndex],
        status,
        ...data
      };
      this.notifyStepUpdate();
    }
  }

  /**
   * Execute the node flow
   */
  public async execute(): Promise<FlowExecutionResult> {
    try {
      // Find the starting node (endpoint node)
      const startNode = this.findStartNode();
      if (!startNode) {
        return {
          statusCode: 500,
          message: 'No endpoint node found',
          error: 'Flow execution failed: No starting node',
          executionSteps: this.executionSteps
        };
      }

      // Execute the flow starting from the endpoint node
      const result = await this.executeNodeFlow(startNode);
      
      // If no response node was found or no data returned
      if (!result || result.statusCode === 200 && !result.data) {
        return {
          statusCode: 200,
          message: 'Flow executed successfully',
          executionSteps: this.executionSteps
        };
      }

      return {
        ...result,
        executionSteps: this.executionSteps
      };

    } catch (error) {
      console.error('Flow execution error:', error);
      return {
        statusCode: 500,
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        executionSteps: this.executionSteps
      };
    }
  }

  /**
   * Find the starting node (endpoint node)
   */
  private findStartNode(): WorkbenchNode | null {
    return this.nodes.find(node => 
      node.data.type === 'endpointNode' && node.id === this.endpointId
    ) || null;
  }

  /**
   * Execute the node flow recursively
   */
  private async executeNodeFlow(currentNode: WorkbenchNode): Promise<FlowExecutionResult | null> {
    const startTime = Date.now();
    
    try {
      // Mark node as executing
      this.updateStepStatus(currentNode.id, 'executing');
      
      // Process the current node
      const nodeResult = await this.processNode(currentNode);
      
      // Mark node as completed
      const executionTime = Date.now() - startTime;
      this.updateStepStatus(currentNode.id, 'completed', {
        input: nodeResult.input,
        output: nodeResult.output,
        executionTime
      });
      
      // Find the next node(s) in the flow
      let nextNodes: WorkbenchNode[] = [];
      
      // Handle conditional nodes differently
      if ((currentNode.data as any).type === 'conditionalNode') {
        const conditionalResult = nodeResult.output?.result;
        if (typeof conditionalResult === 'boolean') {
          nextNodes = this.getNextNodesForConditional(currentNode.id, conditionalResult);
        } else {
          // If conditional evaluation failed, try to continue with all next nodes
          nextNodes = this.getNextNodes(currentNode.id);
        }
      } else {
        nextNodes = this.getNextNodes(currentNode.id);
      }
      
      if (nextNodes.length === 0) {
        // This is the last node
        if ((currentNode.data as any).type === 'responseNode') {
          const responseData = currentNode.data as ResponseNodeData;
          return {
            statusCode: responseData.statusCode,
            data: this.parseResponseBody(responseData.responseBody)
          };
        } else {
          // Last node is not a response node
          return {
            statusCode: 200,
            message: 'Flow executed successfully'
          };
        }
      }

      // Continue to next nodes
      for (const nextNode of nextNodes) {
        const result = await this.executeNodeFlow(nextNode);
        if (result) {
          return result;
        }
      }

      return null;

    } catch (error) {
      // Mark node as error
      const executionTime = Date.now() - startTime;
      this.updateStepStatus(currentNode.id, 'error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime
      });
      
      // If error occurred in a node, return the node's error
      if (error instanceof Error) {
        return {
          statusCode: 500,
          message: 'Node execution error',
          error: error.message
        };
      }
      throw error;
    }
  }

  /**
   * Process a single node
   */
  private async processNode(node: WorkbenchNode): Promise<{ input?: any; output?: any }> {
    const nodeData = node.data as any;
    switch (nodeData.type) {
      case 'endpointNode':
        return await this.processEndpointNode(node);
      case 'responseNode':
        // Response nodes are processed in executeNodeFlow
        return { input: this.context, output: { message: 'Response node processed' } };
      case 'conditionalNode':
        return await this.processConditionalNode(node);
      default:
        console.log(`Unknown node type: ${nodeData.type}`);
        return { input: this.context, output: { message: `${nodeData.type} processed` } };
    }
  }

  /**
   * Process endpoint node - extract request data
   */
  private async processEndpointNode(node: WorkbenchNode): Promise<{ input?: any; output?: any }> {
    const endpointData = node.data as EndpointNodeData;
    const endpoint = endpointData.endpoint;

    const input = { ...this.context };

    // Extract parameters from endpoint definition
    if (endpoint.parameters) {
      endpoint.parameters.forEach((param: any) => {
        if (param.in === 'path') {
          this.context.params[param.name] = param.defaultValue || null;
        } else if (param.in === 'query') {
          this.context.query[param.name] = param.defaultValue || null;
        }
      });
    }

    // Set headers context
    this.context.headers = {
      'content-type': 'application/json',
      'authorization': 'Bearer token', // This would come from actual request
      ...this.context.headers
    };

    return {
      input,
      output: {
        message: 'Endpoint processed successfully',
        data: this.context
      }
    };
  }

  /**
   * Process conditional node - evaluate condition and determine path
   */
  private async processConditionalNode(node: WorkbenchNode): Promise<{ input?: any; output?: any }> {
    const conditionalData = node.data as ConditionalNodeData;
    const input = { ...this.context };

    try {
      // Create a safe evaluation context
      const evaluationContext = {
        params: this.context.params,
        query: this.context.query,
        body: this.context.body,
        headers: this.context.headers,
        // Add some common utility functions
        Math,
        JSON,
        String,
        Number,
        Boolean,
        Array,
        Object,
        Date,
      };

      // Evaluate the condition
      const conditionResult = this.evaluateCondition(conditionalData.condition, evaluationContext);
      
      return {
        input,
        output: {
          message: 'Conditional node processed',
          condition: conditionalData.condition,
          result: conditionResult,
          path: conditionResult ? 'true' : 'false'
        }
      };
    } catch (error) {
      return {
        input,
        output: {
          message: 'Conditional node error',
          condition: conditionalData.condition,
          error: error instanceof Error ? error.message : 'Unknown error',
          path: 'error'
        }
      };
    }
  }

  /**
   * Safely evaluate a condition string
   */
  private evaluateCondition(condition: string, context: any): boolean {
    try {
      // Create a function that evaluates the condition
      const func = new Function(...Object.keys(context), `return ${condition}`);
      const result = func(...Object.values(context));
      return Boolean(result);
    } catch (error) {
      console.error('Error evaluating condition:', error);
      throw new Error(`Invalid condition: ${condition}`);
    }
  }

  /**
   * Get the next nodes in the flow
   */
  private getNextNodes(nodeId: string): WorkbenchNode[] {
    const outgoingEdges = this.edges.filter(edge => edge.source === nodeId);
    const nextNodeIds = outgoingEdges.map(edge => edge.target);
    
    return this.nodes.filter(node => nextNodeIds.includes(node.id));
  }

  /**
   * Get the next nodes in the flow based on conditional path
   */
  private getNextNodesForConditional(nodeId: string, conditionResult: boolean): WorkbenchNode[] {
    const outgoingEdges = this.edges.filter(edge => edge.source === nodeId);
    
    // For conditional nodes, we need to check the handle (true/false)
    const targetHandle = conditionResult ? 'true' : 'false';
    const relevantEdges = outgoingEdges.filter(edge => edge.sourceHandle === targetHandle);
    const nextNodeIds = relevantEdges.map(edge => edge.target);
    const nextNodes = this.nodes.filter(node => nextNodeIds.includes(node.id));
    
    return nextNodes;
  }

  /**
   * Parse response body and replace template variables
   */
  private parseResponseBody(responseBody: string): any {
    try {
      // Replace template variables with actual context values
      let parsedBody = responseBody;
      
      // Replace params
      Object.keys(this.context.params).forEach(key => {
        const regex = new RegExp(`\\{\\{params\\.${key}\\}\\}`, 'g');
        parsedBody = parsedBody.replace(regex, JSON.stringify(this.context.params[key]));
      });

      // Replace query parameters
      Object.keys(this.context.query).forEach(key => {
        const regex = new RegExp(`\\{\\{query\\.${key}\\}\\}`, 'g');
        parsedBody = parsedBody.replace(regex, JSON.stringify(this.context.query[key]));
      });

      // Replace body
      if (this.context.body) {
        parsedBody = parsedBody.replace(/\{\{body\}\}/g, JSON.stringify(this.context.body));
      }

      // Replace headers
      Object.keys(this.context.headers).forEach(key => {
        const regex = new RegExp(`\\{\\{headers\\.${key}\\}\\}`, 'g');
        parsedBody = parsedBody.replace(regex, JSON.stringify(this.context.headers[key]));
      });

      // Parse as JSON
      return JSON.parse(parsedBody);

    } catch (error) {
      console.error('Error parsing response body:', error);
      return { error: 'Invalid response body format' };
    }
  }

  /**
   * Get the current execution context
   */
  public getContext(): FlowExecutionContext {
    return { ...this.context };
  }

  /**
   * Update context with new data
   */
  public updateContext(updates: Partial<FlowExecutionContext>): void {
    this.context = { ...this.context, ...updates };
  }

  /**
   * Get current execution steps
   */
  public getExecutionSteps(): NodeExecutionStep[] {
    return [...this.executionSteps];
  }
}
