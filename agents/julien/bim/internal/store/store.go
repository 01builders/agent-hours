// Package store provides persistence for tracked contracts, analysis results, and reports.
package store

import (
	"context"
	"time"

	"github.com/julienrbrt/bim/internal/analyzer"
)

// ContractStatus represents the processing state of a tracked contract.
type ContractStatus string

const (
	// StatusPending means the contract has been discovered but not yet analyzed.
	StatusPending ContractStatus = "pending"
	// StatusAnalyzing means the contract is currently being analyzed.
	StatusAnalyzing ContractStatus = "analyzing"
	// StatusAnalyzed means the analysis is complete.
	StatusAnalyzed ContractStatus = "analyzed"
	// StatusReported means reports have been generated for actionable findings.
	StatusReported ContractStatus = "reported"
	// StatusSkipped means the contract was skipped (e.g. no source, duplicate, not interesting).
	StatusSkipped ContractStatus = "skipped"
	// StatusFailed means the analysis or report generation failed.
	StatusFailed ContractStatus = "failed"
)

// Contract represents a tracked smart contract in the store.
type Contract struct {
	// ChainID is the chain where the contract is deployed.
	ChainID uint64 `gorm:"primaryKey;column:chain_id"`
	// Address is the contract's hex address (checksummed or lowercased).
	Address string `gorm:"primaryKey;column:address"`
	// Name is the contract name from compilation metadata, if available.
	Name string `gorm:"column:name;default:''"`
	// Language is the source language (e.g. "Solidity", "Vyper").
	Language string `gorm:"column:language;default:''"`
	// CompilerVersion is the compiler version used.
	CompilerVersion string `gorm:"column:compiler_version;default:''"`
	// MatchType is the Sourcify match type ("exact_match" or "partial_match").
	MatchType string `gorm:"column:match_type;default:''"`
	// Status is the current processing state.
	Status ContractStatus `gorm:"column:status;default:'pending';index:idx_contracts_status;index:idx_contracts_chain_status"`
	// AnalysisID is the ID of the associated analysis result, if any.
	AnalysisID string `gorm:"column:analysis_id;default:''"`
	// SourceCount is the number of source files.
	SourceCount int `gorm:"column:source_count;default:0"`
	// FirstSeenAt is when the contract was first discovered.
	FirstSeenAt time.Time `gorm:"column:first_seen_at;autoCreateTime;index:idx_contracts_first_seen"`
	// UpdatedAt is when the contract record was last updated.
	UpdatedAt time.Time `gorm:"column:updated_at;autoUpdateTime"`
	// ErrorMessage holds an error description if Status is StatusFailed.
	ErrorMessage string `gorm:"column:error_message;default:''"`
}

// TableName overrides the default GORM table name.
func (Contract) TableName() string {
	return "contracts"
}

// StoredFinding represents a persisted security finding linked to a contract.
type StoredFinding struct {
	// ID is the unique identifier for the finding.
	ID string `gorm:"primaryKey;column:id"`
	// ChainID is the chain of the associated contract.
	ChainID uint64 `gorm:"column:chain_id;index:idx_findings_contract"`
	// Address is the contract address.
	Address string `gorm:"column:address;index:idx_findings_contract"`
	// AnalysisID is the ID of the analysis that produced this finding.
	AnalysisID string `gorm:"column:analysis_id;default:'';index:idx_findings_analysis"`
	// Finding is the actual security finding data (embedded fields).
	Finding analyzer.Finding `gorm:"-"`
	// Severity stores the finding severity in the DB.
	Severity string `gorm:"column:severity;index:idx_findings_severity"`
	// Title stores the finding title in the DB.
	Title string `gorm:"column:title"`
	// Description stores the finding description in the DB.
	Description string `gorm:"column:description;default:''"`
	// AffectedFunction stores the affected function in the DB.
	AffectedFunction string `gorm:"column:affected_function;default:''"`
	// AffectedFile stores the affected file in the DB.
	AffectedFile string `gorm:"column:affected_file;default:''"`
	// LineNumbers stores the line numbers in the DB.
	LineNumbers string `gorm:"column:line_numbers;default:''"`
	// Impact stores the impact in the DB.
	Impact string `gorm:"column:impact;default:''"`
	// Recommendation stores the recommendation in the DB.
	Recommendation string `gorm:"column:recommendation;default:''"`
	// Confidence stores the confidence score in the DB.
	Confidence float64 `gorm:"column:confidence;default:0.0"`
	// Category stores the vulnerability category in the DB.
	Category string `gorm:"column:category;default:''"`
	// ReportPath is the file path to the generated report, if any.
	ReportPath string `gorm:"column:report_path;default:''"`
	// CreatedAt is when the finding was stored.
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime"`
}

