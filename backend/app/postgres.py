"""Persistência PostgreSQL 18+, com as mesmas transações e regras do SQLite."""

from contextlib import contextmanager
import re
import unicodedata

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from .database import SCHEMA

# Mantém JSON como texto para compartilhar o repositório; PostgreSQL valida o conteúdo.
POSTGRES_SCHEMA = re.sub(r"CHECK\(json_valid\((\w+)\)\)", r"CHECK(\1::jsonb IS NOT NULL)", SCHEMA)


class PostgresConnection:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, query, parameters=()):
        # Somente SQL interno usa esta interface. Valores continuam separados e parametrizados.
        query = query.replace("%", "%%").replace("?", "%s")
        return self.connection.execute(query, parameters)


class PostgresDatabase:
    def __init__(self, url: str):
        self._url = url

    @contextmanager
    def connect(self):
        with psycopg.connect(self._url, row_factory=dict_row, connect_timeout=10,
                             prepare_threshold=None) as connection:
            yield PostgresConnection(connection)

    def initialize(self):
        # Reproduz a remoção de marcas Unicode e espaços de domain.normalize sem extensões.
        marks = "".join(chr(code) for code in range(0x110000)
                        if unicodedata.category(chr(code)) == "Mn")
        whitespace = "".join(chr(code) for code in range(0x3100) if chr(code).isspace())
        with self.connect() as adapter:
            connection = adapter.connection
            if connection.info.server_version < 180000:
                raise RuntimeError("Esta aplicação requer PostgreSQL 18 ou superior.")
            # A inicialização do schema é transacional e serializada entre processos.
            connection.execute("SELECT pg_advisory_xact_lock(7261646172)")
            connection.execute(sql.SQL("""
                CREATE OR REPLACE FUNCTION normalizar(value text) RETURNS text
                LANGUAGE sql IMMUTABLE STRICT AS $function$
                    SELECT btrim(casefold(translate(normalize(value, NFD), {marks}, '')
                                COLLATE pg_unicode_fast), {whitespace})
                $function$;
            """).format(marks=sql.Literal(marks), whitespace=sql.Literal(whitespace)))
            connection.execute("""
                CREATE OR REPLACE FUNCTION instr(value text, part text) RETURNS integer
                LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT strpos(value, part) $$;
            """)
            connection.execute(POSTGRES_SCHEMA)
