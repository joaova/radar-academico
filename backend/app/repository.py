"""SQL parametrizado; somente nomes de colunas internos entram nas consultas."""

import json

from .domain import normalize, today


def dump(value) -> str:
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def opportunity_from_row(row) -> dict:
    result = dict(row)
    result["ativa"] = bool(result["ativa"])
    result["requisitos"] = json.loads(result["requisitos"])
    return result


def simulation_from_row(row) -> dict:
    result = dict(row)
    return {"id": result["id"], "usuario_id": result["usuario_id"],
            "oportunidade_id": result["oportunidade_id"], "criado_em": result["criado_em"],
            **json.loads(result["resultado"]),
            "perfil_snapshot": json.loads(result["perfil_snapshot"]),
            "oportunidade_snapshot": json.loads(result["oportunidade_snapshot"])}


class Repository:
    def __init__(self, connection):
        self.connection = connection

    def user_by_email(self, email):
        row = self.connection.execute("SELECT * FROM usuarios WHERE email = ?", (email,)).fetchone()
        return dict(row) if row else None

    def register(self, user: dict, profile: dict):
        self.connection.execute(
            "INSERT INTO usuarios(id,nome,email,senha_hash,criado_em) VALUES(?,?,?,?,?)",
            (user["id"], user["nome"], user["email"], user["senha_hash"], user["criado_em"]),
        )
        self.connection.execute(
            "INSERT INTO perfis(usuario_id,dados,atualizado_em) VALUES(?,?,?)",
            (user["id"], dump(profile), user["criado_em"]),
        )

    def add_session(self, digest, user_id, expiration, now):
        self.connection.execute("DELETE FROM sessoes WHERE expira_em <= ?", (now,))
        self.connection.execute("INSERT INTO sessoes VALUES(?,?,?)", (digest, user_id, expiration))

    def session_user(self, digest, now):
        row = self.connection.execute(
            "SELECT u.* FROM usuarios u JOIN sessoes s ON u.id = s.usuario_id "
            "WHERE s.token_hash = ? AND s.expira_em > ?", (digest, now),
        ).fetchone()
        return dict(row) if row else None

    def revoke_session(self, digest):
        self.connection.execute("DELETE FROM sessoes WHERE token_hash = ?", (digest,))

    def profile(self, user_id):
        row = self.connection.execute("SELECT * FROM perfis WHERE usuario_id = ?", (user_id,)).fetchone()
        return {"dados": json.loads(row["dados"]), "atualizado_em": row["atualizado_em"]} if row else None

    def update_profile(self, user_id, profile, now):
        self.connection.execute("UPDATE perfis SET dados = ?, atualizado_em = ? WHERE usuario_id = ?",
                                (dump(profile), now, user_id))
        self.connection.execute("UPDATE usuarios SET nome = ? WHERE id = ?", (profile["nome"], user_id))

    def opportunity(self, opportunity_id):
        row = self.connection.execute("SELECT * FROM oportunidades WHERE id = ?", (opportunity_id,)).fetchone()
        return opportunity_from_row(row) if row else None

    def catalog(self, filters: dict, on_date=None):
        clauses = ["ativa = 1", "data_limite >= ?"]
        values = [(on_date or today()).isoformat()]
        for field in ("nivel", "area", "idioma", "pais", "bolsa"):
            if filters.get(field):
                clauses.append(f"normalizar({field}) = ?")
                values.append(normalize(filters[field]))
        for field, operator in (("min", ">="), ("max", "<=")):
            if filters.get(field) is not None:
                clauses.append(f"meses {operator} ?")
                values.append(filters[field])
        for term in normalize(filters.get("busca", "")).split():
            # instr trata %, _ e aspas literalmente, sem alterar a consulta.
            clauses.append("instr(normalizar(universidade || ' ' || titulo || ' ' || cidade), ?) > 0")
            values.append(term)
        where = " AND ".join(clauses)
        total = self.connection.execute(
            f"SELECT count(*) AS total FROM oportunidades WHERE {where}", values,
        ).fetchone()["total"]
        rows = self.connection.execute(
            f"SELECT * FROM oportunidades WHERE {where} ORDER BY id LIMIT ? OFFSET ?",
            (*values, filters.get("limite", 20), filters.get("offset", 0)),
        ).fetchall()
        return [opportunity_from_row(row) for row in rows], total

    def filter_options(self):
        rows = self.connection.execute(
            "SELECT area,idioma,pais,bolsa,nivel,meses FROM oportunidades "
            "WHERE ativa = 1 AND data_limite >= ?", (today().isoformat(),),
        ).fetchall()
        options = {field: sorted({r[field] for r in rows}, key=normalize)
                   for field in ("area", "idioma", "pais", "bolsa", "nivel")}
        months = [r["meses"] for r in rows]
        return {**options, "duracao": {"min": min(months) if months else None,
                                        "max": max(months) if months else None}}

    def add_opportunity(self, opportunity):
        columns = ("id", "universidade", "titulo", "cidade", "pais", "area", "meses", "nivel",
                   "idioma", "proficiencia", "bolsa", "beneficio", "vagas", "ativa", "data_limite")
        self.connection.execute(
            f"INSERT INTO oportunidades({','.join(columns)},requisitos) "
            f"VALUES({','.join('?' for _ in range(len(columns) + 1))})",
            (*[int(opportunity[c]) if c == "ativa" else opportunity[c] for c in columns],
             dump(opportunity["requisitos"])),
        )

    def save_simulation(self, identifier, user_id, opportunity_id, now, result, profile, opportunity):
        self.connection.execute(
            "INSERT INTO simulacoes VALUES(?,?,?,?,?,?,?)",
            (identifier, user_id, opportunity_id, now, dump(result), dump(profile), dump(opportunity)),
        )

    def simulation(self, identifier, user_id):
        row = self.connection.execute(
            "SELECT * FROM simulacoes WHERE id = ? AND usuario_id = ?", (identifier, user_id),
        ).fetchone()
        return simulation_from_row(row) if row else None

    def history(self, user_id, limit=20, offset=0):
        total = self.connection.execute(
            "SELECT count(*) AS total FROM simulacoes WHERE usuario_id = ?", (user_id,),
        ).fetchone()["total"]
        rows = self.connection.execute(
            "SELECT * FROM simulacoes WHERE usuario_id = ? ORDER BY criado_em DESC, id LIMIT ? OFFSET ?",
            (user_id, limit, offset),
        ).fetchall()
        return [simulation_from_row(row) for row in rows], total

