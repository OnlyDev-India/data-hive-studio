import path from "path";
import fs from "fs";
import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  shell,
  nativeTheme,
  dialog,
  TitleBarOverlayOptions,
} from "electron";
// import { createHandler } from "./handler/index.js";
import { seedDataIntoDB } from "./seed/seed-appDb.js";
import { createHandler } from "next-electron-rsc";
import { registerIPCHandlers } from "./customization/menu.js";

const isDev = process.env.NODE_ENV === "development";
const appPath = app.getAppPath();
const localhostUrl = "http://localhost:4080"; // must match Next.js dev server

let mainWindow: BrowserWindow | null;
let stopIntercept: any;
let createInterceptor: any;

const appDataPath = app.getPath("appData");

// TODO: add a check to see if the appDataPath is a valid path
const dbPath = path.join(appDataPath, "data-hive-studio/app.db");

// create app.db file if it doesn't exists
if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, "", { flag: "wx" });
  seedDataIntoDB(dbPath);
}

process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";
process.env["ELECTRON_ENABLE_LOGGING"] = "true";

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

const themes: { [key: string]: TitleBarOverlayOptions } = {
  dark: {
    color: "#191b1f",
    symbolColor: "#ffffff",
  },
  light: {
    color: "#f4f4f5",
    symbolColor: "#24292e",
  },
};

// Next.js handler
const standaloneDir = path.join(appPath, ".next", "standalone");

if (!isDev) {
  const handler = createHandler({
    standaloneDir,
    localhostUrl,
    protocol,
    debug: true,
  });

  createInterceptor = handler.createInterceptor;
}

const createWindow = async () => {
  const preloadPath = path.join(app.getAppPath(), "build", "preload.mjs");
  const splashScreenPath = isDev
    ? path.join(appPath, "public/splash-screen.html")
    : path.join(process.resourcesPath, "public/splash-screen.html");
  const splashScreen = new BrowserWindow({
    width: 800,
    height: 600,
    icon: process.platform === "darwin" ? path.join(appPath, "public/icon.icns") : path.join(appPath, "public/icon.png"),
    title: "Data Hive Studio",
    frame: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: true,
      devTools: isDev,
      preload: preloadPath,
    },
  });

  splashScreen.loadFile(splashScreenPath);

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 800,
    icon: process.platform === "darwin" ? path.join(appPath, "public/icon.icns") : path.join(appPath, "public/icon.png"),
    title: "Data Hive Studio",
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    ...(process.platform !== "darwin" ? { titleBarOverlay: true } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: true,
      devTools: isDev,
      preload: preloadPath,
    },
  });

  // Next.js handler

  if (!isDev) {
    console.log(
      `[APP] Server Debugging Enabled, ${localhostUrl} will be intercepted to ${standaloneDir}`,
    );
    stopIntercept = createInterceptor({
      session: mainWindow.webContents.session,
    });
  }

  // Next.js handler
  if (!mainWindow) return;

  mainWindow.once("ready-to-show", () => {
    splashScreen.close();
    changeTheme();
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.webContents.openDevTools();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    stopIntercept?.();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }: any) => {
    shell.openExternal(url).catch((e) => console.error(e));
    return { action: "deny" };
  });

  // Menu.setApplicationMenu(Menu.buildFromTemplate(defaultMenu(app, shell)));

  // Should be last, after all listeners and menu

  await app.whenReady();

  await mainWindow.loadURL(localhostUrl + "/");

  registerIPCHandlers();

  nativeTheme.on("updated", changeTheme);
  // console.log("[APP] Loaded", localhostUrl);
};

const changeTheme = () => {
  if(process.platform === "darwin")return;
  if (!mainWindow) return;
  if (nativeTheme.themeSource?.includes("dark")) {
    mainWindow.setTitleBarOverlay(themes.dark);
  } else if (nativeTheme.themeSource?.includes("light")) {
    mainWindow.setTitleBarOverlay(themes.light);
  } else if (nativeTheme.themeSource?.includes("system")) {
    mainWindow.setTitleBarOverlay(
      nativeTheme.shouldUseDarkColors ? themes.dark : themes.light,
    );
  }
};

ipcMain.handle("app-db-path", () => {
  return dbPath;
});

ipcMain.handle("update-theme", (_: any, theme: string) => {
  if (theme?.includes("dark")) {
    nativeTheme.themeSource = "dark";
  } else if (theme?.includes("light")) {
    nativeTheme.themeSource = "light";
  } else {
    nativeTheme.themeSource = "system";
  }
});

ipcMain.handle("open-select-dir", async (_any: any, path: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    defaultPath: path || app.getPath("downloads"),
  });
  return result;
});

ipcMain.handle("save-file", async (_any: any, data: any, path: string) => {
  if (!mainWindow) return null;
  if (!path) return { success: false, error: "No path provided" };

  // Check if file exists and if file doesn't exist, create it
  try {
    // Check if the file exists
    const fileExists = await fs.promises
      .access(path, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false);

    if (!fileExists) {
      // If the file doesn't exist, create it and write data
      await fs.promises.writeFile(path, data);
      return { success: true, error: null };
    }

    // If the file exists, use a writable stream to overwrite the file
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(path);

      writer.on("finish", () => resolve({ success: true, error: null }));
      writer.on("error", (err) =>
        reject({ success: false, error: err.message }),
      );

      writer.end(data);
    });
  } catch (error: any) {
    console.error("Error saving file:", error);
    return { success: false, error: error.message || "Failed to save file" };
  }
});

app.on("ready", createWindow);

app.on("window-all-closed", () => app.quit()); // if (process.platform !== 'darwin')

app.on(
  "activate",
  () =>
    BrowserWindow.getAllWindows().length === 0 && !mainWindow && createWindow(),
);
