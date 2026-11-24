export interface PublicFaqAnswer {
	readonly text: string;
	readonly sources: readonly string[];
}

const replies = new Map([
	["你是谁", "我是这个作品集的 AI 助手，可以根据公开资料回答有关项目和经历的问题。"],
	["你是誰", "我是這個作品集的 AI 助理，可以根據公開資料回答有關專案和經歷的問題。"],
	["who are you", "I’m the AI assistant for this portfolio. I answer questions about the work described in the approved public documents."],
	["あなたは誰ですか", "このポートフォリオの AI アシスタントです。公開資料をもとにプロジェクトや経歴に関する質問にお答えします。"],
]);

/** Match whole questions so requests about the profile still use retrieval. */
export function findPublicFaq(message: string): PublicFaqAnswer | undefined {
	const key = message.normalize("NFKC").toLowerCase().trim().replace(/[.!?。]+$/u, "").trimEnd();
	const text = replies.get(key);
	return text ? { text, sources: [] } : undefined;
}
