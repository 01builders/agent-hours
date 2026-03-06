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

    const entries = fs
        .readdirSync(skillsDir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .sort((a, b) => a.name.localeCompare(b.name));

    if (entries.length === 0) {
        return "";
    }

    const parts = entries.map((entry) => {
        const fullPath = path.join(entry.parentPath ?? (entry as any).path ?? skillsDir, entry.name);
        const content = fs.readFileSync(fullPath, "utf-8").trim();
        const name = path.basename(entry.name, ".md");
        return `### Skill: ${name}\n\n${content}`;
    });

    return parts.join("\n\n---\n\n");
}
