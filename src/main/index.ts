import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import fs from "fs";
import path from "path";
import { registerCadHandlers } from "./cad";
import { registerSettingsHandlers } from "./settings";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return win;
}

function buildMenu(win: BrowserWindow): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Export as STL...",
          accelerator: "CmdOrCtrl+Shift+E",
          click: () => win.webContents.send("export-stl"),
        },
        {
          label: "Settings...",
          accelerator: "CmdOrCtrl+,",
          click: () => win.webContents.send("show-settings"),
        },
        { type: "separator" },
        {
          label: "About",
          click: () => win.webContents.send("show-about"),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  registerCadHandlers();
  registerSettingsHandlers();

  // Handle STL save requests from the renderer
  ipcMain.handle(
    "cad:save-stl",
    async (_event, buffer: ArrayBuffer, fileName?: string) => {
      const win = BrowserWindow.getFocusedWindow();
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        title: "Export as STL",
        defaultPath: fileName ?? "model.stl",
        filters: [{ name: "STL", extensions: ["stl"] }],
      });
      if (canceled || !filePath) return false;
      fs.writeFileSync(filePath, Buffer.from(buffer));
      return true;
    },
  );

  const win = createWindow();
  buildMenu(win);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
