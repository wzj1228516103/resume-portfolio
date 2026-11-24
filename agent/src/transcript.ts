// Flattens an agent transcript into a JSON-safe shape for the read-only session endpoint.

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { contentText } from "@earendil-works/pi-ai";

export interface ToolCallSummary {
	readonly name: string;
	readonly arguments: unknown;
}

export interface MessageSummary {
	readonly role: string;
	readonly text: string;
	readonly toolCalls?: readonly ToolCallSummary[];
	readonly timestamp: number;
}

/** Drops system messages: they are the prompt, not conversation, and would dominate the payload. */
export function summarizeMessages(messages: readonly AgentMessage[]): MessageSummary[] {
	const summaries: MessageSummary[] = [];
	for (const message of messages) {
		if (message.role === "system") continue;
		if (message.role === "assistant") {
			const toolCalls = message.content.flatMap((part) =>
				part.type === "toolCall" ? [{ name: part.name, arguments: part.arguments }] : [],
			);
			summaries.push({
				role: message.role,
				text: contentText(message.content),
				toolCalls,
				timestamp: message.timestamp,
			});
			continue;
		}
		summaries.push({ role: message.role, text: contentText(message.content), timestamp: message.timestamp });
	}
	return summaries;
}
