# 12-Factor Agents

## Core Idea

The useful takeaway from 12-factor agents is that production agents are mostly deterministic systems with model-driven steps inserted where reasoning is actually needed.

That is a better way to think about agent design than treating the entire system as one large autonomous black box.

## The Mindset

### 1. Turn natural language into structured actions

The model can interpret intent. The system should execute actions in a controlled way.

### 2. Own your prompts

Your instructions are part of the product. They should be visible, inspectable, and testable.

### 3. Own your context

Context engineering matters. What the model sees, how it is structured, and when it is included has a major effect on quality.

### 4. Treat tools as structured outputs

Tool use is not magic. It is a structured prediction followed by deterministic execution.

### 5. Keep state inspectable

You should be able to inspect, replay, and reason about the agent's state and decisions.

### 6. Support pause and resume

Real workflows involve waiting for approvals, human input, and external events. Agents should be built for that.

### 7. Make human contact a first-class part of the system

Approval, escalation, and intervention should be designed in from the beginning.

### 8. Own control flow

Do not give away the control loop if reliability matters. The model should not silently define the whole system behavior.

### 9. Feed useful errors back into the loop

Errors should be compact, legible, and actionable so the agent can recover or escalate.

### 10. Keep agents small

Small agents are easier to understand, evaluate, and improve.

### 11. Trigger agents from real workflows

Useful agents sit inside the places where work already happens: tickets, chat, code review, dashboards, scheduled jobs, and operational systems.

### 12. Think in state transitions

It helps to think of the agent as a system that consumes events and produces the next state in a controlled way.

## Why This Matters In The Workshop

These ideas are useful because they push people away from vague agent demos and toward systems that can survive contact with real work.

For this workshop, the 12-factor framing should help participants:

- Build around workflows instead of abstractions
- Keep state and control explicit
- Add human approvals where risk is real
- Avoid over-relying on the model for deterministic behavior
- Design agents that are easier to debug and improve

## Practical Filter

When reviewing an agent design, ask:

- Is the prompt owned and intentional?
- Is the context deliberate?
- Are tools bounded and structured?
- Is the control flow explicit?
- Can state be inspected?
- Can the agent pause, resume, and escalate safely?

If those answers are weak, the design is probably still too hand-wavy.

## References

- 12-Factor Agents: <https://github.com/humanlayer/12-factor-agents>
- Summary source used for this page: <https://github.com/tac0turtle/ai-learning/blob/main/knowledge/12-factor-agents.md>
- Related source for the workshop's "Five Levels of Agents" framing: <https://github.com/tac0turtle/ai-learning/blob/main/knowledge/5-levels-of-agents.md>
