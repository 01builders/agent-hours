import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeListPrsTool } from "../list-prs.js";

function mockOctokit(prs: object[]) {
    return {
        rest: {
            pulls: {
                list: vi.fn().mockResolvedValue({ data: prs }),
            },
        },
    } as any;
}

describe("makeListPrsTool", () => {
    const since = "2024-01-01T00:00:00.000Z";

    it("returns merged PRs since the given timestamp", async () => {
        const prs = [
            { number: 42, title: "feat: add thing", body: "desc", merged_at: "2024-06-01T12:00:00Z", user: { login: "alice" }, html_url: "https://github.com/r/p/42" },
            { number: 43, title: "chore: old", body: "", merged_at: "2023-01-01T00:00:00Z", user: { login: "bob" }, html_url: "https://github.com/r/p/43" },
        ];
        const tool = makeListPrsTool(mockOctokit(prs), "owner", "repo", since);
        const result = await tool.execute("id1", {}, undefined);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].number).toBe(42);
    });

    it("returns a message when no PRs are found", async () => {
        const tool = makeListPrsTool(mockOctokit([]), "owner", "repo", since);
        const result = await tool.execute("id2", {}, undefined);
        expect(result.content[0].text).toContain("No merged PRs found");
    });

    it("excludes unmerged PRs", async () => {
        const prs = [
            { number: 99, title: "open pr", body: "", merged_at: null, user: { login: "alice" }, html_url: "url" },
        ];
        const tool = makeListPrsTool(mockOctokit(prs), "owner", "repo", since);
        const result = await tool.execute("id3", {}, undefined);
        expect(result.content[0].text).toContain("No merged PRs found");
    });
});
