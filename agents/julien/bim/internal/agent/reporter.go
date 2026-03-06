package agent

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"github.com/julienrbrt/bim/internal/config"
	"github.com/julienrbrt/bim/internal/reporter"
	"github.com/julienrbrt/bim/internal/sourcify"
	"github.com/julienrbrt/bim/internal/store"
)

// ReporterTool generates exploit summaries, proof-of-concept code, and formatted
// bug bounty reports for security findings. It coordinates between the store
// (for finding/report persistence), Sourcify (for source code), and the reporter
// package (for LLM-powered report generation).
type ReporterTool struct {
	reporter *reporter.Reporter
	sourcify *sourcify.Client
	store    store.Store
	cfg      *config.Config
	logger   *slog.Logger
}

func NewReporterTool(
	rep *reporter.Reporter,
	sourcifyClient *sourcify.Client,
	st store.Store,
	logger *slog.Logger,
	cfg *config.Config,
) *ReporterTool {
	return &ReporterTool{
		reporter: rep,
		sourcify: sourcifyClient,
		store:    st,
		cfg:      cfg,
		logger:   logger,
	}
}

// ReportResult holds the output of a report generation run.
type ReportResult struct {
	// FindingID is the ID of the finding that was reported.
	FindingID string `json:"findingId"`
	// ChainID is the chain where the vulnerable contract is deployed.
	ChainID uint64 `json:"chainId"`
	// Address is the contract address.
	Address string `json:"address"`
	// ReportPath is the filesystem path where the report was written.
	ReportPath string `json:"reportPath"`
	// Title is the finding title.
	Title string `json:"title"`
	// Severity is the finding severity.
	Severity string `json:"severity"`
	// HasPoC indicates whether the report includes proof-of-concept code.
	HasPoC bool `json:"hasPoc"`
	// HasFix indicates whether the report includes a recommended fix.
	HasFix bool `json:"hasFix"`
	// MarkdownContent is the full rendered Markdown content of the report.
	MarkdownContent string `json:"markdownContent"`
	// Summary is a short human-readable summary of the report generation.
	Summary string `json:"summary"`
	// Error is set if the report generation failed.
	Error string `json:"error,omitempty"`
}

func (r *ReportResult) String() string {
	if r.Error != "" {
		return fmt.Sprintf("Report generation failed for finding %s: %s", r.FindingID, r.Error)
	}
	return r.Summary
}

