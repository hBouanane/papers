// Settings: name, language, the AI model and what it can do, and where everything is kept. Everything saves as you change it.
import { combobox } from "../components/combobox.js";
import { chooseFolder } from "../components/folderpicker.js";
import { api, app, busy, empty, esc, loading, toast } from "../core.js";

// ---------- Settings ----------

// Languages for translations, with their own names so you can find yours either way.
const LANGUAGES = [
  ["", "English only", "no translations"],
  ["Arabic", "Arabic", "العربية"], ["Bengali", "Bengali", "বাংলা"], ["Chinese", "Chinese", "中文"],
  ["Czech", "Czech", "Čeština"], ["Dutch", "Dutch", "Nederlands"], ["French", "French", "Français"],
  ["German", "German", "Deutsch"], ["Greek", "Greek", "Ελληνικά"], ["Hebrew", "Hebrew", "עברית"],
  ["Hindi", "Hindi", "हिन्दी"], ["Indonesian", "Indonesian", "Bahasa Indonesia"], ["Italian", "Italian", "Italiano"],
  ["Japanese", "Japanese", "日本語"], ["Korean", "Korean", "한국어"], ["Malay", "Malay", "Bahasa Melayu"],
  ["Persian", "Persian", "فارسی"], ["Polish", "Polish", "Polski"], ["Portuguese", "Portuguese", "Português"],
  ["Romanian", "Romanian", "Română"], ["Russian", "Russian", "Русский"], ["Spanish", "Spanish", "Español"],
  ["Swahili", "Swahili", "Kiswahili"], ["Swedish", "Swedish", "Svenska"], ["Tamil", "Tamil", "தமிழ்"],
  ["Thai", "Thai", "ไทย"], ["Turkish", "Turkish", "Türkçe"], ["Ukrainian", "Ukrainian", "Українська"],
  ["Urdu", "Urdu", "اردو"], ["Vietnamese", "Vietnamese", "Tiếng Việt"],
].map(([value, label, hint]) => ({ value, label, hint }));
// ---------- Settings: AI providers ----------
const AI_GROUPS = [["subscription", "Use your subscription"], ["key", "Pay per use with an API key"],
  ["local", "On this computer (free, private)"], ["other", "Other"]];
const KEY_PAGES = {
  anthropic: "console.anthropic.com", openai: "platform.openai.com/api-keys", gemini: "aistudio.google.com/apikey",
  mistral: "console.mistral.ai", groq: "console.groq.com/keys", openrouter: "openrouter.ai/keys",
};
// What each provider needs, in a sentence or two.
function aboutProvider(p, s) {
  const link = (host) => `<a href="https://${host}" target="_blank" rel="noopener">${host}</a>`;
  if (p.id === "claude-plan") return `Runs Claude Code on this computer, signed in with your Claude account; usage counts toward your plan.
    ${s.claude_binary ? `Found it at <code>${esc(s.claude_binary)}</code>.` : `Install it from ${link("claude.com/claude-code")}.`}
    First time: in a terminal run <code>claude</code>, type <code>/login</code> and sign in. For your own use only.`;
  if (p.id === "chatgpt-plan") return `Runs OpenAI's Codex on this computer, signed in with your ChatGPT account; usage counts toward your plan.
    ${s.codex_binary ? `Found it at <code>${esc(s.codex_binary)}</code>.` : `Install it with <code>npm install -g @openai/codex</code>.`}
    First time: in a terminal run <code>codex login</code>. Answers arrive all at once rather than word by word. For your own use only.`;
  if (p.group === "key") return `Paid per use. Get a key at ${link(KEY_PAGES[p.id])}${p.id === "gemini" ? " (it has a free tier)" : ""}, paste it below,
    then List models and pick one.`;
  if (p.group === "local") return `Free and private: the model runs on this computer and nothing leaves it. Install
    ${p.id === "ollama" ? link("ollama.com") : link("lmstudio.ai")}, download a model in it and keep it running, then List models.`;
  return "Any server that speaks the OpenAI chat API (vLLM, llama.cpp, a company gateway). Set its address under More options.";
}


