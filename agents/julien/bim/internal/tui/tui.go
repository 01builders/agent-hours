package tui

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"charm.land/bubbles/v2/textinput"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"
	lipgloss "charm.land/lipgloss/v2"

	"google.golang.org/adk/agent"
	"google.golang.org/adk/runner"
	"google.golang.org/adk/session"
	"google.golang.org/genai"
)

// progRef is a shared, mutable holder for the *tea.Program reference.
// Because bubbletea copies the Model value when NewProgram is called,
// we need a level of indirection so every copy (and the LogSink) can
// reach the same *tea.Program once it is wired up.
type progRef struct {
	mu sync.Mutex
	p  *tea.Program
}

func newProgRef() *progRef { return &progRef{} }

func (r *progRef) Set(p *tea.Program) {
	r.mu.Lock()
	r.p = p
	r.mu.Unlock()
}

func (r *progRef) Ready() bool {
	r.mu.Lock()
	ok := r.p != nil
	r.mu.Unlock()
	return ok
}

func (r *progRef) Send(msg tea.Msg) {
	r.mu.Lock()
	p := r.p
	r.mu.Unlock()
	if p != nil {
		p.Send(msg)
	}
}

// ---------------------------------------------------------------------------
// Message types internal to the TUI
// ---------------------------------------------------------------------------

// agentChunkMsg carries a piece of streaming text from the model.
type agentChunkMsg struct{ text string }

// agentDoneMsg signals that the runner iteration has finished.
type agentDoneMsg struct{ err error }

// agentToolCallMsg is sent when the agent invokes a tool.
type agentToolCallMsg struct{ tool string }

// agentToolResultMsg is sent when a tool invocation returns.
type agentToolResultMsg struct{ tool string }

// agentStatusMsg is a free-form status line (shown in the tab bar and as a
// transient line at the bottom of the chat viewport while the agent is busy).
type agentStatusMsg struct{ text string }

const (
	tabChat = iota
	tabLogs
)

// ---------------------------------------------------------------------------
// Pretty tool-name mapping
// ---------------------------------------------------------------------------

var toolDisplayNames = map[string]string{
	"discover_contracts": "Discovering contracts",
	"analyze_contract":   "Analyzing contract",
	"generate_report":    "Generating report",
	"display_report":     "Displaying report",
	"run_pipeline":       "Running full pipeline",
	"generate_poc":       "Generating PoC exploit",
	"reanalyze_contract": "Re-analyzing contract",
	"discovery_status":   "Checking discovery status",
}

func prettyToolName(name string) string {
	if pretty, ok := toolDisplayNames[name]; ok {
		return pretty
	}
	return name
}

// Config holds everything the TUI needs from the caller.
type Config struct {
	Runner    *runner.Runner
	SessionID string
	UserID    string
	Ctx       context.Context
}

// Model is the top-level Bubbletea model.
type Model struct {
	cfg Config

	activeTab int

	chatVP viewport.Model
	logsVP viewport.Model
	input  textinput.Model

	chatLines []string
	logLines  []string

	// agentBusy is true while the agent goroutine is running.
	agentBusy bool
	// agentPartial accumulates streaming text chunks for the current reply.
	agentPartial string
	// agentStatus is a human-readable description of what the agent is doing
	// right now (e.g. "Calling analyze_contract…").  Shown in the tab bar
	// and as a ghost line in the chat viewport.
	agentStatus string

	width  int
	height int

	// pref is a shared pointer so every copy of Model (and the LogSink)
	// can reach the same *tea.Program after it is wired up.
	pref *progRef

	// logSink is kept so Init() can flush lines queued before the program started.
	logSink *LogSink

	ready bool
}

// New creates the initial TUI model.
func New(cfg Config) Model {
	ti := textinput.New()
	ti.Prompt = "> "
	ti.Placeholder = "Ask BiM something…"
	ti.Focus()
	ti.CharLimit = 4096

	return Model{
		cfg:       cfg,
		activeTab: tabChat,
		chatVP:    viewport.New(),
		logsVP:    viewport.New(),
		input:     ti,
		chatLines: []string{"Welcome to BiM. Type a message and press Enter."},
		logLines:  []string{},
		pref:      newProgRef(),
	}
}

