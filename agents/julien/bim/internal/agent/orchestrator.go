// Package agent defines the ADK tools and orchestrator for BiM.
package agent

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/julienrbrt/bim/internal/config"
)

// Orchestrator coordinates the discovery, analysis, and reporting pipeline.
// It composes DiscoveryTool, AnalyzerTool, and ReporterTool and exposes
// high-level methods that the ADK agent in main.go registers as tool functions.
type Orchestrator struct {
	discovery *DiscoveryTool
	analyzer  *AnalyzerTool
	reporter  *ReporterTool
	cfg       *config.Config
	logger    *slog.Logger
}

func NewOrchestrator(
	discovery *DiscoveryTool,
	analyzer *AnalyzerTool,
	reporter *ReporterTool,
	logger *slog.Logger,
	cfg *config.Config,
) *Orchestrator {
	return &Orchestrator{
		discovery: discovery,
		analyzer:  analyzer,
		reporter:  reporter,
		cfg:       cfg,
		logger:    logger,
	}
}

// PipelineResult holds the combined output of a full pipeline run.
type PipelineResult struct {
	// Discovery is the result of the contract discovery phase.
	Discovery *DiscoverResult `json:"discovery,omitempty"`
	// Analyses holds the results of the analysis phase.
	Analyses []*AnalyzeResult `json:"analyses,omitempty"`
	// Reports holds the results of the reporting phase.
	Reports []*ReportResult `json:"reports,omitempty"`
	// Duration is the total time the pipeline took.
	Duration time.Duration `json:"duration"`
	// Summary is a human-readable summary of the entire run.
	Summary string `json:"summary"`
}

func (r *PipelineResult) String() string { return r.Summary }

// RunFullPipeline executes discover → analyze → report in sequence.
func (o *Orchestrator) RunFullPipeline(ctx context.Context) (*PipelineResult, error) {
	start := time.Now()
	o.logger.Info("starting full pipeline run")

	result := &PipelineResult{}

	o.logger.Info("pipeline phase 1: discovery")
	discoverResult, err := o.discovery.Discover(ctx)
	if err != nil {
		o.logger.Error("discovery phase failed", "error", err)
	}
	result.Discovery = discoverResult

	if ctx.Err() != nil {
		result.Duration = time.Since(start)
		result.Summary = "Pipeline interrupted during discovery phase."
		return result, ctx.Err()
	}

	o.logger.Info("pipeline phase 2: analysis")
	analyses, err := o.analyzer.AnalyzePending(ctx)
	if err != nil {
		o.logger.Error("analysis phase failed", "error", err)
	}
	result.Analyses = analyses

	if ctx.Err() != nil {
		result.Duration = time.Since(start)
		result.Summary = "Pipeline interrupted during analysis phase."
		return result, ctx.Err()
	}

	o.logger.Info("pipeline phase 3: reporting")
	reports, err := o.reporter.GenerateAllPending(ctx)
	if err != nil {
		o.logger.Error("reporting phase failed", "error", err)
	}
	result.Reports = reports

	result.Duration = time.Since(start)
	result.Summary = o.buildPipelineSummary(result)

	o.logger.Info("pipeline run complete",
		"duration", result.Duration,
		"new_contracts", countNewContracts(result.Discovery),
		"analyses", len(result.Analyses),
		"reports", len(result.Reports),
	)

	return result, nil
}

// RunDiscovery executes only the discovery phase.
func (o *Orchestrator) RunDiscovery(ctx context.Context) (*DiscoverResult, error) {
	o.logger.Info("running discovery phase only")
	return o.discovery.Discover(ctx)
}

// RunAnalysis executes only the analysis phase on all pending contracts.
func (o *Orchestrator) RunAnalysis(ctx context.Context) ([]*AnalyzeResult, error) {
	o.logger.Info("running analysis phase only")
	return o.analyzer.AnalyzePending(ctx)
}

// RunReporting generates reports for all unreported actionable findings.
func (o *Orchestrator) RunReporting(ctx context.Context) ([]*ReportResult, error) {
	o.logger.Info("running reporting phase only")
	return o.reporter.GenerateAllPending(ctx)
}

