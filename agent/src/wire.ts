// Events pushed to HTTP clients, and the mapping from the agent's event stream onto them.
// The wire shape is deliberately smaller than AgentEvent: clients get text, tool lifecycle, and a terminal result.

import type { AgentEvent } from "@earendil-works/pi-agent-core";

export type WireEvent =
	| { type: "turn_start" }
	| { type: "delta"; text: string }
	| { type: "thinking"; text: string }
	| { type: "tool_start"; name: string; args: unknown }
	| { type: "tool_end"; name: string; isError: boolean; durationMs: number | undefined }
	| { type: "turn_end" }
	/** Emitted by the service, not the agent, when a transient provider failure is being retried. */
	| { type: "retry"; attempt: number; delayMs: number; reason: string };

/** Returns undefined for agent events that carry nothing a client can act on. */
export function toWireEvent(event: AgentEvent): WireEvent | undefined {
	switch (event.type) {
		case "turn_start":
			return { type: "turn_start" };
		case "turn_end":
			return { type: "turn_end" };
		case "message_update": {
			const update = event.assistantMessageEvent;
			if (update.type === "text_delta") return { type: "delta", text: update.delta };
			if (update.type === "thinking_delta") return { type: "thinking", text: update.delta };
			return undefined;
		}
		case "tool_execution_start":
			return { type: "tool_start", name: event.toolName, args: event.args };
		case "tool_execution_end":
			return { type: "tool_end", name: event.toolName, isError: event.isError, durationMs: event.durationMs };
		default:
			return undefined;
	}
}
