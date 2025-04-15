import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { octokit } from "../config.js";
import axios from "axios";

const GitHubIssueSearchSchema = z.object({
  repository: z
    .string()
    .describe("Repository name or search term (e.g., 'react' or 'vite')"),
  labels: z
    .string()
    .optional()
    .describe(
      "Optional comma-separated issue labels (e.g., 'good first issue,bug')"
    ),
  state: z
    .enum(["open", "closed", "all"])
    .optional()
    .describe("Issue state filter (defaults to open)"),
});

export class GitHubIssueSearchTool extends StructuredTool {
  name = "github_issue_search";
  schema = GitHubIssueSearchSchema;
  description =
    "Search for issues in GitHub repositories using smart repository search";
  conversationContext = [];
  maxContextMessages = 2;

  constructor() {
    super();
    this.initializeContext();
  }

  initializeContext() {
    this.conversationContext = [];
  }

  updateContext(message) {
    this.conversationContext.push({
      timestamp: new Date(),
      message: message,
    });

    if (this.conversationContext.length > this.maxContextMessages) {
      this.conversationContext.shift();
    }
  }

  async findRepository(repoName) {
    try {
      repoName = repoName
        .replace("https://github.com/", "")
        .replace("github.com/", "")
        .toLowerCase()
        .trim();

      if (repoName.includes("/")) {
        const [owner, repo] = repoName.split("/");
        try {
          await octokit.rest.repos.get({ owner, repo });
          return repoName;
        } catch (error) {
          console.log("Direct lookup failed, trying search...");
        }
      }

      const searchStrategies = [
        async () => {
          const response = await octokit.rest.search.repos({
            q: `${repoName} in:name`,
            sort: "stars",
            order: "desc",
            per_page: 5,
          });
          return response.data.items;
        },
        async () => {
          const response = await octokit.rest.search.repos({
            q: `org:${repoName}`,
            sort: "stars",
            order: "desc",
            per_page: 5,
          });
          return response.data.items;
        },
        async () => {
          const response = await octokit.rest.search.repos({
            q: `${repoName} in:name,description`,
            sort: "stars",
            order: "desc",
            per_page: 5,
          });
          return response.data.items;
        },
      ];

      for (const strategy of searchStrategies) {
        try {
          const items = await strategy();
          if (items && items.length > 0) {
            const bestMatch = items[0];
            console.log(`Found repository: ${bestMatch.full_name}`);
            return bestMatch.full_name;
          }
        } catch (error) {
          console.log("Search strategy failed, trying next...");
          continue;
        }
      }

      throw new Error(`Could not find repository matching "${repoName}"`);
    } catch (error) {
      if (error.status === 404) {
        throw new Error(
          `Repository '${repoName}' not found. Please check the name and try again.`
        );
      }
      if (error.status === 403) {
        throw new Error(`API rate limit exceeded. Please try again later.`);
      }
      throw new Error(`Error searching for repository: ${error.message}`);
    }
  }

