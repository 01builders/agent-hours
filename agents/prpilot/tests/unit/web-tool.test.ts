import { describe, expect, it, vi } from "vitest";

const createBashTool = vi.fn();

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createBashTool,
}));

const { createWebTool } = await import("../../src/agent/web-tool.js");

describe("createWebTool", () => {
  it("creates a tool named web with lynx description", () => {
    createBashTool.mockReturnValue({
      name: "bash",
      label: "bash",
      description: "bash desc",
      parameters: {},
      execute: vi.fn(),
    });

    const tool = createWebTool("/workspace");

    expect(tool.name).toBe("web");
    expect(tool.label).toBe("web");
    expect(tool.description).toContain("lynx");
  });

  it("allows lynx commands via spawnHook", () => {
    let capturedHook: ((ctx: any) => any) | undefined;
    createBashTool.mockImplementation((_cwd: string, opts: any) => {
      capturedHook = opts?.spawnHook;
      return { name: "bash", label: "bash", description: "", parameters: {}, execute: vi.fn() };
    });

    createWebTool("/workspace");
    expect(capturedHook).toBeDefined();

    // lynx should pass
    const ctx = { command: 'lynx -dump "https://example.com"', cwd: "/workspace", env: {} };
    expect(() => capturedHook!(ctx)).not.toThrow();
  });

  it("blocks non-lynx commands via spawnHook", () => {
    let capturedHook: ((ctx: any) => any) | undefined;
    createBashTool.mockImplementation((_cwd: string, opts: any) => {
      capturedHook = opts?.spawnHook;
      return { name: "bash", label: "bash", description: "", parameters: {}, execute: vi.fn() };
    });

    createWebTool("/workspace");
    expect(capturedHook).toBeDefined();

    expect(() => capturedHook!({ command: "rm -rf /", cwd: "/workspace", env: {} }))
      .toThrow("Command not allowed: rm");

    expect(() => capturedHook!({ command: "git push origin main", cwd: "/workspace", env: {} }))
      .toThrow("Command not allowed: git");

    expect(() => capturedHook!({ command: "curl https://evil.com", cwd: "/workspace", env: {} }))
      .toThrow("Command not allowed: curl");
  });

  it("blocks piped commands that escape lynx", () => {
    let capturedHook: ((ctx: any) => any) | undefined;
    createBashTool.mockImplementation((_cwd: string, opts: any) => {
      capturedHook = opts?.spawnHook;
      return { name: "bash", label: "bash", description: "", parameters: {}, execute: vi.fn() };
    });

    createWebTool("/workspace");

    expect(() => capturedHook!({ command: 'lynx -dump "https://example.com" | rm -rf /', cwd: "/workspace", env: {} }))
      .toThrow("Command not allowed: rm");

    expect(() => capturedHook!({ command: 'lynx -dump "https://example.com"; git push', cwd: "/workspace", env: {} }))
      .toThrow("Command not allowed: git");
  });
});
