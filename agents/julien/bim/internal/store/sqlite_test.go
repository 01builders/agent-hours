package store

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/julienrbrt/bim/internal/analyzer"
)

func newTestStore(t *testing.T) *SQLiteStore {
	t.Helper()
	s, err := NewSQLiteStore(":memory:", slog.Default())
	if err != nil {
		t.Fatalf("failed to create test store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestNewSQLiteStore(t *testing.T) {
	s := newTestStore(t)
	if s == nil {
		t.Fatal("expected non-nil store")
	}
	if s.db == nil {
		t.Fatal("expected non-nil db")
	}
}

func TestNewSQLiteStore_InvalidPath(t *testing.T) {
	_, err := NewSQLiteStore("/nonexistent/directory/that/does/not/exist/bim.db", slog.Default())
	if err == nil {
		t.Fatal("expected error for invalid path, got nil")
	}
}

func TestSaveContract(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	c := &Contract{
		ChainID:         1,
		Address:         "0xabc123",
		Name:            "contracts/Token.sol:Token",
		Language:        "Solidity",
		CompilerVersion: "0.8.19",
		MatchType:       "exact_match",
		Status:          StatusPending,
		SourceCount:     3,
	}

	err := s.SaveContract(ctx, c)
	if err != nil {
		t.Fatalf("SaveContract failed: %v", err)
	}

	if c.FirstSeenAt.IsZero() {
		t.Error("FirstSeenAt should be set after save")
	}
	if c.UpdatedAt.IsZero() {
		t.Error("UpdatedAt should be set after save")
	}
}

func TestSaveContract_Upsert(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	c := &Contract{
		ChainID: 1,
		Address: "0xabc123",
		Name:    "Token",
		Status:  StatusPending,
	}

	if err := s.SaveContract(ctx, c); err != nil {
		t.Fatalf("first SaveContract failed: %v", err)
	}

	c.Name = "UpdatedToken"
	c.Status = StatusAnalyzed
	c.AnalysisID = "analysis-001"

	if err := s.SaveContract(ctx, c); err != nil {
		t.Fatalf("second SaveContract failed: %v", err)
	}

	got, err := s.GetContract(ctx, 1, "0xabc123")
	if err != nil {
		t.Fatalf("GetContract failed: %v", err)
	}
	if got == nil {
		t.Fatal("expected contract, got nil")
	}
	if got.Name != "UpdatedToken" {
		t.Errorf("name = %q, want %q", got.Name, "UpdatedToken")
	}
	if got.Status != StatusAnalyzed {
		t.Errorf("status = %q, want %q", got.Status, StatusAnalyzed)
	}
	if got.AnalysisID != "analysis-001" {
		t.Errorf("analysisID = %q, want %q", got.AnalysisID, "analysis-001")
	}
}

func TestGetContract(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	c := &Contract{
		ChainID:         8453,
		Address:         "0xbase123",
		Name:            "Vault",
		Language:        "Solidity",
		CompilerVersion: "0.8.20",
		MatchType:       "partial_match",
		Status:          StatusPending,
		SourceCount:     5,
	}

	if err := s.SaveContract(ctx, c); err != nil {
		t.Fatalf("SaveContract failed: %v", err)
	}

	got, err := s.GetContract(ctx, 8453, "0xbase123")
	if err != nil {
		t.Fatalf("GetContract failed: %v", err)
	}
	if got == nil {
		t.Fatal("expected contract, got nil")
	}

	if got.ChainID != 8453 {
		t.Errorf("chainID = %d, want 8453", got.ChainID)
	}
	if got.Address != "0xbase123" {
		t.Errorf("address = %q, want %q", got.Address, "0xbase123")
	}
	if got.Name != "Vault" {
		t.Errorf("name = %q, want %q", got.Name, "Vault")
	}
	if got.Language != "Solidity" {
		t.Errorf("language = %q, want %q", got.Language, "Solidity")
	}
	if got.CompilerVersion != "0.8.20" {
		t.Errorf("compilerVersion = %q, want %q", got.CompilerVersion, "0.8.20")
	}
	if got.MatchType != "partial_match" {
		t.Errorf("matchType = %q, want %q", got.MatchType, "partial_match")
	}
	if got.Status != StatusPending {
		t.Errorf("status = %q, want %q", got.Status, StatusPending)
	}
	if got.SourceCount != 5 {
		t.Errorf("sourceCount = %d, want 5", got.SourceCount)
	}
}

func TestGetContract_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	got, err := s.GetContract(ctx, 1, "0xnonexistent")
	if err != nil {
		t.Fatalf("GetContract returned error: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil for non-existent contract, got %+v", got)
	}
}

func TestHasSeen(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	seen, err := s.HasSeen(ctx, 1, "0xabc123")
	if err != nil {
		t.Fatalf("HasSeen failed: %v", err)
	}
	if seen {
		t.Error("expected false for unseen contract")
	}

	c := &Contract{
		ChainID: 1,
		Address: "0xabc123",
		Status:  StatusPending,
	}
	if err := s.SaveContract(ctx, c); err != nil {
		t.Fatalf("SaveContract failed: %v", err)
	}

	seen, err = s.HasSeen(ctx, 1, "0xabc123")
	if err != nil {
		t.Fatalf("HasSeen failed: %v", err)
	}
	if !seen {
		t.Error("expected true for seen contract")
	}

	// Different chain, same address should not be seen.
	seen, err = s.HasSeen(ctx, 8453, "0xabc123")
	if err != nil {
		t.Fatalf("HasSeen failed: %v", err)
	}
	if seen {
		t.Error("expected false for same address on different chain")
	}
}

func TestListContracts(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	contracts := []Contract{
		{ChainID: 1, Address: "0xeth1", Status: StatusPending, Name: "A"},
		{ChainID: 1, Address: "0xeth2", Status: StatusAnalyzed, Name: "B"},
		{ChainID: 8453, Address: "0xbase1", Status: StatusPending, Name: "C"},
		{ChainID: 8453, Address: "0xbase2", Status: StatusFailed, Name: "D", ErrorMessage: "analysis failed"},
		{ChainID: 1, Address: "0xeth3", Status: StatusPending, Name: "E"},
	}

	for i := range contracts {
		if err := s.SaveContract(ctx, &contracts[i]); err != nil {
			t.Fatalf("SaveContract failed: %v", err)
		}
		// Small delay to ensure distinct ordering by first_seen_at.
		time.Sleep(time.Millisecond)
	}

	t.Run("no filter", func(t *testing.T) {
		got, err := s.ListContracts(ctx, ContractFilter{})
		if err != nil {
			t.Fatalf("ListContracts failed: %v", err)
		}
		if len(got) != 5 {
			t.Fatalf("count = %d, want 5", len(got))
		}
	})

	t.Run("filter by chain", func(t *testing.T) {
		got, err := s.ListContracts(ctx, ContractFilter{ChainID: 1})
		if err != nil {
			t.Fatalf("ListContracts failed: %v", err)
		}
		if len(got) != 3 {
			t.Fatalf("count = %d, want 3", len(got))
		}
		for _, c := range got {
			if c.ChainID != 1 {
				t.Errorf("got chain %d, want 1", c.ChainID)
			}
		}
	})

	t.Run("filter by status", func(t *testing.T) {
		got, err := s.ListContracts(ctx, ContractFilter{Status: StatusPending})
		if err != nil {
			t.Fatalf("ListContracts failed: %v", err)
		}
		if len(got) != 3 {
			t.Fatalf("count = %d, want 3", len(got))
		}
		for _, c := range got {
			if c.Status != StatusPending {
				t.Errorf("got status %q, want %q", c.Status, StatusPending)
			}
		}
	})

	t.Run("filter by chain and status", func(t *testing.T) {
		got, err := s.ListContracts(ctx, ContractFilter{ChainID: 1, Status: StatusPending})
		if err != nil {
			t.Fatalf("ListContracts failed: %v", err)
		}
		if len(got) != 2 {
			t.Fatalf("count = %d, want 2", len(got))
		}
	})

	t.Run("limit", func(t *testing.T) {
		got, err := s.ListContracts(ctx, ContractFilter{Limit: 2})
		if err != nil {
			t.Fatalf("ListContracts failed: %v", err)
		}
		if len(got) != 2 {
			t.Fatalf("count = %d, want 2", len(got))
		}
	})

	t.Run("limit and offset", func(t *testing.T) {
		got, err := s.ListContracts(ctx, ContractFilter{Limit: 2, Offset: 3})
		if err != nil {
			t.Fatalf("ListContracts failed: %v", err)
		}
		if len(got) != 2 {
			t.Fatalf("count = %d, want 2", len(got))
		}
	})

	t.Run("offset beyond results", func(t *testing.T) {
		got, err := s.ListContracts(ctx, ContractFilter{Offset: 100})
		if err != nil {
			t.Fatalf("ListContracts failed: %v", err)
		}
		if len(got) != 0 {
			t.Fatalf("count = %d, want 0", len(got))
		}
	})

	t.Run("no results for filter", func(t *testing.T) {
		got, err := s.ListContracts(ctx, ContractFilter{Status: StatusReported})
		if err != nil {
			t.Fatalf("ListContracts failed: %v", err)
		}
		if len(got) != 0 {
			t.Fatalf("count = %d, want 0", len(got))
		}
	})
}

func TestUpdateContractStatus(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	c := &Contract{
		ChainID: 1,
		Address: "0xabc123",
		Status:  StatusPending,
	}
	if err := s.SaveContract(ctx, c); err != nil {
		t.Fatalf("SaveContract failed: %v", err)
	}

	err := s.UpdateContractStatus(ctx, 1, "0xabc123", StatusAnalyzing, "")
	if err != nil {
		t.Fatalf("UpdateContractStatus failed: %v", err)
	}

	got, err := s.GetContract(ctx, 1, "0xabc123")
	if err != nil {
		t.Fatalf("GetContract failed: %v", err)
	}
	if got.Status != StatusAnalyzing {
		t.Errorf("status = %q, want %q", got.Status, StatusAnalyzing)
	}
	if got.ErrorMessage != "" {
		t.Errorf("errorMessage = %q, want empty", got.ErrorMessage)
	}

	err = s.UpdateContractStatus(ctx, 1, "0xabc123", StatusFailed, "something went wrong")
	if err != nil {
		t.Fatalf("UpdateContractStatus failed: %v", err)
	}

	got, err = s.GetContract(ctx, 1, "0xabc123")
	if err != nil {
		t.Fatalf("GetContract failed: %v", err)
	}
	if got.Status != StatusFailed {
		t.Errorf("status = %q, want %q", got.Status, StatusFailed)
	}
	if got.ErrorMessage != "something went wrong" {
		t.Errorf("errorMessage = %q, want %q", got.ErrorMessage, "something went wrong")
	}
}

func TestSaveFindings(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Insert a contract first (foreign key).
	c := &Contract{
		ChainID: 1,
		Address: "0xabc123",
		Status:  StatusAnalyzed,
	}
	if err := s.SaveContract(ctx, c); err != nil {
		t.Fatalf("SaveContract failed: %v", err)
	}

	findings := []StoredFinding{
		{
			ID:         "FINDING-001",
			ChainID:    1,
			Address:    "0xabc123",
			AnalysisID: "analysis-001",
			Finding: analyzer.Finding{
				ID:               "FINDING-001",
				Severity:         analyzer.SeverityCritical,
				Title:            "Reentrancy in withdraw()",
				Description:      "The withdraw function makes an external call before updating state.",
				AffectedFunction: "withdraw(uint256)",
				AffectedFile:     "contracts/Vault.sol",
				LineNumbers:      "42-58",
				Impact:           "Complete drainage of vault funds.",
				Recommendation:   "Apply the checks-effects-interactions pattern.",
				Confidence:       0.95,
				Category:         "Reentrancy",
			},
		},
		{
			ID:         "FINDING-002",
			ChainID:    1,
			Address:    "0xabc123",
			AnalysisID: "analysis-001",
			Finding: analyzer.Finding{
				ID:               "FINDING-002",
				Severity:         analyzer.SeverityHigh,
				Title:            "Missing access control on setOwner()",
				Description:      "Anyone can call setOwner to change the contract owner.",
				AffectedFunction: "setOwner(address)",
				AffectedFile:     "contracts/Vault.sol",
				LineNumbers:      "15-18",
				Impact:           "Attacker can take ownership of the contract.",
				Recommendation:   "Add onlyOwner modifier.",
				Confidence:       0.99,
				Category:         "Access Control",
			},
		},
		{
			ID:         "FINDING-003",
			ChainID:    1,
			Address:    "0xabc123",
			AnalysisID: "analysis-001",
			Finding: analyzer.Finding{
				ID:         "FINDING-003",
				Severity:   analyzer.SeverityLow,
				Title:      "Missing event emission",
				Confidence: 0.8,
				Category:   "Logic Error",
			},
		},
	}

	err := s.SaveFindings(ctx, findings)
	if err != nil {
		t.Fatalf("SaveFindings failed: %v", err)
	}

	// Verify via GetFindings.
	got, err := s.GetFindings(ctx, 1, "0xabc123")
	if err != nil {
		t.Fatalf("GetFindings failed: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("findings count = %d, want 3", len(got))
	}

	// Check the first finding.
	f1 := findFindingByID(got, "FINDING-001")
	if f1 == nil {
		t.Fatal("FINDING-001 not found")
	}
	if f1.Finding.Severity != analyzer.SeverityCritical {
		t.Errorf("severity = %q, want %q", f1.Finding.Severity, analyzer.SeverityCritical)
	}
	if f1.Finding.Title != "Reentrancy in withdraw()" {
		t.Errorf("title = %q, want %q", f1.Finding.Title, "Reentrancy in withdraw()")
	}
	if f1.Finding.Confidence != 0.95 {
		t.Errorf("confidence = %f, want 0.95", f1.Finding.Confidence)
	}
	if f1.AnalysisID != "analysis-001" {
		t.Errorf("analysisID = %q, want %q", f1.AnalysisID, "analysis-001")
	}
}

func TestSaveFindings_Upsert(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	c := &Contract{ChainID: 1, Address: "0xabc", Status: StatusAnalyzed}
	if err := s.SaveContract(ctx, c); err != nil {
		t.Fatalf("SaveContract failed: %v", err)
	}

	findings := []StoredFinding{
		{
			ID: "FINDING-001", ChainID: 1, Address: "0xabc", AnalysisID: "a1",
			Finding: analyzer.Finding{
				ID: "FINDING-001", Severity: analyzer.SeverityHigh, Title: "Original Title",
				Confidence: 0.5,
			},
		},
	}

	if err := s.SaveFindings(ctx, findings); err != nil {
		t.Fatalf("first SaveFindings failed: %v", err)
	}

	// Update the finding.
	findings[0].Finding.Title = "Updated Title"
	findings[0].Finding.Confidence = 0.9

	if err := s.SaveFindings(ctx, findings); err != nil {
		t.Fatalf("second SaveFindings failed: %v", err)
	}

	got, err := s.GetFindingByID(ctx, "FINDING-001")
	if err != nil {
		t.Fatalf("GetFindingByID failed: %v", err)
	}
	if got == nil {
		t.Fatal("expected finding, got nil")
	}
	if got.Finding.Title != "Updated Title" {
		t.Errorf("title = %q, want %q", got.Finding.Title, "Updated Title")
	}
	if got.Finding.Confidence != 0.9 {
		t.Errorf("confidence = %f, want 0.9", got.Finding.Confidence)
	}
}

func TestGetFindingByID(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	c := &Contract{ChainID: 1, Address: "0xabc", Status: StatusAnalyzed}
	if err := s.SaveContract(ctx, c); err != nil {
		t.Fatalf("SaveContract failed: %v", err)
	}

	findings := []StoredFinding{
		{
			ID: "FINDING-XYZ", ChainID: 1, Address: "0xabc", AnalysisID: "a1",
			Finding: analyzer.Finding{
				ID: "FINDING-XYZ", Severity: analyzer.SeverityCritical,
				Title: "Test Finding", AffectedFunction: "foo()",
				AffectedFile: "test.sol", Category: "Reentrancy",
			},
		},
	}

	if err := s.SaveFindings(ctx, findings); err != nil {
		t.Fatalf("SaveFindings failed: %v", err)
	}

	got, err := s.GetFindingByID(ctx, "FINDING-XYZ")
	if err != nil {
		t.Fatalf("GetFindingByID failed: %v", err)
	}
	if got == nil {
		t.Fatal("expected finding, got nil")
	}
	if got.ID != "FINDING-XYZ" {
		t.Errorf("id = %q, want %q", got.ID, "FINDING-XYZ")
	}
	if got.Finding.Title != "Test Finding" {
		t.Errorf("title = %q, want %q", got.Finding.Title, "Test Finding")
	}
}

func TestGetFindingByID_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	got, err := s.GetFindingByID(ctx, "nonexistent")
	if err != nil {
		t.Fatalf("GetFindingByID returned error: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil, got %+v", got)
	}
}

func TestGetActionableFindings(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	c := &Contract{ChainID: 1, Address: "0xabc", Status: StatusAnalyzed}
	if err := s.SaveContract(ctx, c); err != nil {
		t.Fatalf("SaveContract failed: %v", err)
	}

	findings := []StoredFinding{
		{
			ID: "F1", ChainID: 1, Address: "0xabc", AnalysisID: "a1",
			Finding: analyzer.Finding{
				ID: "F1", Severity: analyzer.SeverityCritical, Title: "Critical Bug",
			},
		},
		{
			ID: "F2", ChainID: 1, Address: "0xabc", AnalysisID: "a1",
			Finding: analyzer.Finding{
				ID: "F2", Severity: analyzer.SeverityHigh, Title: "High Bug",
			},
		},
		{
			ID: "F3", ChainID: 1, Address: "0xabc", AnalysisID: "a1",
			Finding: analyzer.Finding{
				ID: "F3", Severity: analyzer.SeverityMedium, Title: "Medium Bug",
			},
		},
		{
			ID: "F4", ChainID: 1, Address: "0xabc", AnalysisID: "a1",
			Finding: analyzer.Finding{
				ID: "F4", Severity: analyzer.SeverityLow, Title: "Low Bug",
			},
		},
		{
			ID: "F5", ChainID: 1, Address: "0xabc", AnalysisID: "a1",
			Finding: analyzer.Finding{
				ID: "F5", Severity: analyzer.SeverityInfo, Title: "Info Finding",
			},
		},
	}

	if err := s.SaveFindings(ctx, findings); err != nil {
		t.Fatalf("SaveFindings failed: %v", err)
	}

	got, err := s.GetActionableFindings(ctx)
	if err != nil {
		t.Fatalf("GetActionableFindings failed: %v", err)
	}

	if len(got) != 2 {
		t.Fatalf("count = %d, want 2", len(got))
	}

	// Critical should come first.
	if got[0].Finding.Severity != analyzer.SeverityCritical {
		t.Errorf("first finding severity = %q, want Critical", got[0].Finding.Severity)
	}
	if got[1].Finding.Severity != analyzer.SeverityHigh {
		t.Errorf("second finding severity = %q, want High", got[1].Finding.Severity)
	}
}

func TestGetActionableFindings_ExcludesReported(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	c := &Contract{ChainID: 1, Address: "0xabc", Status: StatusAnalyzed}
	if err := s.SaveContract(ctx, c); err != nil {
		t.Fatalf("SaveContract failed: %v", err)
	}

	findings := []StoredFinding{
		{
			ID: "F1", ChainID: 1, Address: "0xabc", AnalysisID: "a1",
			Finding: analyzer.Finding{
				ID: "F1", Severity: analyzer.SeverityCritical, Title: "Already Reported",
			},
			ReportPath: "/some/report.md",
		},
		{
			ID: "F2", ChainID: 1, Address: "0xabc", AnalysisID: "a1",
			Finding: analyzer.Finding{
				ID: "F2", Severity: analyzer.SeverityHigh, Title: "Not Yet Reported",
			},
		},
	}

	if err := s.SaveFindings(ctx, findings); err != nil {
		t.Fatalf("SaveFindings failed: %v", err)
	}

	// Manually set the report path for F1 using GORM.
	if err := s.db.Model(&StoredFinding{}).Where("id = ?", "F1").Update("report_path", "/some/report.md").Error; err != nil {
		t.Fatalf("failed to update report_path: %v", err)
	}

	got, err := s.GetActionableFindings(ctx)
	if err != nil {
		t.Fatalf("GetActionableFindings failed: %v", err)
	}

	if len(got) != 1 {
		t.Fatalf("count = %d, want 1 (should exclude the already-reported finding)", len(got))
	}

	if got[0].ID != "F2" {
		t.Errorf("finding ID = %q, want %q", got[0].ID, "F2")
	}
}

func TestSaveReport(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	c := &Contract{ChainID: 1, Address: "0xabc", Status: StatusAnalyzed}
	if err := s.SaveContract(ctx, c); err != nil {
		t.Fatalf("SaveContract failed: %v", err)
	}

	findings := []StoredFinding{
		{
			ID: "F1", ChainID: 1, Address: "0xabc", AnalysisID: "a1",
			Finding: analyzer.Finding{
				ID: "F1", Severity: analyzer.SeverityCritical, Title: "Bug",
			},
		},
	}
	if err := s.SaveFindings(ctx, findings); err != nil {
		t.Fatalf("SaveFindings failed: %v", err)
	}

	report := &StoredReport{
		ID:         "report-001",
		FindingID:  "F1",
		ChainID:    1,
		Address:    "0xabc",
		ReportPath: "/data/1/0xabc/reports/report-001.md",
	}

	err := s.SaveReport(ctx, report)
	if err != nil {
		t.Fatalf("SaveReport failed: %v", err)
	}

	if report.CreatedAt.IsZero() {
		t.Error("CreatedAt should be set after save")
	}

	// Verify the report was stored.
	got, err := s.GetReportByFindingID(ctx, "F1")
	if err != nil {
		t.Fatalf("GetReportByFindingID failed: %v", err)
	}
	if got == nil {
		t.Fatal("expected report, got nil")
	}
	if got.ID != "report-001" {
		t.Errorf("id = %q, want %q", got.ID, "report-001")
	}
	if got.ReportPath != "/data/1/0xabc/reports/report-001.md" {
		t.Errorf("reportPath = %q, want %q", got.ReportPath, "/data/1/0xabc/reports/report-001.md")
	}

	// Verify the finding's report_path was also updated.
	f, err := s.GetFindingByID(ctx, "F1")
	if err != nil {
		t.Fatalf("GetFindingByID failed: %v", err)
	}
	if f.ReportPath != "/data/1/0xabc/reports/report-001.md" {
		t.Errorf("finding reportPath = %q, want %q", f.ReportPath, "/data/1/0xabc/reports/report-001.md")
	}
}

func TestGetReportByFindingID_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	got, err := s.GetReportByFindingID(ctx, "nonexistent")
	if err != nil {
		t.Fatalf("GetReportByFindingID returned error: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil, got %+v", got)
	}
}

