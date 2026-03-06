// Package reporter generates exploit summaries and PoC code for security findings.
package reporter

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"text/template"
	"time"

	"github.com/google/uuid"

	"github.com/julienrbrt/bim/internal/analyzer"
)

// LLM is the interface used by the reporter to interact with a language model.
type LLM interface {
	Generate(ctx context.Context, systemPrompt, userPrompt string) (string, error)
}

// Reporter generates exploit summaries, PoC code, and formatted bug bounty reports.
type Reporter struct {
	llm     LLM
	logger  *slog.Logger
	dataDir string
}

func New(llm LLM, dataDir string, logger *slog.Logger) *Reporter {
	return &Reporter{
		llm:     llm,
		logger:  logger,
		dataDir: dataDir,
	}
}

// GenerateReport produces a complete bug bounty report for the given finding,
// including exploit narrative, impact assessment, PoC code, and recommended fix.
// After generation, it runs the humanizer skill on narrative sections to remove
// AI writing patterns.
func (r *Reporter) GenerateReport(ctx context.Context, finding analyzer.Finding, chainID uint64, address string, sources map[string]string) (*Report, error) {
	r.logger.Info("generating report",
		"finding_id", finding.ID, "severity", finding.Severity,
		"title", finding.Title, "chain_id", chainID, "address", address,
	)

	prompt := GenerateReportPrompt(finding, chainID, address, sources)
	response, err := r.llm.Generate(ctx, SystemPrompt(), prompt)
	if err != nil {
		return nil, fmt.Errorf("LLM generation failed for finding %s: %w", finding.ID, err)
	}

	report, err := r.parseReportResponse(response, finding, chainID, address)
	if err != nil {
		return nil, fmt.Errorf("parsing report response for finding %s: %w", finding.ID, err)
	}

	r.humanizeReport(ctx, report)

	r.logger.Info("report generated",
		"finding_id", finding.ID,
		"has_poc", report.PoC != "",
		"has_narrative", report.ExploitNarrative != "",
	)

	return report, nil
}

// humanizeReport rewrites the ExploitNarrative and ImpactAssessment sections
// to read more naturally. PoC code and RecommendedFix are left untouched.
func (r *Reporter) humanizeReport(ctx context.Context, report *Report) {
	if report.ExploitNarrative == "" && report.ImpactAssessment == "" {
		return
	}

	r.logger.Info("running humanizer pass", "finding_id", report.Finding.ID)

	var narrativeBlock strings.Builder
	if report.ExploitNarrative != "" {
		narrativeBlock.WriteString("## Exploit Narrative\n\n")
		narrativeBlock.WriteString(report.ExploitNarrative)
		narrativeBlock.WriteString("\n\n")
	}
	if report.ImpactAssessment != "" {
		narrativeBlock.WriteString("## Impact Assessment\n\n")
		narrativeBlock.WriteString(report.ImpactAssessment)
		narrativeBlock.WriteString("\n\n")
	}

	response, err := r.llm.Generate(ctx, HumanizerSystemPrompt(), HumanizerUserPrompt(narrativeBlock.String()))
	if err != nil {
		r.logger.Warn("humanizer pass failed, keeping original text", "finding_id", report.Finding.ID, "error", err)
		return
	}

	sections := parseSections(response)
	if humanized := sections["exploit narrative"]; humanized != "" {
		report.ExploitNarrative = humanized
	}
	if humanized := sections["impact assessment"]; humanized != "" {
		report.ImpactAssessment = humanized
	}

	r.logger.Info("humanizer pass complete", "finding_id", report.Finding.ID)
}

// GeneratePoC produces only a Foundry proof-of-concept test for the given finding.
func (r *Reporter) GeneratePoC(ctx context.Context, finding analyzer.Finding, chainID uint64, address string, relevantSource string) (string, error) {
	r.logger.Info("generating PoC", "finding_id", finding.ID, "chain_id", chainID, "address", address)

	prompt := GeneratePoCPrompt(finding, chainID, address, relevantSource)
	response, err := r.llm.Generate(ctx, SystemPrompt(), prompt)
	if err != nil {
		return "", fmt.Errorf("LLM PoC generation failed for finding %s: %w", finding.ID, err)
	}

	if poc := extractCodeBlock(response); poc != "" {
		return poc, nil
	}
	return response, nil
}

// WriteReport writes a formatted Markdown report to disk and returns the file path.
// Reports are written to: {dataDir}/{chainID}/{address}/reports/{reportID}.md
func (r *Reporter) WriteReport(report *Report) (string, error) {
	dir := filepath.Join(r.dataDir, fmt.Sprintf("%d", report.ChainID), report.Address, "reports")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("creating report directory %s: %w", dir, err)
	}

	path := filepath.Join(dir, uuid.New().String()+".md")
	content, err := r.renderMarkdown(report)
	if err != nil {
		return "", fmt.Errorf("rendering report markdown: %w", err)
	}

	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("writing report to %s: %w", path, err)
	}

	r.logger.Info("report written to disk", "path", path, "finding_id", report.Finding.ID)
	return path, nil
}