// TableName overrides the default GORM table name.
func (StoredFinding) TableName() string {
	return "findings"
}

// syncToFields copies the embedded Finding fields to the flat DB columns.
func (sf *StoredFinding) syncToFields() {
	sf.Severity = string(sf.Finding.Severity)
	sf.Title = sf.Finding.Title
	sf.Description = sf.Finding.Description
	sf.AffectedFunction = sf.Finding.AffectedFunction
	sf.AffectedFile = sf.Finding.AffectedFile
	sf.LineNumbers = sf.Finding.LineNumbers
	sf.Impact = sf.Finding.Impact
	sf.Recommendation = sf.Finding.Recommendation
	sf.Confidence = sf.Finding.Confidence
	sf.Category = sf.Finding.Category
}

// syncFromFields copies the flat DB columns back into the embedded Finding.
func (sf *StoredFinding) syncFromFields() {
	sf.Finding = analyzer.Finding{
		ID:               sf.ID,
		Severity:         analyzer.Severity(sf.Severity),
		Title:            sf.Title,
		Description:      sf.Description,
		AffectedFunction: sf.AffectedFunction,
		AffectedFile:     sf.AffectedFile,
		LineNumbers:      sf.LineNumbers,
		Impact:           sf.Impact,
		Recommendation:   sf.Recommendation,
		Confidence:       sf.Confidence,
		Category:         sf.Category,
	}
}

// AnalysisResultRecord stores a full analysis result as JSON in the database.
type AnalysisResultRecord struct {
	// ID is the unique identifier for this analysis run.
	ID string `gorm:"primaryKey;column:id"`
	// ChainID is the chain where the contract is deployed.
	ChainID uint64 `gorm:"column:chain_id;index:idx_analysis_results_contract"`
	// Address is the contract address that was analyzed.
	Address string `gorm:"column:address;index:idx_analysis_results_contract"`
	// ResultJSON is the serialized AnalysisResult.
	ResultJSON string `gorm:"column:result_json;type:text"`
	// CreatedAt is when the analysis was stored.
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime"`
}

// TableName overrides the default GORM table name.
func (AnalysisResultRecord) TableName() string {
	return "analysis_results"
}

// StoredReport represents a persisted bug bounty report.
type StoredReport struct {
	// ID is the unique identifier for the report.
	ID string `gorm:"primaryKey;column:id"`
	// FindingID is the ID of the finding this report covers.
	FindingID string `gorm:"column:finding_id;index:idx_reports_finding"`
	// ChainID is the chain of the associated contract.
	ChainID uint64 `gorm:"column:chain_id;index:idx_reports_contract"`
	// Address is the contract address.
	Address string `gorm:"column:address;index:idx_reports_contract"`
	// ReportPath is the filesystem path where the Markdown report is stored.
	ReportPath string `gorm:"column:report_path"`
	// CreatedAt is when the report was generated.
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime"`
}

// TableName overrides the default GORM table name.
func (StoredReport) TableName() string {
	return "reports"
}

// ContractFilter specifies optional filters for listing contracts.
type ContractFilter struct {
	// ChainID filters by chain. Zero means no filter.
	ChainID uint64
	// Status filters by contract status. Empty means no filter.
	Status ContractStatus
	// Limit is the maximum number of results to return. Zero means no limit.
	Limit int
	// Offset is the number of results to skip (for pagination).
	Offset int
}

// Store is the persistence interface for BiM's contract tracking, analysis results, and reports.
type Store interface {
	SaveContract(ctx context.Context, c *Contract) error
	GetContract(ctx context.Context, chainID uint64, address string) (*Contract, error)
	HasSeen(ctx context.Context, chainID uint64, address string) (bool, error)
	ListContracts(ctx context.Context, filter ContractFilter) ([]Contract, error)
	UpdateContractStatus(ctx context.Context, chainID uint64, address string, status ContractStatus, errMsg string) error

	SaveFindings(ctx context.Context, findings []StoredFinding) error
	GetFindings(ctx context.Context, chainID uint64, address string) ([]StoredFinding, error)
	GetFindingByID(ctx context.Context, id string) (*StoredFinding, error)
	GetActionableFindings(ctx context.Context) ([]StoredFinding, error)

	SaveReport(ctx context.Context, report *StoredReport) error
	GetReportByFindingID(ctx context.Context, findingID string) (*StoredReport, error)

	SaveAnalysisResult(ctx context.Context, result *analyzer.AnalysisResult) error
	GetAnalysisResult(ctx context.Context, id string) (*analyzer.AnalysisResult, error)

	Close() error
}
