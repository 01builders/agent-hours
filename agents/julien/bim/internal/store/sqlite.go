package store

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"

	"github.com/julienrbrt/bim/internal/analyzer"
)

// SQLiteStore implements the Store interface using GORM with SQLite.
type SQLiteStore struct {
	db     *gorm.DB
	logger *slog.Logger
}

// NewSQLiteStore opens (or creates) a SQLite database at the given path and runs auto-migration.
// Use ":memory:" for an in-memory database (useful for testing).
func NewSQLiteStore(dbPath string, log *slog.Logger) (*SQLiteStore, error) {
	dsn := dbPath
	if dsn == ":memory:" {
		// For in-memory databases, ensure the connection stays open and is shared.
		dsn = "file::memory:?cache=shared"
	} else if dsn != "" && !contains(dsn, "?") {
		dsn += "?_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=ON"
	}

	gormLogger := logger.Discard
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: gormLogger,
	})
	if err != nil {
		return nil, fmt.Errorf("opening sqlite database: %w", err)
	}

	// Enable WAL mode and foreign keys via PRAGMA for non-DSN params.
	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("getting underlying sql.DB: %w", err)
	}
	if err := sqlDB.Ping(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("pinging sqlite database: %w", err)
	}

	s := &SQLiteStore{db: db, logger: log}

	if err := s.autoMigrate(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("running auto-migration: %w", err)
	}

	return s, nil
}

func (s *SQLiteStore) autoMigrate() error {
	return s.db.AutoMigrate(
		&Contract{},
		&AnalysisResultRecord{},
		&StoredFinding{},
		&StoredReport{},
	)
}

// Close closes the underlying database connection.
func (s *SQLiteStore) Close() error {
	sqlDB, err := s.db.DB()
	if err != nil {
		return fmt.Errorf("getting underlying sql.DB for close: %w", err)
	}
	return sqlDB.Close()
}

// SaveContract upserts a contract record.
func (s *SQLiteStore) SaveContract(ctx context.Context, c *Contract) error {
	now := time.Now().UTC()
	if c.FirstSeenAt.IsZero() {
		c.FirstSeenAt = now
	}
	c.UpdatedAt = now

	result := s.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "chain_id"}, {Name: "address"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"name", "language", "compiler_version", "match_type",
				"status", "analysis_id", "source_count",
				"updated_at", "error_message",
			}),
		}).
		Create(c)

	if result.Error != nil {
		return fmt.Errorf("saving contract %s on chain %d: %w", c.Address, c.ChainID, result.Error)
	}
	return nil
}

// GetContract retrieves a contract by chain ID and address. Returns nil if not found.
func (s *SQLiteStore) GetContract(ctx context.Context, chainID uint64, address string) (*Contract, error) {
	var c Contract
	result := s.db.WithContext(ctx).
		Where("chain_id = ? AND address = ?", chainID, address).
		First(&c)

	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("getting contract %s on chain %d: %w", address, chainID, result.Error)
	}
	return &c, nil
}

// HasSeen checks whether a contract has been recorded before.
func (s *SQLiteStore) HasSeen(ctx context.Context, chainID uint64, address string) (bool, error) {
	var count int64
	result := s.db.WithContext(ctx).
		Model(&Contract{}).
		Where("chain_id = ? AND address = ?", chainID, address).
		Count(&count)

	if result.Error != nil {
		return false, fmt.Errorf("checking if contract seen: %w", result.Error)
	}
	return count > 0, nil
}

// ListContracts retrieves contracts matching the given filter.
func (s *SQLiteStore) ListContracts(ctx context.Context, filter ContractFilter) ([]Contract, error) {
	query := s.db.WithContext(ctx).Model(&Contract{})

	if filter.ChainID != 0 {
		query = query.Where("chain_id = ?", filter.ChainID)
	}
	if filter.Status != "" {
		query = query.Where("status = ?", string(filter.Status))
	}

	query = query.Order("first_seen_at DESC")

	if filter.Limit > 0 {
		query = query.Limit(filter.Limit)
	}
	if filter.Offset > 0 {
		query = query.Offset(filter.Offset)
	}

	var contracts []Contract
	if result := query.Find(&contracts); result.Error != nil {
		return nil, fmt.Errorf("listing contracts: %w", result.Error)
	}
	return contracts, nil
}

