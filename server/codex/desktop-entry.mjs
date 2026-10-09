// Bun 的單一執行檔會讓各 module 的 import.meta.url 指到同一入口。
// 先關閉被匯入模組的 CLI 自動執行，再載入，避免啟動第二台 server 或意外安裝 skill。
process.env.AIDOL_SKIP_HTTP_AUTOSTART = '1';
process.env.AIDOL_SKIP_SKILL_AUTOINSTALL = '1';
const { startServer } = await import('../http.mjs');
const { registerCodexRoutes } = await import('../integrations.mjs');

let integration;
const { server } = await startServer({ staticDir: process.env.AIDOL_STATIC_DIR || process.env.AIDOL_CLIENT_DIR, registerIntegrations(app, store) { integration = registerCodexRoutes(app, store); return integration; } });

const shutdown = () => {
  integration?.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
