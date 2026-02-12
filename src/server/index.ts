import express from "express";
import path from "path";
import router from "./routes.js";
import { closeBrowser } from "../capture/index.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), "src/web")));
app.use(router);

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
