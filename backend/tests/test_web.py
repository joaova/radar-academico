"""Publicação da interface junto da API, com banco temporário."""

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi.testclient import TestClient

from app.config import Settings
from app.web import create_web_app


class WebTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.client = self.enterContext(TestClient(create_web_app(Settings(
            database_path=Path(directory.name) / "web.sqlite3", database_url=None, require_postgres=False,
        ))))

    def test_pages_and_assets_are_served(self):
        for path, content_type in (("/", "text/html"), ("/login.html", "text/html"),
                                   ("/app.js", "javascript"), ("/radar.css", "text/css")):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertIn(content_type, response.headers["content-type"])
        self.assertEqual(self.client.head("/login.html").content, b"")

    def test_deployed_config_uses_the_browser_origin(self):
        response = self.client.get("/config.js")
        self.assertEqual(response.status_code, 200)
        self.assertIn("window.location.origin", response.text)
        self.assertNotIn("127.0.0.1", response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_backend_and_private_files_are_not_exposed(self):
        for path in ("/.env", "/package.json", "/servir.mjs", "/tests/api.test.mjs",
                     "/backend/seed.json", "/%2e%2e/backend/seed.json", "/inexistente.html"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)

    def test_api_routes_remain_available(self):
        self.assertEqual(self.client.get("/api/saude").json(), {"status": "ok"})
        self.assertEqual(self.client.get("/api/perfil").status_code, 401)
        self.assertEqual(self.client.get("/openapi.json").status_code, 200)
