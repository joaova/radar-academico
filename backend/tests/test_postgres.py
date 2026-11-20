"""Contrato HTTP em PostgreSQL real; use uma URL de banco exclusivo para testes."""

import os
import unittest
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import psycopg
from psycopg import sql

from app.config import Settings
from app.domain import normalize
from app.postgres import PostgresDatabase
from app.seed import seed_catalog
from tests import test_api


@unittest.skipUnless(os.environ.get("RADAR_TEST_POSTGRES_URL"), "Defina RADAR_TEST_POSTGRES_URL para testar PostgreSQL.")
class PostgresApiTests(test_api.ApiTests):
    def app_settings(self, path):
        url = os.environ["RADAR_TEST_POSTGRES_URL"]
        schema = "radar_test_" + uuid4().hex
        with psycopg.connect(url) as connection:
            connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))

        def cleanup():
            with psycopg.connect(url) as connection:
                connection.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))

        self.addCleanup(cleanup)
        parts = urlsplit(url)
        query = dict(parse_qsl(parts.query))
        query["options"] = f"-csearch_path={schema},public"
        self.database_url = urlunsplit(parts._replace(query=urlencode(query)))
        return Settings(database_url=self.database_url)

    def test_unicode_normalization_matches_local_database(self):
        database = self.client.app.state.database
        with database.connect() as connection:
            for value in (" ITÁLIA ", "INGLÊS", "München", "Straße", "İSTANBUL", "\u00a0PÓS-GRADUAÇÃO\t", "\u1ab0Á"):
                with self.subTest(value=value):
                    found = connection.execute("SELECT normalizar(?) AS value", (value,)).fetchone()
                    self.assertEqual(found["value"], normalize(value))

    def test_foreign_keys_and_transaction_rollback(self):
        database = self.client.app.state.database
        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            with database.connect() as connection:
                connection.execute("UPDATE usuarios SET nome = ? WHERE id = ?", ("Não persistir", self.user["id"]))
                connection.execute("INSERT INTO perfis VALUES(?,?,?)", ("inexistente", "{}", "2026-01-01"))
        self.assertEqual(self.get("/api/auth/me").json()["nome"], "Aluno")

    def test_reinitialization_preserves_account_session_and_seed(self):
        database = PostgresDatabase(self.database_url)
        database.initialize()
        seed_catalog(database)
        self.assertEqual(self.get("/api/auth/me").json()["id"], self.user["id"])
        self.assertEqual(self.get("/api/oportunidades").json()["total"], 6)


class PostgresSettingsTests(unittest.TestCase):
    def test_required_postgres_never_falls_back_to_local_sqlite(self):
        with self.assertRaisesRegex(ValueError, "Configure DATABASE_URL"):
            Settings(database_url=None, require_postgres=True)

    def test_connection_credentials_are_not_in_settings_repr_or_validation_error(self):
        settings = Settings(database_url="postgresql://user:segredo@localhost/radar")
        self.assertNotIn("segredo", repr(settings))
        with self.assertRaises(ValueError) as caught:
            Settings(database_url="https://user:segredo@localhost/radar")
        self.assertNotIn("segredo", str(caught.exception))
