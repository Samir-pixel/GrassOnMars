from pydantic import SecretStr

from app.core.config import settings
from app.integrations import gemini


class _Response:
    def __init__(self, status_code: int, payload: dict) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict:
        return self._payload


def test_assistant_ask_uses_native_header_and_hides_the_key(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "gemini_api_key", SecretStr("AQ.test-key"))
    seen: dict = {}

    class _Client:
        def post(self, url, headers, json, timeout):
            seen.update(url=url, headers=headers, json=json, timeout=timeout)
            return _Response(
                200,
                {"candidates": [{"content": {"parts": [{"thought": True, "text": "hidden"}, {"text": "Jezero ranks first."}]}}]},
            )

    monkeypatch.setattr(gemini, "shared_client", lambda: _Client())
    response = client.post("/api/v1/assistant/ask", json={"prompt": "User: Why Jezero?\nZyro:"})
    assert response.status_code == 200
    assert response.json() == {"text": "Jezero ranks first."}
    assert seen["headers"]["x-goog-api-key"] == "AQ.test-key"
    assert "Authorization" not in seen["headers"]
    assert "ONLY questions about Mars" in seen["json"]["systemInstruction"]["parts"][0]["text"]
    assert seen["json"]["generationConfig"]["thinkingConfig"]["thinkingBudget"] == 0
    assert "AQ.test-key" not in response.text


def test_assistant_without_key_is_503(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "gemini_api_key", None)
    response = client.post("/api/v1/assistant/ask", json={"prompt": "Hi"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "GEMINI_NOT_CONFIGURED"
