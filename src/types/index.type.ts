declare global {
  interface Window {
    electron: {
      getConnectionsJsonPath: () => string;
      updateTheme: (theme: string) => void;
      openSelectDir: (path: any) => Promise<any>;
      reloadWindow: () => void;
      toggleDevTools: () => void;
      minimizeWindow: () => void;
      closeWindow: () => void;
      setFullScreen: () => void;
      saveFile: (
        data: string,
        path: string,
      ) => Promise<{ success: boolean; error: string }>;
    };
  }
}

export {};
