package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"google.golang.org/adk/agent/llmagent"
	"google.golang.org/adk/model/gemini"
	"google.golang.org/adk/runner"
	"google.golang.org/adk/session"
	"google.golang.org/adk/tool"
	"google.golang.org/adk/tool/functiontool"
	"google.golang.org/genai"

	tea "charm.land/bubbletea/v2"

	agentpkg "github.com/julienrbrt/bim/internal/agent"
	"github.com/julienrbrt/bim/internal/analyzer"
	"github.com/julienrbrt/bim/internal/config"
	"github.com/julienrbrt/bim/internal/reporter"
	"github.com/julienrbrt/bim/internal/sourcify"
	"github.com/julienrbrt/bim/internal/store"
	"github.com/julienrbrt/bim/internal/tui"
)

const (
	appName = "bim"
	userID  = "user"
)

func main() {
	ctx := context.Background()

	configPath := envOr("BIM_CONFIG", "config.yaml")
	cfg, err := config.Load(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load config from %s: %v\n", configPath, err)
		os.Exit(1)
	}

	// Create the shared progRef and LogSink *before* any component so that
	// every *slog.Logger handed out below writes into the TUI log tab
	// instead of stderr.  Lines emitted before tea.Program is wired up are
	// buffered inside the LogSink and flushed once the program starts.
	tuiModel := tui.New(tui.Config{Ctx: ctx}) // lightweight; Runner/SessionID filled later
	ref := tuiModel.ProgRef()
	logSink := tui.NewLogSink(ref)

	logger := slog.New(slog.NewTextHandler(logSink, &slog.HandlerOptions{
		Level: parseLogLevel(cfg.LogLevel),
	}))
	slog.SetDefault(logger)

	logger.Info("configuration loaded",
		"config_path", configPath,
		"model", cfg.ModelName,
		"chains", len(cfg.Chains),
		"data_dir", cfg.DataDir,
	)

	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		logger.Error("failed to create data directory", "path", cfg.DataDir, "error", err)
		os.Exit(1)
	}

	adkModel, err := gemini.NewModel(ctx, cfg.ModelName, &genai.ClientConfig{
		APIKey:  cfg.GoogleAPIKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		logger.Error("failed to create ADK Gemini model", "error", err)
		os.Exit(1)
	}

	genaiClient, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  cfg.GoogleAPIKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		logger.Error("failed to create genai client", "error", err)
		os.Exit(1)
	}

	st, err := store.NewSQLiteStore(cfg.DBPath, logger)
	if err != nil {
		logger.Error("failed to initialize SQLite store", "path", cfg.DBPath, "error", err)
		os.Exit(1)
	}
	defer st.Close()

	sourcifyClient := sourcify.NewClient(cfg.SourcifyBaseURL, nil, logger)

	contractSource := func(ctx context.Context, chainID uint64) ([]string, error) {
		return sourcifyClient.GetRecentlyVerified(ctx, chainID, sourcify.MaxRecentContracts)
	}

	llmAdapter := &genaiLLMAdapter{
		client:    genaiClient,
		modelName: cfg.ModelName,
	}

	az := analyzer.New(llmAdapter, logger, cfg.ModelName, cfg)
	rep := reporter.New(llmAdapter, cfg.DataDir, logger)

	discoveryTool := agentpkg.NewDiscoveryTool(sourcifyClient, st, contractSource, logger, cfg)
	analyzerTool := agentpkg.NewAnalyzerTool(az, sourcifyClient, st, logger, cfg)
	reporterTool := agentpkg.NewReporterTool(rep, sourcifyClient, st, logger, cfg)
	orch := agentpkg.NewOrchestrator(discoveryTool, analyzerTool, reporterTool, logger, cfg)

	tools, err := buildTools(orch, discoveryTool, logger)
	if err != nil {
		os.Exit(1)
	}

	// Start background discovery polling at the configured interval.
	discoveryTool.StartBackgroundPolling(ctx)
	defer discoveryTool.Stop()

	bimAgent, err := llmagent.New(llmagent.Config{
		Name:        appName,
		Model:       adkModel,
		Description: "BiM — AI-powered smart contract security agent for Ethereum and Base. Discovers new contracts, finds vulnerabilities, and generates bug bounty reports with PoC exploits.",
		Instruction: agentpkg.OrchestratorSystemPrompt(),
		Tools:       tools,
	})
	if err != nil {
		logger.Error("failed to create ADK agent", "error", err)
		os.Exit(1)
	}

	// --- Session + Runner ---------------------------------------------------

	sessionSvc := session.InMemoryService()

	sessionID, err := tui.EnsureSession(ctx, sessionSvc, appName, userID, "default")
	if err != nil {
		logger.Error("failed to ensure session", "error", err)
		os.Exit(1)
	}

	r, err := runner.New(runner.Config{
		AppName:        appName,
		Agent:          bimAgent,
		SessionService: sessionSvc,
	})
	if err != nil {
		logger.Error("failed to create ADK runner", "error", err)
		os.Exit(1)
	}

	// --- TUI ----------------------------------------------------------------

	// Fill in the fields that were not available at initial construction.
	tuiModel.SetRunnerConfig(r, sessionID, userID)
	tuiModel.SetLogSink(logSink)

	p := tea.NewProgram(tuiModel)
	ref.Set(p)

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "BiM exited with error: %v\n", err)
		os.Exit(1)
	}
}

