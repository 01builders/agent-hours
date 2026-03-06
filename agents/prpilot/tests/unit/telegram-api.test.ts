import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramApi } from "../../src/telegram/api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TelegramApi", () => {
  it("redacts sensitive text in sendMessage payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = new TelegramApi("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    await api.sendMessage(42, "token=abc Bearer ghp_verysecret");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));

    expect(payload.chat_id).toBe(42);
    expect(payload.text).toContain("***REDACTED***");
    expect(payload.text).not.toContain("ghp_verysecret");
    expect(payload.disable_web_page_preview).toBe(true);
  });

  it("includes parse mode and supports chat actions/commands", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { pending_update_count: 0 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = new TelegramApi("token");
    await api.sendMessage(1, "hello", "HTML");
    await api.sendChatAction(1, "upload_document");
    await api.setWebhook("https://example.com/hook", "secret");
    await api.setMyCommands([{ command: "repo", description: "select" }]);
    await api.deleteMyCommands({ type: "default" });
    await api.getWebhookInfo();

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const sendBody = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(sendBody.parse_mode).toBe("HTML");

    const actionBody = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body));
    expect(actionBody.action).toBe("upload_document");
  });

  it("throws when telegram returns failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ ok: false, description: "bad" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = new TelegramApi("token");
    await expect(api.sendChatAction(1)).rejects.toThrow("Telegram API sendChatAction failed");
  });
});