// ProcessContract runs discover → analyze → report for a single contract.
func (o *Orchestrator) ProcessContract(ctx context.Context, chainID uint64, address string) (*PipelineResult, error) {
	start := time.Now()
	address = normalizeAddress(address)

	o.logger.Info("processing single contract", "chain_id", chainID, "address", address)

	result := &PipelineResult{}

	contract, err := o.discovery.DiscoverSingleContract(ctx, chainID, address)
	if err != nil {
		result.Duration = time.Since(start)
		result.Summary = fmt.Sprintf("Failed to discover contract %s on chain %d: %v", address, chainID, err)
		return result, err
	}

	o.logger.Info("contract discovered/retrieved",
		"chain_id", chainID, "address", address,
		"name", contract.Name, "status", contract.Status,
	)

	analysisResult, err := o.analyzer.Analyze(ctx, chainID, address)
	if err != nil {
		result.Analyses = []*AnalyzeResult{analysisResult}
		result.Duration = time.Since(start)
		result.Summary = fmt.Sprintf("Analysis failed for %s on chain %d: %v", address, chainID, err)
		return result, err
	}
	result.Analyses = []*AnalyzeResult{analysisResult}

	var reports []*ReportResult
	for _, finding := range analysisResult.Findings {
		if !finding.Severity.IsActionable() {
			continue
		}
		if ctx.Err() != nil {
			break
		}

		reportResult, err := o.reporter.GenerateForFinding(ctx, finding.ID)
		if err != nil {
			o.logger.Error("report generation failed for finding",
				"finding_id", finding.ID, "error", err,
			)
			reports = append(reports, &ReportResult{
				FindingID: finding.ID,
				ChainID:   chainID,
				Address:   address,
				Error:     err.Error(),
			})
			continue
		}
		reports = append(reports, reportResult)
	}
	result.Reports = reports

	result.Duration = time.Since(start)
	result.Summary = o.buildSingleContractSummary(chainID, address, analysisResult, reports)

	o.logger.Info("single contract processing complete",
		"chain_id", chainID, "address", address,
		"duration", result.Duration,
		"findings", analysisResult.TotalFindings,
		"reports", len(reports),
	)

	return result, nil
}

// ReAnalyzeContract forces a re-analysis of a previously analyzed contract.
func (o *Orchestrator) ReAnalyzeContract(ctx context.Context, chainID uint64, address string) (*AnalyzeResult, error) {
	o.logger.Info("re-analyzing contract", "chain_id", chainID, "address", address)
	return o.analyzer.ReAnalyze(ctx, chainID, address)
}

// GenerateReport generates a report for a specific finding by ID.
func (o *Orchestrator) GenerateReport(ctx context.Context, findingID string) (*ReportResult, error) {
	o.logger.Info("generating report for finding", "finding_id", findingID)
	return o.reporter.GenerateForFinding(ctx, findingID)
}

// DisplayReport retrieves and returns the full Markdown content of a previously
// generated report for the given finding ID. It looks up the report path in the
// store and reads the file from disk.
func (o *Orchestrator) DisplayReport(ctx context.Context, findingID string) (string, error) {
	o.logger.Info("displaying report for finding", "finding_id", findingID)
	return o.reporter.GetReportContent(ctx, findingID)
}

// GeneratePoC generates only the proof-of-concept code for a finding.
func (o *Orchestrator) GeneratePoC(ctx context.Context, findingID string) (string, error) {
	o.logger.Info("generating PoC for finding", "finding_id", findingID)
	return o.reporter.GeneratePoCOnly(ctx, findingID)
}

