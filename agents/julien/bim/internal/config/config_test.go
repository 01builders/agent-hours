package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoad_ValidConfig(t *testing.T) {
	content := `
google_api_key: test-key-123
model_name: gemini-2.0-flash
log_level: debug
data_dir: /tmp/bim-test
db_path: /tmp/bim-test/bim.db
sourcify_base_url: https://sourcify.example.com
poll_interval: 30s
chains:
  - id: 1
    name: Ethereum Mainnet
    rpc_url: https://eth.example.com
  - id: 8453
    name: Base
    rpc_url: https://base.example.com
`
	path := writeTemp(t, content)

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if cfg.GoogleAPIKey != "test-key-123" {
		t.Errorf("GoogleAPIKey = %q, want %q", cfg.GoogleAPIKey, "test-key-123")
	}
	if cfg.ModelName != "gemini-2.0-flash" {
		t.Errorf("ModelName = %q, want %q", cfg.ModelName, "gemini-2.0-flash")
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel = %q, want %q", cfg.LogLevel, "debug")
	}
	if cfg.DataDir != "/tmp/bim-test" {
		t.Errorf("DataDir = %q, want %q", cfg.DataDir, "/tmp/bim-test")
	}
	if cfg.DBPath != "/tmp/bim-test/bim.db" {
		t.Errorf("DBPath = %q, want %q", cfg.DBPath, "/tmp/bim-test/bim.db")
	}
	if cfg.SourcifyBaseURL != "https://sourcify.example.com" {
		t.Errorf("SourcifyBaseURL = %q, want %q", cfg.SourcifyBaseURL, "https://sourcify.example.com")
	}
	if cfg.PollInterval != 30*time.Second {
		t.Errorf("PollInterval = %v, want %v", cfg.PollInterval, 30*time.Second)
	}
	if len(cfg.Chains) != 2 {
		t.Fatalf("len(Chains) = %d, want 2", len(cfg.Chains))
	}
	if cfg.Chains[0].ID != 1 {
		t.Errorf("Chains[0].ID = %d, want 1", cfg.Chains[0].ID)
	}
	if cfg.Chains[0].Name != "Ethereum Mainnet" {
		t.Errorf("Chains[0].Name = %q, want %q", cfg.Chains[0].Name, "Ethereum Mainnet")
	}
	if cfg.Chains[1].ID != 8453 {
		t.Errorf("Chains[1].ID = %d, want 8453", cfg.Chains[1].ID)
	}
}

func TestLoad_DefaultsApplied(t *testing.T) {
	// Only provide the required field; everything else should get defaults.
	content := `
google_api_key: my-key
`
	path := writeTemp(t, content)

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if cfg.ModelName != "gemini-2.5-pro" {
		t.Errorf("ModelName = %q, want default %q", cfg.ModelName, "gemini-2.5-pro")
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel = %q, want default %q", cfg.LogLevel, "info")
	}
	if cfg.DataDir != "./data" {
		t.Errorf("DataDir = %q, want default %q", cfg.DataDir, "./data")
	}
	if cfg.DBPath != "./data/bim.db" {
		t.Errorf("DBPath = %q, want default %q", cfg.DBPath, "./data/bim.db")
	}
	if cfg.SourcifyBaseURL != "https://sourcify.dev/server" {
		t.Errorf("SourcifyBaseURL = %q, want default", cfg.SourcifyBaseURL)
	}
	if cfg.PollInterval != 60*time.Second {
		t.Errorf("PollInterval = %v, want default %v", cfg.PollInterval, 60*time.Second)
	}
	if len(cfg.Chains) != 2 {
		t.Fatalf("len(Chains) = %d, want default 2", len(cfg.Chains))
	}
	if cfg.Chains[0].ID != 1 || cfg.Chains[1].ID != 8453 {
		t.Errorf("default chain IDs = [%d, %d], want [1, 8453]", cfg.Chains[0].ID, cfg.Chains[1].ID)
	}
}

func TestLoad_PartialOverride(t *testing.T) {
	// Override only chains; other defaults should remain.
	content := `
google_api_key: key
chains:
  - id: 42161
    name: Arbitrum One
    rpc_url: https://arb.example.com
`
	path := writeTemp(t, content)

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if len(cfg.Chains) != 1 {
		t.Fatalf("len(Chains) = %d, want 1", len(cfg.Chains))
	}
	if cfg.Chains[0].Name != "Arbitrum One" {
		t.Errorf("Chains[0].Name = %q, want %q", cfg.Chains[0].Name, "Arbitrum One")
	}
	// Defaults should still hold for unset fields.
	if cfg.ModelName != "gemini-2.5-pro" {
		t.Errorf("ModelName = %q, want default", cfg.ModelName)
	}
}

