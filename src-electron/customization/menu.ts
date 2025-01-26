import { BrowserWindow, ipcMain } from "electron";
export function registerIPCHandlers() {
  ipcMain.handle("reload-window", () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      // on reload, start fresh and close any old
      // open secondary windows
      if (focusedWindow.id === 1) {
        for (const win of BrowserWindow.getAllWindows()) {
          if (win.id > 1) win.close();
        }
      }
      focusedWindow.reload();
    }
  });

  ipcMain.handle("fullscreen-window", () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.setFullScreen(!focusedWindow.isFullScreen());
    }
  });

  ipcMain.handle("toggle-devtools", () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.webContents.toggleDevTools();
    }
  });

  ipcMain.handle("minimize-window", () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.minimize();
    }
  });

  ipcMain.handle("close-window", () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.close();
    }
  });
}
