import { DBType } from "./db.type";

declare global {
  interface Window {
    electron: {
      getAppDbPath: () => string;
    };
  }
}

export {};
