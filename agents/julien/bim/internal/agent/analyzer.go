package agent

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/julienrbrt/bim/internal/analyzer"
	"github.com/julienrbrt/bim/internal/config"
	"github.com/julienrbrt/bim/internal/sourcify"
	"github.com/julienrbrt/bim/internal/store"
)

// AnalyzerTool fetches verified contract source code from Sourcify and runs
// LLM-powered security analysis, persisting results in the store.
type AnalyzerTool struct {
	analyzer *analyzer.Analyzer
	sourcify *sourcify.Client
	store    store.Store
	cfg      *config.Config
	logger   *slog.Logger
}

func NewAnalyzerTool(
	az *analyzer.Analyzer,
	sourcifyClient *sourcify.Client,
	st store.Store,
	logger *slog.Logger,
	cfg *config.Config,
) *AnalyzerTool {
	return &AnalyzerTool{
		analyzer: az,
		sourcify: sourcifyClient,
		store:    st,
		cfg:      cfg,
		logger:   logger,
	}
}

// AnalyzeResult holds the output of an analysis run exposed to the agent layer.
type AnalyzeResult struct {
	AnalysisID    string             `json:"analysisId"`
	ChainID       uint64             `json:"chainId"`
	Address       string             `json:"address"`
	ContractName  string             `json:"contractName"`
	Language      string             `json:"language"`
	TotalFindings int                `json:"totalFindings"`
	CriticalCount int                `json:"criticalCount"`
	HighCount     int                `json:"highCount"`
	MediumCount   int                `json:"mediumCount"`
	LowCount      int                `json:"lowCount"`
	InfoCount     int                `json:"infoCount"`
	Findings      []analyzer.Finding `json:"findings"`
	Summary       string             `json:"summary"`
	Error         string             `json:"error,omitempty"`
}

func (r *AnalyzeResult) String() string {
	if r.Error != "" {
		return fmt.Sprintf("Analysis failed for %s on chain %d: %s", r.Address, r.ChainID, r.Error)
	}
	return r.Summary
}

// Analyze runs the full security analysis pipeline for a single contract.
func (t *AnalyzerTool) Analyze(ctx context.Context, chainID uint64, address string) (*AnalyzeResult, error) {
	address = normalizeAddress(address)

	t.logger.Info("starting contract analysis",
		"chain_id", chainID,
		"address", address,
	)

	result := &AnalyzeResult{
		ChainID: chainID,
		Address: address,
	}

	if err := t.store.UpdateContractStatus(ctx, chainID, address, store.StatusAnalyzing, ""); err != nil {
		t.logger.Warn("failed to update contract status to analyzing",
			"chain_id", chainID,
			"address", address,
			"error", err,
		)
	}

	contract, err := t.sourcify.GetContract(ctx, chainID, address)
	if err != nil {
		errMsg := fmt.Sprintf("failed to fetch source from Sourcify: %v", err)
		result.Error = errMsg
		t.markFailed(ctx, chainID, address, errMsg)
		return result, fmt.Errorf("fetching contract source: %w", err)
	}

	if len(contract.Sources) == 0 {
		errMsg := "contract has no source files on Sourcify"
		result.Error = errMsg
		t.markFailed(ctx, chainID, address, errMsg)
		return result, fmt.Errorf("%s", errMsg)
	}

	sources := make(map[string]string, len(contract.Sources))
	for path, src := range contract.Sources {
		sources[path] = src.Content
	}

	var language, compilerVersion, contractName string
	if contract.Compilation != nil {
		language = contract.Compilation.Language
		compilerVersion = contract.Compilation.CompilerVersion
		contractName = contract.Compilation.FullyQualifiedName
	}

	input := analyzer.AnalysisInput{
		ChainID:         chainID,
		Address:         address,
		Sources:         sources,
		Language:        language,
		CompilerVersion: compilerVersion,
		ContractName:    contractName,
	}

	result.ContractName = input.ContractName
	result.Language = input.Language

	analysisResult, err := t.analyzer.Analyze(ctx, input)
	if err != nil {
		errMsg := fmt.Sprintf("analysis failed: %v", err)
		result.Error = errMsg
		t.markFailed(ctx, chainID, address, errMsg)
		return result, fmt.Errorf("running analysis: %w", err)
	}

	result.AnalysisID = analysisResult.ID
	result.TotalFindings = len(analysisResult.Findings)
	result.Findings = analysisResult.Findings

	for _, f := range analysisResult.Findings {
		switch f.Severity {
		case analyzer.SeverityCritical:
			result.CriticalCount++
		case analyzer.SeverityHigh:
			result.HighCount++
		case analyzer.SeverityMedium:
			result.MediumCount++
		case analyzer.SeverityLow:
			result.LowCount++
		case analyzer.SeverityInfo:
			result.InfoCount++
		}
	}

	result.Summary = t.buildSummary(result, analysisResult)

	if err := t.store.SaveAnalysisResult(ctx, analysisResult); err != nil {
		t.logger.Error("failed to persist analysis result",
			"analysis_id", analysisResult.ID,
			"error", err,
		)
	}

	t.logger.Info("contract analysis complete",
		"analysis_id", analysisResult.ID,
		"chain_id", chainID,
		"address", address,
		"total_findings", result.TotalFindings,
		"critical", result.CriticalCount,
		"high", result.HighCount,
		"duration", analysisResult.Duration,
	)

	return result, nil
}