// OrchestratorSystemPrompt returns the system instruction for the root ADK agent.
func OrchestratorSystemPrompt() string {
	return `You are BiM, an AI-powered smart contract security agent.

Your mission is to discover newly published smart contracts on Ethereum and Base,
analyze them for critical and high-severity security vulnerabilities, and generate
detailed bug bounty reports with proof-of-concept exploit code.

## Background Polling

BiM runs a background discovery loop that continuously polls for new verified contracts
at the configured poll interval (default: 60s). New contracts are automatically ingested
into the store with status "pending" — ready for analysis. You do NOT need to call
discover_contracts manually for routine discovery; the background loop handles it.

Use **discovery_status** to check what the background loop has found so far.

## Core Pipeline Tools

1. **discover_contracts** — Trigger an immediate on-demand discovery cycle (in addition to background polling).
   Chains that were already polled within the current interval are skipped automatically.

2. **analyze_contract** — Run an AI-powered security analysis on a verified contract.
   Provide a chain ID and contract address. Returns findings ranked by severity.

3. **generate_report** — Generate a bug bounty report with PoC exploit code for a specific finding.
   Provide a finding ID. Produces a Markdown report ready for submission.

4. **display_report** — Display the full Markdown content of a previously generated report.
   Provide a finding ID. Use this when the user wants to see, read, or review a report.

5. **run_pipeline** — Run the full discover → analyze → report pipeline automatically.

6. **generate_poc** — Generate only the Foundry proof-of-concept exploit code for a finding.

7. **reanalyze_contract** — Force a re-analysis of a previously analyzed contract.

8. **discovery_status** — Check the background discovery loop status: whether it is running,
   poll interval, total cycles completed, cumulative new contracts found, last run time, and
   the latest discovery results. Use this to see what has been found automatically.

## Usage Patterns

When the user asks you to:
- "Find new contracts" or "What's new?" → Use discovery_status first, then discover_contracts.
- "Is the background loop running?" or "What has been found?" → Use discovery_status.
- "Analyze 0x..." → Use analyze_contract.
- "Generate a report for..." → Use generate_report.
- "Show me the report" or "Display the report for..." → Use display_report.
- "Run a full scan" → Use run_pipeline.
- "Re-analyze 0x..." → Use reanalyze_contract.

## Research Strategy

For broad surveillance:
1. Use discovery_status to see what the background loop has already found.
2. Use discover_contracts to trigger an immediate cycle.
3. Use analyze_contract on pending contracts.
4. Use run_pipeline for automated end-to-end processing.

Always present results clearly:
- List findings with their severity, title, and affected function.
- Highlight Critical and High findings prominently.
- Mention when reports have been generated and where they are saved.
- Provide actionable next steps.

Be concise but thorough. Focus on what matters: exploitable vulnerabilities.`
}

func (o *Orchestrator) buildPipelineSummary(result *PipelineResult) string {
	var b strings.Builder

	fmt.Fprintf(&b, "## BiM Pipeline Run Complete\n\n")
	fmt.Fprintf(&b, "**Duration:** %s\n\n", result.Duration.Round(time.Millisecond))

	if result.Discovery != nil {
		fmt.Fprintf(&b, "### Discovery\n\n")
		fmt.Fprintf(&b, "- **New contracts found:** %d\n", result.Discovery.TotalNew)
		fmt.Fprintf(&b, "- **Total checked:** %d\n", result.Discovery.TotalChecked)
		fmt.Fprintf(&b, "- **Already seen:** %d\n\n", result.Discovery.TotalAlreadySeen)

		for _, cr := range result.Discovery.ChainResults {
			if len(cr.NewContracts) > 0 {
				fmt.Fprintf(&b, "**%s:** %d new contracts\n", cr.ChainName, len(cr.NewContracts))
				for _, addr := range cr.NewContracts {
					fmt.Fprintf(&b, "  - `%s`\n", addr)
				}
				b.WriteString("\n")
			}
		}
	}

	if len(result.Analyses) > 0 {
		fmt.Fprintf(&b, "### Analysis\n\n")
		fmt.Fprintf(&b, "- **Contracts analyzed:** %d\n", len(result.Analyses))

		var totalFindings, totalCritical, totalHigh int
		for _, ar := range result.Analyses {
			totalFindings += ar.TotalFindings
			totalCritical += ar.CriticalCount
			totalHigh += ar.HighCount
		}

		fmt.Fprintf(&b, "- **Total findings:** %d\n", totalFindings)
		fmt.Fprintf(&b, "- **Critical:** %d\n", totalCritical)
		fmt.Fprintf(&b, "- **High:** %d\n\n", totalHigh)

		for _, ar := range result.Analyses {
			switch {
			case ar.Error != "":
				fmt.Fprintf(&b, "- `%s` (chain %d): **FAILED** — %s\n", ar.Address, ar.ChainID, ar.Error)
			case ar.CriticalCount+ar.HighCount > 0:
				fmt.Fprintf(&b, "- `%s` (chain %d): %d Critical, %d High findings\n",
					ar.Address, ar.ChainID, ar.CriticalCount, ar.HighCount)
			default:
				fmt.Fprintf(&b, "- `%s` (chain %d): %d findings (no Critical/High)\n",
					ar.Address, ar.ChainID, ar.TotalFindings)
			}
		}
		b.WriteString("\n")
	}

	if len(result.Reports) > 0 {
		fmt.Fprintf(&b, "### Reports\n\n")
		fmt.Fprintf(&b, "- **Reports generated:** %d\n\n", len(result.Reports))

		for _, rr := range result.Reports {
			if rr.Error != "" {
				fmt.Fprintf(&b, "- [%s] %s: **FAILED** — %s\n", rr.Severity, rr.Title, rr.Error)
			} else {
				fmt.Fprintf(&b, "- [%s] %s → `%s`\n", rr.Severity, rr.Title, rr.ReportPath)
			}
		}
		b.WriteString("\n")
	}

	if result.Discovery != nil && result.Discovery.TotalNew == 0 && len(result.Analyses) == 0 {
		fmt.Fprintf(&b, "No new contracts discovered and no pending analyses. Everything is up to date.\n")
	}

	return b.String()
}

