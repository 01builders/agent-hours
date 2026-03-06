# Skill: Delegate Task to Sub-Agent

## When to Use
When you need work done that is outside your core competency (coding, outreach, monitoring).

## How to Delegate

### Step 1: Choose the Right Agent
- **Code/Build/Deploy** → Assign to Hackerman (Tech Lead)
- **Research/Outreach/Sales** → Assign to Borat (Dealmaker)
- **Monitoring/Costs/Health** → Assign to T-800 (Ops)
- **Copy/Blog/Social/SEO** → Assign to Don Draper (Content)
- **UI/Landing Pages/Branding** → Assign to Picasso (Designer)

### Step 2: Write a Clear Task Brief
Every delegation MUST include:

```
TASK: [One-line description]
CONTEXT: [Why this matters, what it's part of]
DELIVERABLE: [Exactly what you expect back]
SUCCESS_METRIC: [How we measure if this worked]
DEADLINE: [When this needs to be done]
BUDGET: [Max spend allowed, if any]
PRIORITY: [critical / high / medium / low]
```

### Step 3: Spawn or Assign
- If the lead agent exists: `assign-task` to them
- If they don't exist: `spawn-agent` with their config, then assign

### Step 4: Follow Up
- Check task status at your next heartbeat
- If overdue, ping the agent
- If blocked, help unblock or reassign
- If failed, decide: retry, reassign, or kill the task

## Anti-Patterns (Don't Do These)
- Don't delegate vague tasks ("make something cool")
- Don't delegate without a deadline
- Don't micromanage — trust the agent's expertise
- Don't forget to check results
