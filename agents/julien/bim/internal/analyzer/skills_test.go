package analyzer

import (
	"slices"
	"strings"
	"testing"
)

func TestLoadAllSkills(t *testing.T) {
	skills, err := LoadAllSkills()
	if err != nil {
		t.Fatalf("LoadAllSkills failed: %v", err)
	}
	if len(skills) == 0 {
		t.Fatal("expected at least one skill, got 0")
	}

	// Verify all known skills are present.
	loaded := make(map[string]bool)
	for _, s := range skills {
		loaded[s.Name] = true
		if s.Content == "" {
			t.Errorf("skill %q has empty content", s.Name)
		}
	}

	for name := range knownSkills {
		if !loaded[name] {
			t.Errorf("known skill %q was not loaded", name)
		}
	}
}

func TestLoadSkill(t *testing.T) {
	skill, err := LoadSkill("false-positive-patterns")
	if err != nil {
		t.Fatalf("LoadSkill failed: %v", err)
	}
	if skill.Name != "false-positive-patterns" {
		t.Errorf("name = %q, want %q", skill.Name, "false-positive-patterns")
	}
	if !strings.Contains(skill.Content, "False Positive") {
		t.Error("expected skill content to contain 'False Positive'")
	}
}

func TestLoadSkill_NotFound(t *testing.T) {
	_, err := LoadSkill("nonexistent-skill")
	if err == nil {
		t.Fatal("expected error for nonexistent skill, got nil")
	}
}

func TestSelectSkillsForSource_AlwaysIncludesBaseSkills(t *testing.T) {
	sources := map[string]string{
		"Simple.sol": "pragma solidity ^0.8.0; contract Simple { }",
	}
	selected := selectSkillsForSource(sources, "Solidity")

	has := func(name string) bool {
		return slices.Contains(selected, name)
	}

	if !has("false-positive-patterns") {
		t.Error("expected false-positive-patterns to always be selected")
	}
	if !has("entry-point-analyzer") {
		t.Error("expected entry-point-analyzer to always be selected")
	}
}

func TestSelectSkillsForSource_TokenRelated(t *testing.T) {
	sources := map[string]string{
		"Token.sol": `pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
contract MyToken is IERC20 {
    function transfer(address to, uint256 amount) external returns (bool) {}
    function balanceOf(address account) external view returns (uint256) {}
    function totalSupply() external view returns (uint256) {}
}`,
	}
	selected := selectSkillsForSource(sources, "Solidity")

	has := func(name string) bool {
		return slices.Contains(selected, name)
	}

	if !has("token-integration-analyzer") {
		t.Error("expected token-integration-analyzer for ERC20 source")
	}
	if !has("token-assessment-categories") {
		t.Error("expected token-assessment-categories for ERC20 source")
	}
}

func TestSelectSkillsForSource_Solidity(t *testing.T) {
	sources := map[string]string{
		"Vault.sol": "pragma solidity ^0.8.0; contract Vault { function deposit() external payable {} }",
	}
	selected := selectSkillsForSource(sources, "Solidity")

	has := func(name string) bool {
		return slices.Contains(selected, name)
	}

	if !has("guidelines-advisor") {
		t.Error("expected guidelines-advisor for Solidity source")
	}
}

func TestSelectSkillsForSource_LargeCodebase(t *testing.T) {
	sources := map[string]string{
		"A.sol": strings.Repeat("x", 10000),
		"B.sol": strings.Repeat("y", 10000),
		"C.sol": strings.Repeat("z", 10000),
	}
	selected := selectSkillsForSource(sources, "Solidity")

	has := func(name string) bool {
		return slices.Contains(selected, name)
	}

	if !has("variant-analysis") {
		t.Error("expected variant-analysis for large codebase (3+ files)")
	}
}

func TestSelectSkillsForSource_NonTokenNonSolidity(t *testing.T) {
	sources := map[string]string{
		"main.vy": "# @version ^0.3.0\n@external\ndef foo(): pass",
	}
	selected := selectSkillsForSource(sources, "Vyper")

	has := func(name string) bool {
		return slices.Contains(selected, name)
	}

	// Should still have the base skills.
	if !has("false-positive-patterns") {
		t.Error("expected false-positive-patterns")
	}
	if !has("entry-point-analyzer") {
		t.Error("expected entry-point-analyzer")
	}
	// Should NOT have Solidity-specific skills.
	if has("guidelines-advisor") {
		t.Error("did not expect guidelines-advisor for Vyper")
	}
	// Should NOT have token skills.
	if has("token-integration-analyzer") {
		t.Error("did not expect token-integration-analyzer for non-token source")
	}
}

