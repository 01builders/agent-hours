---
theme: default
title: "Building Specialist Agents"
info: |
  A workshop on the thinking process behind designing and building agents
  that are narrowly useful, testable, and worth trusting.
class: text-center
drawings:
  persist: false
transition: slide-left
mdc: true
---

# Building Specialist Agents

The thinking process behind agents that actually work

<div class="abs-br m-6 text-sm opacity-50">
Agent Hours Workshop
</div>

---

# The Wrong Question vs The Right Question

<br>

<div class="text-2xl text-center my-8 text-red-400 font-semibold">
"How do I build an agent that can do everything?"
</div>

This leads to vague scope, endless capability lists, and agents that demo well but break under real use.

<div class="text-2xl text-center my-8 text-green-400 font-semibold">
"What is the smallest specialist I can build that is meaningfully better than a generalist for one important workflow?"
</div>

That is the frame for this entire talk.

---

# Generalists vs Specialists

Tools like Claude Code and Codex are useful because they are **broad generalists**. That breadth is also the limitation.

<div class="grid grid-cols-2 gap-8 mt-6">
<div>

### A generalist typically lacks

- Deep context for your exact domain
- Strong judgment for one repeated workflow
- Tight integration with your systems
- Clear evaluation criteria for one job
- Reliability around narrow operating boundaries

</div>
<div>

### A specialist should be better at

- Domain context
- Workflow judgment
- Integration with tools and systems
- Consistency
- Evaluation and feedback loops

</div>
</div>

<div class="mt-6 p-4 border border-gray-500 rounded-lg text-center">
If your specialist is not <span class="text-yellow-400 font-bold">measurably better</span> at a specific job than a generalist, it is just a narrower demo.
</div>

---

# Thinking About Agents: Scope and Purpose

Two questions to answer before anything else.

<div class="mt-6">

### 1. What exact job does this agent own?

If you cannot describe it in one or two sentences, it is probably too broad.

</div>

<div class="grid grid-cols-2 gap-6 mt-4">
<div class="p-4 bg-green-900/20 rounded">

**Good:** Triage support tickets for one product. Draft research briefs for sales. Review PRs against a fixed checklist.

</div>
<div class="p-4 bg-red-900/20 rounded">

**Too broad:** "Automate engineering." "Help with company operations." "Be our AI employee."

</div>
</div>

<div class="mt-6">

### 2. Why should this be an agent and not a script?

An agent makes sense when the workflow requires **reasoning over messy input**, **tool use**, **multi-step decisions**, or **judgment under ambiguity**.

If the task is deterministic end to end, it does not need an agent.

</div>

---

# Thinking About Agents: Boundaries and Evaluation

<div class="mt-4">

### 3. What should software handle vs the model?

</div>

<div class="grid grid-cols-2 gap-6 mt-2">
<div class="p-4 bg-gray-800 rounded">

**Software owns:** Validation, authorization, data access, state management, business rules, side effects

</div>
<div class="p-4 bg-gray-800 rounded">

**The model owns:** Interpreting ambiguity, classification, summarization, extracting structure, choosing among bounded actions

</div>
</div>

<div class="mt-6">

### 4. What are the boundaries?

</div>

<div class="mt-2 grid grid-cols-5 gap-2 text-center text-sm">
<div class="bg-green-900/30 rounded p-3">What can it do <strong>automatically</strong>?</div>
<div class="bg-yellow-900/30 rounded p-3">What requires <strong>approval</strong>?</div>
<div class="bg-red-900/30 rounded p-3">What makes it <strong>stop</strong>?</div>
<div class="bg-orange-900/30 rounded p-3">What should it <strong>escalate</strong>?</div>
<div class="bg-blue-900/30 rounded p-3">How are errors <strong>detected</strong>?</div>
</div>

<div class="mt-6">

### 5. How will you evaluate it?

Accuracy, completion rate, time saved, failure rate. If you cannot measure it, you cannot improve it.

</div>

---

# What Is Inside an Agent

Every agent follows the same fundamental pattern.

```
              +-----> [ LLM Call ] ------+
              |              |           |
              |              v           |
              |     { Tool Call? } --Yes--> [ Execute Tool ]
              |              |                     |
              |              No                    |
              |              v                     |
              |     [ Final Response ]             |
              |                                    |
              +-------------- Result --------------+
```

<div class="grid grid-cols-3 gap-4 mt-4 text-sm">
<div class="border border-gray-600 rounded p-3">

**System Prompt** -- the agent's instructions, constraints, and behavioral rules

</div>
<div class="border border-gray-600 rounded p-3">

**Context Assembly** -- what gets fed into each call: docs, history, tool results, user input

</div>
<div class="border border-gray-600 rounded p-3">

**Tools** -- structured descriptions of actions the agent can take, executed by your code

</div>
</div>

<div class="mt-4 text-sm opacity-70">
The model reasons. Tools execute. Software controls the loop.
</div>

---

# Context Engineering

