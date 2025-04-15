process.on("unhandledRejection", (reason, promise) => {
  console.error("!!!! SERVER ERROR: UNHANDLED PROMISE REJECTION !!!!");
  console.error("Reason:", reason); // Log the reason (often the error object)
  // Avoid logging the promise itself unless necessary, can be huge
  // console.error('Promise:', promise);
  // IMPORTANT: In a production scenario, you might log more details,
  // send an alert, or decide if a graceful shutdown is needed for
  // certain types of unhandled rejections. For now, logging is key.
});

process.on("uncaughtException", (error, origin) => {
  console.error("!!!! SERVER ERROR: UNCAUGHT EXCEPTION !!!!");
  console.error("Error:", error);
  console.error("Origin:", origin); // 'uncaughtException' or 'unhandledRejection'
  // According to Node.js docs, after an uncaught exception, the application
  // is in an undefined state and attempting to resume normally is unsafe.
  // Best practice is usually to log and exit gracefully.
  // For development or if you accept the risk, you might just log it.
  // Consider uncommenting exit for production robustness:
  // console.error('Exiting process due to uncaught exception...');
  // process.exit(1);
});
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import chatRoutes from "./routes/chat.routes.js"; // Use .js extension
// Import the initializer if you want to pre-load the agent
import { initializeAgent } from "./services/agent.service.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors()); // Enable CORS (configure appropriately for production)
app.use(express.json()); // Parse JSON request bodies

// --- Routes ---
app.get("/", (req, res) => {
  res.send("JS Backend server is running!");
});

// Mount chat API routes
app.use("/api/chat", chatRoutes);

// --- Start Server ---
app.listen(port, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:${port}`);

  // Optional: Initialize agent on startup (non-blocking)
  initializeAgent().catch((err) => {
    console.error("Initial agent load failed on startup:", err);
    // Decide if server should exit if agent fails to load initially
    // process.exit(1);
  });
});