func TestSelectSkillsForSource_NoDuplicates(t *testing.T) {
	sources := map[string]string{
		"Token.sol": "pragma solidity ^0.8.0; contract T { function transfer(address,uint) external {} }",
	}
	selected := selectSkillsForSource(sources, "Solidity")

	seen := make(map[string]bool)
	for _, s := range selected {
		if seen[s] {
			t.Errorf("duplicate skill in selection: %q", s)
		}
		seen[s] = true
	}
}

func TestFormatSkillsBlock_Empty(t *testing.T) {
	result := FormatSkillsBlock(nil)
	if result != "" {
		t.Errorf("expected empty string for nil skills, got %q", result)
	}

	result = FormatSkillsBlock([]*Skill{})
	if result != "" {
		t.Errorf("expected empty string for empty skills, got %q", result)
	}
}

func TestFormatSkillsBlock_WithSkills(t *testing.T) {
	skills := []*Skill{
		{Name: "test-skill", Content: "---\nname: test\n---\n# Test Skill\n\nDo stuff."},
		{Name: "another", Content: "# Another Skill\n\nMore stuff."},
	}

	result := FormatSkillsBlock(skills)

	if !strings.Contains(result, "### Skill: test-skill") {
		t.Error("expected skill header for test-skill")
	}
	if !strings.Contains(result, "### Skill: another") {
		t.Error("expected skill header for another")
	}
	// Front matter should be stripped.
	if strings.Contains(result, "name: test") {
		t.Error("expected front matter to be stripped from test-skill")
	}
	if !strings.Contains(result, "# Test Skill") {
		t.Error("expected skill body content after front matter stripping")
	}
	// Content without front matter should pass through.
	if !strings.Contains(result, "# Another Skill") {
		t.Error("expected skill body content for skill without front matter")
	}
}

func TestStripFrontMatter(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantHas string
		wantNot string
	}{
		{
			name:    "with front matter",
			input:   "---\nname: test\ndescription: something\n---\n# Heading\n\nBody text.",
			wantHas: "# Heading",
			wantNot: "name: test",
		},
		{
			name:    "no front matter",
			input:   "# Heading\n\nBody text.",
			wantHas: "# Heading",
		},
		{
			name:    "unclosed front matter",
			input:   "---\nname: test\n# Heading",
			wantHas: "name: test",
		},
		{
			name:    "empty",
			input:   "",
			wantHas: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := stripFrontMatter(tt.input)
			if tt.wantHas != "" && !strings.Contains(result, tt.wantHas) {
				t.Errorf("expected result to contain %q, got %q", tt.wantHas, result)
			}
			if tt.wantNot != "" && strings.Contains(result, tt.wantNot) {
				t.Errorf("expected result to NOT contain %q, got %q", tt.wantNot, result)
			}
		})
	}
}

func TestDedupe(t *testing.T) {
	tests := []struct {
		input []string
		want  int
	}{
		{[]string{"a", "b", "c"}, 3},
		{[]string{"a", "a", "b"}, 2},
		{[]string{"a", "b", "a", "b", "c"}, 3},
		{nil, 0},
		{[]string{}, 0},
	}

	for _, tt := range tests {
		result := dedupe(tt.input)
		if len(result) != tt.want {
			t.Errorf("dedupe(%v) = %d items, want %d", tt.input, len(result), tt.want)
		}
	}
}

func TestIsTokenRelated(t *testing.T) {
	tests := []struct {
		name   string
		source string
		want   bool
	}{
		{"ERC20 import", "import ierc20 from openzeppelin", true},
		{"transfer call", "function transfer(address to, uint amount)", true},
		{"balanceOf", "function balanceof(address)", true},
		{"mint", "_mint(msg.sender, amount)", true},
		{"approve", "function approve(address spender, uint amount)", true},
		{"plain contract", "contract simple { function foo() {} }", false},
		{"empty", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isTokenRelated(strings.ToLower(tt.source))
			if got != tt.want {
				t.Errorf("isTokenRelated(%q) = %v, want %v", tt.name, got, tt.want)
			}
		})
	}
}

func TestHasSolidityFiles(t *testing.T) {
	if !hasSolidityFiles(map[string]string{"Token.sol": "content"}) {
		t.Error("expected true for .sol file")
	}
	if !hasSolidityFiles(map[string]string{"path/to/Token.SOL": "content"}) {
		t.Error("expected true for .SOL file (case insensitive)")
	}
	if hasSolidityFiles(map[string]string{"main.vy": "content"}) {
		t.Error("expected false for .vy file")
	}
	if hasSolidityFiles(map[string]string{}) {
		t.Error("expected false for empty map")
	}
}