func TestLoad_MissingAPIKey(t *testing.T) {
	content := `
model_name: gemini-2.0-flash
`
	path := writeTemp(t, content)

	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for missing google_api_key, got nil")
	}
}

func TestLoad_FileNotFound(t *testing.T) {
	_, err := Load("/nonexistent/path/config.yaml")
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}

func TestLoad_InvalidYAML(t *testing.T) {
	path := writeTemp(t, `{{{not yaml`)

	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for invalid YAML, got nil")
	}
}

func TestLoad_DuplicateChainID(t *testing.T) {
	content := `
google_api_key: key
chains:
  - id: 1
    name: Ethereum Mainnet
    rpc_url: https://eth.example.com
  - id: 1
    name: Ethereum Duplicate
    rpc_url: https://eth2.example.com
`
	path := writeTemp(t, content)

	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for duplicate chain id, got nil")
	}
}

func TestLoad_ChainMissingName(t *testing.T) {
	content := `
google_api_key: key
chains:
  - id: 1
    rpc_url: https://eth.example.com
`
	path := writeTemp(t, content)

	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for chain missing name, got nil")
	}
}

func TestLoad_ChainMissingRPCURL(t *testing.T) {
	content := `
google_api_key: key
chains:
  - id: 1
    name: Ethereum Mainnet
`
	path := writeTemp(t, content)

	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for chain missing rpc_url, got nil")
	}
}

func TestLoad_ChainZeroID(t *testing.T) {
	content := `
google_api_key: key
chains:
  - id: 0
    name: Bad Chain
    rpc_url: https://bad.example.com
`
	path := writeTemp(t, content)

	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for zero chain id, got nil")
	}
}

func TestLoad_PollIntervalTooSmall(t *testing.T) {
	content := `
google_api_key: key
poll_interval: 500ms
`
	path := writeTemp(t, content)

	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for poll_interval < 1s, got nil")
	}
}

func TestChainIDs(t *testing.T) {
	cfg := &Config{
		Chains: []Chain{
			{ID: 1, Name: "Eth", RPCURL: "https://eth"},
			{ID: 8453, Name: "Base", RPCURL: "https://base"},
			{ID: 42161, Name: "Arb", RPCURL: "https://arb"},
		},
	}

	ids := cfg.ChainIDs()
	if len(ids) != 3 {
		t.Fatalf("len(ChainIDs()) = %d, want 3", len(ids))
	}
	want := []uint64{1, 8453, 42161}
	for i, id := range ids {
		if id != want[i] {
			t.Errorf("ChainIDs()[%d] = %d, want %d", i, id, want[i])
		}
	}
}

func TestChainByID(t *testing.T) {
	cfg := &Config{
		Chains: []Chain{
			{ID: 1, Name: "Ethereum Mainnet", RPCURL: "https://eth"},
			{ID: 8453, Name: "Base", RPCURL: "https://base"},
		},
	}

	ch, err := cfg.ChainByID(1)
	if err != nil {
		t.Fatalf("ChainByID(1) error: %v", err)
	}
	if ch.Name != "Ethereum Mainnet" {
		t.Errorf("ChainByID(1).Name = %q, want %q", ch.Name, "Ethereum Mainnet")
	}

	ch, err = cfg.ChainByID(8453)
	if err != nil {
		t.Fatalf("ChainByID(8453) error: %v", err)
	}
	if ch.Name != "Base" {
		t.Errorf("ChainByID(8453).Name = %q, want %q", ch.Name, "Base")
	}

	_, err = cfg.ChainByID(999)
	if err == nil {
		t.Fatal("expected error for unknown chain id, got nil")
	}
}

func TestChainName(t *testing.T) {
	cfg := &Config{
		Chains: []Chain{
			{ID: 1, Name: "Ethereum Mainnet", RPCURL: "https://eth"},
		},
	}

	if got := cfg.ChainName(1); got != "Ethereum Mainnet" {
		t.Errorf("ChainName(1) = %q, want %q", got, "Ethereum Mainnet")
	}
	if got := cfg.ChainName(999); got != "Chain 999" {
		t.Errorf("ChainName(999) = %q, want %q", got, "Chain 999")
	}
}

func TestLoad_EmptyChains(t *testing.T) {
	content := `
google_api_key: key
chains: []
`
	path := writeTemp(t, content)

	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for empty chains list, got nil")
	}
}

// writeTemp writes content to a temporary YAML file and returns its path.
func writeTemp(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("writing temp config: %v", err)
	}
	return path
}
