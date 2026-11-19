"""The HTTP API, one module per area of the app. Each has a `router` that main.py includes."""
from papers.routes import chat, figure_play, goals, learning, notes, papers, reading, recall, settings

ROUTERS = [chat.router, papers.router, goals.router, reading.router, learning.router, notes.router, recall.router, settings.router,
           figure_play.router]
