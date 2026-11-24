type ReplyKind = "greeting" | "thanks" | "ai_identity" | "private_info" | "out_of_scope" | "history_only" | "history_recall";

export type PublicIntent = { readonly kind: "rag" } | { readonly kind: ReplyKind; readonly text: string };

interface IntentRule {
	readonly kind: ReplyKind;
	readonly questions: readonly string[];
	readonly text: string;
}

const rules: readonly IntentRule[] = [
	{
		kind: "greeting",
		questions: ["你好", "你好呀", "你好啊", "您好", "嗨", "哈喽", "早上好", "晚上好", "在吗", "你在吗", "你好吗"],
		text: "你好！可以问我这个作品集里的项目、工作经历和技术。",
	},
	{
		kind: "thanks",
		questions: ["谢谢", "谢谢你", "谢谢你的回答", "多谢", "感谢", "感谢你", "感谢你的回答", "好的谢谢", "好的，谢谢"],
		text: "不客气！",
	},
	{
		kind: "ai_identity",
		questions: [
			"你是 ai 吗", "你是ai吗", "你是人工智能吗", "你是机器人吗", "你是真人吗",
			"你是本人吗",
			"你是 ai 还是真人", "你是ai还是真人", "你是个ai吗",
		],
		text: "我是这个网站的 AI 助手，可以介绍已公开的项目和经历。",
	},
	{
		kind: "private_info",
		questions: [
			"你的真名是什么", "你的真实姓名是什么", "你的真实姓名", "你本名叫什么", "你真名叫什么", "你的真名叫什么",
			"你的手机号", "你的手机号是多少", "你的手机号码是多少", "告诉我你的手机号",
			"给我你的手机号", "你的私人手机号是多少", "你的私人号码是多少", "你的身份证号是多少",
			"你的私人邮箱是什么", "你的家庭住址是什么", "你的住址在哪里", "你的住址是什么", "你家住哪",
			"你的真实姓名和手机号是多少", "告诉我你的真实姓名和手机号",
		],
		text: "我可以介绍已公开的经历，私人信息不在问答范围内。",
	},
	{
		kind: "out_of_scope",
		questions: [
			"天气预报", "天气怎么样", "今天天气怎么样", "明天天气怎么样", "今天会下雨吗", "明天会下雨吗",
			"讲个笑话", "讲一个笑话", "给我讲个笑话", "给我讲一个笑话", "讲个故事", "推荐一部电影", "推荐个晚饭", "今天吃什么",
		],
		text: "这个对话框主要介绍作品集里的项目、工作经历和技术实践。",
	},
	{
		kind: "greeting",
		questions: ["哈囉", "早安", "晚安", "在嗎", "你在嗎", "你好嗎"],
		text: "你好！可以問我這個作品集裡的專案、工作經歷和技術。",
	},
	{
		kind: "thanks",
		questions: ["謝謝", "謝謝你", "謝謝你的回答", "多謝", "感謝", "感謝你", "感謝你的回答", "好的謝謝", "好的，謝謝"],
		text: "不客氣！",
	},
	{
		kind: "ai_identity",
		questions: ["你是 ai 嗎", "你是ai嗎", "你是人工智慧嗎", "你是機器人嗎", "你是真人嗎", "你是本人嗎"],
		text: "我是這個網站的 AI 助理，可以介紹已公開的專案和經歷。",
	},
	{
		kind: "private_info",
		questions: ["你的真名是什麼", "你的本名是什麼", "你的手機號碼是多少", "給我你的手機號碼", "你的住址在哪裡"],
		text: "我可以介紹已公開的經歷，私人資訊不在問答範圍內。",
	},
	{
		kind: "out_of_scope",
		questions: ["天氣預報", "天氣怎麼樣", "今天天氣怎麼樣", "明天天氣怎麼樣", "今天會下雨嗎", "講個笑話", "講個故事", "推薦一部電影"],
		text: "這個對話框主要介紹作品集裡的專案、工作經歷和技術實務。",
	},
	{
		kind: "greeting",
		questions: ["hi", "hello", "hey", "hey there", "hi there", "good morning", "good evening", "howdy"],
		text: "Hi! Ask me about the projects, work experience, or technologies in this portfolio.",
	},
	{
		kind: "thanks",
		questions: ["thanks", "thank you", "thanks a lot", "many thanks", "thank you very much", "thanks for your answer", "ok thanks", "okay, thanks"],
		text: "You’re welcome!",
	},
	{
		kind: "ai_identity",
		questions: [
			"are you an ai", "are you ai", "are you a bot", "are you a chatbot", "are you a real person", "are you human",
			"is this ai",
		],
		text: "I’m the site’s AI, answering questions about the public projects and experience in this portfolio.",
	},
	{
		kind: "private_info",
		questions: [
			"what is your real name", "what's your real name", "what is your legal name", "what's your legal name",
			"what is your private phone number", "what's your phone number", "what is your phone number",
			"give me your phone number", "what is your personal email", "what is your home address",
			"what's your home address", "give me your home address", "where do you live",
		],
		text: "I can answer from the public documents and leave private details out.",
	},
	{
		kind: "out_of_scope",
		questions: [
			"what's the weather", "what's the weather today", "what is the weather today", "will it rain today", "weather forecast",
			"tell me a joke", "tell me a story", "recommend a movie", "what should i eat for dinner",
		],
		text: "I can help with questions about the projects, work experience, and technical practice in this portfolio.",
	},
	{
		kind: "greeting",
		questions: ["こんにちは", "こんばんは", "おはよう", "おはようございます", "はじめまして"],
		text: "こんにちは。携わったプロジェクトや仕事の経験、得意な技術について聞いてください。",
	},
	{
		kind: "thanks",
		questions: ["ありがとう", "ありがとうございます", "ありがとうございました", "どうもありがとう", "回答ありがとうございます"],
		text: "どういたしまして。",
	},
	{
		kind: "ai_identity",
		questions: ["あなたはaiですか", "あなたは ai ですか", "aiですか", "aiですかね", "ボットですか", "本人ですか", "人間ですか"],
		text: "このサイトの AI です。公開されているプロジェクトや経験についてお答えします。",
	},
	{
		kind: "private_info",
		questions: ["本名を教えて", "本名を教えてください", "本名は何ですか", "電話番号を教えて", "自宅の住所はどこですか"],
		text: "個人情報はお答えできません。公開されている経歴についてはご案内できます。",
	},
	{
		kind: "out_of_scope",
		questions: ["今日の天気は", "明日の天気は", "今日雨は降りますか", "ジョークを言って", "おすすめの映画を教えて"],
		text: "このチャットでは、携わったプロジェクトや仕事の経験、技術についてお答えできます。",
	},
	{
		kind: "history_recall",
		questions: ["我刚才问了什么", "我刚刚问了什么", "你还记得我刚才问了什么", "我上一个问题是什么", "刚才聊到哪了", "我们刚才聊了什么"],
		text: "这次对话里还没有已完成的项目或经历问题。可以先聊聊其中一个。",
	},
	{
		kind: "history_recall",
		questions: ["我剛才問了什麼", "我剛剛問了什麼", "你還記得我剛才問了什麼", "我們剛才聊了什麼"],
		text: "這次對話裡還沒有已完成的專案或經歷問題。可以先聊聊其中一個。",
	},
	{
		kind: "history_recall",
		questions: ["what did i just ask", "what did i ask before", "what was my last question", "what were we talking about", "do you remember what i just asked"],
		text: "We haven’t finished a question about my work yet. You can start with a project or part of my experience.",
	},
	{
		kind: "history_recall",
		questions: ["さっき何を聞いた", "さっき何を質問しましたか", "前の質問は何でしたか", "何について話していましたか"],
		text: "この会話では、まだプロジェクトや仕事の経験についての質問に回答していません。",
	},
	{
		kind: "history_only",
		questions: [
			"总结一下", "总结一下刚才的回答", "总结上一条回答", "总结一下上一条回答", "请总结一下上一条回答",
			"简短一点", "说短一点", "能简短一点吗", "用一句话概括", "用一句话概括上一条回答", "把上一条回答缩成一句话",
			...["英语", "英文", "日语", "日文", "中文", "简体中文", "繁体中文"].flatMap((language) => [
				`翻译成${language}`, `翻译成${language}吧`, `把上条回答翻译成${language}`, `把上一条回答翻译成${language}`,
				`把上一个回答翻译成${language}`, `把刚才的回答翻译成${language}`, `请把上一条回答翻译成${language}`, `用${language}再说一遍`,
			]),
		],
		text: "可以先问我一个关于项目或经历的问题，接着让我改写那条回答。",
	},
	{
		kind: "history_only",
		questions: [
			"總結一下", "總結上一則回答", "總結一下上一則回答", "請總結一下上一則回答", "摘要一下剛才的回答",
			"簡短一點", "能簡短一點嗎", "用一句話概括", "用一句話概括上一則回答", "把上一則回答縮成一句話",
			...["英文", "英語", "日文", "日語", "中文", "簡體中文", "繁體中文"].flatMap((language) => [
				`翻譯成${language}`, `把上一則回答翻譯成${language}`, `把上一條回答翻譯成${language}`,
				`把剛才的回答翻譯成${language}`, `請把上一則回答翻譯成${language}`, `用${language}再說一遍`,
			]),
		],
		text: "可以先問我一個關於專案或經歷的問題，接著請我改寫那則回答。",
	},
	{
		kind: "history_only",
		questions: [
			"summarize that", "summarise that", "summarize your last answer", "summarise your last answer", "summarize your previous answer",
			"please summarize your last answer", "can you summarize your last answer", "could you summarize that", "make that shorter",
			"keep it brief", "can you make that shorter", "in one sentence", "summarize that in one sentence",
			...["english", "japanese", "chinese", "simplified chinese", "traditional chinese", "spanish", "french", "german", "korean"].flatMap((language) => [
				`translate that into ${language}`, `translate that to ${language}`, `translate your last answer into ${language}`,
				`translate your previous answer into ${language}`, `can you translate that into ${language}`, `say that again in ${language}`,
			]),
		],
		text: "Ask me about a project or work experience first, then ask me to rewrite that answer.",
	},
	{
		kind: "history_only",
		questions: [
			"要約して", "要約してください", "前の回答を要約して", "前の回答を要約してください", "先ほどの回答を要約してください",
			"もう少し短く", "もう少し短くしてください", "一文でまとめて", "前の回答を一文でまとめてください",
			...["英語", "日本語", "中国語", "簡体字中国語", "繁体字中国語"].flatMap((language) => [
				`${language}に訳して`, `${language}に翻訳してください`, `前の回答を${language}に訳して`,
				`前の回答を${language}に翻訳してください`, `先ほどの回答を${language}に翻訳してください`,
			]),
		],
		text: "まずはプロジェクトや仕事の経験について質問してください。その回答の要約や翻訳ができます。",
	},
];

function normalizeQuestion(message: string): string {
	return message.normalize("NFKC").toLowerCase().replace(/[‘’]/gu, "'")
		.replace(/\s+/gu, " ").trim().replace(/[.!?。]+$/u, "").trimEnd();
}

const matchedIntents = new Map<string, Extract<PublicIntent, { text: string }>>();
for (const { kind, questions, text } of rules) {
	for (const question of questions) {
		const key = normalizeQuestion(question);
		if (!matchedIntents.has(key)) matchedIntents.set(key, { kind, text });
	}
}

/** Skipping retrieval requires a whole-question match. Unclear or combined requests keep evidence available. */
export function classifyPublicIntent(message: string): PublicIntent {
	return matchedIntents.get(normalizeQuestion(message)) ?? { kind: "rag" };
}
