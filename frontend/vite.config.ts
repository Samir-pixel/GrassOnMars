import { defineConfig } from "vite";

// index.html is the designer's page. It reaches the backend through /api on its own origin
// (public/marswalk-api.js), so the browser needs no CORS and the backend stays on localhost.
const proxy = {
  "/api": { target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4781", changeOrigin: true },
};
// Localhost only by default: the proxy would otherwise expose the API to the whole network.
const host = process.env.VITE_HOST ?? "127.0.0.1";
const port = Number(process.env.FRONTEND_PORT ?? 4780);

export default defineConfig({
  // Public tunnel/proxy host for the deployed preview (Vite blocks unknown Host headers by default).
  server: { host, port, proxy, allowedHosts: ["grassonmars.myspaceproject.app"] },
  preview: { host, port: Number(process.env.FRONTEND_PREVIEW_PORT ?? 4783), proxy, allowedHosts: ["grassonmars.myspaceproject.app"] },
});