// FormatMarkdown renders a report to a Markdown string using the template.
func (r *Reporter) FormatMarkdown(report *Report, opts FormatOptions) (string, error) {
	return r.renderMarkdownWithOpts(report, opts)
}

func (r *Reporter) parseReportResponse(response string, finding analyzer.Finding, chainID uint64, address string) (*Report, error) {
	report := &Report{
		Finding:   finding,
		ChainID:   chainID,
		Address:   address,
		CreatedAt: time.Now().UTC(),
	}

	sections := parseSections(response)

	report.ExploitNarrative = firstNonEmpty(sections["exploit narrative"], sections["exploit"])
	report.ImpactAssessment = firstNonEmpty(sections["impact assessment"], sections["impact"])

	report.PoC = firstNonEmpty(sections["proof of concept"], sections["poc"])
	if code := extractCodeBlock(report.PoC); code != "" {
		report.PoC = code
	}

	report.RecommendedFix = firstNonEmpty(sections["recommended fix"], sections["fix"], sections["recommendation"])

	if report.ExploitNarrative == "" && report.PoC == "" {
		r.logger.Warn("could not parse distinct sections, using full response as narrative",
			"finding_id", finding.ID, "response_length", len(response),
		)
		report.ExploitNarrative = response
	}

	return report, nil
}

func (r *Reporter) renderMarkdown(report *Report) (string, error) {
	return r.renderMarkdownWithOpts(report, DefaultFormatOptions())
}

func (r *Reporter) renderMarkdownWithOpts(report *Report, opts FormatOptions) (string, error) {
	data := map[string]any{
		"Title":            report.Finding.Title,
		"Severity":         string(report.Finding.Severity),
		"Category":         report.Finding.Category,
		"ChainID":          report.ChainID,
		"Address":          report.Address,
		"AffectedFunction": report.Finding.AffectedFunction,
		"Confidence":       fmt.Sprintf("%.0f%%", report.Finding.Confidence*100),
		"Description":      report.Finding.Description,
		"ExploitNarrative": report.ExploitNarrative,
		"ImpactAssessment": report.ImpactAssessment,
		"PoC":              report.PoC,
		"RecommendedFix":   report.RecommendedFix,
	}

	tmplText := templateText()
	if !opts.IncludePoC {
		tmplText = removeSection(tmplText, "Proof of Concept")
	}
	if !opts.IncludeFix {
		tmplText = removeSection(tmplText, "Recommended Fix")
	}

	renderTmpl, err := template.New("report-render").Parse(tmplText)
	if err != nil {
		return "", fmt.Errorf("parsing report template: %w", err)
	}

	var buf bytes.Buffer
	if err := renderTmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("executing report template: %w", err)
	}

	return buf.String(), nil
}

func templateText() string {
	data, err := templatesFS.ReadFile("templates/markdown.tmpl")
	if err != nil {
		panic(fmt.Sprintf("reading markdown.tmpl: %v", err))
	}
	return string(data)
}

// parseSections splits a Markdown response into named sections based on ## or ### headers.
// Section names are normalized to lowercase.
func parseSections(text string) map[string]string {
	sections := make(map[string]string)
	lines := strings.Split(text, "\n")

	var currentSection string
	var currentContent []string

	flush := func() {
		if currentSection != "" {
			sections[currentSection] = strings.TrimSpace(strings.Join(currentContent, "\n"))
		}
		currentContent = nil
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if isHeader(trimmed) {
			flush()
			currentSection = normalizeHeader(trimmed)
		} else {
			currentContent = append(currentContent, line)
		}
	}
	flush()

	return sections
}

// extractCodeBlock extracts the content of the first fenced code block.
func extractCodeBlock(text string) string {
	lines := strings.Split(text, "\n")
	var code []string
	inBlock := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !inBlock {
			if strings.HasPrefix(trimmed, "```") {
				inBlock = true
				continue
			}
		} else {
			if strings.HasPrefix(trimmed, "```") {
				return strings.TrimSpace(strings.Join(code, "\n"))
			}
			code = append(code, line)
		}
	}

	if inBlock && len(code) > 0 {
		return strings.TrimSpace(strings.Join(code, "\n"))
	}
	return ""
}

func isHeader(line string) bool {
	return strings.HasPrefix(line, "##")
}

func normalizeHeader(line string) string {
	s := strings.TrimLeft(line, "#")
	s = strings.TrimSpace(s)

	// Strip leading numbering like "1. " or "2. "
	if len(s) > 2 && s[0] >= '0' && s[0] <= '9' && s[1] == '.' {
		s = strings.TrimSpace(s[2:])
	}

	return strings.ToLower(s)
}

func removeSection(tmpl, sectionTitle string) string {
	lines := strings.Split(tmpl, "\n")
	var result []string
	skip := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if isHeader(trimmed) {
			skip = normalizeHeader(trimmed) == strings.ToLower(sectionTitle)
		}
		if !skip {
			result = append(result, line)
		}
	}

	return strings.TrimSpace(strings.Join(result, "\n"))
}

func firstNonEmpty(candidates ...string) string {
	for _, s := range candidates {
		if s != "" {
			return s
		}
	}
	return ""
}
