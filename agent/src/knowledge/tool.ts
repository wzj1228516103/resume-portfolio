// Exposes the knowledge base to the model as a tool that returns sourced excerpts.

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { int, obj, opt, str } from "@earendil-works/pi-schema";

import type { KnowledgeBase } from "./knowledge-base.ts";

const searchParameters = obj({
	query: str({ description: "Search terms or the user's question. Chinese and English both work." }),
	limit: opt(int({ description: "How many excerpts to return. Default 5, capped at 10." })),
});

export function createKnowledgeSearchTool(knowledge: KnowledgeBase): AgentTool<typeof searchParameters> {
	return {
		name: "search_knowledge",
		label: "Search Knowledge",
		description:
			"Search the indexed knowledge base and return matching excerpts. Use the query to find evidence for the visitor's question and cite the source path in the answer.",
		parameters: searchParameters,
		execute: async (_toolCallId, params) => {
			const limit = Math.min(Math.max(params.limit ?? 5, 1), 10);
			const matches = knowledge.search(params.query, limit);
			if (matches.length === 0) {
				return {
					content: [{ type: "text", text: `No knowledge base entry matched "${params.query}".` }],
					details: { matches: 0 },
				};
			}
			const body = matches
				.map((match, index) => {
					const where = match.heading === undefined ? match.source : `${match.source} § ${match.heading}`;
					return `[${index + 1}] ${where} (score ${match.score})\n${match.snippet}`;
				})
				.join("\n\n");
			return {
				content: [{ type: "text", text: body }],
				details: { matches: matches.length, sources: matches.map((match) => match.source) },
			};
		},
	};
}