// GenerateForFinding generates a complete bug bounty report for a specific finding ID.
func (t *ReporterTool) GenerateForFinding(ctx context.Context, findingID string) (*ReportResult, error) {
	t.logger.Info("generating report for finding", "finding_id", findingID)

	result := &ReportResult{FindingID: findingID}

	storedFinding, err := t.store.GetFindingByID(ctx, findingID)
	if err != nil {
		result.Error = fmt.Sprintf("failed to retrieve finding: %v", err)
		return result, fmt.Errorf("retrieving finding %s: %w", findingID, err)
	}
	if storedFinding == nil {
		result.Error = fmt.Sprintf("finding %s not found in store", findingID)
		return result, fmt.Errorf("finding %s not found in store", findingID)
	}

	result.ChainID = storedFinding.ChainID
	result.Address = storedFinding.Address
	result.Title = storedFinding.Finding.Title
	result.Severity = string(storedFinding.Finding.Severity)

	existingReport, err := t.store.GetReportByFindingID(ctx, findingID)
	if err != nil {
		t.logger.Warn("failed to check for existing report", "finding_id", findingID, "error", err)
	}
	if existingReport != nil {
		result.ReportPath = existingReport.ReportPath
		result.Summary = fmt.Sprintf("Report already exists for finding %s at %s", findingID, existingReport.ReportPath)
		return result, nil
	}

	sources, err := t.sourcify.GetContractSources(ctx, storedFinding.ChainID, storedFinding.Address)
	if err != nil {
		result.Error = fmt.Sprintf("failed to fetch source code from Sourcify: %v", err)
		return result, fmt.Errorf("fetching sources for %s on chain %d: %w",
			storedFinding.Address, storedFinding.ChainID, err)
	}

	report, err := t.reporter.GenerateReport(ctx, storedFinding.Finding, storedFinding.ChainID, storedFinding.Address, sources)
	if err != nil {
		result.Error = fmt.Sprintf("report generation failed: %v", err)
		return result, fmt.Errorf("generating report for finding %s: %w", findingID, err)
	}

	result.HasPoC = report.PoC != ""
	result.HasFix = report.RecommendedFix != ""

	markdown, err := t.reporter.FormatMarkdown(report, reporter.DefaultFormatOptions())
	if err != nil {
		t.logger.Warn("failed to format markdown, using raw content", "finding_id", findingID, "error", err)
		markdown = buildFallbackMarkdown(report)
	}
	result.MarkdownContent = markdown

	reportPath, err := t.reporter.WriteReport(report)
	if err != nil {
		t.logger.Error("failed to write report to disk", "finding_id", findingID, "error", err)
		result.Summary = fmt.Sprintf(
			"Generated report for [%s] %s on %s (chain %d) but failed to write to disk: %v",
			storedFinding.Finding.Severity, storedFinding.Finding.Title,
			storedFinding.Address, storedFinding.ChainID, err,
		)
		return result, nil
	}
	result.ReportPath = reportPath

	storedReport := &store.StoredReport{
		ID:         fmt.Sprintf("report-%s", findingID),
		FindingID:  findingID,
		ChainID:    storedFinding.ChainID,
		Address:    storedFinding.Address,
		ReportPath: reportPath,
	}
	if err := t.store.SaveReport(ctx, storedReport); err != nil {
		t.logger.Error("failed to persist report metadata", "finding_id", findingID, "report_path", reportPath, "error", err)
	}

	t.tryMarkReported(ctx, storedFinding.ChainID, storedFinding.Address)

	result.Summary = fmt.Sprintf(
		"Generated bug bounty report for [%s] \"%s\" on %s (chain %d).\n"+
			"Contract: %s\n"+
			"Report saved to: %s\n"+
			"PoC included: %v | Fix included: %v",
		storedFinding.Finding.Severity, storedFinding.Finding.Title,
		t.cfg.ChainName(storedFinding.ChainID), storedFinding.ChainID,
		storedFinding.Address,
		reportPath,
		result.HasPoC, result.HasFix,
	)

	t.logger.Info("report generated successfully",
		"finding_id", findingID,
		"report_path", reportPath,
		"has_poc", result.HasPoC,
		"has_fix", result.HasFix,
	)

	return result, nil
}

// GenerateAllPending generates reports for all Critical/High findings without an existing report.
func (t *ReporterTool) GenerateAllPending(ctx context.Context) ([]*ReportResult, error) {
	findings, err := t.store.GetActionableFindings(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing actionable findings: %w", err)
	}

	t.logger.Info("generating reports for actionable findings", "count", len(findings))

	var results []*ReportResult
	for _, sf := range findings {
		if ctx.Err() != nil {
			break
		}

		result, err := t.GenerateForFinding(ctx, sf.ID)
		if err != nil {
			t.logger.Error("report generation failed", "finding_id", sf.ID, "error", err)
		}
		results = append(results, result)
	}

	return results, nil
}

