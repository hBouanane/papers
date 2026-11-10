# Security

## Reporting a problem

Please don't open a public issue for a security problem. Report it privately instead: on GitHub, open the repository's
**Security** tab and choose **Report a vulnerability**. Say what you found, how to reproduce it, and what someone
could do with it. You'll get an answer within a week, and credit in the release notes if you'd like it.

Fixes go into the newest release; please update to it (`uvx papers-app@latest`, `pipx upgrade papers-app`, or
`docker pull ghcr.io/hbouanane/papers:latest`).

## How Papers is meant to be run

Papers is a personal app: it runs on your computer and has **no login**. Keep that in mind:

- By default it listens only on `127.0.0.1`, so only your computer can reach it. `--host 0.0.0.0` (and the Docker
  image) make it reachable by others on your network: do that only on networks you trust, or put it behind
  something that asks for a password.
- **API keys** are kept in your system's keychain (in the database only where there's none, such as Docker), are
  sent only to the provider they belong to, and are never sent back to the page.
- With a **subscription** (Claude, ChatGPT) the app runs the provider's own command-line tool, which signs in with
  your account. The app never reads or stores those credentials.
- **Interactive pages** written by the AI (off unless you turn them on in Settings) run in a sandboxed frame with no
  access to the app, your files, or the network. Formulas in the built-in widgets are evaluated by a locked-down
  math.js, never by `eval`.
- PDFs you add are parsed on your computer; the app downloads PDFs only from links you or a search result give it.

Problems in any of these are exactly what we'd like to hear about.