// AnalyzePending fetches all contracts with status "pending" and runs analysis on each.
func (t *AnalyzerTool) AnalyzePending(ctx context.Context) ([]*AnalyzeResult, error) {
	contracts, err := t.store.ListContracts(ctx, store.ContractFilter{
		Status: store.StatusPending,
	})
	if err != nil {
		return nil, fmt.Errorf("listing pending contracts: %w", err)
	}

	t.logger.Info("analyzing pending contracts", "count", len(contracts))

	var results []*AnalyzeResult
	for _, c := range contracts {
		if ctx.Err() != nil {
			break
		}

		result, err := t.Analyze(ctx, c.ChainID, c.Address)
		if err != nil {
			t.logger.Error("analysis failed for pending contract",
				"chain_id", c.ChainID,
				"address", c.Address,
				"error", err,
			)
		}
		results = append(results, result)
	}

	return results, nil
}

// ReAnalyze forces a re-analysis by resetting the contract status first.
func (t *AnalyzerTool) ReAnalyze(ctx context.Context, chainID uint64, address string) (*AnalyzeResult, error) {
	address = normalizeAddress(address)

	t.logger.Info("re-analyzing contract",
		"chain_id", chainID,
		"address", address,
	)

	if err := t.store.UpdateContractStatus(ctx, chainID, address, store.StatusPending, ""); err != nil {
		t.logger.Warn("failed to reset contract status for re-analysis",
			"chain_id", chainID,
			"address", address,
			"error", err,
		)
	}

	return t.Analyze(ctx, chainID, address)
}

func (t *AnalyzerTool) buildSummary(result *AnalyzeResult, analysis *analyzer.AnalysisResult) string {
	var b strings.Builder
	fmt.Fprintf(&b,
		"Security analysis of %s (%s) on %s completed in %s.\n",
		result.ContractName,
		result.Address,
		t.cfg.ChainName(result.ChainID),
		analysis.Duration.Round(time.Second),
	)

	fmt.Fprintf(&b,
		"Found %d total findings: %d Critical, %d High, %d Medium, %d Low, %d Informational.\n",
		result.TotalFindings,
		result.CriticalCount,
		result.HighCount,
		result.MediumCount,
		result.LowCount,
		result.InfoCount,
	)

	actionable := analysis.CriticalAndHighFindings()
	if len(actionable) > 0 {
		fmt.Fprintf(&b, "\n%d actionable findings (Critical/High) for bug bounty reporting:\n", len(actionable))
		for i, f := range actionable {
			fmt.Fprintf(&b, "  %d. [%s] %s — %s (confidence: %.0f%%)\n",
				i+1, f.Severity, f.Title, f.AffectedFunction, f.Confidence*100)
		}
	} else {
		b.WriteString("\nNo Critical or High severity findings detected.")
	}

	if analysis.Summary.Description != "" {
		fmt.Fprintf(&b, "\nContract summary: %s", analysis.Summary.Description)
	}

	return b.String()
}

func (t *AnalyzerTool) markFailed(ctx context.Context, chainID uint64, address, errMsg string) {
	if err := t.store.UpdateContractStatus(ctx, chainID, address, store.StatusFailed, errMsg); err != nil {
		t.logger.Error("failed to mark contract as failed",
			"chain_id", chainID,
			"address", address,
			"error", err,
		)
	}
}