  async _call(arg) {
    console.log(`Tool [${this.name}] context:`, this.conversationContext);

    this.updateContext({
      type: "input",
      content: arg,
    });

    console.log(`Tool [${this.name}] called with args:`, arg);

    try {
      const validation = this.schema.safeParse(arg);
      if (!validation.success) {
        return `Error: Invalid input format for ${this.name}: ${validation.error.message}`;
      }

      const { repository, labels, state } = arg;
      const fullRepoPath = await this.findRepository(repository);
      console.log(`Found repository: ${fullRepoPath}`);

      validation.data.repository = fullRepoPath;

      const [owner, repo] = fullRepoPath.split("/");

      const perPage = 10;

      console.log(
        `--> Searching issues in ${owner}/${repo}, Labels: ${labels}, State: ${state}`
      );

      try {
        const response = await octokit.rest.issues.listForRepo({
          owner: owner,
          repo: repo,
          state: state,
          labels: labels,
          per_page: perPage,
          page: 1,
          sort: "updated",
          direction: "desc",
        });

        console.log(
          `--> GitHub API Response Status (Issues): ${response.status}`
        );

        if (response.status !== 200) {
          const errorMsg = `Error fetching issues: Received status ${
            response.status
          } from GitHub API for repo ${repository}. Body: ${JSON.stringify(
            response.data
          )}`;
          console.error(errorMsg);
          if (response.status === 404) {
            return `Error: Repository '${repository}' not found or not accessible.`;
          }
          return errorMsg;
        }

        const issues = response.data;
        const onlyIssues = issues.filter((item) => !item.pull_request);

        console.log(
          `--> Found ${onlyIssues.length} issues (filtered from ${issues.length} items).`
        );

        if (!onlyIssues || onlyIssues.length === 0) {
          let msg = `No issues found in '${repository}'`;
          if (state) msg += ` with state '${state}'`;
          if (labels) msg += ` matching labels '${labels}'`;
          return msg + ".";
        }

        const formattedResults = onlyIssues
          .map((issue, index) => {
            const issueUrl = `https://github.com/${owner}/${repo}/issues/${issue.number}`;
            return (
              `${index + 1}. **${issue.title}**\n` +
              `   Link: [${issueUrl}]\n` +
              `   State: ${issue.state}\n` +
              `   Author: ${issue.user?.login || "N/A"}\n` +
              `   Labels: ${
                issue.labels
                  .map((label) =>
                    typeof label === "string" ? label : label.name
                  )
                  .join(", ") || "None"
              }\n` +
              `   Created: ${new Date(
                issue.created_at
              ).toLocaleDateString()}\n` +
              `   Updated: ${new Date(issue.updated_at).toLocaleDateString()}`
            );
          })
          .join("\n\n---\n\n");

        const directLinks = onlyIssues
          .map((issue, index) => {
            const issueUrl = `https://github.com/${owner}/${repo}/issues/${issue.number}`;
            return `${index + 1}. [${issueUrl}]`;
          })
          .join("\n");

        const finalOutput = `Found ${onlyIssues.length} issues matching your criteria:\n\n${formattedResults}\n\nQuick Links:\n${directLinks}`;

        if (!formattedResults || formattedResults.trim() === "") {
          console.error(
            "!!! ERROR: formattedResults string is empty after mapping issues!"
          );
          return "Error: Failed to format issue results.";
        }

        this.updateContext({
          type: "output",
          content: finalOutput,
        });

        return finalOutput;
      } catch (error) {
        console.error(`!!! CATCH BLOCK ERROR in tool [${this.name}]:`, error);
        let errorMessage = `An unexpected error occurred while searching issues in ${repository}.`;
        if (error.status === 404) {
          errorMessage = `Error: Repository '${repository}' not found or not accessible via listForRepo.`;
        } else if (error.response) {
          errorMessage = `GitHub API Error (${error.status || "N/A"}): ${
            error.response?.data?.message || error.message
          }`;
        } else if (error.message) {
          errorMessage = `Error processing issue search: ${error.message}`;
        }

        this.updateContext({
          type: "error",
          content: errorMessage,
        });

        return errorMessage;
      }
    } catch (error) {
      console.error(`!!! CATCH BLOCK ERROR in tool [${this.name}]:`, error);
      let errorMessage = `An unexpected error occurred while searching issues in ${repository}.`;
      if (error.status === 404) {
        errorMessage = `Error: Repository '${repository}' not found or not accessible via listForRepo.`;
      } else if (error.response) {
        errorMessage = `GitHub API Error (${error.status || "N/A"}): ${
          error.response?.data?.message || error.message
        }`;
      } else if (error.message) {
        errorMessage = `Error processing issue search: ${error.message}`;
      }

      this.updateContext({
        type: "error",
        content: errorMessage,
      });

      return errorMessage;
    }
  }
}
