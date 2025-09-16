"use client";

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { TestResult } from '../lib/actions/test-api';

interface KeyValuePair {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

interface TestConfig {
  requestBody: string;
  queryParams: KeyValuePair[];
  headers: KeyValuePair[];
  urlParams: KeyValuePair[];
}

interface TestResultsContextType {
  testResults: Record<string, TestResult>;
  testConfigs: Record<string, TestConfig>;
  addTestResult: (endpointId: string, result: TestResult) => void;
  clearTestResults: () => void;
  getTestResult: (endpointId: string) => TestResult | undefined;
  saveTestConfig: (endpointId: string, config: TestConfig) => void;
  getTestConfig: (endpointId: string) => TestConfig | undefined;
}

const TestResultsContext = createContext<TestResultsContextType | undefined>(undefined);

export const useTestResults = () => {
  const context = useContext(TestResultsContext);
  if (context === undefined) {
    throw new Error('useTestResults must be used within a TestResultsProvider');
  }
  return context;
};

interface TestResultsProviderProps {
  children: ReactNode;
}

export const TestResultsProvider: React.FC<TestResultsProviderProps> = ({ children }) => {
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testConfigs, setTestConfigs] = useState<Record<string, TestConfig>>({});

  const addTestResult = (endpointId: string, result: TestResult) => {
    setTestResults(prev => ({
      ...prev,
      [endpointId]: result
    }));
  };

  const clearTestResults = () => {
    setTestResults({});
  };

  const getTestResult = (endpointId: string) => {
    return testResults[endpointId];
  };

  const saveTestConfig = (endpointId: string, config: TestConfig) => {
    setTestConfigs(prev => ({
      ...prev,
      [endpointId]: config
    }));
  };

  const getTestConfig = (endpointId: string) => {
    return testConfigs[endpointId];
  };

  const value: TestResultsContextType = {
    testResults,
    testConfigs,
    addTestResult,
    clearTestResults,
    getTestResult,
    saveTestConfig,
    getTestConfig,
  };

  return (
    <TestResultsContext.Provider value={value}>
      {children}
    </TestResultsContext.Provider>
  );
};