// UpdateContractStatus sets the status and error message on a contract.
func (s *SQLiteStore) UpdateContractStatus(ctx context.Context, chainID uint64, address string, status ContractStatus, errMsg string) error {
	result := s.db.WithContext(ctx).
		Model(&Contract{}).
		Where("chain_id = ? AND address = ?", chainID, address).
		Updates(map[string]any{
			"status":        string(status),
			"error_message": errMsg,
			"updated_at":    time.Now().UTC(),
		})

	if result.Error != nil {
		return fmt.Errorf("updating contract status: %w", result.Error)
	}
	return nil
}

// SaveFindings upserts a batch of findings in a transaction.
func (s *SQLiteStore) SaveFindings(ctx context.Context, findings []StoredFinding) error {
	if len(findings) == 0 {
		return nil
	}

	// Sync the embedded Finding fields to the flat DB columns.
	for i := range findings {
		findings[i].syncToFields()
		if findings[i].CreatedAt.IsZero() {
			findings[i].CreatedAt = time.Now().UTC()
		}
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for i := range findings {
			result := tx.
				Clauses(clause.OnConflict{
					Columns: []clause.Column{{Name: "id"}},
					DoUpdates: clause.AssignmentColumns([]string{
						"severity", "title", "description",
						"affected_function", "affected_file", "line_numbers",
						"impact", "recommendation", "confidence", "category",
					}),
				}).
				Create(&findings[i])
			if result.Error != nil {
				return fmt.Errorf("inserting finding %s: %w", findings[i].ID, result.Error)
			}
		}
		return nil
	})
}

// GetFindings retrieves all findings for a given contract.
func (s *SQLiteStore) GetFindings(ctx context.Context, chainID uint64, address string) ([]StoredFinding, error) {
	var findings []StoredFinding
	result := s.db.WithContext(ctx).
		Where("chain_id = ? AND address = ?", chainID, address).
		Order("created_at DESC").
		Find(&findings)

	if result.Error != nil {
		return nil, fmt.Errorf("querying findings: %w", result.Error)
	}

	for i := range findings {
		findings[i].syncFromFields()
	}
	return findings, nil
}

// GetFindingByID retrieves a single finding by ID. Returns nil if not found.
func (s *SQLiteStore) GetFindingByID(ctx context.Context, id string) (*StoredFinding, error) {
	var sf StoredFinding
	result := s.db.WithContext(ctx).Where("id = ?", id).First(&sf)

	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("getting finding %s: %w", id, result.Error)
	}

	sf.syncFromFields()
	return &sf, nil
}

// GetActionableFindings retrieves all Critical/High findings that have not yet been reported.
func (s *SQLiteStore) GetActionableFindings(ctx context.Context) ([]StoredFinding, error) {
	var findings []StoredFinding
	result := s.db.WithContext(ctx).
		Where("severity IN ? AND (report_path IS NULL OR report_path = '')", []string{"Critical", "High"}).
		Order("CASE severity WHEN 'Critical' THEN 0 ELSE 1 END, created_at DESC").
		Find(&findings)

	if result.Error != nil {
		return nil, fmt.Errorf("querying actionable findings: %w", result.Error)
	}

	for i := range findings {
		findings[i].syncFromFields()
	}
	return findings, nil
}

