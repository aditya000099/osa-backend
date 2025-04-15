import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
// Import specific message types, including BaseMessage for type checking if needed
import { AIMessage, HumanMessage, BaseMessage } from "@langchain/core/messages";
import { chatModel } from "../config.js"; // Use .js extension
import { GitHubRepoSearchTool } from "../tools/githubRepoSearchTool.js";
import { GitHubIssueSearchTool } from "../tools/githubIssueSearchTool.js";

import { saveToMemory, retrieveFromMemory } from "./memory.service.js"; // <-- IMPORT THIS
import { GitHubProfileTool } from "../tools/githubProfileTool.js";

// Add CircuitBreaker implementation
class CircuitBreaker {
  constructor() {
    this.failures = 0;
    this.lastFailure = null;
    this.state = "CLOSED"; // CLOSED, OPEN, HALF_OPEN
    this.threshold = 5;
    this.timeout = 30000; // 30 seconds
  }

  async execute(fn) {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailure > this.timeout) {
        this.state = "HALF_OPEN";
      } else {
        throw new Error("Circuit breaker is OPEN");
      }
    }

    try {
      const result = await fn();
      if (this.state === "HALF_OPEN") {
        this.state = "CLOSED";
        this.failures = 0;
      }
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailure = Date.now();
      if (this.failures >= this.threshold) {
        this.state = "OPEN";
      }
      throw error;
    }
  }
}

// Add proper error handling utility
const isRetryableError = (error) => {
  if (!error) return false;

  // Specific error patterns that are safe to retry
  const retryablePatterns = [
    "failed to parse stream",
    "network error",
    "timeout",
    "rate limit",
    "429", // Rate limit status code
    "503", // Service unavailable
    "504", // Gateway timeout
  ];

  const errorMessage = error.message?.toLowerCase() || "";
  return retryablePatterns.some((pattern) => errorMessage.includes(pattern));
};

// Initialize circuit breaker
const circuitBreaker = new CircuitBreaker();

// Add utility to convert Zod schema to Gemini parameters
function zodToGeminiParameters(zodSchema) {
  if (!zodSchema?._def?.shape) {
    throw new Error("Invalid Zod schema provided");
  }

  const shape = zodSchema._def.shape;
  const properties = {};
  const required = [];

  for (const [key, value] of Object.entries(shape)) {
    // Handle basic types
    let type = "string"; // default type
    let enumValues;
    let description = value.description;

    switch (value._def.typeName) {
      case "ZodString":
        type = "string";
        break;
      case "ZodNumber":
        type = "number";
        break;
      case "ZodBoolean":
        type = "boolean";
        break;
      case "ZodEnum":
        type = "string";
        enumValues = value._def.values;
        break;
    }

    // Build property definition
    properties[key] = {
      type,
      description,
      ...(enumValues && { enum: enumValues }),
    };

    // Check if required (not optional and not nullable)
    if (!value._def.isOptional) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    required,
  };
}

// Manual function declarations for Gemini
const functionDeclarations = [
  {
    name: "github_repo_search",
    description: "Search for GitHub repositories by name or keywords",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Repository name or search keywords (e.g., 'gumroad', 'react')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "github_issue_search",
    description:
      "Search for issues in a GitHub repository using just the repository name",
    parameters: {
      type: "object",
      properties: {
        repository: {
          type: "string",
          description: "Just the repository name (e.g., 'gumroad', 'react')",
        },
      },
      required: ["repository"],
    },
  },
];

// Initialize tools with instances
const toolInstances = [
  new GitHubRepoSearchTool(),
  new GitHubIssueSearchTool(),
  new GitHubProfileTool(),
];

// Cache the agent executor
let agentExecutor = null;

