# Agent Thinking

## Start With The Right Question

The wrong question is:

"How do I build an agent that can do everything?"

The better question is:

"What is the smallest specialist I can build that is meaningfully better than a generalist for one important workflow?"

That is the frame for this workshop.

## Generalists Versus Specialists

Tools like Claude Code and Codex are useful because they are broad generalists. They can do many things reasonably well.

That breadth is also the limitation.

A generalist usually lacks:

- Deep context for your exact domain
- Strong judgment for one repeated workflow
- Tight integration with your systems
- Clear evaluation criteria for one job
- Reliability around a narrow operating boundary

That is why we are building specialists.

A specialist agent should be better than a generalist in at least one important way:

- Better domain context
- Better workflow judgment
- Better integration with tools and systems
- Better consistency
- Better evaluation and feedback loops

If your specialist is not better at a specific job, it is not really a specialist. It is just a narrower demo.

## How To Think About An Agent

When designing an agent, work through these questions:

### 1. What exact job does this agent own?

If you cannot describe the job in one or two sentences, it is probably too broad.

Good examples:

- Triage inbound support tickets for a single product
- Draft research briefs for account executives
- Review pull requests in one repository against a fixed checklist
- Watch a workflow, detect failures, and escalate with context

Bad examples:

- Automate engineering
- Help with company operations
- Be our AI employee

### 2. Why should this be an agent at all?

Some problems need automation. Some just need a better UI, a script, or a search tool.

An agent makes sense when the workflow requires some combination of:

- Reasoning over messy input
- Tool use
- Multi-step decisions
- Interaction with humans
- Ongoing execution across a workflow

If the task is deterministic end to end, do not pretend it needs an agent.

### 3. What should be handled by software, and what should be handled by the model?

This is one of the most important design decisions.

Use software for:

- Validation
- Authorization
- Data access
- State management
- Business rules
- Side effects
- Logging and auditing

Use the model for:

- Interpreting ambiguity
- Classification
- Summarization
- Extracting structure from messy inputs
- Generating drafts
- Choosing among bounded actions

If the model is controlling basic system behavior, the design is usually weak.

### 4. What are the boundaries?

Every agent should have explicit answers to these questions:

- What can it do automatically?
- What requires approval?
- What should make it stop?
- What should it escalate?
- How will errors be detected?

Agents become useful when autonomy is bounded.

### 5. How will you evaluate it?

You need something more concrete than "it feels smart."

Use measures such as:

- Accuracy
- Completion rate
- Time saved
- Reduction in manual effort
- Escalation quality
- Failure rate on risky actions

If you cannot evaluate it, you cannot improve it.

## The Five Levels Of Agents

One useful way to think about agents is through the five levels of agents: a progression from simple tool-using systems to broader agentic systems.

The practical lesson is not that higher levels are always better. It is that you should start at the lowest level that solves the problem and move up only when the workflow genuinely requires it.

### Level 1: Agent With Instructions and Tools

A single agent with a clear prompt and access to a small set of tools.

This is enough for more use cases than most teams think.

### Level 2: Agent With Knowledge and Storage

Add retrieval or persistent storage when the agent needs stable context outside the prompt window.

### Level 3: Agent With Memory and Longer-Horizon Reasoning

Add memory when continuity across interactions genuinely matters.

### Level 4: Multi-Agent Collaboration

Only move here when the problem decomposes cleanly into distinct specialties and handoffs.

If one agent is still unclear, multiple agents usually make the system harder to reason about.

### Level 5: Agentic Systems

This is broader workflow automation with monitoring, recovery, escalation, and operational controls around it.

Most teams should not start here.

Taken together, the five levels are useful because they give people a way to reason about complexity without jumping straight to the most elaborate architecture in the room.

## Talking Points For The Workshop

- Start narrower than you want to
- Build a specialist, not a personality
- Use the five levels of agents as a complexity ladder, not as a maturity contest
- Keep the model inside clear operational boundaries
- Let software own control, safety, and state
- Make human approval part of the system where risk is real
- Do not jump to multi-agent designs too early
- Evaluate the agent on usefulness, not novelty

## Closing Position

The point is not to build the most ambitious system in the room.

The point is to build the most credible specialist: something narrow, useful, testable, and worth trusting for a real task.
