export const menus = [
  {
    label: "view",
    submenu: [
      {
        label: "Reload",
        shortcut: "CmdOrCtrl+R",
        onClick: "reloadWindow",
      },
      {
        label: "Toggle Developer Tools",
        shortcut: "CmdOrCtrl+Shift+I",
        onClick: "toggleDevTools",
      },
    ],
  },
  {
    label: "window",
    submenu: [
      {
        label: "minimize",
        shortcut: "CmdOrCtrl+M",
        onClick: "minimizeWindow",
      },
      {
        label: "close",
        onClick: "closeWindow",
      },
    ],
  },
];