The single biggest lever for agent quality is not the model -- it is **what the model sees**.

<div class="mt-8 space-y-4">

**Context engineering** means deliberately designing:

- **What** information goes into each call (and what stays out)
- **When** context is assembled (static vs dynamic)
- **How** it is structured (ordering, formatting, compression)
- **How much** fits (token budgets, summarization, retrieval ranking)

</div>

<div class="mt-8 p-4 bg-blue-900/30 rounded">

A mediocre prompt with excellent context will outperform a brilliant prompt with poor context, every time.

</div>

<div class="mt-4 text-sm opacity-70">

Most quality problems with agents are context problems. The model is usually fine -- it just is not seeing the right information.

</div>

---

# The Five Levels of Agents

A complexity ladder, not a maturity contest.

<div class="mt-4 space-y-3">
<div class="flex gap-4 items-start p-3 bg-blue-900/20 rounded">
<div class="text-xl font-bold text-blue-400 w-6">1</div>
<div><strong>Instructions + Tools.</strong> A single agent with a clear prompt and a few tools. This is enough for more use cases than most teams think.</div>
</div>

<div class="flex gap-4 items-start p-3 bg-blue-900/20 rounded">
<div class="text-xl font-bold text-blue-400 w-6">2</div>
<div><strong>Knowledge + Storage.</strong> Add retrieval or persistent storage when the agent needs stable context outside the prompt window.</div>
</div>

<div class="flex gap-4 items-start p-3 bg-blue-900/20 rounded">
<div class="text-xl font-bold text-blue-400 w-6">3</div>
<div><strong>Memory + Longer-Horizon Reasoning.</strong> Add memory when continuity across interactions genuinely matters.</div>
</div>

<div class="flex gap-4 items-start p-3 bg-yellow-900/20 rounded">
<div class="text-xl font-bold text-yellow-400 w-6">4</div>
<div><strong>Multi-Agent Collaboration.</strong> Only move here when the problem decomposes cleanly into distinct specialties. If one agent is still unclear, more agents add confusion.</div>
</div>

<div class="flex gap-4 items-start p-3 bg-red-900/20 rounded">
<div class="text-xl font-bold text-red-400 w-6">5</div>
<div><strong>Agentic Systems.</strong> Broader workflow automation with monitoring, recovery, and operational controls. Most teams should not start here.</div>
</div>
</div>

<div class="mt-4 text-green-400">
Start at the lowest level that solves the problem. Move up only when the workflow requires it.
</div>

---

# Principles for Production Agents

<div class="text-lg text-center my-4 p-4 border border-gray-500 rounded-lg">
Production agents are mostly <span class="text-green-400 font-bold">deterministic systems</span> with model-driven steps inserted where <span class="text-yellow-400 font-bold">reasoning is actually needed</span>.
</div>

<div class="grid grid-cols-2 gap-4 mt-4 text-sm">

<div class="flex gap-3 items-start p-3 bg-gray-800 rounded">
<div class="font-bold text-blue-400">1</div>
<div><strong>Own your prompts.</strong> Instructions are product, not boilerplate. Make them visible and testable.</div>
</div>

<div class="flex gap-3 items-start p-3 bg-gray-800 rounded">
<div class="font-bold text-blue-400">2</div>
<div><strong>Own your context.</strong> What the model sees has more impact on quality than which model you use.</div>
</div>

<div class="flex gap-3 items-start p-3 bg-gray-800 rounded">
<div class="font-bold text-blue-400">3</div>
<div><strong>Own control flow.</strong> The model should not silently define system behavior.</div>
</div>

<div class="flex gap-3 items-start p-3 bg-gray-800 rounded">
<div class="font-bold text-blue-400">4</div>
<div><strong>Keep state inspectable.</strong> You should be able to replay and reason about every decision.</div>
</div>

<div class="flex gap-3 items-start p-3 bg-gray-800 rounded">
<div class="font-bold text-blue-400">5</div>
<div><strong>Design for humans in the loop.</strong> Approval, escalation, and intervention from the start.</div>
</div>

<div class="flex gap-3 items-start p-3 bg-gray-800 rounded">
<div class="font-bold text-blue-400">6</div>
<div><strong>Keep agents small.</strong> Small agents are easier to understand, evaluate, and improve.</div>
</div>

</div>

<div class="mt-4 text-xs opacity-60">
Inspired by the 12-Factor Agents framework (humanlayer/12-factor-agents)
</div>

---

# The Trust Gradient

Agents earn trust incrementally. Design for this.

<div class="mt-10 flex items-center gap-2">
<div class="bg-red-900/40 rounded p-6 text-center flex-1">

**Read-only**
<div class="text-sm mt-2">Observe and report</div>

</div>
<div class="text-2xl">-></div>
<div class="bg-orange-900/40 rounded p-6 text-center flex-1">

**Suggest**
<div class="text-sm mt-2">Propose actions for human review</div>

</div>
<div class="text-2xl">-></div>
<div class="bg-yellow-900/40 rounded p-6 text-center flex-1">

