"""The first-run setup in the terminal: a short banner, then two questions: where your papers go as normal files
(PDFs and notes you can open yourself), and which AI writes the answers. The app's own data folder isn't asked
about: it goes to the usual place and is shown at the end. Everything here can be changed later in Settings.

    papers            asks these the first time (in a terminal), then starts the app
    papers setup      asks again
    papers --no-setup skips it (it's also skipped when not in a terminal, e.g. Docker, or when --data is given)

Answers go where the app keeps them anyway: the data folder in config.json, the API key in the system keychain,
the provider, model and library folder in the database's settings.

How it looks: one welcome box, then each step as a bullet with its lines hanging under it,

    ● Your papers as normal files  1 of 2
      ⎿  A folder per goal, each paper's PDF under its real title…
      ? Where should this folder go?
      ❯ C:\\Users\\you\\Documents\\Papers
        Somewhere else…
      ⎿  ✓ C:\\Users\\you\\Documents\\Papers

and a closing box with where everything ended up. One accent colour (the app's blue), dim for what's secondary.
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
BLUE = "#6f8cf0"  # the accent, light enough for dark terminals and dark enough for light ones


def interactive() -> bool:
    return sys.stdin.isatty() and sys.stdout.isatty() and not os.environ.get("CI")


def needed() -> bool:
    """The first start in a terminal, unless the data folder was given (--data, PAPERS_DATA, Docker)."""
    return interactive() and not config.read_config().get("setup_done") and config.data_dir_source() != "env"


# ---------- The look ----------
def glyphs(console) -> dict:
    """The marks used everywhere; plain ones for old Windows consoles that can't draw the others."""
    fancy = (console.encoding or "").lower().startswith("utf") and not console.legacy_windows
    return ({"dot": "●", "elbow": "⎿", "pointer": "❯", "tick": "✓", "mark": "✻"} if fancy
            else {"dot": "*", "elbow": "-", "pointer": ">", "tick": "ok", "mark": "*"})


def prompt_look(console) -> dict:
    """How every question is drawn: a blue ?, the pointer on the current choice, the answer in blue."""
    from questionary import Style
    return {"qmark": "  ?", "style": Style([
        ("qmark", f"fg:{BLUE} bold"), ("question", "bold"), ("pointer", f"fg:{BLUE} bold"),
        ("highlighted", f"fg:{BLUE} bold"), ("answer", f"fg:{BLUE}"), ("instruction", "fg:#808080"),
        ("separator", "fg:#808080"), ("text", ""), ("selected", "")])}


def step(console, n: int, total: int, title: str, *about: str) -> None:
    """A step's heading, with what it's about hanging under it."""
    g = glyphs(console)
    console.print(f"[bold {BLUE}]{g['dot']}[/] [bold]{title}[/]  [dim]{n} of {total}[/]")
    for i, line in enumerate(about):
        hang(console, f"[dim]{line}[/]", first=i == 0)


def hang(console, markup: str, first: bool = True) -> None:
    """A line under the current step: `  ⎿  text`, wrapped so long text stays in its column."""
    from rich.table import Table
    grid = Table.grid(padding=(0, 2))
    grid.add_column(width=3, no_wrap=True)
    grid.add_column(overflow="fold")
    grid.add_row(f"  [dim]{glyphs(console)['elbow'] if first else ' '}[/]", markup)
    console.print(grid)


def good(console, text: str) -> None:
    hang(console, f"[green]{glyphs(console)['tick']}[/] {text}")


def careful(console, text: str) -> None:
    hang(console, f"[yellow]![/] {text}")


