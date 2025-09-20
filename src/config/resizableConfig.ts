interface ResizableConfig {
  defaultSizes: number[];
  minSizes: number[];
  maxSizes: number[];
  collapsedTo?: number[];
}

interface ResizableConfigs {
  default: ResizableConfig;
}

const resizableConfig: ResizableConfigs = {
  default: {
    defaultSizes: [20, 80],
    minSizes: [10, 30],
    maxSizes: [70, 100],
    collapsedTo: [0, 0],
  },
};


export default resizableConfig;
export type { ResizableConfig, ResizableConfigs };
