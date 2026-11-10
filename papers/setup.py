"""The first-run setup in the terminal: a short banner, then a few questions, so it's clear from the start where
everything is kept and which AI writes the answers. Everything here can be changed later in Settings.

    papers            asks these the first time (in a terminal), then starts the app
    papers setup      asks again
    papers --no-setup skips it (it's also skipped when not in a terminal, e.g. Docker, or when --data is given)

Answers go where the app keeps them anyway: the data folder in config.json, the API key in the system keychain,
the provider, model and library folder in the database's settings.
"""
import os
import sys
import time
from pathlib import Path

from papers import __version__, config

LOGO = r"""
   ___  ___ ____  ___ ___  ___
  / _ \/ _ `/ _ \/ -_) __/(_-<
 / .__/\_,_/ .__/\__/_/  /___/
/_/       /_/
"""
INK = ["#9fb3f5", "#7b95ee", "#5a78e4", "#3d5fd6", "#2a4dc8", "#1d3fbb"]


def interactive() -> bool:
    return sys.stdin.isatty() and sys.stdout.isatty() and not os.environ.get("CI")


def needed() -> bool:
    """The first start in a terminal, unless the data folder was given (--data, PAPERS_DATA, Docker)."""
    return interactive() and not config.read_config().get("setup_done") and config.data_dir_source() != "env"


# ---------- The banner ----------
def banner(console) -> None:
    """The logo sweeps in from left to right in the app's ink blue, then the tagline types itself."""
    from rich.live import Live
    from rich.text import Text

    lines = LOGO.strip("\n").splitlines()
    width = max(len(line) for line in lines)

    def frame(shown: int) -> Text:
        t = Text()
        for line in lines:
            for i, ch in enumerate(line.ljust(width)):
                if i < shown:
                    t.append(ch, style=f"bold {INK[min(len(INK) - 1, max(0, (shown - i) // 3))]}")
                else:
                    t.append(" ")
            t.append("\n")
        return t

    if console.is_terminal and not os.environ.get("NO_COLOR"):
        with Live(frame(0), console=console, refresh_per_second=60, transient=False) as live:
            for shown in range(0, width + len(INK) * 3 + 1, 2):
                live.update(frame(shown))
                time.sleep(0.012)
        tagline = f"  an AI reading companion for research papers · v{__version__}"
        for i in range(0, len(tagline) + 1, 3):
            console.print(tagline[:i], style="dim", end="\r")
            time.sleep(0.008)
        console.print(tagline, style="dim")
    else:
        console.print(LOGO.strip("\n"), style="bold")
        console.print(f"  an AI reading companion for research papers · v{__version__}")
    console.print()


def step(console, n: int, total: int, title: str, about: str = "") -> None:
    console.print(f"[bold #3d5fd6]{n}/{total}[/]  [bold]{title}[/]")
    if about:
        console.print(f"     [dim]{about}[/]")


# ---------- The questions ----------
def ask_data_folder(console, q) -> Path:
    here = Path("data") if Path("data/papers.db").exists() else None
    usual = config.default_data_dir()
    documents = Path.home() / "Documents" / "Papers"
    choices = []
    if here:
        choices.append(q.Choice(f"Keep using the library found here   {here.resolve()}", str(here.resolve())))
    choices += [q.Choice(f"The usual place for app data   {usual}", str(usual)),
                q.Choice(f"In my Documents   {documents}", str(documents)),
                q.Choice("Somewhere else…", "")]
    picked = q.select("Where should Papers keep your library?", choices=choices, qmark="  ›").ask()
    if picked is None:
        raise KeyboardInterrupt
    while not picked:
        typed = q.path("Folder (full path):", only_directories=True, qmark="  ›").ask()
        if typed is None:
            raise KeyboardInterrupt
        if Path(typed).expanduser().is_absolute():
            picked = str(Path(typed).expanduser())
        else:
            console.print("     [yellow]Give a full path, like D:\\Papers or ~/Papers.[/]")
    folder = Path(picked)
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def ask_library_folder(console, q) -> str:
    suggested = Path.home() / "Documents" / "Papers Library"
    picked = q.select("Also keep a copy you can browse in your file manager?", qmark="  ›", choices=[
        q.Choice("No, not now", ""),
        q.Choice(f"Yes, in   {suggested}", str(suggested)),
        q.Choice("Yes, somewhere else…", "other")]).ask()
    if picked is None:
        raise KeyboardInterrupt
    if picked == "other":
        typed = q.path("Folder (full path):", only_directories=True, qmark="  ›").ask() or ""
        picked = str(Path(typed).expanduser()) if typed and Path(typed).expanduser().is_absolute() else ""
    return picked


