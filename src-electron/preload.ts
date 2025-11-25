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
  saveFile(data: any, path: string) {
    return ipcRenderer.invoke("save-file", data, path);
  },
  getConnectionsJsonPath: () => ipcRenderer.invoke("get-connections-json-path"),
  getSettingsJsonPath: () => ipcRenderer.invoke("get-settings-json-path"),
  readSettings: () => ipcRenderer.invoke("read-settings"),
  writeSettings: (settings: any) => ipcRenderer.invoke("write-settings", settings),
  updateTheme(theme: string) {
    ipcRenderer.invoke("update-theme", theme);
  },
  openSelectDir(path: string) {
    return ipcRenderer.invoke("open-select-dir", path);
  },
  reloadWindow() {
    ipcRenderer.invoke("reload-window");
  },
  setFullScreen() {
    ipcRenderer.invoke("fullscreen-window");
  },
  toggleDevTools() {
    ipcRenderer.invoke("toggle-devtools");
  },
  minimizeWindow() {
    ipcRenderer.invoke("minimize-window");
  },
  closeWindow() {
    ipcRenderer.invoke("close-window");
  },
};

contextBridge.exposeInMainWorld("electron", handler);