// ProgRef returns the shared program-reference holder.
func (m *Model) ProgRef() *progRef {
	return m.pref
}

// SetProgram is a convenience that stores the program in the shared ref.
func (m *Model) SetProgram(p *tea.Program) {
	m.pref.Set(p)
}

// SetRunnerConfig fills in the Runner, SessionID and UserID that were not
// available when the Model was first constructed.
func (m *Model) SetRunnerConfig(r *runner.Runner, sessionID, userID string) {
	m.cfg.Runner = r
	m.cfg.SessionID = sessionID
	m.cfg.UserID = userID
}

// SetLogSink stores the LogSink so that Init() can flush lines that were
// queued before the program started running.
func (m *Model) SetLogSink(s *LogSink) {
	m.logSink = s
}

// ---------------------------------------------------------------------------
// tea.Model interface
// ---------------------------------------------------------------------------

func (m Model) Init() tea.Cmd {
	cmds := []tea.Cmd{m.input.Focus()}
	if m.logSink != nil {
		if flushCmd := m.logSink.FlushQueued(); flushCmd != nil {
			cmds = append(cmds, flushCmd)
		}
	}
	return tea.Batch(cmds...)
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.ready = true
		m.recalcLayout()
		return m, nil

	case tea.KeyPressMsg:
		switch {
		// Quit
		case msg.Code == 'c' && msg.Mod == tea.ModCtrl:
			return m, tea.Quit

		// Switch tabs
		case msg.Code == tea.KeyTab && msg.Mod == 0:
			m.activeTab = (m.activeTab + 1) % 2
			return m, nil

		// Submit prompt
		case msg.Code == tea.KeyEnter && msg.Mod == 0 && m.activeTab == tabChat:
			if m.agentBusy {
				return m, nil
			}
			text := strings.TrimSpace(m.input.Value())
			if text == "" {
				return m, nil
			}
			m.input.SetValue("")
			m.chatLines = append(m.chatLines, "You: "+text)
			m.agentBusy = true
			m.agentPartial = ""
			m.agentStatus = "Starting…"
			m.syncChatViewport()
			return m, m.runAgent(text)
		}

		// When on the chat tab, let textinput handle typing; otherwise
		// forward to the active viewport for scrolling.
		if m.activeTab == tabChat {
			switch msg.Code {
			case tea.KeyUp, tea.KeyDown, tea.KeyPgUp, tea.KeyPgDown:
				vp, cmd := m.chatVP.Update(msg)
				m.chatVP = vp
				cmds = append(cmds, cmd)
			default:
				ti, cmd := m.input.Update(msg)
				m.input = ti
				cmds = append(cmds, cmd)
			}
		} else {
			vp, cmd := m.logsVP.Update(msg)
			m.logsVP = vp
			cmds = append(cmds, cmd)
		}

		return m, tea.Batch(cmds...)

	// --- custom messages ---------------------------------------------------

	case logLineMsg:
		m.logLines = append(m.logLines, msg.line)
		m.syncLogsViewport()
		return m, nil

	case agentChunkMsg:
		m.agentPartial += msg.text
		m.agentStatus = "Streaming response…"
		m.syncChatViewport()
		return m, nil

	case agentToolCallMsg:
		m.agentStatus = prettyToolName(msg.tool) + "…"
		// Append a visible status line so the user can see the sequence of
		// tool invocations even after they scroll past.
		m.chatLines = append(m.chatLines, fmt.Sprintf("  ⚙ Calling %s", prettyToolName(msg.tool)))
		m.syncChatViewport()
		return m, nil

	case agentToolResultMsg:
		m.agentStatus = prettyToolName(msg.tool) + " done, processing…"
		m.chatLines = append(m.chatLines, fmt.Sprintf("  ✔ %s complete", prettyToolName(msg.tool)))
		m.syncChatViewport()
		return m, nil

	case agentStatusMsg:
		m.agentStatus = msg.text
		m.syncChatViewport()
		return m, nil

	case agentDoneMsg:
		m.agentBusy = false
		m.agentStatus = ""
		if msg.err != nil {
			m.chatLines = append(m.chatLines, "Error: "+msg.err.Error())
		} else if m.agentPartial != "" {
			m.chatLines = append(m.chatLines, "BiM: "+m.agentPartial)
		}
		m.agentPartial = ""
		m.syncChatViewport()
		return m, nil
	}

	// Forward other messages (mouse, etc.) to sub-components.
	if m.activeTab == tabChat {
		vp, cmd := m.chatVP.Update(msg)
		m.chatVP = vp
		cmds = append(cmds, cmd)
		ti, cmd2 := m.input.Update(msg)
		m.input = ti
		cmds = append(cmds, cmd2)
	} else {
		vp, cmd := m.logsVP.Update(msg)
		m.logsVP = vp
		cmds = append(cmds, cmd)
	}

	return m, tea.Batch(cmds...)
}

