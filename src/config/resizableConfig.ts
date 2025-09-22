interface ResizableConfig {
  defaultSizes: number[];
  minSizes: number[];
  maxSizes: number[];
  collapsedTo?: number[];
}

interface ResizableConfigs {
  default: ResizableConfig;
  editor: ResizableConfig;
}

const resizableConfig: ResizableConfigs = {
  default: {
    defaultSizes: [20, 80],
    minSizes: [10, 30],
    maxSizes: [70, 100],
    collapsedTo: [0, 0],
  },
  editor: {
    defaultSizes: [50, 50],
    minSizes: [5.5, 5.5],
    maxSizes: [94.5, 94.5],
  },
};


export default resizableConfig;
export type { ResizableConfig, ResizableConfigs };
