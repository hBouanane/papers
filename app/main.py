from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import db


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    yield


app = FastAPI(title="Papers", lifespan=lifespan)


@app.get("/api/health")
def health():
    return {"ok": True}
