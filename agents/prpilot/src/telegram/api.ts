import { logger } from "../utils/logger.js";
import { redactText } from "../utils/redact.js";

export class TelegramApi {
  private readonly baseUrl: string;

  constructor(private readonly botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async sendMessage(chatId: number, text: string, parseMode?: "HTML"): Promise<void> {
    const safeText = redactText(text);
    logger.debug("telegram sendMessage", { chatId, textLength: safeText.length, parseMode });
    await this.call("sendMessage", {
      chat_id: chatId,
      text: safeText,
      disable_web_page_preview: true,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });
  }

  async sendChatAction(chatId: number, action: "typing" | "upload_document" = "typing"): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action });
  }

  async setWebhook(webhookUrl: string, secretToken: string): Promise<void> {
    await this.call("setWebhook", {
      url: webhookUrl,
      secret_token: secretToken,
      drop_pending_updates: false,
      allowed_updates: ["message"],
    });
  }

  async getWebhookInfo(): Promise<unknown> {
    return this.call("getWebhookInfo", {});
  }

  async setMyCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
    await this.call("setMyCommands", { commands });
  }

  async deleteMyCommands(scope?: Record<string, unknown>): Promise<void> {
    await this.call("deleteMyCommands", scope ? { scope } : {});
  }

  private async call(method: string, payload: Record<string, unknown>): Promise<any> {
    logger.debug("telegram api call", { method });
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      logger.warn("telegram api error", { method, status: response.status });
      throw new Error(`Telegram API ${method} failed: ${JSON.stringify(data)}`);
    }
    return data.result;
  }
}