func (o *Orchestrator) buildSingleContractSummary(
	chainID uint64,
	address string,
	analysis *AnalyzeResult,
	reports []*ReportResult,
) string {
	var b strings.Builder

	fmt.Fprintf(&b, "## Analysis of `%s` on %s (chain %d)\n\n", address, o.cfg.ChainName(chainID), chainID)

	if analysis.Error != "" {
		fmt.Fprintf(&b, "**Analysis failed:** %s\n", analysis.Error)
		return b.String()
	}

	if analysis.ContractName != "" {
		fmt.Fprintf(&b, "**Contract:** %s\n", analysis.ContractName)
	}
	fmt.Fprintf(&b, "**Language:** %s\n\n", analysis.Language)

	fmt.Fprintf(&b, "### Findings Summary\n\n")
	fmt.Fprintf(&b, "| Severity | Count |\n|---|---|\n")
	fmt.Fprintf(&b, "| Critical | %d |\n", analysis.CriticalCount)
	fmt.Fprintf(&b, "| High | %d |\n", analysis.HighCount)
	fmt.Fprintf(&b, "| Medium | %d |\n", analysis.MediumCount)
	fmt.Fprintf(&b, "| Low | %d |\n", analysis.LowCount)
	fmt.Fprintf(&b, "| Informational | %d |\n\n", analysis.InfoCount)

	if len(analysis.Findings) > 0 {
		fmt.Fprintf(&b, "### All Findings\n\n")
		for i, f := range analysis.Findings {
			fmt.Fprintf(&b, "%d. **[%s]** %s\n", i+1, f.Severity, f.Title)
			fmt.Fprintf(&b, "   - Function: `%s`\n", f.AffectedFunction)
			fmt.Fprintf(&b, "   - Confidence: %.0f%%\n", f.Confidence*100)
			if f.Impact != "" {
				fmt.Fprintf(&b, "   - Impact: %s\n", f.Impact)
			}
			b.WriteString("\n")
		}
	}

	if len(reports) > 0 {
		fmt.Fprintf(&b, "### Generated Reports\n\n")
		for _, rr := range reports {
			if rr.Error != "" {
				fmt.Fprintf(&b, "- [%s] %s: **FAILED** — %s\n", rr.Severity, rr.Title, rr.Error)
			} else {
				fmt.Fprintf(&b, "- [%s] %s → `%s`\n", rr.Severity, rr.Title, rr.ReportPath)
			}
		}
	} else if analysis.CriticalCount+analysis.HighCount == 0 {
		fmt.Fprintf(&b, "No Critical or High severity findings — no bug bounty reports generated.\n")
	}

	return b.String()
}

func countNewContracts(dr *DiscoverResult) int {
	if dr == nil {
		return 0
	}
	return dr.TotalNew
}
