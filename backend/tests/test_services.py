from datetime import timedelta
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from time import perf_counter
import unittest

from app.database import Database
from app.domain import today
from app.errors import ApplicationError
from app.repository import Repository
from app.schemas import Profile, Simulation
from app.security import hash_password, token_digest, verify_password
from app.seed import seed_catalog
from app.services import AuthService, RadarService, utc_now
from tests.helpers import complete_profile


class ServiceTests(unittest.TestCase):
    """Persistência real em SQLite temporário, sem mocks de banco ou domínio."""

    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "test.sqlite3"
        self.db = Database(self.path)
        self.db.initialize()
        seed_catalog(self.db)
        self.auth = AuthService(self.db)
        self.radar = RadarService(self.db)
        self.user = self.auth.register("Aluno", "aluno@example.com", "senha-segura")
        self.user_id = self.user["id"]

    def assert_application_error(self, status, callback):
        with self.assertRaises(ApplicationError) as caught:
            callback()
        self.assertEqual(caught.exception.status, status)
        return caught.exception

    def test_registration_is_atomic_and_email_unique(self):
        self.assert_application_error(409, lambda: self.auth.register("Outro", self.user["email"], "outra-senha"))
        with self.db.connect() as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM usuarios").fetchone()[0], 1)
            self.assertEqual(conn.execute("SELECT count(*) FROM perfis").fetchone()[0], 1)

    def test_password_hashes_use_distinct_salts_and_not_plaintext(self):
        with self.db.connect() as conn:
            stored = Repository(conn).user_by_email(self.user["email"])["senha_hash"]
        self.assertNotIn("senha-segura", stored)
        self.assertTrue(verify_password("senha-segura", stored))
        self.assertFalse(verify_password("senha-errada", stored))
        self.assertNotEqual(stored, hash_password("senha-segura"))
        self.assertNotIn("senha_hash", self.user)

    def test_login_valid_invalid_and_unknown_user(self):
        result = self.auth.login(self.user["email"], "senha-segura")
        self.assertEqual(result["usuario"], self.user)
        self.assertEqual(self.auth.authenticate(result["access_token"]), self.user)
        self.assertNotIn("senha_hash", result["usuario"])
        self.assert_application_error(401, lambda: self.auth.login(self.user["email"], "senha-errada"))
        self.assert_application_error(401, lambda: self.auth.login("outro@example.com", "senha-segura"))

    def test_token_is_hashed_at_rest(self):
        token = self.auth.login(self.user["email"], "senha-segura")["access_token"]
        with self.db.connect() as conn:
            stored = conn.execute("SELECT token_hash FROM sessoes").fetchone()[0]
        self.assertNotEqual(token, stored)
        self.assertEqual(token_digest(token), stored)

    def test_expired_invalid_and_missing_tokens(self):
        token = self.auth.login(self.user["email"], "senha-segura")["access_token"]
        with self.db.connect() as conn:
            conn.execute("UPDATE sessoes SET expira_em = ?", ((utc_now() - timedelta(seconds=1)).isoformat(),))
        for value in (token, "aleatorio", "", "x" * 201):
            with self.subTest(value=value[:8]):
                self.assert_application_error(401, lambda: self.auth.authenticate(value))

    def test_logout_revokes_only_current_session(self):
        first = self.auth.login(self.user["email"], "senha-segura")["access_token"]
        second = self.auth.login(self.user["email"], "senha-segura")["access_token"]
        self.auth.logout(first)
        self.assert_application_error(401, lambda: self.auth.authenticate(first))
        self.assertEqual(self.auth.authenticate(second)["id"], self.user_id)

    def test_profile_update_and_credit_counts(self):
        profile = Profile(**complete_profile(creditos=None, creditos_concluidos=80, creditos_totais=200))
        result = self.radar.update_profile(self.user_id, profile.model_dump(mode="json"))
        self.assertEqual(result["creditos_percentual"], 40)
        self.assertEqual(result["documentos"]["historico_escolar"], "historico-escolar.pdf")
        with self.db.connect() as conn:
            self.assertEqual(Repository(conn).user_by_email(self.user["email"])["nome"], "Estudante")

    def test_unknown_profile(self):
        self.assert_application_error(404, lambda: self.radar.get_profile("inexistente"))
        self.assert_application_error(404, lambda: self.radar.update_profile("inexistente", complete_profile()))

    def test_simulation_is_recorded_and_snapshots_are_immutable(self):
        first = self.radar.simulate(self.user_id, "milano")
        self.assertEqual(first["situacao"], "incompleta")
        self.radar.update_profile(self.user_id, complete_profile())
        second = self.radar.simulate(self.user_id, "milano")
        self.assertEqual(second["situacao"], "compativel")
        self.assertEqual(second["indice"], 80)
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(self.radar.simulation(self.user_id, first["id"]), first)
        with self.db.connect() as conn:
            conn.execute("UPDATE oportunidades SET titulo = ? WHERE id = ?", ("Título alterado", "milano"))
        self.assertEqual(self.radar.simulation(self.user_id, second["id"]), second)
        Simulation.model_validate(second)
        self.assertEqual(self.radar.history(self.user_id, {"limite": 1, "offset": 0})["total"], 2)

    def test_users_do_not_share_profiles_or_history(self):
        other = self.auth.register("Outra", "outra@example.com", "outra-senha")
        self.radar.update_profile(self.user_id, complete_profile())
        simulation = self.radar.simulate(self.user_id, "milano")
        self.assertIsNone(self.radar.get_profile(other["id"])["i3"])
        self.assertEqual(self.radar.history(other["id"], {"limite": 20, "offset": 0})["total"], 0)
        self.assert_application_error(404, lambda: self.radar.simulation(other["id"], simulation["id"]))

    def test_restart_preserves_profiles_sessions_results_and_seed_deadline(self):
        self.radar.update_profile(self.user_id, complete_profile())
        token = self.auth.login(self.user["email"], "senha-segura")["access_token"]
        result = self.radar.simulate(self.user_id, "milano")
        with self.db.connect() as conn:
            conn.execute("UPDATE oportunidades SET data_limite = ? WHERE id = ?", (today().isoformat(), "milano"))
        reopened = Database(self.path)
        reopened.initialize()
        seed_catalog(reopened)
        self.assertEqual(RadarService(reopened).simulation(self.user_id, result["id"]), result)
        self.assertEqual(AuthService(reopened).authenticate(token)["id"], self.user_id)
        self.assertEqual(RadarService(reopened).get_profile(self.user_id)["i3"], 8)
        self.assertEqual(RadarService(reopened).opportunity("milano")["data_limite"], today().isoformat())

    def test_missing_inactive_and_expired_opportunities(self):
        self.assert_application_error(404, lambda: self.radar.opportunity("inexistente"))
        self.assert_application_error(404, lambda: self.radar.simulate(self.user_id, "inexistente"))
        with self.db.connect() as conn:
            conn.execute("UPDATE oportunidades SET ativa = 0 WHERE id = 'milano'")
        self.assert_application_error(409, lambda: self.radar.simulate(self.user_id, "milano"))
        with self.db.connect() as conn:
            conn.execute("UPDATE oportunidades SET ativa = 1, data_limite = ? WHERE id = 'milano'",
                         ((today() - timedelta(days=1)).isoformat(),))
        self.assert_application_error(409, lambda: self.radar.opportunity("milano"))
        self.assert_application_error(409, lambda: self.radar.simulate(self.user_id, "milano"))
        self.assertEqual(self.radar.history(self.user_id, {"limite": 20, "offset": 0})["total"], 0)

    def test_successive_filters_use_and_and_removal_restores_catalog(self):
        filters = {"area": "Engenharia e Tecnologia", "pais": "Itália", "idioma": "Inglês",
                   "nivel": "graduação", "bolsa": "Auxílio mensal", "min": 6, "max": 6}
        result = self.radar.catalog(filters)
        self.assertEqual([item["id"] for item in result["itens"]], ["milano"])
        self.assertEqual(self.radar.catalog({**filters, "pais": "Japão"})["total"], 0)
        self.assertEqual(self.radar.catalog({})["total"], 6)

    def test_no_results_has_explanatory_message(self):
        result = self.radar.catalog({"pais": "Japão", "idioma": "Espanhol"})
        self.assertEqual(result["total"], 0)
        self.assertEqual(result["itens"], [])
        self.assertIn("Altere ou remova", result["mensagem"])

    def test_duration_limits_are_inclusive(self):
        self.assertEqual(self.radar.catalog({"min": 6, "max": 6})["total"], 4)
        self.assertEqual(self.radar.catalog({"min": 12, "max": 12})["total"], 2)
        self.assertEqual(self.radar.catalog({"min": 7, "max": 11})["total"], 0)

    def test_normalization_multi_term_search_and_literal_sql_input(self):
        self.assertEqual(self.radar.catalog({"pais": "italia", "idioma": "INGLES"})["total"], 1)
        self.assertEqual(self.radar.catalog({"busca": "milao computacao"})["total"], 1)
        for term in ("%", "_", "' OR 1=1 --", "orientador inexistente"):
            with self.subTest(term=term):
                self.assertEqual(self.radar.catalog({"busca": term})["total"], 0)

    def test_pagination_has_stable_order_and_total(self):
        all_items = self.radar.catalog({})["itens"]
        first = self.radar.catalog({"limite": 2, "offset": 0})
        second = self.radar.catalog({"limite": 2, "offset": 2})
        self.assertEqual(first["total"], 6)
        self.assertEqual(first["itens"] + second["itens"], all_items[:4])
        beyond = self.radar.catalog({"offset": 100})
        self.assertEqual(beyond["itens"], [])
        self.assertEqual(beyond["total"], 6)

    def test_inactive_expired_and_last_day_in_catalog_and_filter_options(self):
        with self.db.connect() as conn:
            conn.execute("UPDATE oportunidades SET ativa = 0 WHERE id = 'paris'")
            conn.execute("UPDATE oportunidades SET data_limite = ? WHERE id = 'munique'",
                         ((today() - timedelta(days=1)).isoformat(),))
            conn.execute("UPDATE oportunidades SET data_limite = ? WHERE id = 'milano'", (today().isoformat(),))
        ids = {item["id"] for item in self.radar.catalog({})["itens"]}
        self.assertIn("milano", ids)
        self.assertNotIn("paris", ids)
        self.assertNotIn("munique", ids)
        options = self.radar.filter_options()
        self.assertNotIn("França", options["pais"])
        self.assertNotIn("Alemanha", options["pais"])
        self.assertEqual(options["duracao"], {"min": 6, "max": 12})

    def test_empty_catalog_without_seed(self):
        empty = Database(Path(self.directory.name) / "empty.sqlite3")
        empty.initialize()
        radar = RadarService(empty)
        self.assertEqual(radar.catalog({})["total"], 0)
        self.assertEqual(radar.filter_options()["duracao"], {"min": None, "max": None})

    def test_foreign_keys_and_rollback(self):
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db.connect() as conn:
                conn.execute("UPDATE usuarios SET nome = 'Não persistir' WHERE id = ?", (self.user_id,))
                conn.execute("INSERT INTO perfis VALUES(?,?,?)", ("inexistente", "{}", utc_now().isoformat()))
        with self.db.connect() as conn:
            self.assertEqual(Repository(conn).user_by_email(self.user["email"])["nome"], "Aluno")

    def test_rnf01_simulation_under_three_seconds(self):
        self.radar.update_profile(self.user_id, complete_profile())
        start = perf_counter()
        result = self.radar.simulate(self.user_id, "milano")
        elapsed = perf_counter() - start
        self.assertTrue(result["elegivel"])
        self.assertLess(elapsed, 3, f"Simulação levou {elapsed:.3f}s")


if __name__ == "__main__":
    unittest.main()

