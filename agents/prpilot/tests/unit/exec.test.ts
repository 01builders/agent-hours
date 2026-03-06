import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawn = vi.fn();

vi.mock("node:child_process", () => ({ spawn }));

const { assertSuccess, execCommand } = await import("../../src/utils/exec.js");

function makeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

afterEach(() => {
  vi.useRealTimers();
  spawn.mockReset();
});

describe("execCommand", () => {
  it("collects stdout/stderr and resolves on close", async () => {
    const proc = makeProc();
    spawn.mockReturnValue(proc);

    const promise = execCommand("echo", ["ok"], { cwd: "/tmp/repo" });
    proc.stdout.emit("data", Buffer.from("hello"));
    proc.stderr.emit("data", Buffer.from("warn"));
    proc.emit("close", 0);

    await expect(promise).resolves.toEqual({ code: 0, stdout: "hello", stderr: "warn" });
    expect(spawn).toHaveBeenCalledWith(
      "echo",
      ["ok"],
      expect.objectContaining({ cwd: "/tmp/repo", stdio: ["ignore", "pipe", "pipe"] }),
    );
  });

  it("rejects when process emits error", async () => {
    const proc = makeProc();
    spawn.mockReturnValue(proc);

    const promise = execCommand("bad", []);
    proc.emit("error", new Error("spawn failed"));

    await expect(promise).rejects.toThrow("spawn failed");
  });

  it("kills process after timeout", async () => {
    vi.useFakeTimers();
    const proc = makeProc();
    spawn.mockReturnValue(proc);

    const promise = execCommand("sleep", ["10"], { timeoutMs: 5 });
    await vi.advanceTimersByTimeAsync(5);
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");

    proc.emit("close", null);
    await expect(promise).resolves.toEqual({ code: 1, stdout: "", stderr: "" });
  });
});

describe("assertSuccess", () => {
  it("throws for non-zero exit code", () => {
    expect(() => assertSuccess({ code: 1, stdout: "", stderr: "bad" }, "context")).toThrow(
      "context failed (1): bad",
    );
  });

  it("does not throw for zero exit code", () => {
    expect(() => assertSuccess({ code: 0, stdout: "", stderr: "" }, "context")).not.toThrow();
  });
});
