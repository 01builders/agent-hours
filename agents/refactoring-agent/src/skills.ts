import fs from "fs";
import path from "path";

/**
 * Loads all .md files from a directory and returns their combined content.
 * Each file is wrapped with a header so the LLM knows which skill it's reading.
 */
export function loadSkills(skillsDir: string): string {
    if (!fs.existsSync(skillsDir)) {
        return "";
    }

    const files = fs
        .readdirSync(skillsDir)
        .filter((f) => f.endsWith(".md"))
        .sort();

    if (files.length === 0) {
        return "";
    }

    const parts = files.map((file) => {
        const content = fs.readFileSync(path.join(skillsDir, file), "utf-8").trim();
        const name = path.basename(file, ".md");
        return `### Skill: ${name}\n\n${content}`;
    });

    return parts.join("\n\n---\n\n");
}
