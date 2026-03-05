# Agent Frameworks

This page is a short map of agent frameworks and toolkits that are useful to know about. They are not interchangeable. Each one reflects a different opinion about how agents should be built, operated, and integrated into real workflows.

## Google ADK

Google's Agent Development Kit is a modular framework for building and deploying AI agents. It is optimized for Gemini and the Google ecosystem, but the docs describe it as model-agnostic and deployment-agnostic.

Short explainer:

- Good fit if you want a framework that feels closer to software engineering than prompt orchestration
- Strong on workflow agents, multi-agent composition, tools, runtime, deployment, evaluation, and safety
- Especially relevant if you expect to use Gemini, Vertex AI, Cloud Run, or broader Google infrastructure

Official docs: <https://google.github.io/adk-docs/>

## Pi Mono

Pi Mono is an open-source toolkit centered around building AI agents and managing LLM deployments. The repository includes a unified multi-provider LLM API, an agent runtime with tool calling and state management, an interactive coding agent CLI, UI libraries, and a Slack bot.

Short explainer:

- Good fit if you want a more builder-oriented toolkit rather than a polished enterprise platform
- Useful when you want modular pieces for agents, coding workflows, and custom interfaces
- Stronger as an engineer's toolkit than as a single opinionated end-to-end framework

Repository: <https://github.com/badlogic/pi-mono>

## Claude Agent SDK

Anthropic's Claude Agent SDK exposes the same core agent loop, context management, and built-in tools that power Claude Code, but as a programmable SDK for Python and TypeScript.

Short explainer:

- Good fit if you want to build agents that can read files, run commands, edit code, and search with a familiar coding-agent model
- Especially useful for code, research, and operator-style agents where tool use is central
- Best understood as "Claude Code as a library," not as a general workflow orchestration system

Official docs: <https://platform.claude.com/docs/en/agent-sdk/overview>

## Goose

Goose is Block's local, open-source AI agent for engineering tasks. Its positioning is practical: it runs locally, is extensible, and can connect to external MCP servers or APIs.

Short explainer:

- Good fit if you want a local-first engineering agent with an open-source posture
- Useful when developer control, local execution, and extensibility matter more than managed-platform features
- More opinionated as a working agent product than as a low-level orchestration framework

Official docs: <https://block.github.io/goose/>

## LangGraph

LangGraph is LangChain's low-level orchestration framework for building stateful agents and multi-actor systems. Its emphasis is on control over workflow, state transitions, and reliability for more complex agent behavior.

Short explainer:

- Good fit if you need explicit control over agent workflow and state
- Useful for long-running, stateful, multi-step, or multi-agent systems
- Better for orchestration-heavy systems than for simple "single prompt plus tools" agents

Official site: <https://www.langchain.com/langgraph>

## How To Think About These

A useful way to compare frameworks is to ask:

- Is this primarily a runtime, an orchestration layer, or a full agent product?
- Does it help with state, tools, memory, and human approvals?
- Is it optimized for coding agents, workflow agents, or general agent systems?
- Does it give you control, or does it hide too much behind abstraction?
- Is it a good fit for your stack, or are you forcing the wrong framework into the wrong environment?

The mistake is to choose a framework because it sounds the most agentic.

The better approach is to choose the framework whose assumptions match the kind of specialist you are trying to build.

## Sources

- Google ADK docs: <https://google.github.io/adk-docs/>
- Pi Mono repository: <https://github.com/badlogic/pi-mono>
- Claude Agent SDK docs: <https://platform.claude.com/docs/en/agent-sdk/overview>
- Goose docs: <https://block.github.io/goose/>
- LangGraph: <https://www.langchain.com/langgraph>
