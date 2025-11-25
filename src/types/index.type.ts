import { DatabaseClient } from "./db.type";

declare global {
  interface Window {
    electron: {
      getConnectionsJsonPath: () => Promise<string>;
      getSettingsJsonPath: () => Promise<string>;
      readSettings: () => Promise<{ success: boolean; data?: any; error?: string }>;
      writeSettings: (settings: any) => Promise<{ success: boolean; error?: string }>;
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
  var connectionManagerInstance: {[key: string]: DatabaseClient | null};
}

global.connectionManagerInstance = {};

export {};