// GeneratePoCOnly generates just the proof-of-concept code for a finding,
// without the full report narrative.
func (t *ReporterTool) GeneratePoCOnly(ctx context.Context, findingID string) (string, error) {
	t.logger.Info("generating PoC only", "finding_id", findingID)

	storedFinding, err := t.store.GetFindingByID(ctx, findingID)
	if err != nil {
		return "", fmt.Errorf("retrieving finding %s: %w", findingID, err)
	}
	if storedFinding == nil {
		return "", fmt.Errorf("finding %s not found", findingID)
	}

	sources, err := t.sourcify.GetContractSources(ctx, storedFinding.ChainID, storedFinding.Address)
	if err != nil {
		return "", fmt.Errorf("fetching sources: %w", err)
	}

	var relevantSource string
	if storedFinding.Finding.AffectedFile != "" {
		if src, ok := sources[storedFinding.Finding.AffectedFile]; ok {
			relevantSource = src
		}
	}
	if relevantSource == "" {
		for path, content := range sources {
			relevantSource += fmt.Sprintf("// === %s ===\n%s\n\n", path, content)
		}
	}

	return t.reporter.GeneratePoC(ctx, storedFinding.Finding, storedFinding.ChainID, storedFinding.Address, relevantSource)
}

// tryMarkReported marks a contract as "reported" if all its actionable findings have reports.
func (t *ReporterTool) tryMarkReported(ctx context.Context, chainID uint64, address string) {
	findings, err := t.store.GetFindings(ctx, chainID, address)
	if err != nil {
		t.logger.Warn("failed to check findings for report status", "chain_id", chainID, "address", address, "error", err)
		return
	}

	var hasActionable, allReported = false, true
	for _, sf := range findings {
		if sf.Finding.Severity.IsActionable() {
			hasActionable = true
			if sf.ReportPath == "" {
				allReported = false
				break
			}
		}
	}

	if hasActionable && allReported {
		if err := t.store.UpdateContractStatus(ctx, chainID, address, store.StatusReported, ""); err != nil {
			t.logger.Error("failed to mark contract as reported", "chain_id", chainID, "address", address, "error", err)
		} else {
			t.logger.Info("all actionable findings reported", "chain_id", chainID, "address", address)
		}
	}
}

// GetReportContent retrieves the full Markdown content of a previously generated
// report for the given finding ID. It looks up the report path in the store and
// reads the file from disk.
func (t *ReporterTool) GetReportContent(ctx context.Context, findingID string) (string, error) {
	t.logger.Info("retrieving report content", "finding_id", findingID)

	storedReport, err := t.store.GetReportByFindingID(ctx, findingID)
	if err != nil {
		return "", fmt.Errorf("looking up report for finding %s: %w", findingID, err)
	}
	if storedReport == nil {
		return "", fmt.Errorf("no report found for finding %s — generate one first with generate_report", findingID)
	}

	content, err := os.ReadFile(storedReport.ReportPath)
	if err != nil {
		return "", fmt.Errorf("reading report file %s: %w", storedReport.ReportPath, err)
	}

	t.logger.Info("report content retrieved", "finding_id", findingID, "path", storedReport.ReportPath, "length", len(content))
	return string(content), nil
}

// buildFallbackMarkdown constructs a basic Markdown report when template rendering fails.
func buildFallbackMarkdown(report *reporter.Report) string {
	md := fmt.Sprintf("# %s\n\n", report.Finding.Title)
	md += fmt.Sprintf("**Severity:** %s\n\n", report.Finding.Severity)
	md += fmt.Sprintf("**Contract:** `%s` (chain %d)\n\n", report.Address, report.ChainID)
	md += fmt.Sprintf("**Affected Function:** `%s`\n\n", report.Finding.AffectedFunction)
	md += fmt.Sprintf("## Description\n\n%s\n\n", report.Finding.Description)

	if report.ExploitNarrative != "" {
		md += fmt.Sprintf("## Exploit Narrative\n\n%s\n\n", report.ExploitNarrative)
	}
	if report.ImpactAssessment != "" {
		md += fmt.Sprintf("## Impact Assessment\n\n%s\n\n", report.ImpactAssessment)
	}
	if report.PoC != "" {
		md += fmt.Sprintf("## Proof of Concept\n\n```solidity\n%s\n```\n\n", report.PoC)
	}
	if report.RecommendedFix != "" {
		md += fmt.Sprintf("## Recommended Fix\n\n%s\n\n", report.RecommendedFix)
	}

	md += "---\n\n*Report generated by BiM — Automated Smart Contract Security Analysis*\n"
	return md
}
