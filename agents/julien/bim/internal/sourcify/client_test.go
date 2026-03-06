package sourcify

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newTestServer(t *testing.T, handler http.HandlerFunc) (*httptest.Server, *Client) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	client := NewClient(srv.URL, nil, slog.Default())
	return srv, client
}

func TestGetContract_Success(t *testing.T) {
	want := ContractResponse{
		MatchID:       "12345",
		Match:         "match",
		ChainID:       "1",
		Address:       "0x1234567890abcdef1234567890abcdef12345678",
		VerifiedAt:    "2024-08-08T13:20:07Z",
		CreationMatch: "match",
		RuntimeMatch:  "match",
		Sources: map[string]SourceFile{
			"contracts/Token.sol": {
				Content: "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract Token {}",
			},
		},
		Compilation: &Compilation{
			Language:           "Solidity",
			Compiler:           "solc",
			CompilerVersion:    "0.8.19+commit.7dd6d404",
			FullyQualifiedName: "contracts/Token.sol:Token",
			Name:               "Token",
		},
		ABI: []ABIEntry{
			{
				Type:            "function",
				Name:            "balanceOf",
				StateMutability: "view",
				Inputs: []ABIParam{
					{Name: "account", Type: "address"},
				},
				Outputs: []ABIParam{
					{Name: "", Type: "uint256"},
				},
			},
		},
	}

	_, client := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", r.Method)
		}
		expectedPath := "/v2/contract/1/0x1234567890abcdef1234567890abcdef12345678"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}
		if r.URL.Query().Get("fields") != "all" {
			t.Error("expected fields=all query parameter")
		}
		if r.Header.Get("Accept") != "application/json" {
			t.Error("expected Accept: application/json header")
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(want); err != nil {
			t.Fatal(err)
		}
	})

	got, err := client.GetContract(context.Background(), 1, "0x1234567890abcdef1234567890abcdef12345678")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if got.Match != want.Match {
		t.Errorf("match = %q, want %q", got.Match, want.Match)
	}
	if got.ChainID != want.ChainID {
		t.Errorf("chainID = %q, want %q", got.ChainID, want.ChainID)
	}
	if got.Address != want.Address {
		t.Errorf("address = %q, want %q", got.Address, want.Address)
	}
	if got.CreationMatch != "match" {
		t.Errorf("creationMatch = %q, want %q", got.CreationMatch, "match")
	}
	if got.RuntimeMatch != "match" {
		t.Errorf("runtimeMatch = %q, want %q", got.RuntimeMatch, "match")
	}

	// Sources are top-level
	if len(got.Sources) != 1 {
		t.Fatalf("sources count = %d, want 1", len(got.Sources))
	}
	src, ok := got.Sources["contracts/Token.sol"]
	if !ok {
		t.Fatal("expected source file contracts/Token.sol")
	}
	if src.Content == "" {
		t.Error("source content should not be empty")
	}

	// Compilation
	if got.Compilation == nil {
		t.Fatal("expected compilation data, got nil")
	}
	if got.Compilation.Language != "Solidity" {
		t.Errorf("language = %q, want %q", got.Compilation.Language, "Solidity")
	}
	if got.Compilation.CompilerVersion != want.Compilation.CompilerVersion {
		t.Errorf("compiler = %q, want %q", got.Compilation.CompilerVersion, want.Compilation.CompilerVersion)
	}
	if got.Compilation.FullyQualifiedName != "contracts/Token.sol:Token" {
		t.Errorf("fullyQualifiedName = %q, want %q", got.Compilation.FullyQualifiedName, "contracts/Token.sol:Token")
	}

	// ABI is top-level
	if len(got.ABI) != 1 {
		t.Fatalf("ABI entries = %d, want 1", len(got.ABI))
	}
	if got.ABI[0].Name != "balanceOf" {
		t.Errorf("ABI entry name = %q, want %q", got.ABI[0].Name, "balanceOf")
	}
}

