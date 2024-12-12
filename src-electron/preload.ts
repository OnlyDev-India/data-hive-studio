import { contextBridge, ipcRenderer } from "electron";

const handler = {
  send(channel: string, value: any) {
    ipcRenderer.send(channel, value);
  },
  on(channel: string, callback: (...args: any[]) => any) {
    // Updated type for callback
    const subscription = (_event: any, ...args: any[]) => callback(...args); // Ensure args is an array
    ipcRenderer.on(channel, subscription);

    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  },
  getAppDbPath() {
    return ipcRenderer.invoke("app-db-path");
  },
};

contextBridge.exposeInMainWorld("electron", handler);
