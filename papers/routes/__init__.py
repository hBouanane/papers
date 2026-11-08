"""The HTTP API, one module per area of the app. Each has a `router` that main.py includes."""
from papers.routes import goals, learning, notes, papers, reading, recall, settings

ROUTERS = [papers.router, goals.router, reading.router, learning.router, notes.router, recall.router, settings.router]