func TestSaveAnalysisResult(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	c := &Contract{ChainID: 1, Address: "0xabc", Status: StatusPending}
	if err := s.SaveContract(ctx, c); err != nil {
		t.Fatalf("SaveContract failed: %v", err)
	}

	result := &analyzer.AnalysisResult{
		ID:      "analysis-001",
		ChainID: 1,
		Address: "0xabc",
		Summary: analyzer.ContractSummary{
			Type:        analyzer.ContractTypeVault,
			Name:        "MyVault",
			Description: "A simple vault contract",
		},
		Findings: []analyzer.Finding{
			{
				ID:               "FINDING-001",
				Severity:         analyzer.SeverityCritical,
				Title:            "Reentrancy",
				Description:      "Reentrancy in withdraw",
				AffectedFunction: "withdraw()",
				AffectedFile:     "Vault.sol",
				Impact:           "Loss of funds",
				Recommendation:   "Use ReentrancyGuard",
				Confidence:       0.95,
				Category:         "Reentrancy",
			},
			{
				ID:               "FINDING-002",
				Severity:         analyzer.SeverityMedium,
				Title:            "Missing event",
				AffectedFunction: "deposit()",
				Confidence:       0.7,
				Category:         "Logic Error",
			},
		},
		AnalyzedAt: time.Now().UTC(),
		ModelUsed:  "gemini-2.5-pro",
	}

	err := s.SaveAnalysisResult(ctx, result)
	if err != nil {
		t.Fatalf("SaveAnalysisResult failed: %v", err)
	}

	// Verify the analysis result can be retrieved.
	got, err := s.GetAnalysisResult(ctx, "analysis-001")
	if err != nil {
		t.Fatalf("GetAnalysisResult failed: %v", err)
	}
	if got == nil {
		t.Fatal("expected analysis result, got nil")
	}
	if got.ID != "analysis-001" {
		t.Errorf("id = %q, want %q", got.ID, "analysis-001")
	}
	if len(got.Findings) != 2 {
		t.Fatalf("findings count = %d, want 2", len(got.Findings))
	}
	if got.Summary.Name != "MyVault" {
		t.Errorf("summary name = %q, want %q", got.Summary.Name, "MyVault")
	}
	if got.ModelUsed != "gemini-2.5-pro" {
		t.Errorf("modelUsed = %q, want %q", got.ModelUsed, "gemini-2.5-pro")
	}

	// Verify the contract status was updated.
	contract, err := s.GetContract(ctx, 1, "0xabc")
	if err != nil {
		t.Fatalf("GetContract failed: %v", err)
	}
	if contract.Status != StatusAnalyzed {
		t.Errorf("contract status = %q, want %q", contract.Status, StatusAnalyzed)
	}
	if contract.AnalysisID != "analysis-001" {
		t.Errorf("contract analysisID = %q, want %q", contract.AnalysisID, "analysis-001")
	}

	// Verify individual findings were persisted.
	findings, err := s.GetFindings(ctx, 1, "0xabc")
	if err != nil {
		t.Fatalf("GetFindings failed: %v", err)
	}
	if len(findings) != 2 {
		t.Fatalf("findings count = %d, want 2", len(findings))
	}
}