def ask_ai(console, q) -> str | None:
    """Provider, key, model. Returns the provider id, or None for 'decide later'."""
    from papers import db, keys
    from papers.ai import providers

    groups = {"subscription": "your subscription", "key": "API key, pay per use", "local": "on this computer, free",
              "other": "other"}
    choices = []
    for group, label in groups.items():
        choices.append(q.Separator(f"  ── {label}"))
        for p in providers.PROVIDERS:
            if p["group"] == group:
                saved = " · key saved" if p["key"] and keys.get(f"ai_key:{p['id']}") else ""
                choices.append(q.Choice(f"{p['name']}{saved}", p["id"]))
    choices.append(q.Separator(" "))
    choices.append(q.Choice("Decide later in Settings", "later"))
    pid = q.select("Which AI should explain papers for you?", choices=choices, qmark="  ›",
                   default="later" if not providers.configured() else None).ask()
    if pid is None:
        raise KeyboardInterrupt
    if pid == "later":
        return None
    p = providers.BY_ID[pid]
    db.set_setting("ai_provider", pid)
    db.set_setting("ai_backend", p["kind"])

    if p["group"] == "subscription":
        found = providers.claude_binary() if pid == "claude-plan" else providers.codex_binary()
        if found:
            console.print(f"     [green]✓[/] found it at [dim]{found}[/]")
        else:
            how = "https://claude.com/claude-code" if pid == "claude-plan" else "npm install -g @openai/codex"
            console.print(f"     [yellow]Not installed yet.[/] Install it ({how}), sign in once, and it's ready.")
        return pid
    if p["key"]:
        has = keys.get(f"ai_key:{pid}")
        key = q.password(f"API key{' (Enter keeps the saved one)' if has else ''}:", qmark="  ›").ask()
        if key is None:
            raise KeyboardInterrupt
        if key.strip():
            keys.put(f"ai_key:{pid}", key.strip())
            console.print(f"     [green]✓[/] kept in {keys.where()}, never written to a file")
    if pid == "custom":
        base = q.text("Server address (like http://localhost:8080/v1):", qmark="  ›").ask() or ""
        db.set_setting(f"ai_base_url:{pid}", base.strip())

    models: list[str] = []
    with console.status("     asking the provider which models it has…", spinner="dots"):
        try:
            from papers import ai
            models = ai.list_models()
        except Exception:  # no key yet, server not running: just type a name
            models = []
    current = db.setting(f"ai_model:{pid}")
    if models:
        model = q.autocomplete(f"Model ({len(models)} available, type to filter):", choices=models,
                               default=current or "", qmark="  ›", match_middle=True).ask()
    else:
        model = q.text("Model name:", default=current or "", qmark="  ›").ask()
    if model is None:
        raise KeyboardInterrupt
    db.set_setting(f"ai_model:{pid}", model.strip())
    return pid


def check_ai(console) -> None:
    from papers import llm
    from papers.ai import providers
    with console.status("     asking the model a short question…", spinner="dots"):
        try:
            llm.search_queries("checking the connection")
            ok, msg = True, f"{providers.ai_name()} answered"
        except Exception as e:  # shown, not fatal: it can be fixed in Settings
            ok, msg = False, str(e)
    console.print(f"     [green]✓ {msg}[/]" if ok else f"     [yellow]! {msg}[/]  (fix it later in Settings)")


# ---------- The whole setup ----------
def run(console=None) -> None:
    import questionary as q
    from rich.console import Console
    from rich.panel import Panel

    console = console or Console()
    banner(console)
    console.print("  A few questions so you know where everything goes. You can change all of it later in Settings.\n")
    try:
        step(console, 1, 3, "Your library",
             "One folder holds everything: the database (papers, notes, highlights, goals), the PDFs and figure images.")
        data = ask_data_folder(console, q)
        config.write_config(data_dir=str(data.resolve()))
        from papers import db, keys, library
        db.init()
        console.print(f"     [green]✓[/] {data.resolve()}\n")

        step(console, 2, 3, "A folder you can browse (optional)",
             "Each goal a folder, each paper its PDF and a Markdown notes file. Opens in Obsidian as a graph.")
        lib = ask_library_folder(console, q)
        if lib:
            library.set_root(lib)
            console.print(f"     [green]✓[/] {lib}  (drop PDFs into its Inbox folder to add them)\n")
        else:
            console.print()

        step(console, 3, 3, "The AI model",
             "It writes key points, explanations, vocabulary and quizzes, and answers your questions.")
        pid = ask_ai(console, q)
        if pid:
            check_ai(console)
        console.print()

        from papers.ai import providers
        ai_line = f"{providers.ai_name()} through {providers.BY_ID[pid]['name']}" if pid else "not chosen yet (Settings › AI model)"
        console.print(Panel.fit(
            f"[bold]Library[/]        {data.resolve()}\n"
            f"[bold]Browsable copy[/] {lib or 'none'}\n"
            f"[bold]API keys[/]       {keys.where()}\n"
            f"[bold]AI[/]             {ai_line}\n\n"
            f"[dim]Change any of these in Settings, or run [bold]papers setup[/bold] again.[/]",
            title="[bold #3d5fd6]You're set[/]", border_style="#3d5fd6", padding=(1, 2)))
        config.write_config(setup_done=True)
    except KeyboardInterrupt:
        console.print("\n  [dim]Setup skipped; Papers uses its usual folders. Run [bold]papers setup[/bold] any time.[/]")
        config.write_config(setup_done=True)


def started(url: str, data: Path, console=None) -> None:
    """What's printed once the app is starting: where to open it and where the library is."""
    from rich.console import Console
    console = console or Console()
    console.print(f"\n  [bold #3d5fd6]●[/] Papers {__version__} is running at [bold link={url}]{url}[/]")
    console.print(f"    [dim]library: {data}   ·   Ctrl+C to stop[/]\n")
