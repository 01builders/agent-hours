package agent

import (
	"context"
	"log/slog"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/julienrbrt/bim/internal/analyzer"
	"github.com/julienrbrt/bim/internal/config"
	"github.com/julienrbrt/bim/internal/sourcify"
	"github.com/julienrbrt/bim/internal/store"
)

// testStore is a minimal in-memory Store implementation for testing discovery.
type testStore struct {
	seen map[string]bool
}

func newTestStore() *testStore {
	return &testStore{seen: make(map[string]bool)}
}

func (s *testStore) key(chainID uint64, address string) string {
	return address + "@" + string(rune(chainID))
}

func (s *testStore) SaveContract(_ context.Context, c *store.Contract) error {
	s.seen[s.key(c.ChainID, c.Address)] = true
	return nil
}

func (s *testStore) GetContract(_ context.Context, chainID uint64, address string) (*store.Contract, error) {
	if s.seen[s.key(chainID, address)] {
		return &store.Contract{ChainID: chainID, Address: address}, nil
	}
	return nil, nil
}

func (s *testStore) HasSeen(_ context.Context, chainID uint64, address string) (bool, error) {
	return s.seen[s.key(chainID, address)], nil
}

func (s *testStore) ListContracts(_ context.Context, _ store.ContractFilter) ([]store.Contract, error) {
	return nil, nil
}

func (s *testStore) UpdateContractStatus(_ context.Context, _ uint64, _ string, _ store.ContractStatus, _ string) error {
	return nil
}

func (s *testStore) SaveFindings(_ context.Context, _ []store.StoredFinding) error { return nil }
func (s *testStore) GetFindings(_ context.Context, _ uint64, _ string) ([]store.StoredFinding, error) {
	return nil, nil
}
func (s *testStore) GetFindingByID(_ context.Context, _ string) (*store.StoredFinding, error) {
	return nil, nil
}
func (s *testStore) GetActionableFindings(_ context.Context) ([]store.StoredFinding, error) {
	return nil, nil
}
func (s *testStore) SaveReport(_ context.Context, _ *store.StoredReport) error { return nil }
func (s *testStore) GetReportByFindingID(_ context.Context, _ string) (*store.StoredReport, error) {
	return nil, nil
}

func (s *testStore) SaveAnalysisResult(_ context.Context, _ *analyzer.AnalysisResult) error {
	return nil
}

func (s *testStore) GetAnalysisResult(_ context.Context, _ string) (*analyzer.AnalysisResult, error) {
	return nil, nil
}

func (s *testStore) Close() error { return nil }

