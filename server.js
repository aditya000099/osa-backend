process.on("unhandledRejection", (reason, promise) => {
  console.error("!!!! SERVER ERROR: UNHANDLED PROMISE REJECTION !!!!");
  console.error("Reason:", reason); // Log the reason (often the error object)
});

process.on("uncaughtException", (error, origin) => {
  console.error("!!!! SERVER ERROR: UNCAUGHT EXCEPTION !!!!");
  console.error("Error:", error);
  console.error("Origin:", origin);
});
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import chatRoutes from "./routes/chat.routes.js"; // Use .js extension

import { initializeAgent } from "./services/agent.service.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(
  cors({
    origin: "https://osa-frontend-iota.vercel.app",
    methods: ["GET", "POST"],
    credentials: true,
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
