process.on("unhandledRejection", (reason, promise) => {
  console.error("!!!! SERVER ERROR: UNHANDLED PROMISE REJECTION !!!!");
  console.error("Reason:", reason);
});

process.on("uncaughtException", (error, origin) => {
  console.error("!!!! SERVER ERROR: UNCAUGHT EXCEPTION !!!!");
  console.error("Error:", error);
  console.error("Origin:", origin);
});
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import chatRoutes from "./routes/chat.routes.js";

import { initializeAgent } from "./services/agent.service.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Single CORS configuration
app.use(
  cors({
    origin: [
      "https://osa-frontend-iota.vercel.app",
      "https://osa-web.vercel.app",
      "*",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
    ],
    exposedHeaders: ["Content-Range", "X-Content-Range"],
    // credentials: true,
    optionsSuccessStatus: 200,
    preflightContinue: false,
    maxAge: 86400, // 24 hours
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  res.send("JS Backend server is running!");
});

app.use("/api/chat", chatRoutes);

app.listen(port, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:${port}`);

  initializeAgent().catch((err) => {
    console.error("Initial agent load failed on startup:", err);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: "Something went wrong!",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});
