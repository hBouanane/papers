// Settings: name, language, AI provider and library folder.
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

export async function settingsPage(stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const s = await api("/settings");
  if (stale()) return;
  app.innerHTML = `<div class="container page narrow">
    <div class="page-head"><h1 class="page-title">Settings</h1></div>
    <form class="sheet form" id="name-form">
      <h2>Your name</h2>
      <p class="hint">The Library greets you with it. Leave it empty for just "Good morning".</p>
      <label for="name">Name</label>
      <div class="lang-row"><input id="name" value="${esc(s.name)}" autocomplete="given-name" maxlength="60">
        <button class="button">Save</button></div>
    </form>
    <form class="sheet form" id="lang-form">
      <h2>Your language</h2>
      <p class="hint">If English isn't your first language, say which one is. Translate (when you select text in a paper)
        uses it, and new vocabulary lists include a translation for each word.</p>
      <span class="label" id="lang-label">First language</span>
      <div id="lang" aria-labelledby="lang-label"></div>
    </form>
    <form class="sheet form" id="ai-form">
      <h2>AI model</h2>
      <p class="hint">Key points, explanations, vocabulary, questions and recall are written by an AI model. Use any provider.</p>
      <label for="ai-provider">Provider</label>
      <select id="ai-provider">${AI_GROUPS.map(([group, label]) => `<optgroup label="${label}">${s.providers.filter((p) => p.group === group)
        .map((p) => `<option value="${p.id}" ${p.id === s.ai_provider ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</optgroup>`).join("")}</select>
      <p class="hint" id="ai-about"></p>
      <div class="ai-field" id="ai-key-field">
        <label for="ai-key">API key</label>
        <input id="ai-key" type="password" autocomplete="off">
        <p class="hint">Kept on this computer only.</p>
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
        <label class="check"><input type="checkbox" id="ai-vision" ${s.ai_vision ? "checked" : ""}> This model can see images</label>
        <p class="hint">In Deep mode the AI can look at the paper's figures. Claude always can; for other providers, tick this only if your model accepts images (most free and small local models don't).</p>
      </details>
      <div class="form-foot ai-actions"><button type="button" class="button secondary" id="ai-test">Test connection</button>
        <button class="button" id="ai-save">Save</button></div>
      <p id="ai-status" class="hint" role="status"></p>
    </form>
    <form class="sheet form" id="folder-form">
      <h2>Library folder</h2>
      <p class="hint">Keep a copy of your library in a folder on this computer. Each goal gets a folder, each paper
        its PDF plus a Markdown notes file with key points, explanations, quiz and links to related papers.
        The notes open in any Markdown app, and in Obsidian the links between papers show up as a graph.</p>
      <label for="folder">Folder</label>
      <div class="folder-row"><input id="folder" value="${esc(s.library_dir)}" placeholder="${esc(s.suggested)}" spellcheck="false">
        <button type="button" class="button secondary" id="folder-choose">Choose…</button></div>
      <p class="hint">Choose a folder, or type a full path (it's created if it doesn't exist). Empty it to stop keeping a copy.</p>
      <div class="form-foot"><button class="button">Save</button></div>
      <div id="folder-status"></div>
    </form></div>`;
  const status = (folder) => folder ? `<div class="folder-preview">
      <p>Your library is kept in <strong>${esc(folder)}</strong>. Drop PDFs into the Inbox folder and they're added within a few seconds.</p>
      <pre>${esc(folder)}
  Inbox/            drop PDFs here
  Unsorted/         papers without a goal
  &lt;goal&gt;/
    Vaswani et al. 2017 - Attention Is All You Need.pdf
    Vaswani et al. 2017 - Attention Is All You Need.md</pre></div>` : "";
  app.querySelector("#folder-status").innerHTML = status(s.library_dir);
  app.querySelector("#name-form").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, "Saving…", async () => {
      const saved = await api("/settings", { method: "PUT", json: { name: app.querySelector("#name").value } });
      toast(saved.name ? `Saved. Hello, ${saved.name}.` : "Name removed.");
    });
  };
  combobox(app.querySelector("#lang"), {
    options: LANGUAGES, value: s.language, placeholder: "English only", allowCustom: true,
    onPick: async (language) => {
      const saved = await api("/settings", { method: "PUT", json: { language } });
      toast(saved.language ? `Translations will be in ${saved.language}.` : "Translations turned off.");
    },
  });
  app.querySelector("#lang-form").onsubmit = (e) => e.preventDefault();
  // ----- AI model: one list of providers, each set up the same way -----
  const q = (sel) => app.querySelector(sel);
  const aiStatus = q("#ai-status");
  const say = (text, ok = true) => { aiStatus.className = ok ? "hint" : "error"; aiStatus.textContent = text; };
  let ai = s;
  const showProvider = () => {
    const p = ai.providers.find((x) => x.id === ai.ai_provider);
    const subscription = p.group === "subscription";
    q("#ai-about").innerHTML = aboutProvider(p, ai);
    q("#ai-key-field").hidden = !p.key;
    q("#ai-key").value = "";
    q("#ai-key").placeholder = ai.ai_key_set ? "A key is saved. Type to replace it." : "Paste your key";
    q("#ai-model").value = ai.ai_model;
    q("#ai-model").placeholder = subscription ? "Leave empty for the default model" : "Pick from the list or type its name";
    q("#list-models").hidden = subscription;
    q("#ai-models").innerHTML = "";
    q("#ai-base-field").hidden = p.kind !== "openai";
    q("#ai-base").value = ai.ai_base_url;
  };
  showProvider();
  // Picking a provider switches to it at once; its own key and model come back as you left them.
  q("#ai-provider").onchange = async (e) => {
    ai = await api("/settings", { method: "PUT", json: { ai_provider: e.target.value } });
    showProvider();
    say(ai.ai_ready ? "Switched. Use Test connection to check it works." : "Now finish setting it up below, then Save.");
  };
  const saveAi = async () => {
    const p = ai.providers.find((x) => x.id === ai.ai_provider);
    const json = { ai_model: q("#ai-model").value, ai_context: q("#ai-context").value, ai_vision: q("#ai-vision").checked };
    if (p.kind === "openai") json.ai_base_url = q("#ai-base").value;
    if (q("#ai-key").value) json.ai_api_key = q("#ai-key").value;
    ai = await api("/settings", { method: "PUT", json });
    return ai;
  };
  q("#ai-form").onsubmit = (e) => {
    e.preventDefault();
    busy(q("#ai-save"), "Saving…", async () => {
      await saveAi();
      showProvider();
      say(ai.ai_ready ? "Saved. Use Test connection to check it works."
        : ai.providers.find((x) => x.id === ai.ai_provider).group === "subscription" ? "Saved, but its app isn't installed yet (see above)."
        : !ai.ai_model ? "Saved. Now choose a model." : "Saved, but an API key is still needed.");
    });
  };
  // Ask the provider which models it has, so you pick a real name instead of guessing one.
  q("#list-models").onclick = (e) => busy(e.currentTarget, "Asking…", async () => {
    await saveAi();
    try {
      const { models } = await api("/ai/models");
      q("#ai-models").innerHTML = models.map((m) => `<option value="${esc(m)}">`).join("");
      say(models.length ? `${models.length} models available. Click the Model box to pick one, then Save.` : "The provider listed no models.");
      q("#ai-model").focus();
    } catch (err) { say(err.message, false); }
  });
  q("#ai-test").onclick = (e) => busy(e.currentTarget, "Asking the model…", async () => {
    await saveAi();
    const r = await api("/ai/test", { method: "POST" });
    say(r.message, r.ok);
  });
  const saveFolder = async (library_dir) => {
    const saved = await api("/settings", { method: "PUT", json: { library_dir } });
    app.querySelector("#folder").value = saved.library_dir;
    app.querySelector("#folder-status").innerHTML = status(saved.library_dir);
    toast(saved.library_dir ? "Library folder saved and filled." : "No longer keeping a copy in a folder.");
  };
  app.querySelector("#folder-choose").onclick = (e) => busy(e.currentTarget, "Choosing…", async () => {
    const field = app.querySelector("#folder");
    const path = await chooseFolder(field.value || field.placeholder);
    if (path) await saveFolder(path);
  });
  app.querySelector("#folder-form").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, "Saving…", async () => {
      await saveFolder(app.querySelector("#folder").value);
    });
  };
}
