import { readFile } from "node:fs/promises";

const exampleSources: ReadonlyMap<string, string> = new Map([
	["example-profile.md", "https://github.com/wzj1228516103/resume-portfolio/blob/v0.3.0/agent/public-rag/example-profile.md"],
]);

/** Load only reviewed filenames, with an HTTPS citation or a plain filename for each one. */
export async function loadPublicSources(file?: string): Promise<ReadonlyMap<string, string>> {
	if (!file) return exampleSources;
	const contents = await readFile(file, "utf8");
	let manifest: unknown;
	try {
		manifest = JSON.parse(contents.replace(/^\uFEFF/u, ""));
	} catch {
		throw new Error("PUBLIC_SOURCES_FILE contains invalid JSON.");
	}
	if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
		throw new Error("PUBLIC_SOURCES_FILE must contain a JSON object of filenames and citation URLs.");
	}
	const sources = new Map<string, string>();
	for (const [filename, citation] of Object.entries(manifest)) {
		if (!/^[^./\\:\s][^/\\:\u0000-\u001f\u007f]*\.(?:md|markdown|txt|text|html?|csv)$/iu.test(filename)) {
			throw new Error("PUBLIC_SOURCES_FILE entries must be text filenames in the top level of the public knowledge directory.");
		}
		sources.set(filename, citation === null ? filename : citationUrl(citation));
	}
	if (sources.size === 0) throw new Error("PUBLIC_SOURCES_FILE must list at least one approved file.");
	return sources;
}

function citationUrl(value: unknown): string {
	const url = typeof value === "string" && /^https:\/\//iu.test(value) && !/[\s\\]/u.test(value)
		? URL.parse(value)
		: null;
	if (!url || url.protocol !== "https:" || url.username || url.password) {
		throw new Error("PUBLIC_SOURCES_FILE citations must be HTTPS URLs without credentials or null.");
	}
	return url.href;
}
