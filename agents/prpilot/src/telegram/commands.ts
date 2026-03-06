export type BotCommand =
  | { type: "status" }
  | { type: "tasks" }
  | { type: "task"; index?: number }
  | { type: "select"; index?: number }
  | { type: "new" }
  | { type: "delete"; index?: number }
  | { type: "repo"; name?: string }
  | { type: "chat"; text: string }
  | { type: "apply"; task?: string }
  | { type: "abort" }
  | { type: "unknown"; raw: string };

export function parseCommand(text: string): BotCommand {
  const trimmed = text.trim();

  if (trimmed === "/status") return { type: "status" };
  if (trimmed === "/tasks") return { type: "tasks" };
  if (trimmed === "/task") return { type: "task" };
  if (trimmed === "/repo") return { type: "repo" };
  if (trimmed === "/abort") return { type: "abort" };
  if (trimmed === "/apply") return { type: "apply" };
  if (trimmed === "/select") return { type: "select" };
  if (trimmed === "/new") return { type: "new" };
  if (trimmed === "/delete") return { type: "delete" };

  if (trimmed.startsWith("/task ")) {
    const maybeIndex = Number.parseInt(trimmed.slice(6).trim(), 10);
    if (Number.isFinite(maybeIndex) && maybeIndex > 0) {
      return { type: "task", index: maybeIndex };
    }
    return { type: "task" };
  }

  if (trimmed.startsWith("/delete ")) {
    const maybeIndex = Number.parseInt(trimmed.slice(8).trim(), 10);
    if (Number.isFinite(maybeIndex) && maybeIndex > 0) {
      return { type: "delete", index: maybeIndex };
    }
    return { type: "delete" };
  }

  if (trimmed.startsWith("/select ")) {
    const maybeIndex = Number.parseInt(trimmed.slice(8).trim(), 10);
    if (Number.isFinite(maybeIndex) && maybeIndex >= 0) {
      return { type: "select", index: maybeIndex };
    }
    return { type: "select" };
  }

  if (trimmed.startsWith("/repo ")) {
    return { type: "repo", name: trimmed.slice(6).trim() };
  }

  if (trimmed.startsWith("/apply ")) {
    return { type: "apply", task: trimmed.slice(7).trim() };
  }

  if (trimmed.startsWith("/")) {
    return { type: "unknown", raw: text };
  }

  return { type: "chat", text: trimmed };
}
