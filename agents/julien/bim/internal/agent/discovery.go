package agent

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/julienrbrt/bim/internal/config"
	"github.com/julienrbrt/bim/internal/sourcify"
	"github.com/julienrbrt/bim/internal/store"
)

// ContractSource returns recently created contract addresses for a given chain.
// This abstraction allows plugging in different discovery backends (e.g. RPC watcher,
// Etherscan API) without coupling the discovery tool to a specific implementation.
type ContractSource func(ctx context.Context, chainID uint64) ([]string, error)

// DiscoveryTool discovers new verified contracts on supported chains by
// cross-referencing a ContractSource with the Sourcify API.
type DiscoveryTool struct {
	sourcify       *sourcify.Client
	store          store.Store
	contractSource ContractSource
	cfg            *config.Config
	logger         *slog.Logger
	pollInterval   time.Duration

	mu              sync.Mutex
	lastPollResults map[uint64]time.Time

	// Background polling state.
	bgCancel  context.CancelFunc
	bgDone    chan struct{}
	bgRunning bool

	// Latest background discovery results, protected by resultsMu.
	resultsMu     sync.RWMutex
	latestResults *DiscoverResult
	totalRuns     int64
	totalFound    int64
	lastRunAt     time.Time
	lastError     error
}

// NewDiscoveryTool creates a new DiscoveryTool.
func NewDiscoveryTool(
	sourcifyClient *sourcify.Client,
	st store.Store,
	contractSource ContractSource,
	logger *slog.Logger,
	cfg *config.Config,
) *DiscoveryTool {
	return &DiscoveryTool{
		sourcify:        sourcifyClient,
		store:           st,
		contractSource:  contractSource,
		cfg:             cfg,
		logger:          logger,
		pollInterval:    cfg.PollInterval,
		lastPollResults: make(map[uint64]time.Time),
	}
}

// DiscoverResult holds the output of a discovery run.
type DiscoverResult struct {
	// ChainResults maps chain ID to per-chain discovery results.
	ChainResults map[uint64]*ChainDiscoverResult `json:"chainResults"`
	// TotalNew is the total number of newly discovered verified contracts across all chains.
	TotalNew int `json:"totalNew"`
	// TotalChecked is the total number of addresses checked across all chains.
	TotalChecked int `json:"totalChecked"`
	// TotalAlreadySeen is the total number of addresses that were already in the store.
	TotalAlreadySeen int `json:"totalAlreadySeen"`
	// Duration is how long the discovery run took.
	Duration time.Duration `json:"duration"`
}

// ChainDiscoverResult holds the discovery result for a single chain.
type ChainDiscoverResult struct {
	ChainID      uint64   `json:"chainId"`
	ChainName    string   `json:"chainName"`
	Checked      int      `json:"checked"`
	AlreadySeen  int      `json:"alreadySeen"`
	NotVerified  int      `json:"notVerified"`
	NewContracts []string `json:"newContracts"`
	Errors       []string `json:"errors,omitempty"`
}

func (r *DiscoverResult) String() string {
	var b strings.Builder
	fmt.Fprintf(&b, "Discovery complete in %s: found %d new verified contracts (%d checked, %d already seen).\n",
		r.Duration.Round(time.Millisecond), r.TotalNew, r.TotalChecked, r.TotalAlreadySeen)

	for _, cr := range r.ChainResults {
		fmt.Fprintf(&b, "\n  %s (chain %d): %d new, %d checked, %d already seen, %d not verified",
			cr.ChainName, cr.ChainID, len(cr.NewContracts), cr.Checked, cr.AlreadySeen, cr.NotVerified)
		if len(cr.Errors) > 0 {
			fmt.Fprintf(&b, ", %d errors", len(cr.Errors))
		}
		for _, addr := range cr.NewContracts {
			fmt.Fprintf(&b, "\n    + %s", addr)
		}
	}

	return b.String()
}

