function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Converts a subset of Markdown (as produced by Claude) to Telegram HTML.
 * Supported: code blocks, inline code, headings, bold, italic.
 */
export function markdownToHtml(text: string): string {
  const placeholders: string[] = [];

  // Extract fenced code blocks
  let out = text.replace(/```(?:[^\n`]*)?\n?([\s\S]*?)```/g, (_, code: string) => {
    const idx = placeholders.length;
    placeholders.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return `\x00PH${idx}\x00`;
  });

  // Extract inline code
  out = out.replace(/`([^`\n]+)`/g, (_, code: string) => {
    const idx = placeholders.length;
    placeholders.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00PH${idx}\x00`;
  });

  // Escape HTML in remaining text
  out = out.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

  // Headings → bold
  out = out.replace(/^#{1,3} (.+)$/gm, (_, content: string) => `<b>${content}</b>`);

  // Bold **text**
  out = out.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // Italic *text*
  out = out.replace(/\*([^*\n]+)\*/g, "<i>$1</i>");

  // Italic _text_ (only at word boundaries to avoid breaking snake_case)
  out = out.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "<i>$1</i>");

  // Restore placeholders
  out = out.replace(/\x00PH(\d+)\x00/g, (_, idx: string) => placeholders[Number(idx)] ?? "");

  return out;
}
