// Builds the pi-ai model registry and resolves the model this service serves.

import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createModels, type Api, type Model, type MutableModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

export interface ModelSetup {
	readonly models: MutableModels;
	readonly model: Model<Api>;
	/** Bound stream function handed to every Agent instance. */
	readonly streamFn: StreamFn;
}

export function createModelSetup(providerId: string, modelId: string): ModelSetup {
	const models = createModels();
	models.setProvider(deepseekProvider());

	const model = models.getModel(providerId, modelId);
	if (!model) {
		const provider = models.getProvider(providerId);
		const available = provider ? provider.getModels().map((entry) => entry.id).join(", ") : "(provider not registered)";
		throw new Error(`Unknown model "${modelId}" for provider "${providerId}". Available: ${available}`);
	}

	return { models, model, streamFn: models.streamSimple.bind(models) };
}
