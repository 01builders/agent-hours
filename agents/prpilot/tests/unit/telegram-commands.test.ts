import { describe, expect, it } from "vitest";
import { parseCommand } from "../../src/telegram/commands.js";

describe("parseCommand", () => {
  it("parses /status", () => {
    expect(parseCommand("/status")).toEqual({ type: "status" });
  });

  it("parses /tasks", () => {
    expect(parseCommand("/tasks")).toEqual({ type: "tasks" });
  });

  it("parses /task", () => {
    expect(parseCommand("/task")).toEqual({ type: "task" });
  });

  it("parses /task with index", () => {
    expect(parseCommand("/task 2")).toEqual({ type: "task", index: 2 });
  });

  it("treats invalid /task index as usage request", () => {
    expect(parseCommand("/task banana")).toEqual({ type: "task" });
    expect(parseCommand("/task 0")).toEqual({ type: "task" });
  });

  it("parses /select", () => {
    expect(parseCommand("/select")).toEqual({ type: "select" });
  });

  it("parses /select with index", () => {
    expect(parseCommand("/select 3")).toEqual({ type: "select", index: 3 });
  });

  it("parses /select 0 for deselect", () => {
    expect(parseCommand("/select 0")).toEqual({ type: "select", index: 0 });
  });

  it("treats invalid /select index as usage request", () => {
    expect(parseCommand("/select abc")).toEqual({ type: "select" });
  });

  it("parses /new", () => {
    expect(parseCommand("/new")).toEqual({ type: "new" });
  });

  it("parses /delete", () => {
    expect(parseCommand("/delete")).toEqual({ type: "delete" });
  });

  it("parses /delete with index", () => {
    expect(parseCommand("/delete 2")).toEqual({ type: "delete", index: 2 });
  });

  it("treats invalid /delete index as usage request", () => {
    expect(parseCommand("/delete abc")).toEqual({ type: "delete" });
    expect(parseCommand("/delete 0")).toEqual({ type: "delete" });
  });

  it("parses /repo", () => {
    expect(parseCommand("/repo")).toEqual({ type: "repo" });
  });

  it("parses /repo with name", () => {
    expect(parseCommand("/repo home-ops")).toEqual({ type: "repo", name: "home-ops" });
  });

  it("/arm is treated as unknown command", () => {
    expect(parseCommand("/arm")).toEqual({ type: "unknown", raw: "/arm" });
    expect(parseCommand("/arm 15")).toEqual({ type: "unknown", raw: "/arm 15" });
  });

  it("parses /apply with task", () => {
    expect(parseCommand("/apply add tests")).toEqual({ type: "apply", task: "add tests" });
  });

  it("parses bare /apply with no task", () => {
    expect(parseCommand("/apply")).toEqual({ type: "apply" });
  });

  it("routes free text as chat", () => {
    expect(parseCommand("update the readme")).toEqual({ type: "chat", text: "update the readme" });
    expect(parseCommand("scale down the nginx deployment")).toEqual({ type: "chat", text: "scale down the nginx deployment" });
  });

  it("returns unknown for unsupported command", () => {
    expect(parseCommand("/hello")).toEqual({ type: "unknown", raw: "/hello" });
  });
});
