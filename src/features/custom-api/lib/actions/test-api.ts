"use server";

import axios from 'axios';

export interface TestResult {
  status: 'success' | 'error' | 'loading';
  statusCode?: number;
  response?: any;
  error?: string;
  duration?: number;
  timestamp: Date;
}

export async function testApiAction(
  method: string,
  url: string,
  body?: any,
  headers?: Record<string, string>
): Promise<{
  success: boolean;
  result?: TestResult;
  error?: string;
}> {
  try {
    const startTime = Date.now();

    const response = await axios({
      method: method.toLowerCase(),
      url,
      data: body,
      headers: headers || { 'Content-Type': 'application/json' },
      timeout: 10000,
      validateStatus: () => true, // Don't throw on HTTP error status codes
    });

    const duration = Date.now() - startTime;

    const result: TestResult = {
      status: response.status >= 200 && response.status < 300 ? 'success' : 'error',
      statusCode: response.status,
      response: response.data,
      duration,
      timestamp: new Date(),
    };

    return {
      success: true,
      result,
    };

  } catch (error) {
    const duration = Date.now() - Date.now();
    
    let errorMessage = 'Unknown error';
    let statusCode: number | undefined;
    
    if (axios.isAxiosError(error)) {
      // Handle axios-specific errors
      if (error.response) {
        // Server responded with error status
        statusCode = error.response.status;
        errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
        if (error.response.data) {
          errorMessage += ` - ${JSON.stringify(error.response.data)}`;
        }
      } else if (error.request) {
        // Request was made but no response received
        errorMessage = 'Network error: No response received';
      } else {
        // Something else happened
        errorMessage = error.message || 'Request setup error';
      }
    } else if (error instanceof Error) {
      // Handle other Error instances
      errorMessage = error.message;
    }
    
    const result: TestResult = {
      status: 'error',
      statusCode,
      error: errorMessage,
      duration,
      timestamp: new Date(),
    };

    return {
      success: false,
      result,
      error: errorMessage,
    };
  }
}