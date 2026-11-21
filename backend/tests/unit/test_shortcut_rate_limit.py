import unittest

from fastapi.testclient import TestClient

from app.main import app
from app.rate_limit import limiter


class ShortcutRateLimitTests(unittest.TestCase):
    def setUp(self):
        limiter.reset()

    def tearDown(self):
        limiter.reset()

    def test_429_keeps_the_shortcut_message_contract(self):
        # No lifespan: requests fail auth before touching the database, which
        # is enough to exhaust the 30/minute limit on /shortcuts/add.
        client = TestClient(app)
        headers = {"X-Real-IP": "203.0.113.7"}
        for _ in range(30):
            self.assertEqual(
                client.post("/api/v1/shortcuts/add", json={"amount": 5}, headers=headers).status_code,
                401,
            )
        response = client.post("/api/v1/shortcuts/add", json={"amount": 5}, headers=headers)
        self.assertEqual(response.status_code, 429)
        body = response.json()
        self.assertFalse(body["ok"])
        self.assertIn("Too many requests", body["message"])

    def test_other_clients_are_not_throttled(self):
        client = TestClient(app)
        for _ in range(31):
            client.post("/api/v1/shortcuts/add", json={}, headers={"X-Real-IP": "203.0.113.8"})
        response = client.post("/api/v1/shortcuts/add", json={}, headers={"X-Real-IP": "203.0.113.9"})
        self.assertEqual(response.status_code, 401)
