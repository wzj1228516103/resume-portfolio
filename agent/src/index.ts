// Process entry point: validate configuration, start the HTTP service, shut down cleanly on signals.

import { assertCredentials, loadConfig } from "./config.ts";
import { startServer } from "./server.ts";

assertCredentials();
const config = loadConfig();
const service = await startServer(config);

console.log(`portfolio-agent listening on ${service.url}`);
console.log(`model:     ${config.providerId}/${config.modelId}`);
console.log(`knowledge: ${service.knowledge.documents} documents, ${service.knowledge.chunks} chunks`);
console.log(`auth:      ${config.apiToken ? "bearer token required" : "open (set API_TOKEN to require a token)"}`);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`\n${signal} received, shutting down.`);
	try {
		await service.close();
		process.exit(0);
	} catch (error) {
		console.error("Shutdown failed:", error);
		process.exit(1);
	}
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
