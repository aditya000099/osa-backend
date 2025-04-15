import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { octokit } from "../config.js";

const GitHubProfileSchema = z.object({
  username: z
    .string()
    .describe("The GitHub username to fetch profile information for"),
});

export class GitHubProfileTool extends StructuredTool {
  schema = GitHubProfileSchema;
  name = "github-profile-search";
  description =
    "Fetches detailed information about a GitHub user profile including their repositories, contributions, and basic information.";

  async _call(arg) {
    const { username } = arg;

    try {
      // Fetch user profile
      const userResponse = await octokit.rest.users.getByUsername({
        username,
      });

      // Fetch user's repositories
      const reposResponse = await octokit.rest.repos.listForUser({
        username,
        sort: "updated",
        per_page: 5,
      });

      const user = userResponse.data;
      const repos = reposResponse.data;

      return {
        profile: {
          login: user.login,
          name: user.name,
          bio: user.bio,
          company: user.company,
          blog: user.blog,
          location: user.location,
          email: user.email,
          twitter_username: user.twitter_username,
          public_repos: user.public_repos,
          followers: user.followers,
          following: user.following,
          created_at: user.created_at,
        },
        top_repositories: repos.map((repo) => ({
          name: repo.name,
          description: repo.description,
          stars: repo.stargazers_count,
          language: repo.language,
          url: repo.html_url,
        })),
      };
    } catch (error) {
      console.error("Profile fetch error:", error);
      return `Error fetching profile for ${username}: ${error.message}`;
    }
  }
}
