import "dotenv/config";

// Suppress gramJS/telegram library logging
if (typeof window === "undefined") {
  const originalLog = console.log;
  console.log = function (...args: any[]) {
    const message = args.join(" ");
    if (
      !message.includes("[INFO]") &&
      !message.includes("gramJS") &&
      !message.includes("Running gramJS") &&
      !message.includes("Connecting to") &&
      !message.includes("Connection to") &&
      !message.includes("Using LAYER")
    ) {
      originalLog.apply(console, args);
    }
  };
}

import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { registerRoutes } from "./routes";
import { addAuthTestRoutes } from "./authTest";
import { createTelegramBot } from "./telegramBot";
import { NotificationAlgorithmService } from "./notificationAlgorithm";
import { seedAdmin } from "./seedAdmin";
import { initializeDatabase } from "./initDb";

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function log(message: string) {
  console.log(message);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------------------------------------------------------
// App setup
// -------------------------------------------------------------------

const app = express();

// Multer config
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "coverImage" || file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  }
});

// Webhooks & parsers
app.use("/api/webhook/paystack", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: false, limit: "50mb" }));

// File uploads
app.use("/api/admin/", upload.any());

// CORS
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true
  })
);

// Cache control
app.use((_req, res, next) => {
  res.header("Cache-Control", "no-cache, no-store, must-revalidate");
  res.header("Pragma", "no-cache");
  res.header("Expires", "0");
  next();
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;

  res.on("finish", () => {
    if (reqPath.startsWith("/api")) {
      const duration = Date.now() - start;
      log(`${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

// -------------------------------------------------------------------
// Main bootstrap
// -------------------------------------------------------------------

(async () => {
  // Telegram bot (safe in production)
  const telegramBot = createTelegramBot();
  if (telegramBot) {
    await telegramBot.testConnection();
  }

  // Routes
  const server = await registerRoutes(app, upload);
  addAuthTestRoutes(app);

  // Initialize database
  try {
    await initializeDatabase();
  } catch (err) {
    console.error("❌ Failed to initialize database:", err);
  }

  // Notification service
  const { storage } = await import("./storage");
  const notificationAlgorithm = new NotificationAlgorithmService(storage);
  notificationAlgorithm.startNotificationScheduler();

  // Seed admin users
  try {
    await seedAdmin();
  } catch (err) {
    console.error("❌ Failed to seed admin users:", err);
  }

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ message: err.message || "Internal Server Error" });
  });

  // -----------------------------------------------------------------
  // Frontend handling
  // -----------------------------------------------------------------

  const distPublicPath = path.resolve(__dirname, "../dist/public");

  if (process.env.NODE_ENV === "development") {
    // Dev only: dynamic Vite import
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    // Production: serve static files
    if (fs.existsSync(distPublicPath)) {
      app.use(express.static(distPublicPath));

      app.get("*", (_req, res) => {
        res.sendFile(path.join(distPublicPath, "index.html"));
      });
    }
  }

  // -----------------------------------------------------------------
  // Start server (Render requires PORT)
  // -----------------------------------------------------------------

  const port = Number(process.env.PORT || 5000);

  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true
    },
    () => {
      log(`✅ Server running on port ${port}`);
    }
  );
})();

// -------------------------------------------------------------------
// Serverless export
// -------------------------------------------------------------------

export async function initAppForServerless() {
  // Telegram bot (safe in production)
  const telegramBot = createTelegramBot();
  if (telegramBot) {
    await telegramBot.testConnection();
  }

  // Routes
  const server = await registerRoutes(app, upload);
  addAuthTestRoutes(app);

  // Initialize database
  try {
    await initializeDatabase();
  } catch (err) {
    console.error("❌ Failed to initialize database:", err);
  }

  // Notification service
  const { storage } = await import("./storage");
  const notificationAlgorithm = new NotificationAlgorithmService(storage);
  notificationAlgorithm.startNotificationScheduler();

  // Seed admin users
  try {
    await seedAdmin();
  } catch (err) {
    console.error("❌ Failed to seed admin users:", err);
  }

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ message: err.message || "Internal Server Error" });
  });

  return app;
}
