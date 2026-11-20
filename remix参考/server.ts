import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { MarketEngine } from "./src/server/engine/MarketEngine.js";

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  app.use(express.json());

  const engine = new MarketEngine();
  engine.start();

  // SSE Clients
  let clients: any[] = [];
  
  engine.on('state_update', (state) => {
     const data = `data: ${JSON.stringify({ type: 'state', data: state })}\n\n`;
     clients.forEach(client => client.write(data));
  });

  engine.on('alert', (alert) => {
     const data = `data: ${JSON.stringify({ type: 'alert', data: alert })}\n\n`;
     clients.forEach(client => client.write(data));
  });

  app.get("/api/stream", (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients.push(res);
    
    // Initial payload
    const data = `data: ${JSON.stringify({ type: 'state', data: Array.from(engine.state.values()) })}\n\n`;
    res.write(data);

    req.on('close', () => {
      clients = clients.filter(client => client !== res);
    });
  });

  app.get("/api/config", (req, res) => {
     res.json(engine.config);
  });

  app.post("/api/config", (req, res) => {
     engine.updateConfig(req.body);
     res.json(engine.config);
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
