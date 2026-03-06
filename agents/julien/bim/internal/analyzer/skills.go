package analyzer

import (
	"embed"
	"fmt"
	"strings"
)

//go:embed skills/*.md
var skillsFS embed.FS

// Skill represents a loaded skill with its metadata and content.
type Skill struct {
	Name    string
	Content string
}

var knownSkills = map[string]string{
	"entry-point-analyzer":        "Identifies state-changing entry points and access control patterns",
	"false-positive-patterns":     "Reduces false positives using Trail of Bits' lessons learned",
	"token-integration-analyzer":  "Analyzes token implementations for ERC20/ERC721 conformity and weird token patterns",
	"token-assessment-categories": "Detailed assessment criteria for 24+ weird ERC20 patterns and token risks",
	"variant-analysis":            "Finds similar vulnerabilities across the codebase from an initial pattern",
	"guidelines-advisor":          "Smart contract development best practices from Trail of Bits",
	"audit-prep":                  "Audit preparation checklist and methodology",
}

func LoadSkill(name string) (*Skill, error) {
	path := "skills/" + name + ".md"
	data, err := skillsFS.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("loading skill %q: %w", name, err)
	}
	return &Skill{Name: name, Content: string(data)}, nil
}

func LoadAllSkills() ([]*Skill, error) {
	entries, err := skillsFS.ReadDir("skills")
	if err != nil {
		return nil, fmt.Errorf("reading skills directory: %w", err)
	}

	var skills []*Skill
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), ".md")
		skill, err := LoadSkill(name)
		if err != nil {
			return nil, err
		}
		skills = append(skills, skill)
	}
	return skills, nil
}

// selectSkillsForSource picks the most relevant skills based on heuristics.
func selectSkillsForSource(sources map[string]string, language string) []string {
	combined := combineSourceContent(sources)
	lower := strings.ToLower(combined)
	langLower := strings.ToLower(language)

	selected := []string{
		"false-positive-patterns",
		"entry-point-analyzer",
	}

	isSolidity := langLower == "solidity" ||
		strings.Contains(lower, "pragma solidity") ||
		hasSolidityFiles(sources)

	if isTokenRelated(lower) {
		selected = append(selected, "token-integration-analyzer", "token-assessment-categories")
	}

	if isSolidity {
		selected = append(selected, "guidelines-advisor")
	}

	if len(sources) >= 3 || len(combined) > 20_000 {
		selected = append(selected, "variant-analysis")
	}

	return dedupe(selected)
}

// FormatSkillsBlock renders the selected skills into a prompt-injectable block.
func FormatSkillsBlock(skills []*Skill) string {
	if len(skills) == 0 {
		return ""
	}

	var b strings.Builder
	b.WriteString("\n## Security Analysis Skills\n\n")
	b.WriteString("Apply the following expert knowledge during your analysis:\n\n")

	for _, skill := range skills {
		fmt.Fprintf(&b, "### Skill: %s\n\n", skill.Name)
		b.WriteString(stripFrontMatter(skill.Content))
		b.WriteString("\n\n---\n\n")
	}

	return b.String()
}

func isTokenRelated(lowerSource string) bool {
	tokenSignals := []string{
		"erc20", "erc721", "erc1155", "erc777",
		"transfer(", "transferfrom(", "balanceof(",
		"ierc20", "ierc721",
		"safetransfer", "safetransferfrom",
		"totalsupply", "_mint(", "_burn(",
		"allowance", "approve(",
		"openzeppelin", "@openzeppelin",
		"tokensreceived", "ontokenstransfer",
	}
	for _, signal := range tokenSignals {
		if strings.Contains(lowerSource, signal) {
			return true
		}
	}
	return false
}

func hasSolidityFiles(sources map[string]string) bool {
	for path := range sources {
		if strings.HasSuffix(strings.ToLower(path), ".sol") {
			return true
		}
	}
	return false
}

func combineSourceContent(sources map[string]string) string {
	var b strings.Builder
	for _, content := range sources {
		b.WriteString(content)
	}
	return b.String()
}

func stripFrontMatter(content string) string {
	if !strings.HasPrefix(content, "---") {
		return content
	}
	rest := content[3:]
	_, after, ok := strings.Cut(rest, "---")
	if !ok {
		return content
	}
	return strings.TrimSpace(after)
}

func dedupe(items []string) []string {
	seen := make(map[string]bool, len(items))
	result := make([]string, 0, len(items))
	for _, item := range items {
		if !seen[item] {
			seen[item] = true
			result = append(result, item)
		}
	}
	return result
}
