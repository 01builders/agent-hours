// Package sourcify provides a client for the Sourcify contract verification API.
package sourcify

// ContractResponse represents the response from the Sourcify v2 contract lookup API.
// GET /v2/contract/{chainId}/{address}?fields=all
type ContractResponse struct {
	// MatchID is the internal Sourcify match identifier.
	MatchID string `json:"matchId,omitempty"`
	// Match indicates the match type: "match", "partial_match", or empty if not found.
	Match string `json:"match"`
	// ChainID is the chain identifier where the contract is deployed (string in the API).
	ChainID string `json:"chainId"`
	// Address is the contract's hex address.
	Address string `json:"address"`
	// VerifiedAt is when the contract was verified on Sourcify (RFC 3339).
	VerifiedAt string `json:"verifiedAt,omitempty"`
	// CreationMatch is the creation bytecode match status (plain string, e.g. "match").
	CreationMatch string `json:"creationMatch,omitempty"`
	// RuntimeMatch is the runtime bytecode match status (plain string, e.g. "match").
	RuntimeMatch string `json:"runtimeMatch,omitempty"`
	// Sources maps source file paths to their content. This is a top-level field.
	Sources map[string]SourceFile `json:"sources,omitempty"`
	// Compilation contains compiler and contract identity information.
	Compilation *Compilation `json:"compilation,omitempty"`
	// ABI is the contract's ABI as a list of ABI entries. This is a top-level field.
	ABI []ABIEntry `json:"abi,omitempty"`
	// Deployment contains on-chain deployment information.
	Deployment *Deployment `json:"deployment,omitempty"`
	// ProxyResolution contains proxy detection results.
	ProxyResolution *ProxyResolution `json:"proxyResolution,omitempty"`
}

// Compilation holds compiler and contract identity data for a verified contract.
type Compilation struct {
	// Language is the source language, e.g. "Solidity", "Vyper", "Yul".
	Language string `json:"language"`
	// Compiler is the compiler binary name, e.g. "solc".
	Compiler string `json:"compiler,omitempty"`
	// CompilerVersion is the full compiler version string.
	CompilerVersion string `json:"compilerVersion"`
	// CompilerSettings holds the raw compiler settings.
	CompilerSettings map[string]any `json:"compilerSettings,omitempty"`
	// Name is the short contract name, e.g. "FiatTokenProxy".
	Name string `json:"name,omitempty"`
	// FullyQualifiedName is the contract identifier, e.g. "FiatTokenProxy.sol:FiatTokenProxy".
	FullyQualifiedName string `json:"fullyQualifiedName"`
}

// SourceFile represents a single source file in a verified contract.
type SourceFile struct {
	Content string `json:"content"`
}

// ABIEntry represents a single entry in a contract's ABI.
type ABIEntry struct {
	Type            string     `json:"type"`
	Name            string     `json:"name,omitempty"`
	Inputs          []ABIParam `json:"inputs,omitempty"`
	Outputs         []ABIParam `json:"outputs,omitempty"`
	StateMutability string     `json:"stateMutability,omitempty"`
	Anonymous       bool       `json:"anonymous,omitempty"`
	Payable         bool       `json:"payable,omitempty"`
	Constant        bool       `json:"constant,omitempty"`
}

// ABIParam represents a parameter in an ABI entry.
type ABIParam struct {
	Name       string     `json:"name"`
	Type       string     `json:"type"`
	Indexed    bool       `json:"indexed,omitempty"`
	Components []ABIParam `json:"components,omitempty"`
}

// Deployment contains on-chain deployment information.
type Deployment struct {
	TransactionHash  string `json:"transactionHash,omitempty"`
	BlockNumber      string `json:"blockNumber,omitempty"`
	TransactionIndex string `json:"transactionIndex,omitempty"`
	Deployer         string `json:"deployer,omitempty"`
}

// ProxyResolution contains proxy detection results from Sourcify.
type ProxyResolution struct {
	IsProxy         bool             `json:"isProxy"`
	ProxyType       string           `json:"proxyType,omitempty"`
	Implementations []Implementation `json:"implementations,omitempty"`
}

// Implementation describes a proxy implementation target.
type Implementation struct {
	Address string `json:"address"`
	Name    string `json:"name,omitempty"`
}

// ErrorResponse represents an error returned by the Sourcify API.
type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}
