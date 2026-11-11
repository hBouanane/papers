# Papers in a container.
#
#   docker build -t papers .
#   docker run -p 8000:8000 -v papers-data:/data papers
#
# or simply `docker compose up` (see docker-compose.yml). Then open http://localhost:8000.
# The database, PDFs and figures live in /data; mount a volume or a folder there to keep them.

FROM python:3.15-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PAPERS_DATA=/data \
    PAPERS_HOST=0.0.0.0 \
    PAPERS_PORT=8000

WORKDIR /src
COPY pyproject.toml README.md LICENSE ./
COPY papers ./papers
RUN pip install . && rm -rf /src

# Run as a normal user, not root.
RUN useradd --create-home --uid 1000 papers && mkdir -p /data /library && chown papers:papers /data /library
USER papers
WORKDIR /home/papers

VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')" || exit 1

CMD ["papers", "--no-browser"]
