(() => {
  const { FluxDispatcher } = vendetta.metro.common;
  const { before } = vendetta.patcher;

  // Fallback list, used only if words.txt can't be fetched and nothing is cached.
  const FALLBACK = ["fuck", "fucking", "shit", "bitch", "asshole", "bastard", "dick", "cunt"];

  // words.txt is loaded from the same folder as the plugin. If your host serves
  // it somewhere else, put the full URL here instead.
  const WORDS_URL = (vendetta.plugin && vendetta.plugin.id ? vendetta.plugin.id : "") + "words.txt";

  const store = vendetta.plugin.storage;

  const SUBS = {
    a: "[a@4]", b: "[b8]", e: "[e3]", i: "[i1!|]", l: "[l1|]",
    o: "[o0]", s: "[s5$]", t: "[t7+]", u: "[uv*]", c: "[c(k]", g: "[g9]"
  };
  const GAP = "[\\s._\\-*]{0,2}";

  const build = (w) =>
    w.split("")
      .map((ch) => (ch === " " ? "[\\s._\\-*]{1,3}" : SUBS[ch] || ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join(GAP);

  const parse = (text) =>
    text.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#"));

  let pattern;
  const compile = (words) => {
    const uniq = [...new Set(words)].sort((a, b) => b.length - a.length);
    pattern = new RegExp(`(?<![a-z0-9])(?:${uniq.map(build).join("|")})s?(?![a-z0-9])`, "gi");
  };

  const censor = (s) =>
    typeof s === "string" && pattern ? s.replace(pattern, (m) => "#".repeat(m.length)) : s;

  const loadWords = async () => {
    try {
      const res = await fetch(WORDS_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      const words = parse(text);
      if (words.length) {
        store.wordsText = text; // cache for offline / next launch
        compile(words);
        return;
      }
    } catch (e) {
      console.log("[HashCensor] couldn't fetch words.txt:", e);
    }
    compile(store.wordsText ? parse(store.wordsText) : FALLBACK);
  };

  const fixMessage = (m) => {
    if (!m) return;
    if (typeof m.content === "string") m.content = censor(m.content);
    if (Array.isArray(m.embeds)) {
      for (const e of m.embeds) {
        if (e.title) e.title = censor(e.title);
        if (e.description) e.description = censor(e.description);
        if (e.rawTitle) e.rawTitle = censor(e.rawTitle);
        if (e.rawDescription) e.rawDescription = censor(e.rawDescription);
      }
    }
    if (m.referenced_message) fixMessage(m.referenced_message);
  };

  const TYPES = new Set([
    "MESSAGE_CREATE", "MESSAGE_UPDATE", "LOAD_MESSAGES_SUCCESS",
    "LOAD_MESSAGES_AROUND_SUCCESS", "SEARCH_FINISH", "LOAD_PINNED_MESSAGES_SUCCESS",
    "LOAD_RECENT_MENTIONS_SUCCESS", "MOBILE_WEB_SIDEBAR_CLOSE"
  ]);

  let unpatch;

  return {
    onLoad() {
      // Start with cached (or fallback) words right away, then refresh from words.txt
      compile(store.wordsText ? parse(store.wordsText) : FALLBACK);
      loadWords();
      // Rewrite message payloads before they reach the store, so the UI
      // never sees the original text (works for history, new msgs, edits).
      unpatch = before("dispatch", FluxDispatcher, ([ev]) => {
        if (!ev || !TYPES.has(ev.type)) return;
        if (ev.message) fixMessage(ev.message);
        if (Array.isArray(ev.messages)) ev.messages.forEach(fixMessage);
        if (Array.isArray(ev.messages) && Array.isArray(ev.messages[0])) {
          ev.messages.forEach((g) => g.forEach && g.forEach(fixMessage)); // search results
        }
      });
    },
    onUnload() {
      unpatch?.();
    },
  };
})()
