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
} from "electron";
// import { createHandler } from "./handler/index.js";
import { seedDataIntoDB } from "./seed/seed-appDb.js";
import { createHandler } from "next-electron-rsc";

const isDev = process.env.NODE_ENV === "development";
const appPath = app.getAppPath();
const localhostUrl = "http://localhost:4080"; // must match Next.js dev server

let mainWindow: any;
let stopIntercept: any;
let createInterceptor: any;

const appDataPath = app.getPath("appData");
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
    icon: path.join(appPath, "public/icon.png"),
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
    icon: path.join(appPath, "public/icon.png"),
    title: "Data Hive Studio",
    show: false,
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

  mainWindow.once("ready-to-show", () => {
    splashScreen.close();
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
  // mainWindow.loadFile(splashScreenPath);

  nativeTheme.on("updated", () => {
    if (nativeTheme.themeSource?.includes("dark")) {
      mainWindow?.setBackgroundColor("#24292e");
    }
  });
  // console.log("[APP] Loaded", localhostUrl);
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
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    defaultPath: path || app.getPath("downloads"),
  });
  return result;
});

app.on("ready", createWindow);

app.on("window-all-closed", () => app.quit()); // if (process.platform !== 'darwin')

app.on(
  "activate",
  () =>
    BrowserWindow.getAllWindows().length === 0 && !mainWindow && createWindow(),
);

const exampleMenuTemplate = [
  {
    label: "Simple O&ptions",
    submenu: [
      {
        label: "Quit",
        click: () => app.quit(),
      },
      {
        label: "Radio1",
        type: "radio",
        checked: true,
      },
      {
        label: "Radio2",
        type: "radio",
      },
    ],
  },
];