def banner(console) -> None:
    """The logo sweeps in from left to right in the app's blue, then the welcome box."""
    from rich import box
    from rich.live import Live
    from rich.panel import Panel
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

    console.print()
    if console.is_terminal and not os.environ.get("NO_COLOR"):
        with Live(frame(0), console=console, refresh_per_second=60, transient=False) as live:
            for shown in range(0, width + len(INK) * 3 + 1, 2):
                live.update(frame(shown))
                time.sleep(0.012)
    else:
        console.print(LOGO.strip("\n"), style="bold")
        console.print()
    g = glyphs(console)
    console.print(Panel.fit(
        f"[bold {BLUE}]{g['mark']}[/] [bold]Welcome to Papers[/]  [dim]v{__version__}[/]\n\n"
        "An AI reading companion for research papers.\n"
        "[dim]Two questions, then it opens in your browser.[/]",
        box=box.ROUNDED, border_style=BLUE, padding=(0, 2)))
    console.print("  [dim]↑↓ to move · Enter to choose · Ctrl+C to skip the setup[/]\n"
                  if g["dot"] == "●" else "  [dim]arrows to move, Enter to choose, Ctrl+C to skip the setup[/]\n")


# ---------- The questions ----------
def overlaps(folder: Path, data: Path) -> bool:
    """The browsable folder must not be the app's data folder, inside it, or around it: the two would mix."""
    folder, data = folder.resolve(), data.resolve()
    return folder == data or data in folder.parents or folder in data.parents


def ask_library_folder(console, q, data: Path, current: Path | None = None) -> str:
    """Where your papers go as normal files. Returns the folder, or "" for not now."""
    look, pointer = prompt_look(console), glyphs(console)["pointer"]
    suggested = Path.home() / "Documents" / "Papers"
    if overlaps(suggested, data):
        suggested = Path.home() / "Documents" / "Papers Library"
    choices = []
    if current and not overlaps(current, data):
        choices.append(q.Choice(f"Keep   {current}", str(current)))
    if not current or current.resolve() != suggested.resolve():
        choices.append(q.Choice(f"{suggested}", str(suggested)))
    choices += [q.Choice("Somewhere else…", "other"), q.Choice("Stop keeping this folder" if current else "Not now", "")]
    picked = q.select("Where should this folder go?", choices=choices, pointer=pointer, **look).ask()
    if picked is None:
        raise KeyboardInterrupt
    while picked == "other":
        typed = q.path("Folder (full path, or leave empty to skip):", only_directories=True, **look).ask()
        if typed is None:
            raise KeyboardInterrupt
        folder = Path(typed.strip()).expanduser()
        if not typed.strip():
            picked = ""
        elif not folder.is_absolute():
            careful(console, "Give a full path, like D:\\Papers or ~/Papers.")
        elif overlaps(folder, data):
            careful(console, f"That's where Papers keeps its own data ({data.resolve()}). Pick another folder.")
        else:
            picked = str(folder)
    return picked


def ask_ai(console, q) -> str | None:
    """Provider, key, model. Returns the provider id, or None for 'decide later'."""
    from papers import db, keys
    from papers.ai import providers

    look, pointer = prompt_look(console), glyphs(console)["pointer"]
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
    pid = q.select("Which AI should explain papers for you?", choices=choices, pointer=pointer,
                   default="later" if not providers.configured() else None, **look).ask()
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
            good(console, f"found it at [dim]{found}[/]")
        else:
            how = "https://claude.com/claude-code" if pid == "claude-plan" else "npm install -g @openai/codex"
            careful(console, f"Not installed yet. Install it ({how}), sign in once, and it's ready.")
        return pid
    if p["key"]:
        has = keys.get(f"ai_key:{pid}")
        key = q.password(f"API key{' (Enter keeps the saved one)' if has else ''}:", **look).ask()
        if key is None:
            raise KeyboardInterrupt
        if key.strip():
            keys.put(f"ai_key:{pid}", key.strip())
            good(console, f"kept in {keys.where()}, never written to a file")
    if pid == "custom":
        base = q.text("Server address (like http://localhost:8080/v1):", **look).ask() or ""
        db.set_setting(f"ai_base_url:{pid}", base.strip())

    models: list[str] = []
    with console.status("  [dim]asking the provider which models it has…[/]", spinner="dots", spinner_style=BLUE):
        try:
            from papers import ai
            models = ai.list_models()
        except Exception:  # no key yet, server not running: just type a name
            models = []
    current = db.setting(f"ai_model:{pid}")
    if models:
        model = q.autocomplete(f"Model ({len(models)} available, type to filter):", choices=models,
                               default=current or "", match_middle=True, **look).ask()
    else:
        model = q.text("Model name:", default=current or "", **look).ask()
    if model is None:
        raise KeyboardInterrupt
    db.set_setting(f"ai_model:{pid}", model.strip())
    return pid


