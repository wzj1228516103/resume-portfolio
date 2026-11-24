// Tokenizer for BM25 retrieval.
// Latin words are lowercased; CJK text is indexed as both single characters and character bigrams,
// so multi-character terms rank precisely while one-character queries still match.

const TOKEN_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+|[a-z0-9_]+/g;

export function tokenize(text: string): string[] {
	const tokens: string[] = [];
	for (const match of text.toLowerCase().matchAll(TOKEN_RUN)) {
		const piece = match[0];
		if (/^[a-z0-9_]+$/.test(piece)) {
			tokens.push(piece);
			continue;
		}
		for (const character of piece) tokens.push(character);
		for (let index = 0; index + 1 < piece.length; index += 1) tokens.push(piece.slice(index, index + 2));
	}
	return tokens;
}

/** True when the token is a CJK character or bigram, used when locating snippets in raw text. */
export function isCjkToken(token: string): boolean {
	return /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+$/.test(token);
}
