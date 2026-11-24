// Okapi BM25 index over chunks. Small enough to keep in memory: the whole knowledge base is
// re-indexed on demand rather than persisted, so the files stay the single source of truth.

import type { Chunk } from "./chunk.ts";
import { tokenize } from "./tokenize.ts";

/** Term-frequency saturation and length-normalisation constants; the usual Okapi defaults. */
const K1 = 1.5;
const B = 0.75;

interface Posting {
	readonly chunkId: number;
	readonly tf: number;
}

export interface SearchHit {
	readonly chunk: Chunk;
	readonly score: number;
}

export class Bm25Index {
	private readonly postings = new Map<string, Posting[]>();
	private readonly chunks: Chunk[] = [];
	private readonly lengths: number[] = [];
	private totalLength = 0;

	get chunkCount(): number {
		return this.chunks.length;
	}

	get termCount(): number {
		return this.postings.size;
	}

	add(chunk: Chunk): void {
		// The heading is indexed with the body so a section title alone can match a query.
		const tokens = tokenize(`${chunk.heading ?? ""}\n${chunk.text}`);
		const chunkId = this.chunks.length;
		this.chunks.push(chunk);
		this.lengths.push(tokens.length);
		this.totalLength += tokens.length;

		const frequencies = new Map<string, number>();
		for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
		for (const [term, tf] of frequencies) {
			const existing = this.postings.get(term);
			if (existing) {
				existing.push({ chunkId, tf });
			} else {
				this.postings.set(term, [{ chunkId, tf }]);
			}
		}
	}

	search(query: string, limit: number): SearchHit[] {
		if (this.chunks.length === 0 || this.totalLength === 0) return [];
		const terms = [...new Set(tokenize(query))];
		if (terms.length === 0) return [];

		const averageLength = this.totalLength / this.chunks.length;
		const scores = new Map<number, number>();

		// Every query term contributes its idf-weighted score; a rare filler bigram adds little, while a
		// meaningful term that is merely common (mysql, 索引) still counts.
		const weighted = terms
			.map((term) => ({ term, postings: this.postings.get(term) }))
			.filter((entry): entry is { term: string; postings: Posting[] } => entry.postings !== undefined && entry.postings.length > 0)
			.map((entry) => ({
				term: entry.term,
				postings: entry.postings,
				idf: Math.log(1 + (this.chunks.length - entry.postings.length + 0.5) / (entry.postings.length + 0.5))
			}))
			.sort((a, b) => b.idf - a.idf);

		const matchedTerms = new Map<number, number>();

		for (const { postings, idf } of weighted) {
			for (const posting of postings) {
				matchedTerms.set(posting.chunkId, (matchedTerms.get(posting.chunkId) ?? 0) + 1);
				const length = this.lengths[posting.chunkId] ?? 0;
				const denominator = posting.tf + K1 * (1 - B + (B * length) / averageLength);
				const contribution = (idf * (posting.tf * (K1 + 1))) / denominator;
				scores.set(posting.chunkId, (scores.get(posting.chunkId) ?? 0) + contribution);
			}
		}

		// Long queries carry filler bigrams that match unrelated chunks; requiring several matching
		// terms keeps the result about the question instead of about one shared character pair.
		const minMatches = weighted.length >= 4 ? 2 : 1;

		const hits: SearchHit[] = [];
		for (const [chunkId, score] of scores) {
			if ((matchedTerms.get(chunkId) ?? 0) < minMatches) continue;
			const chunk = this.chunks[chunkId];
			if (chunk) hits.push({ chunk, score });
		}
		hits.sort(
			(a, b) =>
				b.score - a.score ||
				a.chunk.source.localeCompare(b.chunk.source) ||
				a.chunk.ordinal - b.chunk.ordinal,
		);
		return hits.slice(0, Math.max(1, limit));
	}
}