export async function initializeAgent() {
  if (agentExecutor) return agentExecutor;

  console.log("Initializing agent with Gemini function calling...");

  // Configure the model with tools
  const configuredModel = chatModel.bind({
    tools: [{ functionDeclarations }],
  });

  // Create simplified prompt template
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are an AI GitHub assistant that helps find repositories and issues.

IMPORTANT: 
- When listing repositories, always include the repository link in markdown format like [owner/repo]
- Present repositories with their full names and URLs
- Include relevant statistics like stars and forks
- Format repository names consistently as [owner/repo]

Example response:
"Here's a popular JavaScript repository: [facebook/react] with over 200k stars..."

Remember to search and provide real-time information using the tools!`,
    ],
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  // Create agent with simplified configuration
  const agent = await createToolCallingAgent({
    llm: configuredModel,
    tools: toolInstances,
    prompt,
  });

  agentExecutor = new AgentExecutor({
    agent,
    tools: toolInstances,
    verbose: true,
    handleParsingErrors: true,
    maxIterations: 3,
  });

  console.log("✅ Agent Initialized");
  return agentExecutor;
}

const formatHistoryFromMemory = (retrievedDocs) => {
  if (!Array.isArray(retrievedDocs) || retrievedDocs.length === 0) {
    return [];
  }

  const historyMessages = [];

  retrievedDocs.forEach((doc) => {
    const content = doc.pageContent;

    const role = doc.metadata?.role;

    if (role === "human") {
      historyMessages.push(new HumanMessage({ content }));
    } else if (role === "ai") {
      historyMessages.push(new AIMessage({ content }));
    } else {
      console.warn(
        `Unknown role '${role}' in retrieved memory document ID: ${
          doc.metadata?.id || "N/A"
        }. Skipping.`
      );
    }
  });

  return historyMessages;
};

export async function runAgent(input, chatId) {
  const executor = await initializeAgent();
  if (!executor) {
    throw new Error("Agent executor failed to initialize.");
  }

  const effectiveChatId = chatId || `temp_session_${Date.now()}`;

  let lastError = null;
  const maxAttempts = 3;
  let attempts = 0;

  console.log(
    `\n🤖 Running agent with input: "${input}" (Chat ID: ${effectiveChatId})`
  );

  // Retrieve more context for better memory
  const retrievedDocs = await retrieveFromMemory(effectiveChatId, input, 6);
  const formatted_chat_history = formatHistoryFromMemory(retrievedDocs);

  // Enhanced context extraction
  let userContext = {
    name: null,
    skills: new Set(),
    interests: new Set(),
    experienceLevel: null,
  };

  // Analyze history for context
  for (const message of formatted_chat_history) {
    if (message._getType() === "human") {
      // Name extraction
      const nameMatch = message.content.match(
        /my name is (\w+)|i'm (\w+)|i am (\w+)/i
      );
      if (nameMatch) {
        userContext.name = nameMatch[1] || nameMatch[2] || nameMatch[3];
      }

      // Skills extraction
      const skillsMatch = message.content.match(
        /\b(javascript|python|react|node|angular|vue|typescript)\b/gi
      );
      if (skillsMatch) {
        skillsMatch.forEach((skill) =>
          userContext.skills.add(skill.toLowerCase())
        );
      }

      // Experience level extraction
      const expMatch = message.content.match(
        /\b(beginner|intermediate|advanced)\b/i
      );
      if (expMatch) {
        userContext.experienceLevel = expMatch[0].toLowerCase();
      }
    }
  }

  // Modify input with context if relevant
  let agentInput = input;
  if (
    input.toLowerCase().includes("name") ||
    input.toLowerCase().includes("who am i")
  ) {
    agentInput = `(Context: User's name is ${
      userContext.name || "unknown"
    }) ${input}`;
  }

  // Add request timeout
  const timeout = setTimeout(() => {
    throw new Error("Request timeout after 30 seconds");
  }, 30000);

  try {
    while (attempts < maxAttempts) {
      try {
        attempts++;

        const result = await circuitBreaker.execute(async () => {
          // Simplified input structure
          const response = await executor.invoke({
            input: agentInput || "How can I help you?",
          });

          if (!response) {
            throw new Error("No response from agent");
          }

          return response;
        });

        clearTimeout(timeout);

        // Ensure we have an output string
        const output =
          result.output ||
          result.returnValues?.output ||
          "No response generated";

        if (chatId) {
          await saveToMemory(chatId, input, output);
        }

        return output;
      } catch (error) {
        lastError = error;
        console.warn(`Attempt ${attempts}/${maxAttempts} failed:`, {
          errorType: error.constructor.name,
          message: error.message,
          stack: error.stack,
        });

        if (isRetryableError(error) && attempts < maxAttempts) {
          const delay = Math.min(1000 * Math.pow(2, attempts - 1), 10000);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }
  } catch (error) {
    clearTimeout(timeout);
    console.error("All retry attempts failed:", error);
    return `I apologize, but I'm experiencing technical difficulties. Please try again in a moment. (Error: ${error.message})`;
  }
}