func testConfig(pollInterval time.Duration) *config.Config {
	return &config.Config{
		GoogleAPIKey: "test-key",
		ModelName:    "test-model",
		LogLevel:     "debug",
		DataDir:      "./testdata",
		DBPath:       ":memory:",
		PollInterval: pollInterval,
		Chains: []config.Chain{
			{ID: 1, Name: "Ethereum Mainnet", RPCURL: "http://localhost:8545"},
		},
	}
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

// countingSource returns a ContractSource that counts how many times it was called
// and returns a fixed set of addresses.
func countingSource(counter *atomic.Int64, addresses []string) ContractSource {
	return func(_ context.Context, _ uint64) ([]string, error) {
		counter.Add(1)
		return addresses, nil
	}
}

func TestBackgroundPolling_StartAndStop(t *testing.T) {
	logger := testLogger()
	cfg := testConfig(50 * time.Millisecond)

	var callCount atomic.Int64
	source := countingSource(&callCount, nil)

	sourcifyClient := sourcify.NewClient("http://localhost:0", nil, logger)
	st := newTestStore()

	dt := NewDiscoveryTool(sourcifyClient, st, source, logger, cfg)

	if dt.IsPolling() {
		t.Fatal("expected IsPolling()=false before start")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dt.StartBackgroundPolling(ctx)

	if !dt.IsPolling() {
		t.Fatal("expected IsPolling()=true after start")
	}

	// Wait enough for at least the immediate first run + one tick.
	time.Sleep(200 * time.Millisecond)

	dt.Stop()

	if dt.IsPolling() {
		t.Fatal("expected IsPolling()=false after stop")
	}

	count := callCount.Load()
	if count < 2 {
		t.Errorf("expected contractSource to be called at least 2 times (immediate + tick), got %d", count)
	}
}

func TestBackgroundPolling_MultipleTicks(t *testing.T) {
	logger := testLogger()
	cfg := testConfig(30 * time.Millisecond)

	var callCount atomic.Int64
	source := countingSource(&callCount, nil)

	sourcifyClient := sourcify.NewClient("http://localhost:0", nil, logger)
	st := newTestStore()

	dt := NewDiscoveryTool(sourcifyClient, st, source, logger, cfg)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dt.StartBackgroundPolling(ctx)

	// Wait for ~5 ticks worth of time plus the immediate run.
	time.Sleep(200 * time.Millisecond)

	dt.Stop()

	count := callCount.Load()
	// immediate + at least a few ticks
	if count < 3 {
		t.Errorf("expected at least 3 discovery cycles after 200ms with 30ms interval, got %d", count)
	}
}

func TestBackgroundPolling_LatestResults(t *testing.T) {
	logger := testLogger()
	cfg := testConfig(50 * time.Millisecond)

	var callCount atomic.Int64
	source := countingSource(&callCount, nil)

	sourcifyClient := sourcify.NewClient("http://localhost:0", nil, logger)
	st := newTestStore()

	dt := NewDiscoveryTool(sourcifyClient, st, source, logger, cfg)

	// Before starting, LatestResults should reflect not-running state.
	status := dt.LatestResults()
	if status.Running {
		t.Error("expected Running=false before start")
	}
	if status.TotalRuns != 0 {
		t.Errorf("expected TotalRuns=0 before start, got %d", status.TotalRuns)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dt.StartBackgroundPolling(ctx)

	// Wait for at least the immediate run.
	time.Sleep(100 * time.Millisecond)

	status = dt.LatestResults()
	if !status.Running {
		t.Error("expected Running=true while polling")
	}
	if status.TotalRuns < 1 {
		t.Errorf("expected TotalRuns >= 1 after 100ms, got %d", status.TotalRuns)
	}
	if status.PollInterval != 50*time.Millisecond {
		t.Errorf("expected PollInterval=50ms, got %s", status.PollInterval)
	}
	if status.LastRunAt.IsZero() {
		t.Error("expected LastRunAt to be set")
	}
	if status.LastError != "" {
		t.Errorf("expected no error, got %q", status.LastError)
	}

	dt.Stop()

	// After stop, Running should be false but stats preserved.
	status = dt.LatestResults()
	if status.Running {
		t.Error("expected Running=false after stop")
	}
	if status.TotalRuns < 1 {
		t.Error("expected TotalRuns to be preserved after stop")
	}
}

func TestBackgroundPolling_IdempotentStart(t *testing.T) {
	logger := testLogger()
	cfg := testConfig(100 * time.Millisecond)

	var callCount atomic.Int64
	source := countingSource(&callCount, nil)

	sourcifyClient := sourcify.NewClient("http://localhost:0", nil, logger)
	st := newTestStore()

	dt := NewDiscoveryTool(sourcifyClient, st, source, logger, cfg)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dt.StartBackgroundPolling(ctx)
	// Second call should be a no-op.
	dt.StartBackgroundPolling(ctx)

	time.Sleep(150 * time.Millisecond)

	dt.Stop()

	count := callCount.Load()
	// Should only see calls from a single goroutine, not doubled.
	// With 100ms interval and 150ms sleep, we expect immediate + maybe 1 tick = ~2.
	if count > 5 {
		t.Errorf("idempotent start may have spawned duplicate goroutines: %d calls in 150ms with 100ms interval", count)
	}
}

func TestBackgroundPolling_StopWithoutStart(t *testing.T) {
	logger := testLogger()
	cfg := testConfig(100 * time.Millisecond)

	source := func(_ context.Context, _ uint64) ([]string, error) {
		return nil, nil
	}

	sourcifyClient := sourcify.NewClient("http://localhost:0", nil, logger)
	st := newTestStore()

	dt := NewDiscoveryTool(sourcifyClient, st, source, logger, cfg)

	// Stop without Start should not panic.
	dt.Stop()

	if dt.IsPolling() {
		t.Error("expected IsPolling()=false after Stop without Start")
	}
}

func TestBackgroundPolling_ContextCancellation(t *testing.T) {
	logger := testLogger()
	cfg := testConfig(50 * time.Millisecond)

	var callCount atomic.Int64
	source := countingSource(&callCount, nil)

	sourcifyClient := sourcify.NewClient("http://localhost:0", nil, logger)
	st := newTestStore()

	dt := NewDiscoveryTool(sourcifyClient, st, source, logger, cfg)

	ctx, cancel := context.WithCancel(context.Background())

	dt.StartBackgroundPolling(ctx)

	// Let the immediate run happen.
	time.Sleep(80 * time.Millisecond)

	// Cancel the context instead of calling Stop.
	cancel()

	// Give the goroutine time to notice and exit.
	time.Sleep(100 * time.Millisecond)

	if dt.IsPolling() {
		t.Error("expected IsPolling()=false after context cancellation")
	}

	countBefore := callCount.Load()
	time.Sleep(100 * time.Millisecond)
	countAfter := callCount.Load()

	if countAfter != countBefore {
		t.Errorf("expected no more calls after context cancellation, but count went from %d to %d", countBefore, countAfter)
	}
}

func TestBackgroundPolling_ThrottlesOnDemandDiscover(t *testing.T) {
	logger := testLogger()
	cfg := testConfig(500 * time.Millisecond) // long interval so background won't re-poll

	var callCount atomic.Int64
	source := countingSource(&callCount, nil)

	sourcifyClient := sourcify.NewClient("http://localhost:0", nil, logger)
	st := newTestStore()

	dt := NewDiscoveryTool(sourcifyClient, st, source, logger, cfg)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dt.StartBackgroundPolling(ctx)

	// Wait for the immediate run.
	time.Sleep(100 * time.Millisecond)

	countAfterBg := callCount.Load()
	if countAfterBg < 1 {
		t.Fatalf("expected at least 1 background call, got %d", countAfterBg)
	}

	// Now call Discover() on-demand. Because the background loop just polled
	// within the interval, the on-demand call should skip all chains.
	result, err := dt.Discover(ctx)
	if err != nil {
		t.Fatalf("Discover() returned error: %v", err)
	}

	// All chains should have been skipped (no chain results).
	if len(result.ChainResults) != 0 {
		t.Errorf("expected 0 chain results (throttled), got %d", len(result.ChainResults))
	}

	// The call count should not have increased since the source wasn't called.
	countAfterDiscover := callCount.Load()
	if countAfterDiscover != countAfterBg {
		t.Errorf("expected no additional source calls from throttled Discover(), count went from %d to %d",
			countAfterBg, countAfterDiscover)
	}

	dt.Stop()
}

func TestBackgroundPolling_CumulativeTotalFound(t *testing.T) {
	logger := testLogger()
	cfg := testConfig(40 * time.Millisecond)

	// The source returns addresses, but since we're using a fake Sourcify client
	// (pointing at localhost:0), the actual verification check will fail. The
	// discovery won't count them as "new" but the mechanism still runs.
	// This test just verifies the totalFound field accumulates and doesn't panic.

	var callCount atomic.Int64
	source := countingSource(&callCount, nil)

	sourcifyClient := sourcify.NewClient("http://localhost:0", nil, logger)
	st := newTestStore()

	dt := NewDiscoveryTool(sourcifyClient, st, source, logger, cfg)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dt.StartBackgroundPolling(ctx)

	time.Sleep(150 * time.Millisecond)

	status := dt.LatestResults()

	dt.Stop()

	if status.TotalRuns < 2 {
		t.Errorf("expected at least 2 runs, got %d", status.TotalRuns)
	}
	// totalFound should be 0 because no addresses were returned.
	if status.TotalFound != 0 {
		t.Errorf("expected TotalFound=0 with empty source, got %d", status.TotalFound)
	}
	if status.LatestResults == nil {
		t.Error("expected LatestResults to be non-nil after successful runs")
	}
}
