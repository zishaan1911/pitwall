import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const DATA = fileURLToPath(new URL("../data", import.meta.url));

/** `npm run dev:static`: serve the bundles written by `pitwall.export` at /data. */
function serveData(): Plugin {
  return {
    name: "pitwall-data",
    configureServer(server) {
      server.middlewares.use("/data", (req, res) => {
        const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^[\\/]+/, "");
        const file = join(DATA, rel);
        if (!file.startsWith(DATA) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        createReadStream(file).pipe(res);
      });
    },
  };
}

// `npm run dev` proxies /api to the FastAPI backend on :8000.
export default defineConfig({
  plugins: [react(), serveData()],
  base: "./",
  server: {
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