func (m Model) View() tea.View {
	if !m.ready {
		v := tea.NewView("Initialising…")
		v.AltScreen = true
		return v
	}

	tabBar := m.renderTabBar()

	var body string
	if m.activeTab == tabChat {
		body = m.chatVP.View()
	} else {
		body = m.logsVP.View()
	}

	var inputLine string
	if m.activeTab == tabChat {
		inputLine = m.input.View()
	} else {
		inputLine = dimStyle().Render("(switch to Chat tab to type)")
	}

	content := lipgloss.JoinVertical(lipgloss.Left, tabBar, body, inputLine)

	view := tea.NewView(content)
	view.AltScreen = true
	return view
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

func (m *Model) recalcLayout() {
	// Tab bar = 1 line, input = 1 line, so viewport gets the rest.
	vpHeight := m.height - 2
	if vpHeight < 1 {
		vpHeight = 1
	}

	m.chatVP.SetWidth(m.width)
	m.chatVP.SetHeight(vpHeight)
	m.logsVP.SetWidth(m.width)
	m.logsVP.SetHeight(vpHeight)
	m.input.SetWidth(m.width)

	m.syncChatViewport()
	m.syncLogsViewport()
}

func (m *Model) syncChatViewport() {
	lines := make([]string, len(m.chatLines))
	copy(lines, m.chatLines)

	// Show the in-progress partial reply or a status indicator.
	if m.agentPartial != "" {
		lines = append(lines, "BiM: "+m.agentPartial+"▍")
	} else if m.agentBusy && m.agentStatus != "" {
		lines = append(lines, "  ⏳ "+m.agentStatus)
	}

	styled := make([]string, len(lines))
	for i, l := range lines {
		styled[i] = styleChatLine(l)
	}

	m.chatVP.SetContent(strings.Join(styled, "\n"))
	m.chatVP.GotoBottom()
}

func (m *Model) syncLogsViewport() {
	styled := make([]string, len(m.logLines))
	for i, l := range m.logLines {
		styled[i] = styleLogLine(l)
	}
	m.logsVP.SetContent(strings.Join(styled, "\n"))
	m.logsVP.GotoBottom()
}

// ---------------------------------------------------------------------------
// ADK runner
// ---------------------------------------------------------------------------

func (m *Model) runAgent(input string) tea.Cmd {
	// Capture values for the goroutine — no pointer receiver access after this.
	r := m.cfg.Runner
	ctx := m.cfg.Ctx
	userID := m.cfg.UserID
	sid := m.cfg.SessionID
	ref := m.pref

	return func() tea.Msg {
		userMsg := genai.NewContentFromText(input, genai.RoleUser)

		ref.Send(agentStatusMsg{text: "Sending to model…"})

		for event, err := range r.Run(ctx, userID, sid, userMsg, agent.RunConfig{}) {
			if err != nil {
				return agentDoneMsg{err: err}
			}
			if event == nil || event.Content == nil {
				continue
			}

			for _, p := range event.Content.Parts {
				// ── Tool call: the model is asking to run a function ──
				if p.FunctionCall != nil {
					ref.Send(agentToolCallMsg{tool: p.FunctionCall.Name})
					continue
				}

				// ── Tool result: a function has returned ──
				if p.FunctionResponse != nil {
					ref.Send(agentToolResultMsg{tool: p.FunctionResponse.Name})
					continue
				}

				// ── Streaming text ──
				if p.Text != "" {
					if event.Partial {
						// Partial streaming chunk — append to in-progress text.
						ref.Send(agentChunkMsg{text: p.Text})
					} else if event.IsFinalResponse() {
						// Final, complete text event — send as a chunk so it
						// gets rendered, then the agentDoneMsg finalises it.
						ref.Send(agentChunkMsg{text: p.Text})
					} else {
						// Intermediate non-partial text (e.g. agent
						// deliberation). Still show it as streaming.
						ref.Send(agentChunkMsg{text: p.Text})
					}
				}
			}
		}

		return agentDoneMsg{}
	}
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

func (m Model) renderTabBar() string {
	chatLabel := " Chat "
	logsLabel := " Logs "

	if m.activeTab == tabChat {
		chatLabel = activeTabStyle().Render(chatLabel)
		logsLabel = inactiveTabStyle().Render(logsLabel)
	} else {
		chatLabel = inactiveTabStyle().Render(chatLabel)
		logsLabel = activeTabStyle().Render(logsLabel)
	}

	sep := dimStyle().Render("│")
	bar := chatLabel + sep + logsLabel

	if m.agentBusy && m.agentStatus != "" {
		bar += dimStyle().Render("  ⏳ " + m.agentStatus)
	}

	return lipgloss.NewStyle().Width(m.width).Render(bar)
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

func activeTabStyle() lipgloss.Style {
	return lipgloss.NewStyle().
		Bold(true).
		Underline(true).
		Foreground(lipgloss.ANSIColor(6)) // cyan
}

func inactiveTabStyle() lipgloss.Style {
	return lipgloss.NewStyle().
		Faint(true)
}

func dimStyle() lipgloss.Style {
	return lipgloss.NewStyle().Faint(true)
}

func toolCallStyle() lipgloss.Style {
	return lipgloss.NewStyle().Faint(true).Foreground(lipgloss.ANSIColor(5)) // magenta
}

func toolResultStyle() lipgloss.Style {
	return lipgloss.NewStyle().Faint(true).Foreground(lipgloss.ANSIColor(2)) // green
}

func statusStyle() lipgloss.Style {
	return lipgloss.NewStyle().Faint(true).Foreground(lipgloss.ANSIColor(3)) // yellow
}

func styleChatLine(line string) string {
	switch {
	case strings.HasPrefix(line, "You: "):
		prefix := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.ANSIColor(6)).Render("You:")
		return prefix + " " + line[5:]
	case strings.HasPrefix(line, "BiM: "):
		prefix := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.ANSIColor(2)).Render("BiM:")
		return prefix + " " + line[5:]
	case strings.HasPrefix(line, "Error: "):
		return lipgloss.NewStyle().Foreground(lipgloss.ANSIColor(1)).Render(line)
	case strings.HasPrefix(line, "  ⚙ "):
		return toolCallStyle().Render(line)
	case strings.HasPrefix(line, "  ✔ "):
		return toolResultStyle().Render(line)
	case strings.HasPrefix(line, "  ⏳ "):
		return statusStyle().Render(line)
	default:
		return dimStyle().Render(line)
	}
}

func styleLogLine(line string) string {
	s := dimStyle()
	upper := strings.ToUpper(line)
	switch {
	case strings.Contains(upper, "ERROR"):
		s = s.Foreground(lipgloss.ANSIColor(1)) // red
	case strings.Contains(upper, "WARN"):
		s = s.Foreground(lipgloss.ANSIColor(3)) // yellow
	}
	return s.Render(line)
}

// ---------------------------------------------------------------------------
// Session helper
// ---------------------------------------------------------------------------

// EnsureSession creates an in-memory session if one doesn't exist, and returns
// the session ID. This mirrors what the launcher does internally.
func EnsureSession(ctx context.Context, svc session.Service, appName, userID, sessionID string) (string, error) {
	// Try to get existing session first.
	_, err := svc.Get(ctx, &session.GetRequest{
		AppName:   appName,
		UserID:    userID,
		SessionID: sessionID,
	})
	if err == nil {
		return sessionID, nil
	}

	// Create a new session.
	resp, err := svc.Create(ctx, &session.CreateRequest{
		AppName:   appName,
		UserID:    userID,
		SessionID: sessionID,
	})
	if err != nil {
		return "", fmt.Errorf("create session: %w", err)
	}
	return resp.Session.ID(), nil
}