const bytes = (n) => n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : n < 1e9 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e9).toFixed(2)} GB`;
// An on/off switch with its explanation under it.
const toggle = (id, on, title, text) => `<label class="switch-row" for="${id}">
    <span class="switch-text"><strong>${title}</strong><span class="hint">${text}</span></span>
    <input type="checkbox" role="switch" id="${id}" ${on ? "checked" : ""}><span class="toggle-switch" aria-hidden="true"></span></label>`;

// Everything saves as you change it; each section says "Saved" for a moment, so there is no Save button to forget.
export async function settingsPage(stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const [s, store] = await Promise.all([api("/settings"), api("/storage")]);
  if (stale()) return;
  const head = (title) => `<h2>${title}<span class="saved-note" role="status"></span></h2>`;
  app.innerHTML = `<div class="container page narrow settings-page">
    <div class="page-head"><h1 class="page-title">Settings</h1></div>
    <p class="tip">Changes are saved as you make them.</p>
    <form class="sheet form" id="name-form">
      ${head("Your name")}
      <p class="hint">The Library greets you with it. Leave it empty for just "Good morning".</p>
      <label for="name">Name</label>
      <input id="name" value="${esc(s.name)}" autocomplete="given-name" maxlength="60">
    </form>
    <form class="sheet form" id="lang-form">
      ${head("Your language")}
      <p class="hint">If English isn't your first language, say which one is. Translate (when you select text in a paper)
        uses it, and new vocabulary lists include a translation for each word.</p>
      <span class="label" id="lang-label">First language</span>
      <div id="lang" aria-labelledby="lang-label"></div>
    </form>
    <form class="sheet form" id="ai-form">
      ${head("AI model")}
      <div class="ai-state" id="ai-state"></div>
      <label for="ai-provider">Provider</label>
      <select id="ai-provider">${AI_GROUPS.map(([group, label]) => `<optgroup label="${label}">${s.providers.filter((p) => p.group === group)
        .map((p) => `<option value="${p.id}" ${p.id === s.ai_provider ? "selected" : ""}>${esc(p.name)}${s.keys_saved?.[p.id] ? " · key saved" : ""}</option>`).join("")}</optgroup>`).join("")}</select>
      <p class="hint" id="ai-about"></p>
      <div class="ai-field" id="ai-key-field">
        <label for="ai-key">API key</label>
        <input id="ai-key" class="secret" type="text" name="papers-ai-key" autocomplete="off" autocapitalize="off" autocorrect="off"
          spellcheck="false" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other">
        <p class="hint" id="ai-key-where"></p>
      </div>
      <label for="ai-model">Model</label>
      <div class="model-row"><input id="ai-model" list="ai-models" value="${esc(s.ai_model)}">
        <button type="button" class="button secondary small" id="list-models">List models</button></div>
      <datalist id="ai-models"></datalist>
      <details class="advanced"><summary>More options</summary>
        <div class="ai-field" id="ai-base-field">
          <label for="ai-base">Server address</label>
          <input id="ai-base" value="${esc(s.ai_base_url)}" placeholder="https://…/v1">
          <p class="hint">Filled in for the provider you picked. Change it only for another server or port.</p>
        </div>
        <label for="ai-context">How much of a paper to send</label>
        <select id="ai-context">
          <option value="full" ${s.ai_context === "full" ? "selected" : ""}>The whole paper (large models)</option>
          <option value="32k" ${s.ai_context === "32k" ? "selected" : ""}>About 32k tokens (most local models)</option>
          <option value="8k" ${s.ai_context === "8k" ? "selected" : ""}>About 8k tokens (small local models)</option>
        </select>
        <p class="hint">Models with a small memory can't read a whole paper at once; they get its beginning.</p>
      </details>
      <div class="check-row"><button type="button" class="button" id="ai-test">Check it works</button>
        <p id="ai-status" class="hint" role="status">Sends one short question to the model and shows its answer.</p></div>
    </form>
    <form class="sheet form" id="features-form">
      ${head("What the AI can do")}
      <p class="hint">In a paper's chat, <strong>Quick</strong> answers at once from the paper. <strong>Deep</strong> lets the AI
        work in steps: search the paper, read a section, look at a figure, check your library, and save notes or highlights
        for you (each with Undo). Deep needs a model that can use tools.</p>
      <div class="ai-can" id="ai-can"></div>
      ${toggle("ai-vision", s.ai_vision, "Look at figures",
        "In Deep mode the AI can see the paper's figures and charts, and point at parts of them. Claude always can; for other providers the check above finds out and sets this for you (most free and small local models can't).")}
      ${toggle("ai-pages", s.ai_pages, "Interactive pages",
        "Besides its built-in charts and widgets, let the AI write a small interactive page when an idea is easier to play with than to read. It runs in a sealed frame: no access to the app, your files or the internet.")}
    </form>
    <form class="sheet form" id="storage-form">
      ${head("Where everything is kept")}
      <h3>Data folder</h3>
      <p class="hint">Everything Papers knows lives in this one folder (${esc(store.data_source_text)}). Back it up to keep your library safe.</p>
      <div class="folder-row"><input id="data-dir" value="${esc(store.data_dir)}" readonly spellcheck="false">
        <button type="button" class="button secondary" id="data-copy">Copy</button>
        ${store.can_move ? `<button type="button" class="button secondary" id="data-move">Move…</button>` : ""}</div>
      <table class="store-parts">${store.parts.map((p) => `<tr><td><code>${esc(p.name)}</code></td><td>${esc(p.what)}</td>
        <td class="num">${bytes(p.bytes)}</td></tr>`).join("")}</table>
      <p class="hint">API keys are not in this folder: they're kept in ${esc(store.keys_where)}.</p>
      <h3>Library folder <span class="faint">(optional)</span></h3>
      <p class="hint">A copy of your library you can browse: each goal gets a folder, each paper its PDF plus a Markdown
        notes file with key points, explanations, quiz and links to related papers. The notes open in any Markdown app, and
        in Obsidian the links between papers show up as a graph.</p>
      <div class="folder-row"><input id="folder" value="${esc(s.library_dir)}" placeholder="${esc(s.suggested)}" spellcheck="false">
        <button type="button" class="button secondary" id="folder-choose">Choose…</button></div>
      <p class="hint">Choose a folder, or type a full path and press Enter (it's created if it doesn't exist). Empty it to stop keeping a copy.</p>
      <div id="folder-status"></div>
    </form></div>`;
  const q = (sel) => app.querySelector(sel);
  // "Saved" next to a section's title for a moment.
  const saved = (form, text = "Saved") => {
    const note = q(`${form} .saved-note`);
    note.textContent = text;
    note.classList.add("on");
    clearTimeout(note.timer);
    note.timer = setTimeout(() => note.classList.remove("on"), 1800);
  };
  // Enter in a field saves it rather than submitting the page.
  app.querySelectorAll("form").forEach((f) => (f.onsubmit = (e) => { e.preventDefault(); document.activeElement?.blur?.(); }));

  // ----- Name and language -----
  q("#name").onchange = async (e) => {
    await api("/settings", { method: "PUT", json: { name: e.target.value } });
    saved("#name-form");
  };
  combobox(q("#lang"), {
    options: LANGUAGES, value: s.language, placeholder: "English only", allowCustom: true,
    onPick: async (language) => {
      const r = await api("/settings", { method: "PUT", json: { language } });
      saved("#lang-form", r.language ? `Translations in ${r.language}` : "Translations off");
    },
  });

  // ----- AI model: one list of providers, each set up the same way -----
  const aiStatus = q("#ai-status");
  const say = (text, ok = true) => { aiStatus.className = ok ? "hint" : "error"; aiStatus.textContent = text; };
  let ai = s;
  const provider = () => ai.providers.find((x) => x.id === ai.ai_provider);
  // At the top of the section: ready or not, and if not, what is missing.
  const showState = () => {
    const p = provider();
    const missing = ai.ai_ready ? "" : p.group === "subscription" ? "its app isn't installed yet (see below)"
      : p.key && !ai.keys_saved?.[p.id] ? "paste an API key" : !ai.ai_model ? "choose a model" : "finish setting it up";
    q("#ai-state").className = `ai-state ${ai.ai_ready ? "ready" : "todo"}`;
    q("#ai-state").innerHTML = ai.ai_ready
      ? `<strong>Set up:</strong> ${esc(ai.ai_model || "the default model")} through ${esc(p.name)}.`
      : `<strong>Not ready:</strong> ${missing}.`;
    showCan();
  };
  const showProvider = () => {
    const p = provider();
    const subscription = p.group === "subscription";
    q("#ai-about").innerHTML = aboutProvider(p, ai);
    q("#ai-key-field").hidden = !p.key;
    q("#ai-key").value = "";
    const key = ai.keys_saved?.[p.id];
    q("#ai-key").placeholder = key ? `Key ${key === "saved" ? "" : `ending in ${key.slice(1)} `}saved. Paste a new one to replace it.` : "Paste your key";
    q("#ai-key-where").innerHTML = key
      ? `Kept in ${esc(ai.keys_where)}, so you don't need to paste it again. <button type="button" class="link-button" id="ai-key-forget">Forget this key</button>`
      : `Kept in ${esc(ai.keys_where || "this computer")}, never sent anywhere but ${esc(p.name.split(" (")[0])}.`;
    q("#ai-key-forget")?.addEventListener("click", async () => {
      ai = await api("/settings", { method: "PUT", json: { ai_api_key: "" } });
      showProvider();
      saved("#ai-form", "Key forgotten");
    });
    q("#ai-model").value = ai.ai_model;
    q("#ai-model").placeholder = subscription ? "Leave empty for the default model" : "Pick from the list or type its name";
    q("#list-models").hidden = subscription;
    q("#ai-models").innerHTML = "";
    q("#ai-base-field").hidden = p.kind !== "openai";
    q("#ai-base").value = ai.ai_base_url;
    q(`#ai-provider option[value="${p.id}"]`).textContent = p.name + (key ? " · key saved" : "");
    showState();
  };
  showProvider();
  const put = async (json, note = "Saved") => {
    ai = await api("/settings", { method: "PUT", json });
    saved("#ai-form", note);
    say("Sends one short question to the model and shows its answer.");
    return ai;
  };
  // Picking a provider switches to it at once; its own key and model come back as you left them.
  q("#ai-provider").onchange = async (e) => { await put({ ai_provider: e.target.value }, "Switched"); showProvider(); };
  q("#ai-key").onchange = async (e) => {
    if (!e.target.value.trim()) return;
    await put({ ai_api_key: e.target.value.trim() }, "Key saved");
    showProvider();
  };
  q("#ai-model").onchange = async (e) => { await put({ ai_model: e.target.value }); showState(); };
  q("#ai-base").onchange = async (e) => { await put({ ai_base_url: e.target.value }); showState(); };
  q("#ai-context").onchange = (e) => put({ ai_context: e.target.value });
  // Ask the provider which models it has, so you pick a real name instead of guessing one.
  q("#list-models").onclick = (e) => busy(e.currentTarget, "Asking…", async () => {
    try {
      const { models } = await api("/ai/models");
      q("#ai-models").innerHTML = models.map((m) => `<option value="${esc(m)}">`).join("");
      say(models.length ? `${models.length} models available: click the Model box to pick one.` : "The provider listed no models.");
      q("#ai-model").focus();
    } catch (err) { say(err.message, false); }
  });
  q("#ai-test").onclick = (e) => busy(e.currentTarget, "Asking the model…", async () => {
    say("Waiting for an answer…");
    const r = await api("/ai/test", { method: "POST" });
    say(r.ok ? `✓ ${r.message}` : r.message, r.ok);
    if (r.ok && ai.ai_backend === "openai") await checkCan();
  });

  // ----- What this model can do: images and tools, found out by asking it -----
  function showCan(can = ai.ai_can, asking = false) {
    const row = (name, c) => `<li class="${c?.ok ? "yes" : c?.ok === false ? "no" : "unknown"}"><span class="ai-can-mark" aria-hidden="true">${c?.ok ? "✓" : c?.ok === false ? "✕" : "?"}</span>
      <span><strong>${name}</strong> ${esc(c?.note || "Not checked yet for this model.")}</span></li>`;
    q("#ai-can").innerHTML = `<ul>${row("Images.", can?.images)}${row("Tools.", can?.tools)}</ul>
      ${ai.ai_backend === "openai" ? `<button type="button" class="button secondary small" id="ai-can-check" ${asking || !ai.ai_ready ? "disabled" : ""}>
        ${asking ? "Asking the model…" : can ? "Check again" : "Check this model"}</button>` : ""}`;
    if (q("#ai-can-check")) q("#ai-can-check").onclick = checkCan;
    // Claude always gets the figures and the ChatGPT subscription never does, so the switch is only yours to set for the others.
    const fixed = ai.ai_backend !== "openai";
    q("#ai-vision").disabled = fixed;
    q("#ai-vision").checked = fixed ? ai.ai_backend !== "codex" : ai.ai_vision;
    q("#ai-vision").closest(".switch-row").classList.toggle("is-fixed", fixed);
  }
  async function checkCan() {
    showCan(ai.ai_can, true);
    try {
      const r = await api("/ai/capabilities", { method: "POST" });
      ai.ai_can = r;
      if (ai.ai_vision !== r.ai_vision) {
        ai.ai_vision = r.ai_vision;
        saved("#features-form", `Look at figures turned ${r.ai_vision ? "on" : "off"}`);
      }
    } catch (err) { toast(err.message); }
    showCan();
  }

  // ----- Features -----
  for (const [id, field, name] of [["#ai-vision", "ai_vision", "Figures"], ["#ai-pages", "ai_pages", "Interactive pages"]]) {
    q(id).onchange = async (e) => {
      await api("/settings", { method: "PUT", json: { [field]: e.target.checked } });
      ai[field] = e.target.checked;
      saved("#features-form", `${name} ${e.target.checked ? "on" : "off"}`);
    };
  }

  // ----- Storage -----
  q("#data-copy").onclick = async () => {
    await navigator.clipboard?.writeText(store.data_dir).catch(() => {});
    saved("#storage-form", "Path copied");
  };
  q("#data-move")?.addEventListener("click", (e) => busy(e.currentTarget, "Copying…", async () => {
    const path = await chooseFolder(store.data_dir);
    if (!path) return;
    if (!confirm(`Copy your library to ${path} and use it from now on?\nThe old folder is left as it is; delete it yourself once you've checked.`)) return;
    try {
      const moved = await api("/storage/move", { method: "POST", json: { path } });
      q("#data-dir").value = moved.data_dir;
      store.data_dir = moved.data_dir;
      saved("#storage-form", "Moved");
      toast(`Your library is now kept in ${moved.data_dir}.`);
    } catch (err) { toast(err.message); }
  }));
  const status = (folder) => folder ? `<div class="folder-preview">
      <p>Your library is copied to <strong>${esc(folder)}</strong>. Drop PDFs into the Inbox folder and they're added within a few seconds.</p>
      <pre>${esc(folder)}
  Inbox/            drop PDFs here
  Unsorted/         papers without a goal
  &lt;goal&gt;/
    Vaswani et al. 2017 - Attention Is All You Need.pdf
    Vaswani et al. 2017 - Attention Is All You Need.md</pre></div>` : "";
  q("#folder-status").innerHTML = status(s.library_dir);
  const saveFolder = async (library_dir) => {
    try {
      const r = await api("/settings", { method: "PUT", json: { library_dir } });
      q("#folder").value = r.library_dir;
      q("#folder-status").innerHTML = status(r.library_dir);
      saved("#storage-form", r.library_dir ? "Library folder saved" : "No longer copying");
    } catch (err) { toast(err.message); }
  };
  q("#folder-choose").onclick = (e) => busy(e.currentTarget, "Choosing…", async () => {
    const path = await chooseFolder(q("#folder").value || q("#folder").placeholder);
    if (path) await saveFolder(path);
  });
  q("#folder").onchange = (e) => saveFolder(e.target.value);
}
