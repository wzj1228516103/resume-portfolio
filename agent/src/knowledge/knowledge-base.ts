// The knowledge base: loads the directory, chunks every document, and answers BM25 queries with snippets.
// Files are the source of truth; the index is rebuilt in memory by `rebuild()`.

import { Bm25Index } from "./bm25.ts";
import { chunkDocument } from "./chunk.ts";
import { loadDocuments } from "./load.ts";
import { tokenize } from "./tokenize.ts";

export interface KnowledgeStats {
	readonly directory: string;
	readonly documents: number;
	readonly chunks: number;
	readonly terms: number;
	/** Epoch milliseconds of the last rebuild; 0 before the first one. */
	readonly updatedAt: number;
}

export interface KnowledgeMatch {
	readonly source: string;
	readonly citation?: string;
	readonly heading: string | undefined;
	readonly ordinal: number;
	readonly score: number;
	readonly snippet: string;
}

export interface KnowledgeBaseOptions {
	/** Prepended to every reported path so callers can hand it straight to the file tools. */
	readonly sourcePrefix?: string;
	/** Path prefixes (relative to the knowledge directory) that are never indexed. */
	readonly exclude?: readonly string[];
	/** When supplied, index only these reviewed filenames and cite their associated public pages. */
	readonly approvedSources?: ReadonlyMap<string, string>;
}

export class KnowledgeBase {
	private readonly directory: string;
	private readonly sourcePrefix: string;
	private readonly exclude: readonly string[];
	private readonly approvedSources: ReadonlyMap<string, string> | undefined;
	private index = new Bm25Index();
	private documentSources: readonly string[] = [];
	private stats: KnowledgeStats;

	constructor(directory: string, options: KnowledgeBaseOptions = {}) {
		this.directory = directory;
		this.sourcePrefix = options.sourcePrefix ?? "";
		this.exclude = options.exclude ?? [];
		this.approvedSources = options.approvedSources;
		this.stats = { directory, documents: 0, chunks: 0, terms: 0, updatedAt: 0 };
	}

	/** Rescans the directory and replaces the in-memory index. */
	async rebuild(): Promise<KnowledgeStats> {
		const allowedFiles = this.approvedSources && new Set(this.approvedSources.keys());
		const { documents } = await loadDocuments(this.directory, this.exclude, allowedFiles);
		const index = new Bm25Index();
		for (const document of documents) {
			for (const chunk of chunkDocument(document.source, document.text)) index.add(chunk);
		}
		this.index = index;
		this.documentSources = documents.map((document) => `${this.sourcePrefix}${document.source}`);
		this.stats = {
			directory: this.directory,
			documents: documents.length,
			chunks: index.chunkCount,
			terms: index.termCount,
			updatedAt: Date.now(),
		};
		return this.stats;
	}

	search(query: string, limit: number, snippetFocus?: string): KnowledgeMatch[] {
		const trimmed = query.trim();
		if (trimmed.length === 0) return [];
		const queryTokens = tokenize(trimmed);
		return this.index.search(trimmed, limit).map((hit) => ({
			source: `${this.sourcePrefix}${hit.chunk.source}`,
			citation: this.approvedSources?.get(hit.chunk.source),
			heading: hit.chunk.heading,
			ordinal: hit.chunk.ordinal,
			score: Number(hit.score.toFixed(4)),
			snippet: buildSnippet(hit.chunk.text, queryTokens, snippetFocus),
		}));
	}

	statsSnapshot(): KnowledgeStats {
		return this.stats;
	}

	documents(): readonly string[] {
		return this.documentSources;
	}
}

/** Centres a short excerpt on an explicit identifier, or on the first query term. */
function buildSnippet(text: string, queryTokens: readonly string[], focus?: string): string {
	const length = 260;
	const lower = text.toLowerCase();
	const identifier = focus?.toLowerCase();
	const focusPosition = identifier === undefined ? undefined :
		Array.from(lower.matchAll(/[a-z0-9_-]+/g)).find((match) => match[0] === identifier)?.index;

	let position = focusPosition ?? -1;
	if (focusPosition === undefined) {
		const specific = queryTokens.filter((token) => token.length >= 2);
		const candidates = specific.length > 0 ? specific : queryTokens;
		for (const token of candidates) {
			if (token.length === 0) continue;
			const found = lower.indexOf(token);
			if (found >= 0 && (position < 0 || found < position)) position = found;
		}
	}

	if (position < 0) {
		const head = text.slice(0, length).replace(/\s+/g, " ").trim();
		return text.length > length ? `${head}…` : head;
	}

	const start = Math.max(0, position - (focusPosition === undefined ? 90 : 45));
	const end = Math.min(text.length, start + length);
	const excerpt = text.slice(start, end).replace(/\s+/g, " ").trim();
	return `${start > 0 ? "…" : ""}${excerpt}${end < text.length ? "…" : ""}`;
}
