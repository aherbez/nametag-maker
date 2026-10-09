import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import fs from "fs";
import path from "path";
import { registerCadHandlers } from "./cad";
import { registerSettingsHandlers } from "./settings";
import { namesFromCsv } from "../shared/csv";
import type { NameList } from "../shared/types";

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

/** Ask for a CSV and send its names to the renderer as a batch. */
async function loadCsv(win: BrowserWindow): Promise<void> {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "Load names from CSV",
    properties: ["openFile"],
    filters: [{ name: "CSV files", extensions: ["csv", "txt"] }],
  });
  if (canceled || filePaths.length === 0) return;

  const file = filePaths[0];
  let names: string[];
  try {
    names = namesFromCsv(await fs.promises.readFile(file, "utf8"));
  } catch (e) {
    dialog.showErrorBox("Couldn't read CSV", String(e));
    return;
  }
  if (names.length === 0) {
    dialog.showErrorBox(
      "No names found",
      `${path.basename(file)} doesn't contain any names.`,
    );
    return;
  }
  const list: NameList = {
    baseName: path.basename(file, path.extname(file)),
    names,
  };
  win.webContents.send("csv-loaded", list);
}

function buildMenu(win: BrowserWindow): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Load CSV...",
          accelerator: "CmdOrCtrl+O",
          click: () => loadCsv(win),
        },
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

  // Save a batch: one STL per print bed, named <chosen name>_<n>.stl.
  ipcMain.handle(
    "cad:save-stl-batch",
    async (event, buffers: ArrayBuffer[], baseName: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)!;
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: `Export ${buffers.length} print bed${buffers.length === 1 ? "" : "s"} as STL`,
        message: `Files will be saved as <name>_1.stl to <name>_${buffers.length}.stl`,
        defaultPath: `${baseName}.stl`,
        filters: [{ name: "STL", extensions: ["stl"] }],
      });
      if (canceled || !filePath) return false;
      const base = filePath.replace(/\.stl$/i, "");
      await Promise.all(
        buffers.map((buf, i) =>
          fs.promises.writeFile(`${base}_${i + 1}.stl`, Buffer.from(buf)),
        ),
      );
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
