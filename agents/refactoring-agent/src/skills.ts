import fs from "fs";
import path from "path";

/**
 * Recursively collect all .md files under a directory, sorted by path.
 */
function collectMarkdownFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectMarkdownFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
            results.push(fullPath);
        }
    }
    return results.sort();
}

/**
 * Loads all .md files from a directory (recursively) and returns their
 * combined content. Each file is wrapped with a header so the LLM knows
 * which skill it's reading.
 */
export function loadSkills(skillsDir: string): string {
    if (!fs.existsSync(skillsDir)) {
        return "";
    }

    const files = collectMarkdownFiles(skillsDir);
    if (files.length === 0) {
        return "";
    }

    return files
        .map((filePath) => {
            const content = fs.readFileSync(filePath, "utf-8").trim();
            const name = path.basename(filePath, ".md");
            return `### Skill: ${name}\n\n${content}`;
        })
        .join("\n\n---\n\n");
}
