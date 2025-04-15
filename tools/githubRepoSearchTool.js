import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { octokit } from "../config.js"; // Use .js extension for local imports

// Define the input schema using Zod
const GitHubRepoSearchSchema = z.object({
  query: z.string().describe("Repository name or search keywords"),
  language: z.string().optional().describe("Programming language filter"),
  sort: z
    .enum(["stars", "forks", "help-wanted-issues", "updated"])
    .optional()
    .describe("Sort criteria"),
  beginnerFriendly: z
    .boolean()
    .optional()
    .describe("Filter for beginner-friendly repositories"),
});

// Create the custom Tool class
export class GitHubRepoSearchTool extends StructuredTool {
  // Assign the schema for LangChain to use
  schema = GitHubRepoSearchSchema;

  // Unique identifier for the tool
  name = "github_repo_search"; // Consistent naming

  // Description tells the Agent what this tool does
  description = `Search for GitHub repositories using names or keywords`;

  // The core logic of the tool
  async _call(arg) {
    // No need for explicit type arg in JS here
    console.log(`Tool [${this.name}] called with args:`, arg);

    try {
      // Validate input against schema (optional but good practice)
      const validation = this.schema.safeParse(arg);
      if (!validation.success) {
        return `Error: Invalid input format for ${this.name}: ${validation.error.message}`;
      }
      const { query, language, beginnerFriendly } = validation.data;
      // Apply default sort logic *inside* the tool
      const sort = validation.data.sort ?? "stars";
      const perPage = 5; // Limit results

      console.log(
        `--> Query: ${query}, Language: ${language}, Sort: ${sort}, BeginnerFriendly: ${beginnerFriendly}, PerPage: ${perPage}`
      );

      // 'octokit' is imported directly from config.js
      let q = query;
      if (language) {
        q += ` language:${language}`;
      }

      // Add beginner-friendly terms if requested
      if (beginnerFriendly === true) {
        q += " good-first-issues:>0";
      }

      console.log(`--> Constructed GitHub Query: ${q}`);

      const response = await octokit.rest.search.repos({
        q: q,
        sort: sort,
        order: "desc",
        per_page: perPage,
        page: 1,
      });

      console.log(`--> GitHub API Response Status: ${response.status}`);

      if (response.status !== 200) {
        const errorMsg = `Error: Received status ${
          response.status
        } from GitHub API. Body: ${JSON.stringify(response.data)}`;
        console.error(errorMsg);
        return errorMsg;
      }

      const items = response.data.items;
      console.log(`--> Found ${items?.length ?? 0} items from GitHub API.`);

      if (!items || items.length === 0) {
        return "No repositories found matching your criteria.";
      }

      // Improved formatting with markdown links
      const formattedResults = items
        .map(
          (repo, index) =>
            `${index + 1}. **${repo.full_name || "N/A"}**\n` +
            `   Link: [${repo.html_url}]\n` +
            `   Description: ${
              repo.description || "No description available"
            }\n` +
            `   Stars: ${repo.stargazers_count?.toLocaleString() ?? "N/A"}\n` +
            `   Forks: ${repo.forks_count?.toLocaleString() ?? "N/A"}\n` +
            `   Language: ${repo.language || "N/A"}\n` +
            `   Last Updated: ${
              new Date(repo.updated_at).toLocaleDateString() || "N/A"
            }`
        )
        .join("\n\n---\n\n");

      // Include a direct link section with markdown formatting
      const directLinks = items
        .map((repo, index) => `${index + 1}. [${repo.full_name}]`)
        .join("\n");

      const finalOutput = `Found ${items.length} repositories matching your criteria:\n\n${formattedResults}\n\nQuick Links:\n${directLinks}`;
      return finalOutput;
    } catch (error) {
      // Catch errors during API call or processing
      console.error(`!!! CATCH BLOCK ERROR in tool [${this.name}]:`, error);
      let errorMessage =
        "An unexpected error occurred while searching GitHub repositories.";
      if (error.response) {
        // Octokit error structure
        errorMessage = `GitHub API Error (${error.status || "N/A"}): ${
          error.response?.data?.message || error.message
        }`;
      } else if (error.message) {
        errorMessage = `Error processing GitHub search: ${error.message}`;
      }
      return errorMessage; // Return the error message string
    }
  }
}
