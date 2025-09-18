import { CustomServer } from "@/features/custom-api/lib/custom-server";
import { DatabaseClient } from "./db.type";

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
  var customServer: {[key: string]: CustomServer | null};
  var connectionManagerInstance: {[key: string]: DatabaseClient | null};
}

global.customServer = {};
global.connectionManagerInstance = {};

export {};
