// Splits a document into retrieval chunks. Markdown headings start new sections, and long sections
// are cut at paragraph boundaries with a character overlap so a sentence is not lost between chunks.

export interface Chunk {
	/** Path of the source document, relative to the knowledge directory. */
	readonly source: string;
	/** Nearest preceding markdown heading, when the document has one. */
	readonly heading: string | undefined;
	/** Position of this chunk within the document, starting at 0. */
	readonly ordinal: number;
	readonly text: string;
}

export interface ChunkOptions {
	readonly maxCharacters: number;
	readonly overlapCharacters: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxCharacters: 800, overlapCharacters: 120 };

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/;

export function chunkDocument(source: string, text: string, options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): Chunk[] {
	const chunks: Chunk[] = [];
	for (const section of splitSections(text)) {
		for (const piece of splitText(section.body, options)) {
			chunks.push({ source, heading: section.heading, ordinal: chunks.length, text: piece });
		}
	}
	return chunks;
}

interface Section {
	readonly heading: string | undefined;
	readonly body: string;
}

function splitSections(text: string): Section[] {
	const sections: Section[] = [];
	let heading: string | undefined;
	let lines: string[] = [];
	const flush = (): void => {
		const body = lines.join("\n").trim();
		if (body.length > 0) sections.push({ heading, body });
		lines = [];
	};
	for (const line of text.split(/\r?\n/)) {
		const match = HEADING.exec(line);
		if (match) {
			flush();
			heading = match[2] ?? match[1] ?? undefined;
			continue;
		}
		lines.push(line);
	}
	flush();
	return sections;
}

function splitText(body: string, options: ChunkOptions): string[] {
	const pieces: string[] = [];
	let current = "";
	const flush = (): void => {
		const trimmed = current.trim();
		if (trimmed.length > 0) pieces.push(trimmed);
	};
	for (const paragraph of body.split(/\n{2,}/)) {
		for (const block of hardSplit(paragraph.trim(), options.maxCharacters)) {
			if (block.length === 0) continue;
			if (current.length > 0 && current.length + block.length + 2 > options.maxCharacters) {
				flush();
				const carried = tail(current, options.overlapCharacters);
				current = carried.length > 0 ? `${carried}\n\n${block}` : block;
			} else {
				current = current.length > 0 ? `${current}\n\n${block}` : block;
			}
		}
	}
	flush();
	return pieces;
}

/** Cuts a single paragraph that is longer than one chunk. */
function hardSplit(text: string, maxCharacters: number): string[] {
	if (text.length <= maxCharacters) return [text];
	const blocks: string[] = [];
	for (let index = 0; index < text.length; index += maxCharacters) {
		blocks.push(text.slice(index, index + maxCharacters));
	}
	return blocks;
}

function tail(text: string, size: number): string {
	if (size <= 0 || text.length === 0) return "";
	return text.slice(Math.max(0, text.length - size));
}
