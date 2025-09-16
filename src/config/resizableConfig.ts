interface ResizableConfig {
  defaultSizes: number[];
  minSizes: number[];
  maxSizes: number[];
  collapsedTo?: number[];
}

interface ResizableConfigs {
  default: ResizableConfig;
  endpointPage: ResizableConfig;
  endpointPageComponents: ResizableConfig;
}

const resizableConfig: ResizableConfigs = {
  default: {
    defaultSizes: [20, 80],
    minSizes: [10, 30],
    maxSizes: [70, 100],
    collapsedTo: [0, 0],
  },
  endpointPage: {
    defaultSizes: [50, 50],
    minSizes: [5.5, 5.5],
    maxSizes: [100, 100],
    collapsedTo: [5.5, 5.5],
  },
  endpointPageComponents: {
    defaultSizes: [70, 30],
    minSizes: [20, 20],
    maxSizes: [100, 100],
  },
};


export default resizableConfig;
export type { ResizableConfig, ResizableConfigs };
