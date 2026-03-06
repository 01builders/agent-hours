package reporter

import (
	"time"

	"github.com/julienrbrt/bim/internal/analyzer"
)

// Report contains a complete exploit report for a single finding,
// formatted for bug bounty submission.
type Report struct {
	// Finding is the original security finding this report is based on.
	Finding analyzer.Finding

	// ChainID is the chain where the vulnerable contract is deployed.
	ChainID uint64

	// Address is the contract address.
	Address string

	// ExploitNarrative is a step-by-step description of how the vulnerability
	// can be exploited in practice.
	ExploitNarrative string

	// ImpactAssessment describes the estimated impact: funds at risk,
	// affected users, protocol consequences, etc.
	ImpactAssessment string

	// PoC is proof-of-concept code (typically a Foundry test) that
	// demonstrates the exploit.
	PoC string

	// RecommendedFix contains suggested code changes to remediate the vulnerability.
	RecommendedFix string

	// CreatedAt is the timestamp when the report was generated.
	CreatedAt time.Time
}

// FormatOptions controls how a report is rendered to Markdown.
type FormatOptions struct {
	// IncludePoC controls whether the PoC code is included in the output.
	IncludePoC bool

	// IncludeFix controls whether the recommended fix is included.
	IncludeFix bool
}

// DefaultFormatOptions returns sensible defaults for report formatting.
func DefaultFormatOptions() FormatOptions {
	return FormatOptions{
		IncludePoC: true,
		IncludeFix: true,
	}
}