func TestGetAnalysisResult_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	got, err := s.GetAnalysisResult(ctx, "nonexistent")
	if err != nil {
		t.Fatalf("GetAnalysisResult returned error: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil, got %+v", got)
	}
}

func TestAutoMigrateIsIdempotent(t *testing.T) {
	s := newTestStore(t)
	// Running autoMigrate again should not fail.
	err := s.autoMigrate()
	if err != nil {
		t.Fatalf("second autoMigrate failed: %v", err)
	}
}

func TestClose(t *testing.T) {
	s, err := NewSQLiteStore(":memory:", slog.Default())
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	err = s.Close()
	if err != nil {
		t.Fatalf("Close failed: %v", err)
	}

	// Operations after close should fail.
	_, err = s.HasSeen(context.Background(), 1, "0xabc")
	if err == nil {
		t.Error("expected error after close, got nil")
	}
}

func TestMultipleChainsSameAddress(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	c1 := &Contract{ChainID: 1, Address: "0xabc", Name: "EthContract", Status: StatusPending}
	c2 := &Contract{ChainID: 8453, Address: "0xabc", Name: "BaseContract", Status: StatusAnalyzed}

	if err := s.SaveContract(ctx, c1); err != nil {
		t.Fatalf("SaveContract c1 failed: %v", err)
	}
	if err := s.SaveContract(ctx, c2); err != nil {
		t.Fatalf("SaveContract c2 failed: %v", err)
	}

	got1, err := s.GetContract(ctx, 1, "0xabc")
	if err != nil {
		t.Fatalf("GetContract chain 1 failed: %v", err)
	}
	got2, err := s.GetContract(ctx, 8453, "0xabc")
	if err != nil {
		t.Fatalf("GetContract chain 8453 failed: %v", err)
	}

	if got1 == nil || got2 == nil {
		t.Fatal("expected both contracts to exist")
	}

	if got1.Name != "EthContract" {
		t.Errorf("chain 1 name = %q, want %q", got1.Name, "EthContract")
	}
	if got2.Name != "BaseContract" {
		t.Errorf("chain 8453 name = %q, want %q", got2.Name, "BaseContract")
	}

	if got1.Status != StatusPending {
		t.Errorf("chain 1 status = %q, want %q", got1.Status, StatusPending)
	}
	if got2.Status != StatusAnalyzed {
		t.Errorf("chain 8453 status = %q, want %q", got2.Status, StatusAnalyzed)
	}
}

func TestGetFindings_EmptyForUnknownContract(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	findings, err := s.GetFindings(ctx, 1, "0xnonexistent")
	if err != nil {
		t.Fatalf("GetFindings failed: %v", err)
	}
	if len(findings) != 0 {
		t.Fatalf("expected 0 findings, got %d", len(findings))
	}
}

func TestSaveFindings_Empty(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	err := s.SaveFindings(ctx, nil)
	if err != nil {
		t.Fatalf("SaveFindings with nil slice should not fail: %v", err)
	}

	err = s.SaveFindings(ctx, []StoredFinding{})
	if err != nil {
		t.Fatalf("SaveFindings with empty slice should not fail: %v", err)
	}
}

// findFindingByID is a test helper to locate a finding in a slice by ID.
func findFindingByID(findings []StoredFinding, id string) *StoredFinding {
	for i := range findings {
		if findings[i].ID == id {
			return &findings[i]
		}
	}
	return nil
}
