"""A paper's notes and highlights."""
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator, model_validator

from papers import library, notes
from papers.store import get_paper

router = APIRouter(prefix="/api", tags=["notes"])

Color = Literal["yellow", "green", "blue", "pink"]


class NoteIn(BaseModel):
    kind: Literal["note", "highlight"] = "note"
    body: str = ""
    quote: str = ""
    color: Color = "yellow"
    page: int | None = None
    position: float = Field(0, ge=0, le=1)
    anchor: dict | None = None  # where a highlight sits in the PDF, so it can be drawn again

    @field_validator("body", "quote", mode="before")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v

    @model_validator(mode="after")
    def has_text(self):
        if self.kind == "note" and not self.body:
            raise ValueError("A note needs some text")
        if self.kind == "highlight" and not self.quote:
            raise ValueError("A highlight needs the highlighted text")
        return self


class NoteEdit(BaseModel):
    body: str | None = None
    color: Color | None = None

    @field_validator("body", mode="before")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v


def notes_changed(paper_id: int) -> None:
    library.refresh_notes_text(paper_id)
    library.sync_paper(paper_id, follow_parent=False)


def existing_note(note_id: int) -> dict:
    note = notes.get(note_id)
    if not note:
        raise HTTPException(404, "Note not found")
    return note


@router.get("/papers/{paper_id}/notes")
def list_notes(paper_id: int):
    get_paper(paper_id)
    return notes.list_for(paper_id)


@router.post("/papers/{paper_id}/notes", status_code=201)
def add_note(paper_id: int, body: NoteIn):
    get_paper(paper_id)
    note = notes.add(paper_id, **body.model_dump())
    notes_changed(paper_id)
    return note


@router.patch("/notes/{note_id}")
def edit_note(note_id: int, body: NoteEdit):
    note = existing_note(note_id)
    fields = body.model_dump(exclude_unset=True, exclude_none=True)
    if note["kind"] == "note" and fields.get("body") == "":
        raise HTTPException(422, "A note needs some text (delete it instead)")
    if fields:
        note = notes.edit(note_id, **fields)
        notes_changed(note["paper_id"])
    return note


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: int):
    note = existing_note(note_id)
    notes.delete(note_id)
    notes_changed(note["paper_id"])
    return Response(status_code=204)
