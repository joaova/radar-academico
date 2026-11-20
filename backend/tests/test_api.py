"""Integração HTTP in-process. Necessita requirements-dev.txt; não abre portas."""

from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter
import unittest

try:
    from fastapi.testclient import TestClient
except ModuleNotFoundError as error:
    if error.name not in ("fastapi", "httpx"):
        raise
    raise unittest.SkipTest("Instale requirements-dev.txt para executar a integração HTTP.") from error

from app.config import Settings
from app.main import create_app
from tests.helpers import complete_profile


class ApiTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.client = self.enterContext(TestClient(create_app(Settings(
            database_path=Path(directory.name) / "http.sqlite3",
        ))))
        self.user = self.client.post("/api/auth/cadastro", json={
            "nome": "Aluno", "email": "aluno@example.com", "senha": "senha-segura",
        }).json()
        token = self.client.post("/api/auth/login", json={
            "email": "aluno@example.com", "senha": "senha-segura",
        }).json()["access_token"]
        self.headers = {"Authorization": f"Bearer {token}"}

    def get(self, path, **kwargs):
        return self.client.get(path, headers=self.headers, **kwargs)

    def post(self, path, **kwargs):
        return self.client.post(path, headers=self.headers, **kwargs)

    def test_openapi_health_and_authentication_required(self):
        self.assertEqual(self.client.get("/api/saude").status_code, 200)
        self.assertEqual(self.client.get("/openapi.json").status_code, 200)
        for path in ("/api/perfil", "/api/oportunidades", "/api/oportunidades/filtros", "/api/simulacoes"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.headers["www-authenticate"], "Bearer")

    def test_registration_validation_duplicate_and_password_not_exposed(self):
        response = self.client.post("/api/auth/cadastro", json={
            "nome": "Outro", "email": " ALUNO@EXAMPLE.COM ", "senha": "senha-segura",
        })
        self.assertEqual(response.status_code, 409)
        response = self.client.post("/api/auth/cadastro", json={
            "nome": "Outro", "email": "invalido", "senha": "123",
        })
        self.assertEqual(response.status_code, 422)
        self.assertNotIn('"input"', response.text)
        self.assertNotIn("senha_hash", self.get("/api/auth/me").text)

    def test_login_logout_and_invalid_password(self):
        response = self.client.post("/api/auth/login", json={
            "email": "aluno@example.com", "senha": "senha-errada",
        })
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.post("/api/auth/logout").status_code, 204)
        self.assertEqual(self.get("/api/perfil").status_code, 401)

    def test_combined_filters_and_details(self):
        response = self.get("/api/oportunidades", params={
            "pais": "italia", "area": "Engenharia e Tecnologia", "idioma": "Inglês",
            "nivel": "graduação", "bolsa": "Auxílio mensal", "min": 6, "max": 6,
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["total"], 1)
        self.assertEqual(response.json()["itens"][0]["id"], "milano")
        self.assertEqual(self.get("/api/oportunidades/milano").status_code, 200)
        self.assertEqual(self.get("/api/oportunidades/filtros").status_code, 200)

    def test_unknown_filter_is_not_silently_ignored(self):
        response = self.get("/api/oportunidades", params={"orientador": "Fulano"})
        self.assertEqual(response.status_code, 422)
        self.assertIn("Critério de busca não disponível", response.json()["mensagem"])

    def test_empty_results_and_reset(self):
        response = self.get("/api/oportunidades", params={"pais": "Japão", "idioma": "Espanhol"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["itens"], [])
        self.assertIn("Altere ou remova", response.json()["mensagem"])
        self.assertEqual(self.get("/api/oportunidades").json()["total"], 6)

    def test_invalid_duration_and_pagination(self):
        for params in ({"min": 12, "max": 6}, {"min": 0}, {"min": "seis"}, {"limite": 101}):
            with self.subTest(params=params):
                self.assertEqual(self.get("/api/oportunidades", params=params).status_code, 422)

    def test_profile_validation_and_counts(self):
        response = self.client.put("/api/perfil", headers=self.headers, json=complete_profile(i3=11))
        self.assertEqual(response.status_code, 422)
        response = self.client.put("/api/perfil", headers=self.headers, json=complete_profile(
            creditos=None, creditos_concluidos=40, creditos_totais=100,
        ))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["creditos_percentual"], 40)

    def test_complete_profile_and_resimulate_preserves_first_result(self):
        first = self.post("/api/oportunidades/milano/simulacoes")
        self.assertEqual(first.status_code, 201, first.text)
        self.assertEqual(first.json()["situacao"], "incompleta")
        response = self.client.put("/api/perfil", headers=self.headers, json=complete_profile())
        self.assertEqual(response.status_code, 200, response.text)
        start = perf_counter()
        second = self.post("/api/oportunidades/milano/simulacoes")
        self.assertEqual(second.status_code, 201, second.text)
        self.assertLess(perf_counter() - start, 3)
        self.assertEqual(second.json()["indice"], 80)
        self.assertTrue(second.json()["candidatura_habilitada"])
        self.assertEqual(self.get(f"/api/simulacoes/{first.json()['id']}").json(), first.json())
        self.assertEqual(self.get("/api/simulacoes").json()["total"], 2)

    def test_insufficient_required_criterion(self):
        self.client.put("/api/perfil", headers=self.headers, json=complete_profile(i3=6.5))
        response = self.post("/api/oportunidades/milano/simulacoes")
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["situacao"], "incompativel")
        self.assertFalse(response.json()["candidatura_habilitada"])

    def test_other_user_cannot_read_saved_simulation(self):
        identifier = self.post("/api/oportunidades/milano/simulacoes").json()["id"]
        self.client.post("/api/auth/cadastro", json={
            "nome": "Outra", "email": "outra@example.com", "senha": "outra-senha",
        })
        token = self.client.post("/api/auth/login", json={
            "email": "outra@example.com", "senha": "outra-senha",
        }).json()["access_token"]
        response = self.client.get(f"/api/simulacoes/{identifier}", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(response.status_code, 404)

    def test_missing_opportunity_and_simulation(self):
        self.assertEqual(self.get("/api/oportunidades/inexistente").status_code, 404)
        self.assertEqual(self.post("/api/oportunidades/inexistente/simulacoes").status_code, 404)
        self.assertEqual(self.get("/api/simulacoes/inexistente").status_code, 404)

    def test_cors_for_local_frontend(self):
        response = self.client.options("/api/perfil", headers={
            "Origin": "http://127.0.0.1:8000", "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "Authorization,Content-Type",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://127.0.0.1:8000")


if __name__ == "__main__":
    unittest.main()