**Act with approval**
<div class="text-sm mt-2">Execute after human confirms</div>

</div>
<div class="text-2xl">-></div>
<div class="bg-green-900/40 rounded p-6 text-center flex-1">

**Act autonomously**
<div class="text-sm mt-2">Within bounded scope</div>

</div>
</div>

<div class="mt-10 text-lg text-center">

Start on the left. Move right only as the agent proves itself reliable.

This is not a limitation -- it is how you build agents people actually use.

</div>

---

# Common Mistakes

<div class="space-y-4 mt-6">

<div class="p-4 bg-red-900/20 rounded flex gap-4">
<div class="text-red-400 font-bold text-xl">1</div>
<div><strong>Starting too broad.</strong> "It should handle all customer interactions." Start with one workflow. Get that right. Expand later.</div>
</div>

<div class="p-4 bg-red-900/20 rounded flex gap-4">
<div class="text-red-400 font-bold text-xl">2</div>
<div><strong>Jumping to multi-agent.</strong> If you have not made one agent work reliably, adding more agents adds confusion, not capability.</div>
</div>

<div class="p-4 bg-red-900/20 rounded flex gap-4">
<div class="text-red-400 font-bold text-xl">3</div>
<div><strong>Letting the model own control flow.</strong> The model decides what to do. Your software decides what is allowed, when to stop, and how to recover.</div>
</div>

<div class="p-4 bg-red-900/20 rounded flex gap-4">
<div class="text-red-400 font-bold text-xl">4</div>
<div><strong>No evaluation plan.</strong> "It feels smart" is not a metric. Define what success looks like before you build.</div>
</div>

<div class="p-4 bg-red-900/20 rounded flex gap-4">
<div class="text-red-400 font-bold text-xl">5</div>
<div><strong>Ignoring context engineering.</strong> Most quality problems are context problems. The model is fine -- it just is not seeing the right information.</div>
</div>

</div>

---

# Summary

<div class="mt-6 space-y-5">

1. **Start with a narrow specialist**, not a general-purpose agent
2. **Use the five levels** as a complexity ladder -- start low, move up only when needed
3. **Context engineering** is the biggest quality lever, not the model itself
4. **Software owns control**, safety, and state -- the model owns reasoning and judgment
5. **Design for trust incrementally** -- read-only, suggest, approve, autonomous
6. **Evaluate concretely** -- if you cannot measure it, you cannot improve it

</div>

---

# Example: Support Ticket Triage Agent

Applying everything from this talk to one concrete agent.

<div class="grid grid-cols-2 gap-6 mt-4 text-sm">
<div>

### The design answers

| Question | Answer |
|----------|--------|
| **Job** | Classify incoming support tickets by urgency and route to the right team |
| **Why an agent?** | Messy natural-language input, needs judgment, uses tools to look up customer data |
| **Level** | 1 -- instructions + tools |
| **Software owns** | Ticket queue, routing rules, customer DB access, logging |
| **Model owns** | Reading the ticket, classifying urgency, picking the right team |

</div>
<div>

### Boundaries

- **Automatic:** Classify and route low/medium tickets
- **Approval:** High-urgency tickets get flagged for human review before routing
- **Stop:** Unknown customer, ambiguous product, confidence below threshold
- **Evaluate:** Accuracy vs human triage, time saved, escalation quality

### Trust gradient

Start as **suggest** (human confirms routing) then move to **act with approval** for low-urgency tickets after validation.

</div>
</div>

---

# Example: The Code

A Level 1 agent in ~40 lines. Instructions, tools, a loop.

```python {all|1-8|10-17|19-29|31-40}
# 1. System prompt -- the agent's job and constraints
SYSTEM = """You are a support ticket triage agent.
Classify each ticket as low, medium, or high urgency.
Route to: billing, technical, or account team.
If urgency is high, flag for human review instead of routing.
If the customer is unknown, stop and escalate.
Always explain your reasoning in one sentence."""

# 2. Tools -- structured actions the agent can take
tools = [
    {"name": "lookup_customer", ...},   # fetch customer tier and history
    {"name": "route_ticket", ...},       # send to the right team queue
    {"name": "flag_for_review", ...},    # escalate to a human
]

# 3. The agent loop -- software owns control flow
def triage(ticket):
    messages = [{"role": "user", "content": ticket}]
    while True:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            system=SYSTEM, tools=tools, messages=messages,
        )
        if response.stop_reason == "end_turn":
            return response                    # done
        for block in response.content:
            if block.type == "tool_use":
                result = execute(block)         # deterministic execution
                messages.append(tool_result(result))
```

<div class="mt-2 text-sm opacity-70">
Prompt, tools, loop. That is a real agent. Everything else is refinement.
</div>

---
layout: center
class: text-center
---

# Build the most credible specialist

Not the most ambitious system in the room.

Something narrow, useful, testable, and worth trusting for a real task.

<div class="mt-12 text-sm opacity-50">
Agent Hours Workshop
</div>
