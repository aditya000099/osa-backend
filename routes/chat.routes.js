// backend/routes/chat.routes.js
import express from "express";
import { runAgent } from "../services/agent.service.js";

const router = express.Router();

// Add OPTIONS handling for preflight requests
router.options("/", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Max-Age", "86400");
  res.sendStatus(200);
});

router.post("/", async (req, res) => {
  // Add CORS headers for the actual request
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  try {
    // --> Make sure 'chatId' comes from the request body <--
    const { message, chatId } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: 'Bad Request: "message" is required and must be a string.',
      });
    }
    // Add validation for chatId if required (e.g., must be string)
    if (chatId && typeof chatId !== "string") {
      return res
        .status(400)
        .json({ error: 'Bad Request: "chatId" must be a string if provided.' });
    }

    console.log(
      `Received message: "${message}" for chatId: ${chatId ?? "None Provided"}`
    );

    // Pass both message and chatId to the agent service
    const agentResponse = await runAgent(message, chatId);

    res.status(200).json({ response: agentResponse });
  } catch (error) {
    console.error("Error in POST /api/chat:", error);
    // Avoid sending response if headers already sent
    if (!res.headersSent) {
      res
        .status(500)
        .json({ error: "Internal Server Error", details: error.message });
    }
  }
});

export default router;
