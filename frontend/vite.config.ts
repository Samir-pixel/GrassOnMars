import { defineConfig } from "vite";

// index.html is the designer's page. It reaches the backend through /api on its own origin
// (public/marswalk-api.js), so the browser needs no CORS and the backend stays on localhost.
const proxy = {
  "/api": { target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8000", changeOrigin: true },
};
// Localhost only by default: the proxy would otherwise expose the API to the whole network.
const host = process.env.VITE_HOST ?? "127.0.0.1";

export default defineConfig({
  server: { host, port: 5173, proxy },
  preview: { host, port: 4173, proxy },
});