// SaveReport upserts a report and updates the corresponding finding's report_path.
func (s *SQLiteStore) SaveReport(ctx context.Context, report *StoredReport) error {
	now := time.Now().UTC()
	if report.CreatedAt.IsZero() {
		report.CreatedAt = now
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.
			Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "id"}},
				DoUpdates: clause.AssignmentColumns([]string{"report_path"}),
			}).
			Create(report)
		if result.Error != nil {
			return fmt.Errorf("saving report %s: %w", report.ID, result.Error)
		}

		// Also update the finding's report_path.
		result = tx.Model(&StoredFinding{}).
			Where("id = ?", report.FindingID).
			Update("report_path", report.ReportPath)
		if result.Error != nil {
			return fmt.Errorf("updating finding report_path for %s: %w", report.FindingID, result.Error)
		}

		return nil
	})
}

// GetReportByFindingID retrieves a report by its associated finding ID. Returns nil if not found.
func (s *SQLiteStore) GetReportByFindingID(ctx context.Context, findingID string) (*StoredReport, error) {
	var r StoredReport
	result := s.db.WithContext(ctx).Where("finding_id = ?", findingID).First(&r)

	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("getting report for finding %s: %w", findingID, result.Error)
	}
	return &r, nil
}

// SaveAnalysisResult serializes and stores a full analysis result as JSON,
// and also persists each finding individually.
func (s *SQLiteStore) SaveAnalysisResult(ctx context.Context, ar *analyzer.AnalysisResult) error {
	data, err := json.Marshal(ar)
	if err != nil {
		return fmt.Errorf("marshaling analysis result: %w", err)
	}

	now := time.Now().UTC()

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		record := AnalysisResultRecord{
			ID:         ar.ID,
			ChainID:    ar.ChainID,
			Address:    ar.Address,
			ResultJSON: string(data),
			CreatedAt:  now,
		}

		result := tx.
			Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "id"}},
				DoUpdates: clause.AssignmentColumns([]string{"result_json"}),
			}).
			Create(&record)
		if result.Error != nil {
			return fmt.Errorf("saving analysis result %s: %w", ar.ID, result.Error)
		}

		// Update the contract's analysis_id and status.
		result = tx.Model(&Contract{}).
			Where("chain_id = ? AND address = ?", ar.ChainID, ar.Address).
			Updates(map[string]any{
				"analysis_id": ar.ID,
				"status":      string(StatusAnalyzed),
				"updated_at":  now,
			})
		if result.Error != nil {
			return fmt.Errorf("updating contract analysis_id: %w", result.Error)
		}

		// Persist individual findings.
		if len(ar.Findings) > 0 {
			storedFindings := make([]StoredFinding, len(ar.Findings))
			for i, f := range ar.Findings {
				storedFindings[i] = StoredFinding{
					ID:         f.ID,
					ChainID:    ar.ChainID,
					Address:    ar.Address,
					AnalysisID: ar.ID,
					Finding:    f,
					CreatedAt:  ar.AnalyzedAt,
				}
				storedFindings[i].syncToFields()
			}

			for j := range storedFindings {
				res := tx.
					Clauses(clause.OnConflict{
						Columns: []clause.Column{{Name: "id"}},
						DoUpdates: clause.AssignmentColumns([]string{
							"severity", "title", "description",
							"affected_function", "affected_file", "line_numbers",
							"impact", "recommendation", "confidence", "category",
						}),
					}).
					Create(&storedFindings[j])
				if res.Error != nil {
					return fmt.Errorf("inserting finding %s: %w", storedFindings[j].ID, res.Error)
				}
			}
		}

		return nil
	})
}

// GetAnalysisResult retrieves and deserializes a full analysis result by ID. Returns nil if not found.
func (s *SQLiteStore) GetAnalysisResult(ctx context.Context, id string) (*analyzer.AnalysisResult, error) {
	var record AnalysisResultRecord
	result := s.db.WithContext(ctx).Where("id = ?", id).First(&record)

	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("getting analysis result %s: %w", id, result.Error)
	}

	var ar analyzer.AnalysisResult
	if err := json.Unmarshal([]byte(record.ResultJSON), &ar); err != nil {
		return nil, fmt.Errorf("unmarshaling analysis result %s: %w", id, err)
	}
	return &ar, nil
}

// contains is a simple helper to avoid importing strings just for this.
func contains(s, substr string) bool {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
