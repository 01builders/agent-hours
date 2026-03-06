# Telegram Message Style Guide

This project uses a unified Telegram HTML message style for readability on mobile.

## Standard Format

Use:

1. Title line: `ICON <b>Title</b>`
2. Body lines: short, flat lines (no nesting)
3. Code formatting: wrap paths, commands, branch names, and technical values in `<code>...</code>`

## Helpers

Use the shared helpers in `src/app.ts`:

- `formatTelegramMessage(icon, title, lines?)`
- `formatTelegramRow(icon, label, value)`
- `formatCode(value)`

These helpers enforce a consistent message shape and safe HTML escaping.

## Writing Rules

- Keep messages concise: usually 1-4 body lines.
- One idea per line.
- Prefer clear visual anchors with emojis (for example: `✅`, `⚠️`, `📁`, `📦`, `❓`).
- Use sentence case in titles and labels.
- Avoid markdown (`**bold**`, `_italic_`, `# heading`) in Telegram output.
- Avoid nested bullets and long paragraphs.

## Recommended Icons

- `✅` success or completion
- `⚠️` failure, warning, or blocking issue
- `ℹ️` neutral info
- `❓` missing input or unknown command
- `📦` repository context
- `📁` branch or file context
- `🧭` task status
- `🚀` workflow start
- `🗂️` task list
- `🛑` aborted run

## Examples

Success:

```html
✅ <b>Apply Completed</b>
📁 <b>Branch</b>: <code>agent/add-tests</code>
🔗 <b>PR</b>: <a href="https://github.com/org/repo/pull/12">org/repo - PR #12</a>
```

Action required:

```html
❓ <b>Select Repository First</b>
Use <code>/repo &lt;name&gt;</code>
Supported: <code>repo-one, repo-two</code>
```

Error:

```html
⚠️ <b>Failed to Open PR</b>
📁 <b>Branch</b>: <code>agent/add-tests</code>
❗ <b>Reason</b>: <code>Remote branch not found after push</code>
```
