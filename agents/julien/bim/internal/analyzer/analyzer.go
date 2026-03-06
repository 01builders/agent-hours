// Package analyzer provides AI-powered security analysis of smart contract source code.
package analyzer

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/julienrbrt/bim/internal/config"
)

// LLM is the interface for interacting with a language model.
type LLM interface {
	Generate(ctx context.Context, systemPrompt, userPrompt string) (string, error)
}

// Analyzer performs AI-powered security analysis on smart contract source code.
type Analyzer struct {
	llm       LLM
	logger    *slog.Logger
	modelName string
	cfg       *config.Config
	skills    []*Skill
}

// New creates a new Analyzer with the given LLM backend.
func New(llm LLM, logger *slog.Logger, modelName string, cfg *config.Config) *Analyzer {
	skills, err := LoadAllSkills()
	if err != nil {
		logger.Warn("failed to load analysis skills, continuing without them", "error", err)
	} else {
		logger.Info("loaded analysis skills", "count", len(skills))
	}
	return &Analyzer{
		llm:       llm,
		logger:    logger,
		modelName: modelName,
		cfg:       cfg,
		skills:    skills,
	}
}

// Analyze performs a full security analysis on the provided contract source code.
// For large contracts (exceeding MaxSinglePassTokens), it uses a two-pass strategy:
// summarize each file first, then deep-dive on flagged functions.
func (a *Analyzer) Analyze(ctx context.Context, input AnalysisInput) (*AnalysisResult, error) {
	start := time.Now()
	analysisID := uuid.New().String()

	a.logger.Info("starting security analysis",
		"analysis_id", analysisID,
		"chain_id", input.ChainID,
		"address", input.Address,
		"contract", input.ContractName,
		"source_files", len(input.Sources),
	)

	result := &AnalysisResult{
		ID:        analysisID,
		ChainID:   input.ChainID,
		Address:   input.Address,
		ModelUsed: a.modelName,
		Summary: ContractSummary{
			Name:             input.ContractName,
			Language:         input.Language,
			CompilerVersion:  input.CompilerVersion,
			TotalSourceFiles: len(input.Sources),
			TotalLines:       countLines(input.Sources),
		},
	}

	tokenEstimate := EstimateTokenCount(input.Sources)
	a.logger.Info("estimated token count",
		"analysis_id", analysisID,
		"tokens", tokenEstimate,
		"max_single_pass", MaxSinglePassTokens,
	)

	var findings []Finding
	var err error

	if tokenEstimate > MaxSinglePassTokens {
		a.logger.Info("using two-pass analysis strategy (large contract)", "analysis_id", analysisID)
		findings, err = a.analyzeTwoPass(ctx, input)
	} else {
		findings, err = a.analyzeSinglePass(ctx, input)
	}

	if err != nil {
		result.Error = err.Error()
		result.AnalyzedAt = time.Now().UTC()
		result.Duration = time.Since(start)
		return result, err
	}

	result.Findings = findings
	result.AnalyzedAt = time.Now().UTC()
	result.Duration = time.Since(start)

	a.logger.Info("analysis complete",
		"analysis_id", analysisID,
		"findings", len(findings),
		"critical_high", len(result.CriticalAndHighFindings()),
		"duration", result.Duration,
	)

	return result, nil
}

func (a *Analyzer) analyzeSinglePass(ctx context.Context, input AnalysisInput) ([]Finding, error) {
	chainName := a.cfg.ChainName(input.ChainID)
	prompt := BuildAnalysisPrompt(input.ContractName, chainName, input.Address, input.Sources)
	systemPrompt := a.buildSystemPrompt(input.Sources, input.Language)

	a.logger.Debug("sending single-pass analysis prompt",
		"prompt_length", len(prompt),
		"system_prompt_length", len(systemPrompt),
	)

	response, err := a.llm.Generate(ctx, systemPrompt, prompt)
	if err != nil {
		return nil, fmt.Errorf("LLM generation failed: %w", err)
	}

	return a.parseAnalysisResponse(response)
}

func (a *Analyzer) analyzeTwoPass(ctx context.Context, input AnalysisInput) ([]Finding, error) {
	type fileSummaryResult struct {
		FileSummary string `json:"fileSummary"`
		HighRisk    []struct {
			Name      string `json:"name"`
			Reason    string `json:"reason"`
			LineRange string `json:"lineRange"`
		} `json:"highRiskFunctions"`
		Imports        []string `json:"imports"`
		Inherits       []string `json:"inherits"`
		StateVariables []string `json:"stateVariables"`
	}

	var allHighRisk []map[string]string
	var summaryErrors []string

	systemPrompt := a.buildSystemPrompt(input.Sources, input.Language)

	for filePath, content := range input.Sources {
		a.logger.Debug("summarizing source file",
			"file", filePath,
			"lines", strings.Count(content, "\n")+1,
		)

		prompt := BuildSummaryPrompt(input.ContractName, filePath, content)
		response, err := a.llm.Generate(ctx, systemPrompt, prompt)
		if err != nil {
			summaryErrors = append(summaryErrors, fmt.Sprintf("%s: %v", filePath, err))
			continue
		}

		cleaned := cleanJSONResponse(response)
		var summary fileSummaryResult
		if err := json.Unmarshal([]byte(cleaned), &summary); err != nil {
			a.logger.Warn("failed to parse file summary",
				"file", filePath,
				"error", err,
				"response_preview", truncate(response, 200),
			)
			continue
		}

		for _, hr := range summary.HighRisk {
			allHighRisk = append(allHighRisk, map[string]string{
				"file":      filePath,
				"name":      hr.Name,
				"reason":    hr.Reason,
				"lineRange": hr.LineRange,
			})
		}
	}

	if len(summaryErrors) > 0 {
		a.logger.Warn("some file summaries failed", "errors", summaryErrors)
	}

	if len(allHighRisk) == 0 {
		a.logger.Info("no high-risk functions flagged in pass 1, skipping deep-dive")
		return nil, nil
	}

	a.logger.Info("pass 2: deep-diving on flagged functions", "flagged_functions", len(allHighRisk))

	flaggedJSON, err := json.MarshalIndent(allHighRisk, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshaling flagged functions: %w", err)
	}

	prompt := BuildDeepDivePrompt(input.ContractName, input.Sources, string(flaggedJSON))
	response, err := a.llm.Generate(ctx, systemPrompt, prompt)
	if err != nil {
		return nil, fmt.Errorf("deep-dive LLM generation failed: %w", err)
	}

	return a.parseAnalysisResponse(response)
}

