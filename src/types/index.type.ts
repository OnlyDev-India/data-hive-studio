declare global {
  interface Window {
    electron: {
      getAppDbPath: () => string;
      updateTheme: (theme: string) => void;
      openSelectDir: (path: any) => Promise<any>;
    };
  }
}

export {};
