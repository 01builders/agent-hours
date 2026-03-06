# Agent Submission

## Author

Marko Baricevic

## Agent Name

BrandForge

## One-Line Description

A conversational branding agent that generates color palettes, brand guidelines, and logos from a text prompt and inspiration images.

## What job does this agent own?

Takes a brand concept (described via text prompt and optional mood/inspiration images) and produces a cohesive brand kit: color palette with rationale, brand guidelines document (tone, do's/don'ts), and logo options via Flux image generation.

## Why should this be an agent?

Branding requires subjective reasoning about aesthetics, iterative refinement based on human feedback, multi-step orchestration (analyze input -> propose palette -> refine -> generate logos), and tool use (LLM for strategy + image model for logos). A deterministic pipeline cannot handle the conversational feedback loop.

## What tools does the agent use?

- Claude (via OpenRouter) for color strategy, brand guidelines, and conversational reasoning
- Flux (via Replicate) for logo generation
- File system for saving output artifacts (markdown, images)

## What framework or stack did you use?

pi-mono (`@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`)

## What are the boundaries?

- **What can it do automatically?** Propose color palettes, write brand guidelines, generate logo variations
- **What requires human approval?** Color palette approval before generating logos, final logo selection
- **What should make it stop or escalate?** User rejecting the overall direction after 2 rounds of refinement

## How do you evaluate it?

- Color palette coherence (contrast ratios, accessibility)
- Brand guidelines completeness (covers tone, usage rules, do's/don'ts)
- Logo relevance to the provided prompt and mood
- User satisfaction after the iterative loop

## What level is this agent?

Level 1: Agent with instructions and tools

## Demo / How to Run

```bash
cd agents/marko
npm install
# Set environment variables
export OPENROUTER_API_KEY=your_key
export REPLICATE_API_TOKEN=your_key
npx tsx src/main.ts
```

## Lessons Learned

<!-- To be filled after building -->