type analysisResponse struct {
	Summary struct {
		Type             string   `json:"type"`
		Name             string   `json:"name"`
		Description      string   `json:"description"`
		PublicFunctions  []string `json:"publicFunctions"`
		TotalSourceFiles int      `json:"totalSourceFiles"`
		TotalLines       int      `json:"totalLines"`
	} `json:"summary"`
	Findings []Finding `json:"findings"`
}

func (a *Analyzer) parseAnalysisResponse(response string) ([]Finding, error) {
	cleaned := cleanJSONResponse(response)

	var result analysisResponse
	if err := json.Unmarshal([]byte(cleaned), &result); err != nil {
		var findingsOnly struct {
			Findings []Finding `json:"findings"`
		}
		if err2 := json.Unmarshal([]byte(cleaned), &findingsOnly); err2 != nil {
			a.logger.Error("failed to parse analysis response",
				"error", err,
				"response_preview", truncate(response, 500),
			)
			return nil, fmt.Errorf("parsing analysis response: %w (original: %w)", err2, err)
		}
		result.Findings = findingsOnly.Findings
	}

	var valid []Finding
	for i, f := range result.Findings {
		if f.ID == "" {
			f.ID = fmt.Sprintf("FINDING-%03d", i+1)
		}
		if !f.Severity.Valid() {
			a.logger.Warn("finding has invalid severity, defaulting to Medium",
				"finding_id", f.ID, "severity", f.Severity,
			)
			f.Severity = SeverityMedium
		}
		if f.Title == "" {
			a.logger.Warn("skipping finding with empty title", "finding_id", f.ID)
			continue
		}
		f.Confidence = max(0, min(1, f.Confidence))
		valid = append(valid, f)
	}

	return valid, nil
}

// cleanJSONResponse extracts JSON from an LLM response that may contain
// markdown code fences or other wrapper text.
func cleanJSONResponse(response string) string {
	s := strings.TrimSpace(response)

	if after, ok := strings.CutPrefix(s, "```json"); ok {
		s = after
		if idx := strings.LastIndex(s, "```"); idx >= 0 {
			s = s[:idx]
		}
	} else if after, ok := strings.CutPrefix(s, "```"); ok {
		s = after
		if idx := strings.LastIndex(s, "```"); idx >= 0 {
			s = s[:idx]
		}
	}

	s = strings.TrimSpace(s)

	// Find the first '{' if the response doesn't start with one.
	if len(s) > 0 && s[0] != '{' {
		if idx := strings.Index(s, "{"); idx >= 0 {
			s = s[idx:]
		}
	}

	// Trim trailing content after the JSON object closes.
	if len(s) > 0 && s[0] == '{' {
		depth := 0
		inString := false
		escaped := false
		for i, ch := range s {
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' && inString {
				escaped = true
				continue
			}
			if ch == '"' {
				inString = !inString
				continue
			}
			if inString {
				continue
			}
			switch ch {
			case '{':
				depth++
			case '}':
				depth--
				if depth == 0 {
					return s[:i+1]
				}
			}
		}
	}

	return s
}

func countLines(sources map[string]string) int {
	total := 0
	for _, content := range sources {
		total += strings.Count(content, "\n") + 1
	}
	return total
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// buildSystemPrompt constructs a system prompt augmented with relevant skills.
func (a *Analyzer) buildSystemPrompt(sources map[string]string, language string) string {
	if len(a.skills) == 0 {
		return SystemPrompt()
	}

	selectedNames := selectSkillsForSource(sources, language)
	if len(selectedNames) == 0 {
		return SystemPrompt()
	}

	var selected []*Skill
	for _, name := range selectedNames {
		for _, skill := range a.skills {
			if skill.Name == name {
				selected = append(selected, skill)
				break
			}
		}
	}

	if len(selected) == 0 {
		return SystemPrompt()
	}

	a.logger.Debug("injecting skills into system prompt", "skills", selectedNames, "count", len(selected))

	return SystemPrompt() + "\n\n" + FormatSkillsBlock(selected)
}