def check_ai(console) -> None:
    from papers import llm
    from papers.ai import providers
    with console.status("  [dim]asking the model a short question…[/]", spinner="dots", spinner_style=BLUE):
        try:
            llm.search_queries("checking the connection")
            ok, msg = True, f"{providers.ai_name()} answered"
        except Exception as e:  # shown, not fatal: it can be fixed in Settings
            ok, msg = False, str(e)
    if ok:
        good(console, msg)
    else:
        careful(console, f"{msg}  [dim](fix it later in Settings)[/]")


# ---------- The whole setup ----------
def run(console=None) -> None:
    import questionary as q
    from rich import box
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table

    console = console or Console()
    g = glyphs(console)
    banner(console)
    try:
        # The app's own data (database, PDFs, figures) goes to the usual place without asking.
        data = config.data_dir()
        data.mkdir(parents=True, exist_ok=True)
        if config.data_dir_source() != "env":  # --data and PAPERS_DATA are for this run only
            config.write_config(data_dir=str(data.resolve()))
        from papers import db, keys, library
        db.init()

        step(console, 1, 2, "Your papers as normal files",
             "A folder per goal, each paper's PDF under its real title, and a notes file per paper.",
             "Open it in your file manager, any editor, or Obsidian. Papers keeps this copy up to date, "
             "and a PDF dropped into its Inbox gets added.")
        lib = ask_library_folder(console, q, data, library.root())
        library.set_root(lib)
        if lib:
            good(console, lib)
        else:
            hang(console, "[dim]Skipped. You can turn this on in Settings.[/]")
        console.print()

        step(console, 2, 2, "The AI model",
             "It writes key points, explanations, vocabulary and quizzes, and answers your questions.")
        pid = ask_ai(console, q)
        if pid:
            check_ai(console)
        else:
            hang(console, "[dim]Not chosen. Reading, highlights and notes work without it.[/]")
        console.print()

        from papers.ai import providers
        ai_line = f"{providers.ai_name()} through {providers.BY_ID[pid]['name']}" if pid else "not chosen yet (Settings › AI model)"
        summary = Table.grid(padding=(0, 3))
        summary.add_column(style="dim", no_wrap=True)
        summary.add_column(overflow="fold")
        summary.add_row("Your papers", lib or "no folder yet")
        summary.add_row("AI", ai_line)
        summary.add_row("API keys", keys.where())
        summary.add_row("App data", str(data.resolve()))
        console.print(Panel.fit(summary, title=f"[bold {BLUE}]{g['tick']} You're set[/]", title_align="left",
                                box=box.ROUNDED, border_style=BLUE, padding=(1, 2)))
        console.print("  [dim]Change any of these in Settings, or run[/] [bold]papers setup[/] [dim]again.[/]")
        config.write_config(setup_done=True)
    except KeyboardInterrupt:
        console.print("\n  [dim]Setup skipped; Papers uses its usual folders. Run[/] [bold]papers setup[/] [dim]any time.[/]")
        config.write_config(setup_done=True)


def started(url: str, data: Path, console=None) -> None:
    """What's printed once the app is starting: where to open it and where the library is."""
    from rich.console import Console
    console = console or Console()
    console.print(f"\n[bold {BLUE}]{glyphs(console)['dot']}[/] [bold]Papers {__version__} is running[/]")
    hang(console, f"[bold link={url}]{url}[/]")
    hang(console, f"[dim]data in {data} · Ctrl+C to stop[/]")
    console.print()
