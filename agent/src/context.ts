import type { AgentMessage } from "@earendil-works/pi-agent-core";

export function userMessageText(message: AgentMessage | undefined): string | undefined {
	if (message?.role !== "user") return undefined;
	return typeof message.content === "string" ? message.content
		: message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
}

/** Keep the latest complete exchanges within a fixed context budget. */
export function retainPublicDialogue(messages: readonly AgentMessage[], maxTurns = 4, maxCharacters = 6_000): AgentMessage[] {
	const recent: AgentMessage[] = [];
	let characters = 0;
	for (let i = messages.length - 1; i > 0 && recent.length < maxTurns * 2; i--) {
		const reply = messages[i];
		const question = messages[i - 1];
		if (question?.role !== "user" || reply?.role !== "assistant") continue;
		if (reply.stopReason !== "stop" && reply.stopReason !== "length") continue;
		const size = (userMessageText(question)?.length ?? 0) + reply.content.reduce((total, block) =>
			total + (block.type === "text" ? block.text.length : 0), 0);
		if (characters + size > maxCharacters) break;
		recent.push(reply, question);
		characters += size;
		i--;
	}
	recent.reverse();
	const policy = messages[0];
	if (policy?.role === "system") recent.unshift(policy);
	return recent;
}

/** Remove the exact retrieved message without touching an identical visitor message. */
export function removeTurnEvidence(messages: AgentMessage[], evidence: AgentMessage | undefined): void {
	if (!evidence) return;
	const index = messages.indexOf(evidence);
	if (index >= 0) messages.splice(index, 1);
}
