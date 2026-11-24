(() => {
  if (document.querySelector(".layout").hidden) return;

  const select = id => document.getElementById(id);
  const footer = select("chat-footer");
  const form = select("chat-entry");
  const input = select("chat-input");
  const send = select("chat-send");
  const stop = select("chat-stop");
  const clear = select("chat-clear");
  const status = select("chat-status");
  const announcement = select("chat-announcement");
  const challenge = select("chat-challenge");
  const region = select("chat-answer-region");
  const output = select("chat-answer-output");
  const draft = select("chat-answer-draft");
  const markdown = select("chat-answer-markdown");
  const english = /^en(?:-|$)/i.test(document.documentElement.lang);
  const copy = english ? {
    title: "AI chat", answer: "AI reply", clear: "Close reply", stop: "Stop reply",
    prompt: "Ask about projects or experience", send: "Send",
    offline: "The AI chat service is not connected yet.",
    config: "The AI chat configuration is incomplete.",
    verify: "Complete visitor verification to continue.",
    waiting: "Waiting for a reply…", error: "Could not complete the reply. Try again.",
    stopped: "Reply stopped.", empty: "No reply was received.", complete: "Reply complete."
  } : {
    title: "AI 问答", answer: "AI 回答", clear: "关闭回答", stop: "停止回答",
    prompt: "询问项目或经历", send: "发送",
    offline: "AI 问答服务尚未接入。",
    config: "AI 问答配置未完成。",
    verify: "请完成访客验证。",
    waiting: "正在等待回答…", error: "回答未完成，请重新发送。",
    stopped: "已停止回答。", empty: "没有收到可显示的回答。", complete: "回答已完成。"
  };

  function resolveEndpoint(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value, document.baseURI);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (url.username || url.password || url.search || url.hash) return null;
      return url.protocol === "https:" || (local && url.protocol === "http:") ? url : null;
    } catch {
      return null;
    }
  }

  const config = window.PORTFOLIO_CHAT ?? {};
  const endpoint = resolveEndpoint(config.endpoint);
  const accessEndpoint = resolveEndpoint(config.accessEndpoint);
  const siteKey = typeof config.turnstileSiteKey === "string" ? config.turnstileSiteKey.trim() : "";
  const configuredVerification = Boolean(config.accessEndpoint || siteKey);
  const ready = endpoint && (!configuredVerification || (siteKey && accessEndpoint?.origin === endpoint.origin));

  footer.setAttribute("aria-label", copy.title);
  region.setAttribute("aria-label", copy.answer);
  clear.setAttribute("aria-label", copy.clear);
  stop.setAttribute("aria-label", copy.stop);
  send.setAttribute("aria-label", copy.send);
  select("chat-input-label").textContent = copy.prompt;
  input.placeholder = copy.prompt;
  status.textContent = ready ? "" : (config.endpoint || configuredVerification ? copy.config : copy.offline);
  input.disabled = !ready;
  footer.hidden = false;
  if (!ready) return;

  let sessionId;
  let visitor;
  let active;

  function clearAnswer() {
    region.hidden = true;
    delete document.body.dataset.answerActive;
    draft.hidden = false;
    draft.textContent = "";
    markdown.hidden = true;
    markdown.replaceChildren();
    clear.hidden = true;
  }

  function showAnswer(text, final = false) {
    if (!text.trim()) return;
    const follow = region.hidden || output.scrollHeight - output.scrollTop - output.clientHeight < 36;
    region.hidden = false;
    document.body.dataset.answerActive = "";
    draft.textContent = text;
    if (final && window.renderPortfolioAnswer) {
      try {
        markdown.replaceChildren(window.renderPortfolioAnswer(text));
        if (markdown.textContent.trim()) {
          markdown.hidden = false;
          draft.hidden = true;
        }
      } catch { /* Keep the plain-text reply. */ }
    }
    if (follow) output.scrollTop = output.scrollHeight;
  }

  function post(url, body, signal, accept) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": accept },
      body: JSON.stringify(body),
      credentials: "omit",
      redirect: "error",
      signal
    });
  }

  async function visitorToken(signal) {
    if (!configuredVerification) return undefined;
    if (visitor && visitor.expiresAt > Date.now() + 5000) return visitor.token;
    status.textContent = copy.verify;
    const challengeToken = await window.getPortfolioChallengeToken(challenge, siteKey, english ? "en" : "zh-CN", signal);
    const response = await post(accessEndpoint, { challengeToken, accessToken: visitor?.token, sessionId }, signal, "application/json");
    if (!response.ok) throw new Error("Visitor verification rejected");
    const grant = await response.json();
    if (!grant.accessToken || typeof grant.accessToken !== "string" || !Number.isFinite(grant.expiresIn) || grant.expiresIn <= 0) {
      throw new Error("Invalid visitor pass");
    }
    if (!grant.continued) sessionId = undefined;
    visitor = { token: grant.accessToken, expiresAt: Date.now() + grant.expiresIn * 1000 };
    return visitor.token;
  }

  async function readEvents(response, onDelta) {
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (!response.ok || !response.body || mediaType !== "text/event-stream") throw new Error("Invalid chat response");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        if (done && buffer.trim()) frames.push(buffer);
        for (const frame of frames) {
          const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:"))
            .map(line => line.slice(5).replace(/^ /, "")).join("\n");
          if (!data) continue;
          const event = JSON.parse(data);
          if (event.type === "error") throw new Error("Chat failed");
          if (event.type === "delta" && typeof event.text === "string") onDelta(event.text);
          if (event.type === "done") return event;
        }
        if (done) throw new Error("Chat ended without a final reply");
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  input.addEventListener("input", () => { send.disabled = !input.value.trim(); });
  stop.addEventListener("click", () => active?.abort());
  clear.addEventListener("click", () => {
    clearAnswer();
    status.textContent = "";
    input.focus();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !clear.hidden && !document.querySelector("dialog[open]")) clear.click();
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const message = input.value.trim();
    if (active || !message) return;

    clearAnswer();
    announcement.textContent = "";
    input.value = "";
    input.disabled = send.disabled = send.hidden = true;
    stop.hidden = false;
    const controller = new AbortController();
    active = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
    let text = "";

    try {
      const accessToken = await visitorToken(signal);
      status.textContent = copy.waiting;
      const response = await post(endpoint, { message, sessionId, accessToken }, signal, "text/event-stream");
      if (response.status === 401 && configuredVerification) visitor = undefined;
      if (response.status === 404 || response.status === 401) sessionId = undefined;
      const final = await readEvents(response, delta => {
        text += delta;
        status.textContent = "";
        showAnswer(text);
      });
      if (typeof final.sessionId === "string") sessionId = final.sessionId;
      if (typeof final.text === "string" && final.text.trim()) text = final.text;
      showAnswer(text, true);
      status.textContent = text.trim() ? "" : copy.empty;
      if (text.trim()) announcement.textContent = copy.complete;
    } catch {
      status.textContent = controller.signal.aborted ? copy.stopped : copy.error;
      if (!controller.signal.aborted) input.value = message;
    } finally {
      const restoreFocus = [document.body, stop, input].includes(document.activeElement);
      active = undefined;
      input.disabled = send.hidden = false;
      stop.hidden = true;
      clear.hidden = region.hidden;
      send.disabled = !input.value.trim();
      if (restoreFocus) input.focus({ preventScroll: true });
    }
  });
})();
