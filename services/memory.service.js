// backend/services/memory.service.js
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { Document } from "@langchain/core/documents";
import {
  supabase,
  GEMINI_EMBEDDING_MODEL,
  SUPABASE_TABLE_NAME,
} from "../config.js";

const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  modelName: GEMINI_EMBEDDING_MODEL,
});
console.log(
  `✅ Memory Service: Initialized Embeddings Model (${GEMINI_EMBEDDING_MODEL})`
);

const vectorStore = new SupabaseVectorStore(embeddings, {
  client: supabase,
  tableName: SUPABASE_TABLE_NAME,
  queryName: "match_documents",
  //   filter: {},
});
console.log(
  `✅ Memory Service: Initialized Supabase Vector Store for table "${SUPABASE_TABLE_NAME}"`
);

export async function saveToMemory(chatId, userInput, aiOutput) {
  if (!chatId || !userInput || !aiOutput) {
    console.warn("Missing required parameters for memory save - skipping");
    return;
  }

  try {
    // Ensure strings and trim excessive length
    const sanitizedInput = String(userInput).slice(0, 1000);
    const sanitizedOutput = String(aiOutput).slice(0, 2000);

    const effectiveUserId = chatId;
    console.log(`🧠 Saving memory for user/chat ${effectiveUserId}...`);
    if (!effectiveUserId || !userInput || !aiOutput) {
      console.warn(
        "⚠️ Attempted to save memory with missing effectiveUserId, userInput, or aiOutput."
      );
      return;
    }

    // Add timestamp for better sorting
    const timestamp = new Date().toISOString();

    // Extract potential context markers
    const contextMarkers = {
      mentionsName: /my name is (\w+)|i'm (\w+)|i am (\w+)/i.test(userInput),
      mentionsSkills: /javascript|python|react|frontend|backend/i.test(
        userInput
      ),
      mentionsInterests:
        /beginner|intermediate|advanced|frontend|backend/i.test(userInput),
    };

    const documents = [
      new Document({
        pageContent: sanitizedInput,
        metadata: {
          role: "human",
          userId: effectiveUserId,
          timestamp,
          ...contextMarkers,
        },
      }),
      new Document({
        pageContent: sanitizedOutput,
        metadata: {
          role: "ai",
          userId: effectiveUserId,
          timestamp,
          respondingTo: userInput.substring(0, 100), // Store first 100 chars of what we're responding to
        },
      }),
    ];
    await vectorStore.addDocuments(documents);
  } catch (error) {
    console.error("Memory save failed but continuing:", error);
    // Don't throw - allow conversation to continue even if memory fails
  }
}

export async function retrieveFromMemory(chatId, currentInput, k = 6) {
  if (!chatId || !currentInput) {
    console.warn("Missing required parameters for memory retrieval");
    return [];
  }

  const effectiveUserId = chatId;
  console.log(
    `🧠 Retrieving memory for user/chat ${effectiveUserId} based on: "${currentInput.substring(
      0,
      50
    )}..."`
  );
  if (!effectiveUserId || !currentInput) {
    console.warn(
      "⚠️ Attempted to retrieve memory with missing effectiveUserId or currentInput."
    );
    return [];
  }

  try {
    // First try to find exact name matches in history
    const nameMatch = currentInput.match(/name|who am i/i);
    let relevantDocs = [];

    if (nameMatch) {
      // If asking about names, prioritize documents where names were mentioned
      relevantDocs = await vectorStore.similaritySearch(currentInput, k, {
        userId: effectiveUserId,
        mentionsName: true,
      });
    }

    // If no name-specific results (or wasn't a name query), do regular search
    if (relevantDocs.length === 0) {
      relevantDocs = await vectorStore.similaritySearch(currentInput, k, {
        userId: effectiveUserId,
      });
    }

    // Sort by timestamp if available
    relevantDocs.sort((a, b) => {
      return (
        new Date(a.metadata?.timestamp || 0) -
        new Date(b.metadata?.timestamp || 0)
      );
    });

    console.log(
      `✅ Retrieved ${relevantDocs.length} relevant documents from memory.`
    );
    return relevantDocs;
  } catch (error) {
    console.error("Memory retrieval failed but continuing:", error);
    return []; // Return empty array to allow conversation to continue
  }
}
