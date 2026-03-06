import { describe, expect, it } from "vitest";
import { markdownToHtml } from "../../src/utils/markdown.js";

describe("markdownToHtml", () => {
  it("converts headings, emphasis, and code blocks", () => {
    const input = "# Title\nUse **bold** and *italic* and _more_.\n```ts\nconst x = 1 < 2;\n```";

    const html = markdownToHtml(input);

    expect(html).toContain("<b>Title</b>");
    expect(html).toContain("<b>bold</b>");
    expect(html).toContain("<i>italic</i>");
    expect(html).toContain("<i>more</i>");
    expect(html).toContain("<pre><code>const x = 1 &lt; 2;</code></pre>");
  });

  it("keeps snake_case untouched while converting boundary underscore italics", () => {
    const input = "name_with_underscores and _italic_ and `code_snake_case`";
    const html = markdownToHtml(input);

    expect(html).toContain("name_with_underscores");
    expect(html).toContain("<i>italic</i>");
    expect(html).toContain("<code>code_snake_case</code>");
  });
});
