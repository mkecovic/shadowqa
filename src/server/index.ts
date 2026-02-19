import express, { type Request, type Response } from "express";
import path from "path";
import router from "./routes.js";
import { closeBrowser } from "../capture/index.js";

const app = express();
const PORT = process.env.PORT || 3000;
const reportsDir = path.resolve(process.cwd(), "reports");

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.resolve(process.cwd(), "src/web")));
// Serve report assets (screenshots) so report HTML can reference them by URL
app.use("/report-assets", express.static(reportsDir));
app.use(router);

// Catch-all 404 — must be after all routes
app.use((req: Request, res: Response) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Page not found — Shadow QA</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }
    .container { text-align: center; padding: 2rem; max-width: 400px; }
    .code { font-size: 5rem; font-weight: 700; background: linear-gradient(135deg, #667eea, #764ba2); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; line-height: 1; margin-bottom: 1rem; }
    h1 { font-size: 1.4rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { color: #94a3b8; margin: 0 0 1.75rem; line-height: 1.6; }
    a { display: inline-block; padding: 0.65rem 1.5rem; background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-decoration: none; border-radius: 8px; font-size: 0.9rem; font-weight: 500; }
    a:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="container">
    <div class="code">404</div>
    <h1>Page not found</h1>
    <p>The page you're looking for doesn't exist.</p>
    <a href="/">Back to Shadow QA</a>
  </div>
</body>
</html>`);
});

const server = app.listen(PORT, () => {
  console.log(`Shadow QA running at http://localhost:${PORT}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await closeBrowser();
  server.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeBrowser();
  server.close();
  process.exit(0);
});
