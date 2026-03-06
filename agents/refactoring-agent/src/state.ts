import fs from "fs";
import path from "path";

export interface AgentState {
    lastRunAt: string | null;
}

const DEFAULT_STATE: AgentState = { lastRunAt: null };

export function loadState(statePath: string): AgentState {
    if (!fs.existsSync(statePath)) return DEFAULT_STATE;
    try {
        return JSON.parse(fs.readFileSync(statePath, "utf-8")) as AgentState;
    } catch {
        return DEFAULT_STATE;
    }
}

export function saveState(statePath: string, state: AgentState): void {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

/** Return the effective "since" timestamp — defaults to 7 days ago on first run. */
export function getEffectiveSince(state: AgentState): string {
    if (state.lastRunAt) return state.lastRunAt;
    return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}
