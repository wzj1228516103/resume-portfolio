(() => {
  const readyCallback = "portfolioTurnstileReady";
  const scriptUrl = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=" + readyCallback;

  function loadTurnstile(signal) {
    if (typeof window.turnstile?.render === "function") return Promise.resolve(window.turnstile);
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = scriptUrl;
      script.async = true;
      let settled = false;

      function finish(turnstile, error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        delete window[readyCallback];
        script.onload = script.onerror = null;
        if (turnstile) {
          resolve(turnstile);
        } else {
          script.remove();
          reject(error);
        }
      }

      function ready() {
        if (typeof window.turnstile?.render === "function") finish(window.turnstile);
      }

      function fail(message) {
        if (settled) return;
        console.warn("Portfolio visitor verification:", message);
        finish(null, new Error(message));
      }

      const abort = () => finish(null, signal.reason);
      const timer = setTimeout(() => fail("Turnstile script did not become ready."), 20_000);
      window[readyCallback] = ready;
      script.onload = () => {
        const api = window.turnstile;
        if (typeof api?.ready === "function") api.ready(ready);
        else ready();
      };
      script.onerror = () => fail("Turnstile script could not load.");
      signal.addEventListener("abort", abort, { once: true });
      document.head.append(script);
    });
  }

  async function getChallengeToken(container, sitekey, language, signal) {
    signal.throwIfAborted();
    const turnstile = await loadTurnstile(signal);
    signal.throwIfAborted();

    const verification = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
    const selector = "#" + container.id;
    let cancel;
    let widgetId;
    container.hidden = false;
    try {
      return await new Promise((resolve, reject) => {
        const fail = () => reject(new Error("Visitor verification did not complete"));
        const widgetError = code => {
          if (/^\d{6}$/.test(String(code))) console.warn("Portfolio visitor verification: Turnstile error " + code);
          fail();
          return true;
        };
        cancel = () => reject(verification.reason);
        verification.addEventListener("abort", cancel, { once: true });
        widgetId = turnstile.render(selector, {
          sitekey,
          language,
          action: "portfolio_chat",
          execution: "execute",
          appearance: "interaction-only",
          size: container.parentElement.clientWidth < 300 ? "compact" : "normal",
          theme: "dark",
          retry: "never",
          "response-field": false,
          callback: resolve,
          "error-callback": widgetError,
          "expired-callback": fail,
          "timeout-callback": fail
        });
        turnstile.execute(selector);
      });
    } finally {
      verification.removeEventListener("abort", cancel);
      container.hidden = true;
      if (widgetId) turnstile.remove(widgetId);
    }
  }
  window.getPortfolioChallengeToken = getChallengeToken;
})();
