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
  session,
} from "electron";
import dotenv from "dotenv";
// import { createHandler } from "./handler/index.js";
import { createHandler } from "next-electron-rsc";
import { registerIPCHandlers } from "./customization/menu.js";
import updatePkg from "electron-updater";

const { autoUpdater } = updatePkg;
import { parseConnectionString } from "./helpher/connection-details.js";
import { LocalAppStorePath } from "./config/local-app-store-path.js";

// Load environment variables from .env file
dotenv.config();
const isDev = process.env.NODE_ENV === "development";
const appPath = app.getAppPath();
const localhostUrl = "http://localhost:4080"; // must match Next.js dev server

let mainWindow: BrowserWindow | null;
let stopIntercept: any;
let createInterceptor: any;

const appDataPath = app.getPath("appData");
const configDirectory = path.join(appDataPath, "data-hive-studio");

// Ensure the config directory exists
if (!fs.existsSync(configDirectory)) {
  fs.mkdirSync(configDirectory, { recursive: true });
}

const connectionsJsonPath = path.join(configDirectory);

// create connections.json file if it doesn't exist
if (!fs.existsSync(connectionsJsonPath+LocalAppStorePath.connectionsJsonPath)) {
  fs.writeFileSync(connectionsJsonPath+LocalAppStorePath.connectionsJsonPath, JSON.stringify([]));
}

process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";
process.env["ELECTRON_ENABLE_LOGGING"] = "true";

if(isDev) {
// Enable remote debugging for Chrome DevTools Protocol
app.commandLine.appendSwitch('remote-debugging-port', '9222');
app.commandLine.appendSwitch('remote-allow-origins', '*');
}

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
  const ses = session.defaultSession;

  try {
    const connectionsData = fs.readFileSync(connectionsJsonPath+LocalAppStorePath.connectionsJsonPath, "utf-8");
    const connections = JSON.parse(connectionsData);
    const currentConnection = connections.connections.find((c: any) => c.is_current);

    if (currentConnection) {
      // Set cookies that will be accessible by the renderer process
      const connectionDetails = parseConnectionString(currentConnection.connection_string);
      const dbConfig = {
        id: currentConnection.id,
        name: currentConnection.name || "",
        connection_type: currentConnection.connection_type,
        host: connectionDetails.host || "",
        port: connectionDetails.port || 0,
        username: connectionDetails.user || "",
        password: connectionDetails.password || "",
        database: connectionDetails.database || "",
        connection_string: currentConnection.connection_string,
        color: currentConnection.color || "",
        ssl: connectionDetails.ssl ? { rejectUnauthorized: false } : false,
      };
      await ses.cookies.set({
        url: localhostUrl,
        name: "dbType",
        value: currentConnection.connection_type,
        httpOnly: false,
      });
      await ses.cookies.set({
        url: localhostUrl,
        name: "currentConnection",
        value: JSON.stringify(dbConfig),
        httpOnly: false,
      });
    }
  } catch (error) {
    console.error("Failed to read connections or set cookies:", error);
    // It's okay if the file doesn't exist on first launch
  }

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

  // Check for updates
  autoUpdater.checkForUpdatesAndNotify();

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

// @deprecated
ipcMain.handle("app-db-path", () => {
  return connectionsJsonPath;
});

ipcMain.handle("get-connections-json-path", () => {
  return connectionsJsonPath;
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
    BrowserWindow.getAllWindows().length === 0 && !mainWindow && createWindow()
);
