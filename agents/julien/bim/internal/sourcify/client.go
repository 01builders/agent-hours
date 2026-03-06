package sourcify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

const (
	// DefaultBaseURL is the default Sourcify server API base URL.
	DefaultBaseURL = "https://sourcify.dev/server"

	// DefaultTimeout is the default HTTP client timeout.
	DefaultTimeout = 30 * time.Second

	// MaxRecentContracts is the maximum number of contracts the Sourcify
	// /v2/contracts/{chainId} endpoint will return per request.
	MaxRecentContracts = 200
)

// Client is an HTTP client for the Sourcify contract verification API.
type Client struct {
	baseURL    string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewClient creates a new Sourcify API client.
// If httpClient is nil, a default client with DefaultTimeout is used.
func NewClient(baseURL string, httpClient *http.Client, logger *slog.Logger) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: DefaultTimeout}
	}
	return &Client{
		baseURL:    baseURL,
		httpClient: httpClient,
		logger:     logger,
	}
}

// GetContract fetches the verified source code and metadata for a contract.
func (c *Client) GetContract(ctx context.Context, chainID uint64, address string) (*ContractResponse, error) {
	url := fmt.Sprintf("%s/v2/contract/%d/%s?fields=all", c.baseURL, chainID, address)

	c.logger.Debug("fetching contract from sourcify", "chain_id", chainID, "address", address, "url", url)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response body: %w", err)
	}

	if resp.StatusCode == http.StatusNotFound {
		return nil, &NotFoundError{ChainID: chainID, Address: address}
	}

	if resp.StatusCode != http.StatusOK {
		var apiErr ErrorResponse
		if jsonErr := json.Unmarshal(body, &apiErr); jsonErr == nil && apiErr.Error != "" {
			return nil, fmt.Errorf("sourcify API error (HTTP %d): %s", resp.StatusCode, apiErr.Error)
		}
		return nil, fmt.Errorf("sourcify API returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var contract ContractResponse
	if err := json.Unmarshal(body, &contract); err != nil {
		return nil, fmt.Errorf("decoding contract response: %w", err)
	}

	c.logger.Debug("fetched contract from sourcify", "chain_id", chainID, "address", address, "match", contract.Match)

	return &contract, nil
}

// CheckContract checks whether a contract has been verified on Sourcify without
// fetching the full source. Returns the match status or an error.
func (c *Client) CheckContract(ctx context.Context, chainID uint64, address string) (string, error) {
	url := fmt.Sprintf("%s/v2/contract/%d/%s", c.baseURL, chainID, address)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return "", nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("reading response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("sourcify API returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var contract ContractResponse
	if err := json.Unmarshal(body, &contract); err != nil {
		return "", fmt.Errorf("decoding response: %w", err)
	}

	return contract.Match, nil
}

// GetContractSources fetches a contract and returns only its source files
// as a map of file path to source code content.
func (c *Client) GetContractSources(ctx context.Context, chainID uint64, address string) (map[string]string, error) {
	contract, err := c.GetContract(ctx, chainID, address)
	if err != nil {
		return nil, err
	}

	if len(contract.Sources) == 0 {
		return nil, fmt.Errorf("contract %s on chain %d has no source files", address, chainID)
	}

	sources := make(map[string]string, len(contract.Sources))
	for path, src := range contract.Sources {
		sources[path] = src.Content
	}
	return sources, nil
}

// NotFoundError is returned when a contract is not found on Sourcify.
type NotFoundError struct {
	ChainID uint64
	Address string
}

func (e *NotFoundError) Error() string {
	return fmt.Sprintf("contract %s not found on chain %d", e.Address, e.ChainID)
}

// IsNotFound reports whether the error is a NotFoundError.
func IsNotFound(err error) bool {
	var target *NotFoundError
	return errors.As(err, &target)
}

// RecentContract is a minimal entry from the /v2/contracts/{chainId} listing.
type RecentContract struct {
	Match   string `json:"match"`
	ChainID string `json:"chainId"`
	Address string `json:"address"`
	MatchID string `json:"matchId,omitempty"`
}

// recentContractsResponse is the top-level response from /v2/contracts/{chainId}.
type recentContractsResponse struct {
	Results []RecentContract `json:"results"`
}

// GetRecentlyVerified fetches the most recently verified contracts for a chain
// using the Sourcify v2 paginated listing endpoint. It returns up to limit
// addresses (capped at MaxRecentContracts per the API).
func (c *Client) GetRecentlyVerified(ctx context.Context, chainID uint64, limit int) ([]string, error) {
	if limit <= 0 || limit > MaxRecentContracts {
		limit = MaxRecentContracts
	}

	url := fmt.Sprintf("%s/v2/contracts/%d?sort=desc&limit=%d", c.baseURL, chainID, limit)

	c.logger.Debug("fetching recently verified contracts", "chain_id", chainID, "limit", limit, "url", url)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		var apiErr ErrorResponse
		if jsonErr := json.Unmarshal(body, &apiErr); jsonErr == nil && apiErr.Error != "" {
			return nil, fmt.Errorf("sourcify API error (HTTP %d): %s", resp.StatusCode, apiErr.Error)
		}
		return nil, fmt.Errorf("sourcify API returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var result recentContractsResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	addresses := make([]string, 0, len(result.Results))
	for _, c := range result.Results {
		if c.Address != "" {
			addresses = append(addresses, c.Address)
		}
	}

	c.logger.Debug("fetched recently verified contracts", "chain_id", chainID, "count", len(addresses))
	return addresses, nil
}
