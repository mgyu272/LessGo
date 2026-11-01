import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { pathToFileURL } from "node:url";

// npm run dev 에서도 api/ 폴더의 서버 함수(/api/ask, /api/recommend)가 돌아가게 해 주는 작은 플러그인.
// (배포하면 Vercel이 같은 파일을 서버 함수로 실행해요)
function localApi() {
  const attach = (server, load) =>
    server.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith("/api/")) return next();
      const name = req.url.slice(5).split("?")[0];
      if (!/^[a-z-]+$/.test(name)) return next();
      const send = (code, obj) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
      try {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        req.body = raw ? JSON.parse(raw) : {};
        const mod = await load(`/api/${name}.js`);
        await mod.default(req, { status(code) { this.code = code; return this; }, json(obj) { send(this.code || 200, obj); } });
      } catch (e) {
        send(e.code === "ERR_MODULE_NOT_FOUND" ? 404 : 500, { error: e.message });
      }
    });
  return {
    name: "local-api",
    configureServer(server) { attach(server, (p) => server.ssrLoadModule(p)); },
    configurePreviewServer(server) { attach(server, (p) => import(pathToFileURL(path.resolve("." + p)).href)); },
  };
}

export default defineConfig(({ mode }) => {
  // .env.local 의 GEMINI_API_KEY 등을 서버 함수가 읽을 수 있게 (VITE_ 로 시작하지 않는 값은 브라우저로 안 가요)
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return {
    plugins: [react(), localApi()],
    server: { host: true, port: 5173 },
    build: { chunkSizeWarningLimit: 1500 }, // 지도·Supabase 라이브러리 때문에 커요. 경고만 끈 거예요
  };
});
