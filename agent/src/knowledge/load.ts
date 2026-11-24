// Reads the knowledge directory into plain text documents. Only text-like extensions are indexed;
// binary formats (pdf, docx, images) are skipped rather than decoded into garbage.

import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

export interface LoadedDocument {
	/** Path relative to the knowledge directory, always with forward slashes. */
	readonly source: string;
	readonly text: string;
}

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".text", ".html", ".htm", ".csv"]);

/**
 * Directories that hold private corpora. They are skipped by every knowledge index, including a
 * private one rooted at the repository, so a stray exclude list cannot re-enable them.
 */
export const PROTECTED_KNOWLEDGE_PREFIXES = ["public-kb", ".local-import"] as const;

export interface LoadResult {
	readonly documents: LoadedDocument[];
	readonly skipped: string[];
}

export async function loadDocuments(
	directory: string,
	exclude: readonly string[] = [],
	allowedFiles?: ReadonlySet<string>,
): Promise<LoadResult> {
	const documents: LoadedDocument[] = [];
	const skipped: string[] = [];
	const excludePrefixes = [
		...exclude.map(normalizePrefix),
		...PROTECTED_KNOWLEDGE_PREFIXES.map(normalizePrefix),
	];
	await walk(directory, directory, documents, skipped, excludePrefixes, allowedFiles);
	documents.sort((a, b) => a.source.localeCompare(b.source));
	skipped.sort();
	return { documents, skipped };
}

async function walk(
	root: string,
	current: string,
	documents: LoadedDocument[],
	skipped: string[],
	excludePrefixes: readonly string[],
	allowedFiles?: ReadonlySet<string>,
): Promise<void> {
	let entries;
	try {
		entries = await readdir(current, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		const absolute = join(current, entry.name);
		if (entry.isDirectory()) {
			if (allowedFiles || entry.name === "node_modules") continue;
			await walk(root, absolute, documents, skipped, excludePrefixes);
			continue;
		}
		if (!entry.isFile()) continue;
		const source = relative(root, absolute).split(sep).join("/");
		if (allowedFiles && !allowedFiles.has(source)) continue;
		if (excluded(source, excludePrefixes)) {
			skipped.push(source);
			continue;
		}
		const extension = extname(entry.name).toLowerCase();
		if (!TEXT_EXTENSIONS.has(extension)) {
			skipped.push(source);
			continue;
		}
		try {
			const raw = await readFile(absolute, "utf8");
			const text = extension === ".html" || extension === ".htm" ? htmlToText(raw) : raw;
			if (text.trim().length > 0) documents.push({ source, text });
		} catch {
			skipped.push(source);
		}
	}
}

function normalizePrefix(prefix: string): string {
	return prefix.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

/** A source is excluded when it equals a prefix or lives under it. */
function excluded(source: string, prefixes: readonly string[]): boolean {
	return prefixes.some((prefix) => prefix.length > 0 && (source === prefix || source.startsWith(`${prefix}/`)));
}

/** Crude tag stripping: enough for documentation pages, not a full HTML parser. */
function htmlToText(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/g, "'")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