// BackgroundStatus holds a snapshot of the background polling loop's state.
type BackgroundStatus struct {
	// Running is true if the background polling loop is active.
	Running bool `json:"running"`
	// PollInterval is the configured interval between discovery runs.
	PollInterval time.Duration `json:"pollInterval"`
	// TotalRuns is the total number of completed discovery cycles.
	TotalRuns int64 `json:"totalRuns"`
	// TotalFound is the cumulative count of new contracts found across all runs.
	TotalFound int64 `json:"totalFound"`
	// LastRunAt is when the last discovery cycle completed.
	LastRunAt time.Time `json:"lastRunAt,omitempty"`
	// LastError is the error from the most recent run, if any.
	LastError string `json:"lastError,omitempty"`
	// LatestResults is the result from the most recent discovery cycle.
	LatestResults *DiscoverResult `json:"latestResults,omitempty"`
}

// StartBackgroundPolling launches a goroutine that calls Discover() at the
// configured poll interval. It is safe to call multiple times; subsequent calls
// are no-ops if the loop is already running. Cancel the parent context or call
// Stop() to shut it down.
func (d *DiscoveryTool) StartBackgroundPolling(ctx context.Context) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.bgRunning {
		d.logger.Warn("background polling already running, ignoring duplicate start")
		return
	}

	bgCtx, cancel := context.WithCancel(ctx)
	d.bgCancel = cancel
	d.bgDone = make(chan struct{})
	d.bgRunning = true

	d.logger.Info("starting background discovery polling",
		"interval", d.pollInterval,
		"chains", d.cfg.ChainIDs(),
	)

	go d.pollLoop(bgCtx)
}

// Stop gracefully shuts down the background polling loop and waits for it to
// finish. It is safe to call even if the loop is not running.
func (d *DiscoveryTool) Stop() {
	d.mu.Lock()
	cancel := d.bgCancel
	done := d.bgDone
	running := d.bgRunning
	d.mu.Unlock()

	if !running {
		return
	}

	d.logger.Info("stopping background discovery polling")
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}

	d.mu.Lock()
	d.bgRunning = false
	d.bgCancel = nil
	d.bgDone = nil
	d.mu.Unlock()

	d.logger.Info("background discovery polling stopped")
}

// IsPolling reports whether the background polling loop is currently running.
func (d *DiscoveryTool) IsPolling() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.bgRunning
}

// LatestResults returns the most recent background discovery result and
// cumulative statistics. Returns nil LatestResults if no background run has
// completed yet.
func (d *DiscoveryTool) LatestResults() *BackgroundStatus {
	d.resultsMu.RLock()
	defer d.resultsMu.RUnlock()

	d.mu.Lock()
	running := d.bgRunning
	d.mu.Unlock()

	status := &BackgroundStatus{
		Running:       running,
		PollInterval:  d.pollInterval,
		TotalRuns:     d.totalRuns,
		TotalFound:    d.totalFound,
		LastRunAt:     d.lastRunAt,
		LatestResults: d.latestResults,
	}
	if d.lastError != nil {
		status.LastError = d.lastError.Error()
	}
	return status
}

// pollLoop is the background goroutine. It runs an immediate first discovery,
// then ticks at pollInterval until the context is cancelled.
func (d *DiscoveryTool) pollLoop(ctx context.Context) {
	defer func() {
		d.mu.Lock()
		d.bgRunning = false
		done := d.bgDone
		d.mu.Unlock()
		if done != nil {
			close(done)
		}
	}()

	// Run an immediate first cycle so we don't wait a full interval on startup.
	d.runOnce(ctx)

	ticker := time.NewTicker(d.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			d.logger.Debug("background polling context cancelled", "reason", ctx.Err())
			return
		case <-ticker.C:
			d.runOnce(ctx)
		}
	}
}

