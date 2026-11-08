import json


class AIError(Exception):
    """Anything that kept the model from answering; the message is shown to the user as is."""


def json_in(text: str) -> dict:
    """The JSON object inside a model's text answer (models sometimes wrap it in prose or code fences)."""
    try:
        return json.loads(text[text.index("{"): text.rindex("}") + 1])
    except ValueError as e:
        raise AIError("The model didn't answer in the expected format. Try again, or choose a stronger model.") from e
