package tui

import (
	"bytes"
	"sync"

	tea "charm.land/bubbletea/v2"
)

// logLineMsg is sent to the Bubbletea program for each complete log line.
type logLineMsg struct{ line string }

// LogSink is an io.Writer that splits input on newlines and sends each
// complete line to a Bubbletea program via the shared progRef.
//
// Lines written before the program is wired up are buffered internally.
// Call FlushQueued from within a tea.Cmd (e.g. in Init) to drain them
// into the running program.
//
// It is safe for concurrent use. Partial lines (no trailing newline) are
// buffered until the next Write completes them.
type LogSink struct {
	mu      sync.Mutex
	ref     *progRef
	pending bytes.Buffer // incomplete line accumulator (no trailing \n yet)
	queued  []string     // complete lines waiting for the program to be ready
}

// NewLogSink returns a LogSink wired to the given shared program reference.
func NewLogSink(ref *progRef) *LogSink {
	return &LogSink{ref: ref}
}

// FlushQueued returns a tea.Cmd that drains all lines that were buffered
// before the program was running. Call this from Model.Init() so the flush
// happens inside the event loop where p.Send() is safe.
func (s *LogSink) FlushQueued() tea.Cmd {
	s.mu.Lock()
	lines := s.queued
	s.queued = nil
	s.mu.Unlock()

	if len(lines) == 0 {
		return nil
	}

	return func() tea.Msg {
		// Send all but the last via p.Send; return the last as the Msg.
		for _, line := range lines[:len(lines)-1] {
			s.ref.Send(logLineMsg{line: line})
		}
		return logLineMsg{line: lines[len(lines)-1]}
	}
}

// Write implements io.Writer. It splits the incoming bytes on '\n' and either
// sends each complete line to the Bubbletea update loop immediately (if the
// program is available) or queues it for later flushing.
//
// The mutex is NOT held while calling ref.Send to avoid potential deadlocks
// when the bubbletea event loop is blocked.
func (s *LogSink) Write(p []byte) (int, error) {
	s.mu.Lock()

	n := len(p)
	s.pending.Write(p)

	ready := s.ref.Ready()
	var toSend []string

	for {
		line, err := s.pending.ReadBytes('\n')
		if err != nil {
			// No newline found — put the partial data back.
			s.pending.Write(line)
			break
		}
		// Trim the trailing newline (and possible \r) before sending.
		text := string(bytes.TrimRight(line, "\r\n"))

		if ready {
			toSend = append(toSend, text)
		} else {
			s.queued = append(s.queued, text)
		}
	}

	s.mu.Unlock()

	// Send outside the lock so we never block while holding mu.
	for _, text := range toSend {
		s.ref.Send(logLineMsg{line: text})
	}

	return n, nil
}