func TestGetContract_NotFound(t *testing.T) {
	_, client := newTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	_, err := client.GetContract(context.Background(), 1, "0xdeadbeef")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !IsNotFound(err) {
		t.Errorf("expected NotFoundError, got %T: %v", err, err)
	}

	nfe := err.(*NotFoundError)
	if nfe.ChainID != 1 {
		t.Errorf("NotFoundError.ChainID = %d, want 1", nfe.ChainID)
	}
	if nfe.Address != "0xdeadbeef" {
		t.Errorf("NotFoundError.Address = %q, want %q", nfe.Address, "0xdeadbeef")
	}
}

func TestGetContract_APIError(t *testing.T) {
	_, client := newTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		resp := ErrorResponse{Error: "invalid address format"}
		json.NewEncoder(w).Encode(resp)
	})

	_, err := client.GetContract(context.Background(), 1, "bad-address")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if IsNotFound(err) {
		t.Error("should not be a NotFoundError for bad request")
	}
}

func TestGetContract_ServerError(t *testing.T) {
	_, client := newTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal server error"))
	})

	_, err := client.GetContract(context.Background(), 1, "0xabc")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestGetContract_InvalidJSON(t *testing.T) {
	_, client := newTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{invalid json`))
	})

	_, err := client.GetContract(context.Background(), 1, "0xabc")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestGetContract_ContextCanceled(t *testing.T) {
	_, client := newTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(ContractResponse{})
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := client.GetContract(ctx, 1, "0xabc")
	if err == nil {
		t.Fatal("expected error for canceled context, got nil")
	}
}

func TestCheckContract_ExactMatch(t *testing.T) {
	_, client := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		expectedPath := "/v2/contract/8453/0xabcdef"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}
		// fields=all should NOT be present for CheckContract
		if r.URL.Query().Get("fields") == "all" {
			t.Error("CheckContract should not request fields=all")
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(ContractResponse{Match: "match"})
	})

	match, err := client.CheckContract(context.Background(), 8453, "0xabcdef")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if match != "match" {
		t.Errorf("match = %q, want %q", match, "match")
	}
}

func TestCheckContract_NotFound(t *testing.T) {
	_, client := newTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	match, err := client.CheckContract(context.Background(), 1, "0xdeadbeef")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if match != "" {
		t.Errorf("match = %q, want empty string for not found", match)
	}
}

func TestCheckContract_ServerError(t *testing.T) {
	_, client := newTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("something broke"))
	})

	_, err := client.CheckContract(context.Background(), 1, "0xabc")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestGetContractSources_Success(t *testing.T) {
	resp := ContractResponse{
		Match:   "match",
		ChainID: "1",
		Address: "0xabc",
		Sources: map[string]SourceFile{
			"contracts/A.sol": {Content: "contract A {}"},
			"contracts/B.sol": {Content: "contract B {}"},
			"lib/C.sol":       {Content: "library C {}"},
		},
		Compilation: &Compilation{
			Language: "Solidity",
		},
	}

	_, client := newTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
	})

	sources, err := client.GetContractSources(context.Background(), 1, "0xabc")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(sources) != 3 {
		t.Fatalf("sources count = %d, want 3", len(sources))
	}

	for path, content := range sources {
		if content == "" {
			t.Errorf("source %q has empty content", path)
		}
	}

	if sources["contracts/A.sol"] != "contract A {}" {
		t.Errorf("A.sol content = %q, want %q", sources["contracts/A.sol"], "contract A {}")
	}
}

func TestGetContractSources_NoSources(t *testing.T) {
	resp := ContractResponse{
		Match:   "match",
		ChainID: "1",
		Address: "0xabc",
		// Sources is nil/empty
		Compilation: &Compilation{
			Language: "Solidity",
		},
	}

	_, client := newTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
	})

	_, err := client.GetContractSources(context.Background(), 1, "0xabc")
	if err == nil {
		t.Fatal("expected error for contract with no sources, got nil")
	}
}

func TestGetContractSources_NotFound(t *testing.T) {
	_, client := newTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	_, err := client.GetContractSources(context.Background(), 1, "0xdeadbeef")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !IsNotFound(err) {
		t.Errorf("expected NotFoundError, got %T", err)
	}
}

func TestNewClient_NilHTTPClient(t *testing.T) {
	client := NewClient(DefaultBaseURL, nil, slog.Default())
	if client.baseURL != DefaultBaseURL {
		t.Errorf("baseURL = %q, want %q", client.baseURL, DefaultBaseURL)
	}
	if client.httpClient == nil {
		t.Error("httpClient should not be nil when passing nil (default should be created)")
	}
	if client.logger == nil {
		t.Error("logger should not be nil")
	}
}

func TestNewClient_CustomHTTPClient(t *testing.T) {
	customHTTP := &http.Client{}
	client := NewClient("https://custom.sourcify.dev", customHTTP, slog.Default())

	if client.baseURL != "https://custom.sourcify.dev" {
		t.Errorf("baseURL = %q, want %q", client.baseURL, "https://custom.sourcify.dev")
	}
	if client.httpClient != customHTTP {
		t.Error("httpClient should be the custom client")
	}
}

func TestIsNotFound(t *testing.T) {
	nfe := &NotFoundError{ChainID: 1, Address: "0xabc"}
	if !IsNotFound(nfe) {
		t.Error("IsNotFound should return true for *NotFoundError")
	}

	if IsNotFound(nil) {
		t.Error("IsNotFound should return false for nil")
	}

	other := http.ErrAbortHandler
	if IsNotFound(other) {
		t.Error("IsNotFound should return false for non-NotFoundError")
	}
}

func TestNotFoundError_Error(t *testing.T) {
	nfe := &NotFoundError{ChainID: 1, Address: "0xabc"}
	msg := nfe.Error()
	if msg == "" {
		t.Error("error message should not be empty")
	}
	if msg != "contract 0xabc not found on chain 1" {
		t.Errorf("error message = %q, want %q", msg, "contract 0xabc not found on chain 1")
	}
}

func TestGetContract_MultipleSources(t *testing.T) {
	want := ContractResponse{
		Match:         "match",
		ChainID:       "8453",
		Address:       "0xbase",
		CreationMatch: "match",
		RuntimeMatch:  "match",
		Sources: map[string]SourceFile{
			"contracts/Vault.sol":                            {Content: "contract Vault { }"},
			"contracts/interfaces/IVault.sol":                {Content: "interface IVault { }"},
			"@openzeppelin/contracts/token/ERC20/IERC20.sol": {Content: "interface IERC20 { }"},
		},
		Compilation: &Compilation{
			Language:           "Solidity",
			CompilerVersion:    "0.8.20+commit.a1b79de6",
			FullyQualifiedName: "contracts/Vault.sol:Vault",
		},
	}

	_, client := newTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(want)
	})

	got, err := client.GetContract(context.Background(), 8453, "0xbase")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if got.Match != "match" {
		t.Errorf("match = %q, want %q", got.Match, "match")
	}
	if got.RuntimeMatch != "match" {
		t.Errorf("runtimeMatch = %q, want %q", got.RuntimeMatch, "match")
	}
	if len(got.Sources) != 3 {
		t.Errorf("sources count = %d, want 3", len(got.Sources))
	}
	if got.Compilation == nil {
		t.Fatal("expected compilation, got nil")
	}
	if got.Compilation.FullyQualifiedName != "contracts/Vault.sol:Vault" {
		t.Errorf("fullyQualifiedName = %q, want %q", got.Compilation.FullyQualifiedName, "contracts/Vault.sol:Vault")
	}
}

func TestGetContract_WithDeploymentAndProxy(t *testing.T) {
	want := ContractResponse{
		Match:   "match",
		ChainID: "1",
		Address: "0xproxy",
		Sources: map[string]SourceFile{
			"Proxy.sol": {Content: "contract Proxy {}"},
		},
		Compilation: &Compilation{
			Language:           "Solidity",
			CompilerVersion:    "0.4.24+commit.e67f0147",
			FullyQualifiedName: "Proxy.sol:Proxy",
			Name:               "Proxy",
		},
		Deployment: &Deployment{
			TransactionHash:  "0xabc123",
			BlockNumber:      "6082465",
			TransactionIndex: "22",
			Deployer:         "0xdeployer",
		},
		ProxyResolution: &ProxyResolution{
			IsProxy:   true,
			ProxyType: "ZeppelinOSProxy",
			Implementations: []Implementation{
				{Address: "0ximpl", Name: "FiatTokenV2_2"},
			},
		},
	}

	_, client := newTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(want)
	})

	got, err := client.GetContract(context.Background(), 1, "0xproxy")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if got.Deployment == nil {
		t.Fatal("expected deployment, got nil")
	}
	if got.Deployment.TransactionHash != "0xabc123" {
		t.Errorf("txHash = %q, want %q", got.Deployment.TransactionHash, "0xabc123")
	}
	if got.Deployment.Deployer != "0xdeployer" {
		t.Errorf("deployer = %q, want %q", got.Deployment.Deployer, "0xdeployer")
	}

	if got.ProxyResolution == nil {
		t.Fatal("expected proxyResolution, got nil")
	}
	if !got.ProxyResolution.IsProxy {
		t.Error("expected isProxy = true")
	}
	if got.ProxyResolution.ProxyType != "ZeppelinOSProxy" {
		t.Errorf("proxyType = %q, want %q", got.ProxyResolution.ProxyType, "ZeppelinOSProxy")
	}
	if len(got.ProxyResolution.Implementations) != 1 {
		t.Fatalf("implementations count = %d, want 1", len(got.ProxyResolution.Implementations))
	}
	if got.ProxyResolution.Implementations[0].Name != "FiatTokenV2_2" {
		t.Errorf("impl name = %q, want %q", got.ProxyResolution.Implementations[0].Name, "FiatTokenV2_2")
	}
}

func TestGetContract_TopLevelABI(t *testing.T) {
	want := ContractResponse{
		Match:   "match",
		ChainID: "1",
		Address: "0xabi",
		Sources: map[string]SourceFile{
			"Token.sol": {Content: "contract Token {}"},
		},
		ABI: []ABIEntry{
			{
				Type:            "function",
				Name:            "transfer",
				StateMutability: "nonpayable",
				Inputs: []ABIParam{
					{Name: "to", Type: "address"},
					{Name: "amount", Type: "uint256"},
				},
				Outputs: []ABIParam{
					{Name: "", Type: "bool"},
				},
			},
			{
				Type: "constructor",
				Inputs: []ABIParam{
					{Name: "_implementation", Type: "address"},
				},
			},
			{
				Type:            "fallback",
				Payable:         true,
				StateMutability: "payable",
			},
			{
				Type: "event",
				Name: "Transfer",
				Inputs: []ABIParam{
					{Name: "from", Type: "address", Indexed: true},
					{Name: "to", Type: "address", Indexed: true},
					{Name: "value", Type: "uint256"},
				},
			},
		},
	}

	_, client := newTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(want)
	})

	got, err := client.GetContract(context.Background(), 1, "0xabi")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(got.ABI) != 4 {
		t.Fatalf("ABI entries = %d, want 4", len(got.ABI))
	}
	if got.ABI[0].Name != "transfer" {
		t.Errorf("ABI[0].Name = %q, want %q", got.ABI[0].Name, "transfer")
	}
	if got.ABI[1].Type != "constructor" {
		t.Errorf("ABI[1].Type = %q, want %q", got.ABI[1].Type, "constructor")
	}
	if got.ABI[2].Type != "fallback" {
		t.Errorf("ABI[2].Type = %q, want %q", got.ABI[2].Type, "fallback")
	}
	if !got.ABI[2].Payable {
		t.Error("expected fallback to be payable")
	}
	if got.ABI[3].Type != "event" {
		t.Errorf("ABI[3].Type = %q, want %q", got.ABI[3].Type, "event")
	}
	if got.ABI[3].Name != "Transfer" {
		t.Errorf("ABI[3].Name = %q, want %q", got.ABI[3].Name, "Transfer")
	}
}
