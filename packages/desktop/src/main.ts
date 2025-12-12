import path from "node:path";
import fs from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, Menu } from "electron";

type IndexManager = any;
type Db = any;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = 13001;

function getResourcesDir() {
  if (app.isPackaged) return process.resourcesPath;
  // dev：packages/desktop/dist -> repo root
  return path.resolve(__dirname, "../../");
}

function getWebDir() {
  const base = getResourcesDir();
  return app.isPackaged ? path.join(base, "web") : path.join(base, "packages/web/dist");
}

function getServerDir() {
  const base = getResourcesDir();
  return app.isPackaged ? path.join(base, "server") : path.join(base, "packages/server/dist");
}

function getUserConfigPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function loadConfig(): { rootPath?: string } {
  const p = getUserConfigPath();
  try {
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg: any) {
  const p = getUserConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), "utf-8");
}

async function chooseRootPath(): Promise<string | null> {
  const res = await dialog.showOpenDialog({
    title: "选择航图 PDF 根目录",
    properties: ["openDirectory"]
  });
  if (res.canceled) return null;
  const p = res.filePaths[0];
  return p || null;
}

async function importFrom(serverDir: string, file: string) {
  const abs = path.join(serverDir, file);
  return await import(pathToFileURL(abs).href);
}

async function startBackend(rootPath: string) {
  const serverDir = getServerDir();
  const webDir = getWebDir();

  const { openDb } = await importFrom(serverDir, "sqlite.js");
  const { IndexManager } = await importFrom(serverDir, "indexManager.js");
  const { createServer } = await importFrom(serverDir, "server.js");

  const dbPath = path.join(app.getPath("userData"), "index.sqlite");
  const db: Db = openDb({ dbPath });
  const indexManager: IndexManager = new IndexManager(db);

  const fastifyApp = createServer({
    db,
    rootPath,
    webDistPath: webDir,
    indexManager
  });

  // 默认暴露到局域网
  await fastifyApp.listen({ host: "0.0.0.0", port: DEFAULT_PORT });
  void indexManager.start(rootPath);

  return { url: `http://127.0.0.1:${DEFAULT_PORT}`, fastifyApp };
}

function createWindow(url: string) {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    webPreferences: {
      // 不需要 nodeIntegration，前端是纯 web
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  void win.loadURL(url);
  return win;
}

async function main() {
  await app.whenReady();

  const cfg = loadConfig();
  let rootPath = cfg.rootPath;
  if (!rootPath) {
    rootPath = await chooseRootPath();
    if (!rootPath) {
      app.quit();
      return;
    }
    saveConfig({ ...cfg, rootPath });
  }

  const menu = Menu.buildFromTemplate([
    {
      label: "文件",
      submenu: [
        {
          label: "选择航图目录…",
          click: async () => {
            const p = await chooseRootPath();
            if (!p) return;
            saveConfig({ ...loadConfig(), rootPath: p });
            app.relaunch();
            app.exit(0);
          }
        },
        { type: "separator" },
        { role: "quit", label: "退出" }
      ]
    },
    { role: "editMenu", label: "编辑" },
    { role: "viewMenu", label: "视图" }
  ]);
  Menu.setApplicationMenu(menu);

  const { url } = await startBackend(rootPath);
  createWindow(url);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  app.quit();
});


