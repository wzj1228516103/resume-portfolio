import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { loadConfig, type ServiceConfig } from "./config.ts";
import { startServer } from "./server.ts";

const host = "127.0.0.1";
const mimeTypes = new Map(Object.entries({
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".avif": "image/avif",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".svg": "image/svg+xml",
	".pdf": "application/pdf",
	".mp4": "video/mp4",
	".webm": "video/webm",
}));

/** Run the site and its private Agent behind one loopback origin. */
export async function startLocalSite(config: ServiceConfig, port: number) {
	const siteRoot = await realpath(fileURLToPath(new URL("../../docs/", import.meta.url)));
	const apiToken = randomBytes(32).toString("base64url");
	const agent = await startServer({
		...config, host, port: 0, apiToken, publicPortfolio: false, publicAccess: undefined,
	});
	const server = createServer((request, response) => {
		void route(request, response).catch(() => {
			if (response.headersSent) response.destroy();
			else reply(response, 500, "Local site request failed.");
		});
	});

	async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
		response.setHeader("X-Content-Type-Options", "nosniff");
		response.setHeader("Cache-Control", "no-store");
		const localPort = request.socket.localPort;
		const authority = request.headers.host;
		if (authority !== `${host}:${localPort}` && authority !== `localhost:${localPort}`) {
			reply(response, 403, "Local site host required.");
			return;
		}
		const origin = `http://${authority}`;
		const target = new URL(request.url ?? "/", origin);
		if (target.origin !== origin) {
			reply(response, 403, "Local origin required.");
			return;
		}
		if (target.pathname === "/chat/stream" && request.method === "POST") {
			if (request.headers.origin && request.headers.origin !== origin) {
				reply(response, 403, "Local origin required.");
				return;
			}
			if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
				reply(response, 415, "Send application/json.");
				return;
			}
			forwardChat(request, response, agent.url, apiToken);
			return;
		}
		if (request.method !== "GET" && request.method !== "HEAD") {
			reply(response, 405, "Method not allowed.");
			return;
		}
		if (target.pathname === "/chat-config.js") {
			response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
			response.end('window.PORTFOLIO_CHAT = { endpoint: "/chat/stream" };\n');
			return;
		}
		await serveAsset(siteRoot, target.pathname, request, response);
	}

	let address: string;
	try {
		address = await new Promise<string>((accept, reject) => {
			server.once("error", reject);
			server.listen(port, host, () => {
				const bound = server.address();
				if (!bound || typeof bound === "string") {
					reject(new Error("Local site address is unavailable."));
					return;
				}
				accept(`http://${host}:${bound.port}/`);
			});
		});
	} catch (error) {
		await agent.close();
		throw error;
	}

	return {
		url: address,
		async close(): Promise<void> {
			const closing = new Promise<void>((accept, reject) => {
				server.close(error => error ? reject(error) : accept());
				server.closeAllConnections();
			});
			await Promise.all([closing, agent.close()]);
		},
	};
}

function forwardChat(request: IncomingMessage, response: ServerResponse, agentUrl: string, token: string): void {
	const outgoing = httpRequest(`${agentUrl}/chat/stream`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
	}, incoming => {
		response.writeHead(incoming.statusCode ?? 502, {
			"Content-Type": incoming.headers["content-type"] ?? "text/plain; charset=utf-8",
		});
		void pipeline(incoming, response).catch(() => {});
	});
	outgoing.once("error", () => {
		if (response.headersSent) response.destroy();
		else reply(response, 502, "Local Agent unavailable.");
	});
	response.once("close", () => {
		if (!response.writableEnded) outgoing.destroy();
	});
	request.once("error", () => outgoing.destroy());
	request.pipe(outgoing);
}

async function serveAsset(root: string, pathname: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
	const name = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
	const ordinary = (part: string) => !part.startsWith(".");
	if (!name.startsWith("/") || /[:\\\u0000]/u.test(name) || !name.split("/").every(ordinary)) {
		reply(response, 404, "File not found.");
		return;
	}
	const filename = await realpath(resolve(root, "." + name)).catch(() => undefined);
	const path = filename && relative(root, filename);
	const type = path && !isAbsolute(path) && path.split(sep).every(ordinary) && mimeTypes.get(extname(path).toLowerCase());
	const file = type && filename ? await stat(filename).catch(() => undefined) : undefined;
	if (!filename || !type || !file?.isFile()) {
		reply(response, 404, "File not found.");
		return;
	}
	const range = request.headers.range;
	const slice = range ? byteRange(range, file.size) : undefined;
	response.setHeader("Accept-Ranges", "bytes");
	if (range && !slice) {
		response.setHeader("Content-Range", `bytes */${file.size}`);
		reply(response, 416, "Range not satisfiable.");
		return;
	}
	if (slice) response.setHeader("Content-Range", `bytes ${slice.start}-${slice.end}/${file.size}`);
	response.writeHead(slice ? 206 : 200, {
		"Content-Type": type, "Content-Length": slice ? slice.end - slice.start + 1 : file.size,
	});
	if (request.method === "HEAD") response.end();
	else await pipeline(createReadStream(filename, slice), response);
}

function byteRange(header: string, size: number): { start: number; end: number } | undefined {
	const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
	if (!match || !size || (!match[1] && !match[2])) return undefined;
	const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
	const end = !match[1] || !match[2] ? size - 1 : Math.min(size - 1, Number(match[2]));
	return Number.isSafeInteger(start) && end >= start ? { start, end } : undefined;
}

function reply(response: ServerResponse, status: number, text: string): void {
	response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
	response.end(text);
}

if (import.meta.main) {
	const port = Number(process.env.SITE_PORT ?? "3000");
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SITE_PORT must be a port from 1 to 65535.");
	const config = loadConfig({ ...process.env, PUBLIC_PORTFOLIO: "0", PUBLIC_ACCESS_REQUIRED: "0" });
	const site = await startLocalSite(config, port);
	console.log(`Resume Portfolio and AI chat are running at ${site.url}`);
	let stopping = false;
	const stop = () => {
		if (stopping) return;
		stopping = true;
		void site.close().catch(() => { process.exitCode = 1; });
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
}
