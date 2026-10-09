import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// 開發伺服器預設只綁 127.0.0.1：它會把 /api 轉給本機核心，開放到區網等於讓別人讀寫角色資料。
// 確定要從其他裝置或自訂主機名稱開啟時，在 .env.local 設定 AIDOL_DEV_HOST 與 AIDOL_DEV_ALLOWED_HOSTS（以逗號分隔）。
const devEnv = loadEnv("development", process.cwd(), "AIDOL_");
const devHost = devEnv.AIDOL_DEV_HOST || "127.0.0.1";
const devAllowedHosts = (devEnv.AIDOL_DEV_ALLOWED_HOSTS || "")
  .split(",").map((host) => host.trim()).filter(Boolean);

export default defineConfig({
  build: {
    outDir: "dist/client",
    rollupOptions: { output: { manualChunks: { flow: ["@xyflow/react"], yaml: ["yaml"] } } },
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: devHost,
    allowedHosts: devAllowedHosts,
    proxy: { "/api": "http://127.0.0.1:4318" },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});