// runOnce executes a single background discovery cycle, updating stored results.
func (d *DiscoveryTool) runOnce(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	d.logger.Debug("background discovery cycle starting")

	result, err := d.discoverAll(ctx)

	d.resultsMu.Lock()
	d.totalRuns++
	d.lastRunAt = time.Now()
	if err != nil {
		d.lastError = err
		d.logger.Error("background discovery cycle failed", "error", err, "run", d.totalRuns)
	} else {
		d.lastError = nil
		d.latestResults = result
		d.totalFound += int64(result.TotalNew)
		d.logger.Info("background discovery cycle complete",
			"run", d.totalRuns,
			"new", result.TotalNew,
			"checked", result.TotalChecked,
			"already_seen", result.TotalAlreadySeen,
			"duration", result.Duration,
			"cumulative_found", d.totalFound,
		)
	}
	d.resultsMu.Unlock()
}

// discoverAll runs discovery across all chains unconditionally (no throttle
// check). This is used by the background loop which already gates on the ticker.
func (d *DiscoveryTool) discoverAll(ctx context.Context) (*DiscoverResult, error) {
	start := time.Now()

	result := &DiscoverResult{
		ChainResults: make(map[uint64]*ChainDiscoverResult),
	}

	for _, chainID := range d.cfg.ChainIDs() {
		if ctx.Err() != nil {
			result.Duration = time.Since(start)
			return result, ctx.Err()
		}

		cr, err := d.discoverChain(ctx, chainID)
		if err != nil {
			d.logger.Error("discovery failed for chain", "chain_id", chainID, "error", err)
			cr = &ChainDiscoverResult{
				ChainID:   chainID,
				ChainName: d.cfg.ChainName(chainID),
				Errors:    []string{err.Error()},
			}
		}

		result.ChainResults[chainID] = cr
		result.TotalNew += len(cr.NewContracts)
		result.TotalChecked += cr.Checked
		result.TotalAlreadySeen += cr.AlreadySeen

		// Update the last-poll timestamp so that an on-demand Discover() call
		// right after a background tick doesn't duplicate work.
		d.mu.Lock()
		d.lastPollResults[chainID] = time.Now()
		d.mu.Unlock()
	}

	result.Duration = time.Since(start)
	return result, nil
}

// Discover runs a discovery cycle across all configured chains. Chains that
// were polled within the last pollInterval (by either a previous Discover()
// call or the background loop) are skipped automatically.
func (d *DiscoveryTool) Discover(ctx context.Context) (*DiscoverResult, error) {
	start := time.Now()

	result := &DiscoverResult{
		ChainResults: make(map[uint64]*ChainDiscoverResult),
	}

	for _, chainID := range d.cfg.ChainIDs() {
		d.mu.Lock()
		lastPoll, exists := d.lastPollResults[chainID]
		d.mu.Unlock()

		if exists && time.Since(lastPoll) < d.pollInterval {
			d.logger.Debug("skipping chain (within poll interval)",
				"chain_id", chainID,
				"last_poll", lastPoll,
				"interval", d.pollInterval,
			)
			continue
		}

		cr, err := d.discoverChain(ctx, chainID)
		if err != nil {
			d.logger.Error("discovery failed for chain", "chain_id", chainID, "error", err)
			cr = &ChainDiscoverResult{
				ChainID:   chainID,
				ChainName: d.cfg.ChainName(chainID),
				Errors:    []string{err.Error()},
			}
		}

		result.ChainResults[chainID] = cr
		result.TotalNew += len(cr.NewContracts)
		result.TotalChecked += cr.Checked
		result.TotalAlreadySeen += cr.AlreadySeen

		d.mu.Lock()
		d.lastPollResults[chainID] = time.Now()
		d.mu.Unlock()
	}

	result.Duration = time.Since(start)

	d.logger.Info("discovery cycle complete",
		"total_new", result.TotalNew,
		"total_checked", result.TotalChecked,
		"duration", result.Duration,
	)

	return result, nil
}