func buildTools(orch *agentpkg.Orchestrator, discovery *agentpkg.DiscoveryTool, logger *slog.Logger) ([]tool.Tool, error) {
	type emptyInput struct{}

	discoverFn, err := functiontool.New(
		functiontool.Config{
			Name:        "discover_contracts",
			Description: "Poll Sourcify for new verified smart contracts on Ethereum and Base. Returns a summary of newly discovered contracts ready for analysis.",
		},
		func(ctx tool.Context, _ emptyInput) (map[string]any, error) {
			result, err := orch.RunDiscovery(ctx)
			if err != nil {
				return nil, err
			}
			return map[string]any{"result": result.String()}, nil
		},
	)
	if err != nil {
		logger.Error("failed to create discover_contracts tool", "error", err)
		return nil, err
	}

	type analyzeInput struct {
		ChainID uint64 `json:"chainId" jsonschema:"The chain ID where the contract is deployed. Use 1 for Ethereum Mainnet and 8453 for Base."`
		Address string `json:"address" jsonschema:"The contract address to analyze (hex format with 0x prefix)."`
	}

	analyzeFn, err := functiontool.New(
		functiontool.Config{
			Name:        "analyze_contract",
			Description: "Run an AI-powered security analysis on a verified smart contract. Discovers the contract on Sourcify, analyzes it for vulnerabilities, and generates reports for Critical/High findings. Returns findings ranked by severity.",
		},
		func(ctx tool.Context, input analyzeInput) (map[string]any, error) {
			result, err := orch.ProcessContract(ctx, input.ChainID, input.Address)
			if err != nil {
				return nil, err
			}
			return map[string]any{"result": result.String()}, nil
		},
	)
	if err != nil {
		logger.Error("failed to create analyze_contract tool", "error", err)
		return nil, err
	}

	type reportInput struct {
		FindingID string `json:"findingId" jsonschema:"The unique ID of the finding to generate a report for (e.g. FINDING-001)."`
	}

	reportFn, err := functiontool.New(
		functiontool.Config{
			Name:        "generate_report",
			Description: "Generate a bug bounty report with proof-of-concept exploit code for a specific security finding.",
		},
		func(ctx tool.Context, input reportInput) (map[string]any, error) {
			result, err := orch.GenerateReport(ctx, input.FindingID)
			if err != nil {
				return nil, err
			}
			return map[string]any{"result": result.String()}, nil
		},
	)
	if err != nil {
		logger.Error("failed to create generate_report tool", "error", err)
		return nil, err
	}

	pipelineFn, err := functiontool.New(
		functiontool.Config{
			Name:        "run_pipeline",
			Description: "Run the full discover, analyze, and report pipeline. Finds new contracts, analyzes them for vulnerabilities, and generates reports for Critical/High findings.",
		},
		func(ctx tool.Context, _ emptyInput) (map[string]any, error) {
			result, err := orch.RunFullPipeline(ctx)
			if err != nil {
				return nil, err
			}
			return map[string]any{"result": result.String()}, nil
		},
	)
	if err != nil {
		logger.Error("failed to create run_pipeline tool", "error", err)
		return nil, err
	}

	type pocInput struct {
		FindingID string `json:"findingId" jsonschema:"The unique ID of the finding to generate a PoC for."`
	}

	pocFn, err := functiontool.New(
		functiontool.Config{
			Name:        "generate_poc",
			Description: "Generate only the Foundry proof-of-concept exploit code for a finding, without the full report.",
		},
		func(ctx tool.Context, input pocInput) (map[string]any, error) {
			poc, err := orch.GeneratePoC(ctx, input.FindingID)
			if err != nil {
				return nil, err
			}
			return map[string]any{"result": poc}, nil
		},
	)
	if err != nil {
		logger.Error("failed to create generate_poc tool", "error", err)
		return nil, err
	}

	type reanalyzeInput struct {
		ChainID uint64 `json:"chainId" jsonschema:"The chain ID where the contract is deployed."`
		Address string `json:"address" jsonschema:"The contract address to re-analyze."`
	}

	reanalyzeFn, err := functiontool.New(
		functiontool.Config{
			Name:        "reanalyze_contract",
			Description: "Force a re-analysis of a previously analyzed contract. Useful when you want a fresh look or the contract was updated.",
		},
		func(ctx tool.Context, input reanalyzeInput) (map[string]any, error) {
			result, err := orch.ReAnalyzeContract(ctx, input.ChainID, input.Address)
			if err != nil {
				return nil, err
			}
			return map[string]any{"result": result.String()}, nil
		},
	)
	if err != nil {
		logger.Error("failed to create reanalyze_contract tool", "error", err)
		return nil, err
	}

	type displayReportInput struct {
		FindingID string `json:"findingId" jsonschema:"The unique ID of the finding whose report to display (e.g. FINDING-001)."`
	}

	displayReportFn, err := functiontool.New(
		functiontool.Config{
			Name:        "display_report",
			Description: "Display the full Markdown content of a previously generated bug bounty report for a specific finding. Use this when the user asks to see, show, or read a report.",
		},
		func(ctx tool.Context, input displayReportInput) (map[string]any, error) {
			content, err := orch.DisplayReport(ctx, input.FindingID)
			if err != nil {
				return nil, err
			}
			return map[string]any{"report": content}, nil
		},
	)
	if err != nil {
		logger.Error("failed to create display_report tool", "error", err)
		return nil, err
	}

	discoveryStatusFn, err := functiontool.New(
		functiontool.Config{
			Name:        "discovery_status",
			Description: "Get the status of the background contract discovery loop: whether it is running, the poll interval, how many cycles have completed, how many new contracts were found cumulatively, the last run time, and the latest discovery results.",
		},
		func(ctx tool.Context, _ emptyInput) (map[string]any, error) {
			status := discovery.LatestResults()
			result := map[string]any{
				"running":      status.Running,
				"pollInterval": status.PollInterval.String(),
				"totalRuns":    status.TotalRuns,
				"totalFound":   status.TotalFound,
				"lastRunAt":    status.LastRunAt,
				"lastError":    status.LastError,
			}
			if status.LatestResults != nil {
				result["latestResults"] = status.LatestResults.String()
			}
			return result, nil
		},
	)
	if err != nil {
		logger.Error("failed to create discovery_status tool", "error", err)
		return nil, err
	}

	return []tool.Tool{discoverFn, analyzeFn, reportFn, displayReportFn, pipelineFn, pocFn, reanalyzeFn, discoveryStatusFn}, nil
}

type genaiLLMAdapter struct {
	client    *genai.Client
	modelName string
}

func (a *genaiLLMAdapter) Generate(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
	resp, err := a.client.Models.GenerateContent(ctx, a.modelName, []*genai.Content{
		genai.NewContentFromText(userPrompt, genai.RoleUser),
	}, &genai.GenerateContentConfig{
		SystemInstruction: genai.NewContentFromText(systemPrompt, genai.RoleUser),
	})
	if err != nil {
		return "", fmt.Errorf("gemini generate content: %w", err)
	}
	return resp.Text(), nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func parseLogLevel(s string) slog.Level {
	switch s {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
