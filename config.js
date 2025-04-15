import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createClient } from "@supabase/supabase-js";
import { Octokit } from "@octokit/rest"; // Static import works with ESM

dotenv.config();

// --- Environment Variable Checks ---
const geminiApiKey = process.env.GEMINI_API_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const githubPat = process.env.GITHUB_PAT;

if (!geminiApiKey || !supabaseUrl || !supabaseAnonKey || !githubPat) {
  console.error(
    "FATAL ERROR: Missing one or more required environment variables (Gemini, Supabase, GitHub PAT). Check .env file."
  );
  process.exit(1); // Exit if essential config is missing
}

// --- Initialize Clients ---

// Gemini Client (LangChain)
export const chatModel = new ChatGoogleGenerativeAI({
  apiKey: geminiApiKey,
  model: "gemini-1.5-flash", // Or your preferred model
  temperature: 0.3,
});

// Supabase Client
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Octokit Client (GitHub API)
export const octokit = new Octokit({
  auth: githubPat,
  userAgent: "OpenSourceAdvisorBotJS/1.0",
});

console.log("✅ Config: Initialized Gemini, Supabase, and Octokit.");

// --- Constants ---
// You might still need these later for embeddings/memory
export const GEMINI_EMBEDDING_MODEL = "embedding-001"; // Example
export const SUPABASE_TABLE_NAME = "conversation_memory"; // Example
export const GEMINI_EMBEDDING_DIMENSIONS = 768; // Example (Verify!)