func (d *DiscoveryTool) discoverChain(ctx context.Context, chainID uint64) (*ChainDiscoverResult, error) {
	cr := &ChainDiscoverResult{
		ChainID:   chainID,
		ChainName: d.cfg.ChainName(chainID),
	}

	d.logger.Info("discovering contracts on chain", "chain_id", chainID, "chain_name", cr.ChainName)

	addresses, err := d.contractSource(ctx, chainID)
	if err != nil {
		return cr, fmt.Errorf("fetching contract addresses for chain %d: %w", chainID, err)
	}

	cr.Checked = len(addresses)
	d.logger.Debug("got candidate addresses", "chain_id", chainID, "count", len(addresses))

	for _, addr := range addresses {
		if ctx.Err() != nil {
			return cr, ctx.Err()
		}

		addr = normalizeAddress(addr)

		seen, err := d.store.HasSeen(ctx, chainID, addr)
		if err != nil {
			cr.Errors = append(cr.Errors, fmt.Sprintf("store check %s: %v", addr, err))
			continue
		}
		if seen {
			cr.AlreadySeen++
			continue
		}

		contract, err := d.sourcify.GetContract(ctx, chainID, addr)
		if err != nil {
			if sourcify.IsNotFound(err) {
				cr.NotVerified++
				continue
			}
			cr.Errors = append(cr.Errors, fmt.Sprintf("sourcify check %s: %v", addr, err))
			continue
		}

		if err := d.persistContract(ctx, chainID, addr, contract); err != nil {
			cr.Errors = append(cr.Errors, fmt.Sprintf("persist %s: %v", addr, err))
			continue
		}

		cr.NewContracts = append(cr.NewContracts, addr)
		d.logger.Info("discovered new verified contract",
			"chain_id", chainID,
			"address", addr,
			"match", contract.Match,
			"language", contractLanguage(contract),
		)
	}

	return cr, nil
}

func (d *DiscoveryTool) persistContract(ctx context.Context, chainID uint64, address string, contract *sourcify.ContractResponse) error {
	c := &store.Contract{
		ChainID:   chainID,
		Address:   address,
		MatchType: contract.Match,
		Status:    store.StatusPending,
	}

	if contract.Compilation != nil {
		c.Language = contract.Compilation.Language
		c.CompilerVersion = contract.Compilation.CompilerVersion
		c.Name = contract.Compilation.FullyQualifiedName
	}
	c.SourceCount = len(contract.Sources)

	return d.store.SaveContract(ctx, c)
}

// DiscoverSingleContract checks a specific contract address against Sourcify
// and persists it if verified. Used for ad-hoc requests via the chat interface.
func (d *DiscoveryTool) DiscoverSingleContract(ctx context.Context, chainID uint64, address string) (*store.Contract, error) {
	address = normalizeAddress(address)

	d.logger.Info("checking single contract", "chain_id", chainID, "address", address)

	existing, err := d.store.GetContract(ctx, chainID, address)
	if err != nil {
		return nil, fmt.Errorf("checking store: %w", err)
	}
	if existing != nil {
		d.logger.Info("contract already tracked",
			"chain_id", chainID,
			"address", address,
			"status", existing.Status,
		)
		return existing, nil
	}

	contract, err := d.sourcify.GetContract(ctx, chainID, address)
	if err != nil {
		return nil, fmt.Errorf("fetching from Sourcify: %w", err)
	}

	if err := d.persistContract(ctx, chainID, address, contract); err != nil {
		return nil, fmt.Errorf("persisting contract: %w", err)
	}

	return d.store.GetContract(ctx, chainID, address)
}

func normalizeAddress(addr string) string {
	return strings.ToLower(strings.TrimSpace(addr))
}

func contractLanguage(c *sourcify.ContractResponse) string {
	if c.Compilation != nil {
		return c.Compilation.Language
	}
	return "unknown"
}
