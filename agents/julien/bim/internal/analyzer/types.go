package analyzer

import "time"

// Severity represents the severity level of a security finding.
type Severity string

const (
	// SeverityCritical indicates a critical vulnerability that can lead to direct loss of funds.
	SeverityCritical Severity = "Critical"
	// SeverityHigh indicates a high severity vulnerability with significant impact.
	SeverityHigh Severity = "High"
	// SeverityMedium indicates a medium severity vulnerability with moderate impact.
	SeverityMedium Severity = "Medium"
	// SeverityLow indicates a low severity vulnerability with minor impact.
	SeverityLow Severity = "Low"
	// SeverityInfo indicates an informational finding with no direct security impact.
	SeverityInfo Severity = "Informational"
)

// IsActionable reports whether the severity warrants a bug bounty report (Critical or High).
func (s Severity) IsActionable() bool {
	return s == SeverityCritical || s == SeverityHigh
}

// Valid reports whether the severity is a recognized value.
func (s Severity) Valid() bool {
	switch s {
	case SeverityCritical, SeverityHigh, SeverityMedium, SeverityLow, SeverityInfo:
		return true
	default:
		return false
	}
}

// ContractType describes the kind of smart contract being analyzed.
type ContractType string

const (
	ContractTypeERC20      ContractType = "ERC-20"
	ContractTypeERC721     ContractType = "ERC-721"
	ContractTypeERC1155    ContractType = "ERC-1155"
	ContractTypeDEX        ContractType = "DEX"
	ContractTypeLending    ContractType = "Lending"
	ContractTypeStaking    ContractType = "Staking"
	ContractTypeBridge     ContractType = "Bridge"
	ContractTypeGovernance ContractType = "Governance"
	ContractTypeVault      ContractType = "Vault"
	ContractTypeProxy      ContractType = "Proxy"
	ContractTypeOther      ContractType = "Other"
)

// Finding represents a single security vulnerability discovered during analysis.
type Finding struct {
	// ID is a unique identifier for the finding within an analysis.
	ID string `json:"id"`
	// Severity is the assessed severity level.
	Severity Severity `json:"severity"`
	// Title is a short, descriptive title for the vulnerability.
	Title string `json:"title"`
	// Description is a detailed explanation of the vulnerability.
	Description string `json:"description"`
	// AffectedFunction is the function name or signature where the vulnerability exists.
	AffectedFunction string `json:"affectedFunction"`
	// AffectedFile is the source file path containing the vulnerable code.
	AffectedFile string `json:"affectedFile"`
	// LineNumbers indicates the approximate line range of the vulnerable code.
	LineNumbers string `json:"lineNumbers,omitempty"`
	// Impact describes the potential consequences of exploiting the vulnerability.
	Impact string `json:"impact"`
	// Recommendation describes the suggested fix or mitigation.
	Recommendation string `json:"recommendation"`
	// Confidence is a score from 0.0 to 1.0 indicating the LLM's confidence in the finding.
	Confidence float64 `json:"confidence"`
	// Category classifies the vulnerability type (e.g. "Reentrancy", "Access Control").
	Category string `json:"category"`
}

// Common vulnerability category constants.
const (
	CategoryReentrancy       = "Reentrancy"
	CategoryAccessControl    = "Access Control"
	CategoryIntegerOverflow  = "Integer Overflow/Underflow"
	CategoryFlashLoan        = "Flash Loan"
	CategoryOracleManip      = "Oracle Manipulation"
	CategoryUncheckedCall    = "Unchecked External Call"
	CategoryStorageCollision = "Storage Collision"
	CategoryLogicError       = "Logic Error"
	CategoryDOS              = "Denial of Service"
	CategoryFrontRunning     = "Front-Running"
	CategoryPrivilegeEsc     = "Privilege Escalation"
	CategoryPriceManip       = "Price Manipulation"
)

// ContractSummary holds a high-level description of the analyzed contract.
type ContractSummary struct {
	// Type is the identified contract type.
	Type ContractType `json:"type"`
	// Name is the contract name extracted from source.
	Name string `json:"name"`
	// Language is the source language (e.g. "Solidity", "Vyper").
	Language string `json:"language"`
	// CompilerVersion is the compiler version used.
	CompilerVersion string `json:"compilerVersion"`
	// Description is a brief summary of what the contract does.
	Description string `json:"description"`
	// PublicFunctions lists the public/external function signatures.
	PublicFunctions []string `json:"publicFunctions,omitempty"`
	// TotalSourceFiles is the number of source files in the contract.
	TotalSourceFiles int `json:"totalSourceFiles"`
	// TotalLines is the approximate total lines of source code.
	TotalLines int `json:"totalLines"`
}

// AnalysisResult is the complete output of a security analysis run.
type AnalysisResult struct {
	// ID is the unique identifier for this analysis run.
	ID string `json:"id"`
	// ChainID is the chain where the contract is deployed.
	ChainID uint64 `json:"chainId"`
	// Address is the contract address that was analyzed.
	Address string `json:"address"`
	// Summary is a high-level overview of the contract.
	Summary ContractSummary `json:"summary"`
	// Findings is the list of security findings.
	Findings []Finding `json:"findings"`
	// AnalyzedAt is the timestamp when the analysis was performed.
	AnalyzedAt time.Time `json:"analyzedAt"`
	// Duration is how long the analysis took.
	Duration time.Duration `json:"duration"`
	// ModelUsed is the identifier of the LLM model used for analysis.
	ModelUsed string `json:"modelUsed"`
	// Error is set if the analysis failed.
	Error string `json:"error,omitempty"`
}

// CriticalAndHighFindings returns only the findings with Critical or High severity.
func (r *AnalysisResult) CriticalAndHighFindings() []Finding {
	var actionable []Finding
	for _, f := range r.Findings {
		if f.Severity.IsActionable() {
			actionable = append(actionable, f)
		}
	}
	return actionable
}

// HasActionableFindings reports whether the analysis found any Critical or High findings.
func (r *AnalysisResult) HasActionableFindings() bool {
	for _, f := range r.Findings {
		if f.Severity.IsActionable() {
			return true
		}
	}
	return false
}

// AnalysisInput is the input provided to the analyzer for a single contract.
type AnalysisInput struct {
	// ChainID is the chain where the contract is deployed.
	ChainID uint64
	// Address is the contract's hex address.
	Address string
	// Sources maps source file paths to their content.
	Sources map[string]string
	// Language is the source language (e.g. "Solidity", "Vyper").
	Language string
	// CompilerVersion is the compiler version used.
	CompilerVersion string
	// ContractName is the fully qualified contract name.
	ContractName string
}
