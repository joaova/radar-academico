"""Conexões curtas e transacionais. O schema inicial tem versão 1."""

from contextlib import contextmanager
from pathlib import Path
import sqlite3

from .domain import normalize

SCHEMA = """
CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS perfis (
    usuario_id TEXT PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    dados TEXT NOT NULL CHECK(json_valid(dados)),
    atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessoes (
    token_hash TEXT PRIMARY KEY,
    usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id);
CREATE TABLE IF NOT EXISTS oportunidades (
    id TEXT PRIMARY KEY,
    universidade TEXT NOT NULL,
    titulo TEXT NOT NULL,
    cidade TEXT NOT NULL,
    pais TEXT NOT NULL,
    area TEXT NOT NULL,
    meses INTEGER NOT NULL CHECK(meses > 0),
    nivel TEXT NOT NULL CHECK(nivel IN ('graduação', 'pós-graduação')),
    idioma TEXT NOT NULL,
    proficiencia TEXT NOT NULL,
    bolsa TEXT NOT NULL,
    beneficio TEXT NOT NULL,
    vagas INTEGER NOT NULL CHECK(vagas >= 0),
    ativa INTEGER NOT NULL CHECK(ativa IN (0,1)),
    data_limite TEXT NOT NULL,
    requisitos TEXT NOT NULL CHECK(json_valid(requisitos))
);
CREATE INDEX IF NOT EXISTS idx_oportunidades_ativas
    ON oportunidades(ativa, data_limite);
CREATE TABLE IF NOT EXISTS simulacoes (
    id TEXT PRIMARY KEY,
    usuario_id TEXT NOT NULL REFERENCES usuarios(id),
    oportunidade_id TEXT NOT NULL REFERENCES oportunidades(id),
    criado_em TEXT NOT NULL,
    resultado TEXT NOT NULL CHECK(json_valid(resultado)),
    perfil_snapshot TEXT NOT NULL CHECK(json_valid(perfil_snapshot)),
    oportunidade_snapshot TEXT NOT NULL CHECK(json_valid(oportunidade_snapshot))
);
CREATE INDEX IF NOT EXISTS idx_simulacoes_usuario
    ON simulacoes(usuario_id, criado_em DESC, id);
PRAGMA user_version = 1;
"""


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(str(self.path), timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.create_function("normalizar", 1, normalize, deterministic=True)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1):
                raise RuntimeError(f"Versão SQLite não suportada: {version}")
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(SCHEMA)

