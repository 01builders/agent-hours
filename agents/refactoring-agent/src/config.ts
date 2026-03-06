import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");

export interface Config {
    githubToken: string;
    repoOwner: string;
    repoName: string;
    geminiApiKey: string;
    rootDir: string;
}

export function loadConfig(): Config {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) throw new Error("GITHUB_TOKEN env var is required");

    const repoOwner = process.env.REPO_OWNER;
    if (!repoOwner) throw new Error("REPO_OWNER env var is required");

    const repoName = process.env.REPO_NAME;
    if (!repoName) throw new Error("REPO_NAME env var is required");

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) throw new Error("GEMINI_API_KEY env var is required");

    return { githubToken, repoOwner, repoName, geminiApiKey, rootDir: ROOT };
}
