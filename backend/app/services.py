"""Casos de uso e transações; a camada HTTP somente adapta entrada/saída."""

from datetime import datetime, timedelta, timezone
import sqlite3
from uuid import uuid4

from .domain import credit_percentage, is_active, simulate
from .errors import ApplicationError
from .repository import Repository
from .security import create_token, hash_password, token_digest, verify_password


def utc_now():
    return datetime.now(timezone.utc)


def public_user(user):
    return {key: user[key] for key in ("id", "nome", "email", "criado_em")}


class AuthService:
    def __init__(self, database, session_hours=8):
        self.database = database
        self.session_hours = session_hours

    def register(self, name, email, password):
        user = {"id": str(uuid4()), "nome": name, "email": email,
                "senha_hash": hash_password(password), "criado_em": utc_now().isoformat()}
        profile = {"nome": name, "curso": None, "area": None,
                   "nivel": None, "i3": None, "creditos": None,
                   "creditos_concluidos": None, "creditos_totais": None,
                   "idiomas": {}, "experiencias": None, "disciplinas": None, "documentos": {}}
        try:
            with self.database.connect() as connection:
                Repository(connection).register(user, profile)
        except sqlite3.IntegrityError as error:
            if "usuarios.email" not in str(error):
                raise
            raise ApplicationError(409, "email_cadastrado", "Este e-mail já está cadastrado.") from error
        return public_user(user)

    def login(self, email, password):
        with self.database.connect() as connection:
            user = Repository(connection).user_by_email(email)
        # Executa a função de derivação também para e-mails não cadastrados.
        if user is None:
            hash_password(password)
        if user is None or not verify_password(password, user["senha_hash"]):
            raise ApplicationError(401, "credenciais_invalidas", "E-mail ou senha inválidos.")
        token = create_token()
        now = utc_now()
        expiration = (now + timedelta(hours=self.session_hours)).isoformat()
        with self.database.connect() as connection:
            Repository(connection).add_session(token_digest(token), user["id"], expiration, now.isoformat())
        return {"access_token": token, "token_type": "bearer", "expira_em": expiration,
                "usuario": public_user(user)}

    def authenticate(self, token):
        if not token or len(token) > 200:
            raise ApplicationError(401, "nao_autenticado", "Faça login para acessar este recurso.")
        with self.database.connect() as connection:
            user = Repository(connection).session_user(token_digest(token), utc_now().isoformat())
        if user is None:
            raise ApplicationError(401, "sessao_invalida", "Sessão inválida ou expirada. Faça login novamente.")
        return public_user(user)

    def logout(self, token):
        with self.database.connect() as connection:
            Repository(connection).revoke_session(token_digest(token))


class RadarService:
    def __init__(self, database):
        self.database = database

    def get_profile(self, user_id):
        with self.database.connect() as connection:
            found = Repository(connection).profile(user_id)
        if found is None:
            raise ApplicationError(404, "perfil_inexistente", "Perfil não encontrado.")
        profile = found["dados"]
        return {**profile, "usuario_id": user_id, "atualizado_em": found["atualizado_em"],
                "creditos_percentual": credit_percentage(profile)}

    def update_profile(self, user_id, profile):
        with self.database.connect() as connection:
            repository = Repository(connection)
            if repository.profile(user_id) is None:
                raise ApplicationError(404, "perfil_inexistente", "Perfil não encontrado.")
            repository.update_profile(user_id, profile, utc_now().isoformat())
        return self.get_profile(user_id)

    def catalog(self, filters):
        with self.database.connect() as connection:
            items, total = Repository(connection).catalog(filters)
        return {"itens": items, "total": total, "limite": filters.get("limite", 20),
                "offset": filters.get("offset", 0),
                "mensagem": None if total else (
                    "Nenhuma oportunidade encontrada para os filtros selecionados. "
                    "Altere ou remova algum filtro para ampliar os resultados."
                )}

    def filter_options(self):
        with self.database.connect() as connection:
            return Repository(connection).filter_options()

    @staticmethod
    def require_active(opportunity):
        if opportunity is None:
            raise ApplicationError(404, "edital_inexistente", "Edital não encontrado.")
        if not is_active(opportunity):
            raise ApplicationError(409, "edital_indisponivel", "Este edital está inativo ou com inscrições encerradas.")
        return opportunity

    def opportunity(self, identifier):
        with self.database.connect() as connection:
            return self.require_active(Repository(connection).opportunity(identifier))

    def simulate(self, user_id, opportunity_id):
        with self.database.connect() as connection:
            repository = Repository(connection)
            opportunity = self.require_active(repository.opportunity(opportunity_id))
            found = repository.profile(user_id)
            if found is None:
                raise ApplicationError(404, "perfil_inexistente", "Perfil não encontrado.")
            profile = found["dados"]
            result = simulate(profile, opportunity)
            identifier = str(uuid4())
            repository.save_simulation(identifier, user_id, opportunity_id, utc_now().isoformat(),
                                       result, profile, opportunity)
            return repository.simulation(identifier, user_id)

    def simulation(self, user_id, identifier):
        with self.database.connect() as connection:
            result = Repository(connection).simulation(identifier, user_id)
        if result is None:
            raise ApplicationError(404, "simulacao_inexistente", "Simulação não encontrada.")
        return result

    def history(self, user_id, pagination):
        with self.database.connect() as connection:
            items, total = Repository(connection).history(user_id, pagination["limite"], pagination["offset"])
        return {"itens": items, "total": total, **pagination}

