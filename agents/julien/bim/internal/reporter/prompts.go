package reporter

import (
	"bytes"
	"embed"
	"fmt"
	"strings"
	"text/template"

	"github.com/julienrbrt/bim/internal/analyzer"
)

//go:embed templates/*.tmpl
var templatesFS embed.FS

//go:embed skills/*.md
var skillsFS embed.FS

var (
	systemTmpl          *template.Template
	reportTmpl          *template.Template
	pocTmpl             *template.Template
	markdownTmpl        *template.Template
	humanizerPromptTmpl *template.Template
	humanizerSkill      string
)

func init() {
	var err error

	systemTmpl, err = template.New("system.tmpl").ParseFS(templatesFS, "templates/system.tmpl")
	if err != nil {
		panic(fmt.Sprintf("parsing system.tmpl: %v", err))
	}

	reportTmpl, err = template.New("report.tmpl").ParseFS(templatesFS, "templates/report.tmpl")
	if err != nil {
		panic(fmt.Sprintf("parsing report.tmpl: %v", err))
	}

	pocTmpl, err = template.New("poc.tmpl").ParseFS(templatesFS, "templates/poc.tmpl")
	if err != nil {
		panic(fmt.Sprintf("parsing poc.tmpl: %v", err))
	}

	markdownTmpl, err = template.New("markdown.tmpl").ParseFS(templatesFS, "templates/markdown.tmpl")
	if err != nil {
		panic(fmt.Sprintf("parsing markdown.tmpl: %v", err))
	}

	humanizerPromptTmpl, err = template.New("humanizer-prompt.tmpl").ParseFS(templatesFS, "templates/humanizer-prompt.tmpl")
	if err != nil {
		panic(fmt.Sprintf("parsing humanizer-prompt.tmpl: %v", err))
	}

	data, err := skillsFS.ReadFile("skills/humanizer.md")
	if err != nil {
		panic(fmt.Sprintf("reading skills/humanizer.md: %v", err))
	}
	humanizerSkill = string(data)
}

// SystemPrompt returns the system prompt for the reporter agent.
func SystemPrompt() string {
	var buf bytes.Buffer
	if err := systemTmpl.Execute(&buf, nil); err != nil {
		panic(fmt.Sprintf("executing system.tmpl: %v", err))
	}
	return buf.String()
}

// HumanizerSystemPrompt returns the system prompt for the humanizer pass,
// which rewrites narrative sections to read like a human researcher wrote them.
func HumanizerSystemPrompt() string {
	return stripFrontMatter(humanizerSkill)
}

// HumanizerUserPrompt builds the user prompt for the humanizer pass.
func HumanizerUserPrompt(reportContent string) string {
	var buf bytes.Buffer
	data := map[string]string{"ReportContent": reportContent}
	if err := humanizerPromptTmpl.Execute(&buf, data); err != nil {
		panic(fmt.Sprintf("executing humanizer-prompt.tmpl: %v", err))
	}
	return buf.String()
}

// GenerateReportPrompt builds the prompt for generating a full exploit report.
func GenerateReportPrompt(finding analyzer.Finding, chainID uint64, address string, sources map[string]string) string {
	var sourceBlock strings.Builder
	for path, content := range sources {
		fmt.Fprintf(&sourceBlock, "### `%s`\n\n", path)
		sourceBlock.WriteString("```solidity\n")
		sourceBlock.WriteString(content)
		if !strings.HasSuffix(content, "\n") {
			sourceBlock.WriteString("\n")
		}
		sourceBlock.WriteString("```\n\n")
	}

	data := map[string]any{
		"ChainID":          chainID,
		"Address":          address,
		"Severity":         string(finding.Severity),
		"Title":            finding.Title,
		"Category":         finding.Category,
		"AffectedFunction": finding.AffectedFunction,
		"AffectedFile":     finding.AffectedFile,
		"LineNumbers":      finding.LineNumbers,
		"Description":      finding.Description,
		"Impact":           finding.Impact,
		"Recommendation":   finding.Recommendation,
		"SourceBlock":      sourceBlock.String(),
	}

	var buf bytes.Buffer
	if err := reportTmpl.Execute(&buf, data); err != nil {
		panic(fmt.Sprintf("executing report.tmpl: %v", err))
	}
	return buf.String()
}

// GeneratePoCPrompt builds a focused prompt for generating only the PoC code.
func GeneratePoCPrompt(finding analyzer.Finding, chainID uint64, address string, relevantSource string) string {
	if !strings.HasSuffix(relevantSource, "\n") {
		relevantSource += "\n"
	}

	data := map[string]any{
		"ChainID":          chainID,
		"Address":          address,
		"Title":            finding.Title,
		"Severity":         string(finding.Severity),
		"Category":         finding.Category,
		"AffectedFunction": finding.AffectedFunction,
		"Description":      finding.Description,
		"RelevantSource":   relevantSource,
	}

	var buf bytes.Buffer
	if err := pocTmpl.Execute(&buf, data); err != nil {
		panic(fmt.Sprintf("executing poc.tmpl: %v", err))
	}
	return buf.String()
}

// ReportMarkdownTemplate returns the parsed Markdown output template.
func ReportMarkdownTemplate() *template.Template {
	return markdownTmpl
}

// stripFrontMatter removes YAML front matter (--- delimited) from markdown content.
func stripFrontMatter(content string) string {
	if !strings.HasPrefix(content, "---") {
		return content
	}
	rest := content[3:]
	_, after, ok := strings.Cut(rest, "---")
	if !ok {
		return content
	}
	return strings.TrimSpace(after)
}
