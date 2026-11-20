"""Inicialização da aplicação; execute uvicorn app.main:app --port 8001."""

from contextlib import asynccontextmanager
import logging
import sqlite3
from typing import Annotated

import psycopg

from fastapi import Depends, FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import Settings
from .database import Database
from .postgres import PostgresDatabase
from .errors import ApplicationError
from .schemas import (Catalog, Credentials, FilterOptions, Filters, Opportunity, Pagination,
                      Profile, ProfileResponse, Registration, Simulation, SimulationHistory, Token, User)
from .seed import seed_catalog
from .services import AuthService, RadarService

bearer = HTTPBearer(auto_error=False)
FILTER_HELP = ("Utilize os filtros de país (pais), área do conhecimento (area), idioma, "
               "duração (min/max), bolsa ou nível acadêmico (nivel). "
               "Também são aceitos busca, limite e offset.")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    database = PostgresDatabase(settings.database_url) if settings.database_url else Database(settings.database_path)
    auth = AuthService(database, settings.session_hours)
    radar = RadarService(database)

    @asynccontextmanager
    async def lifespan(application):
        database.initialize()
        if settings.seed:
            seed_catalog(database)
        yield

    application = FastAPI(
        title="Radar Acadêmico", version="1.0.0", lifespan=lifespan,
        description="UC01: simular compatibilidade. UC02: filtrar oportunidades. Dados fictícios.",
    )
    application.state.database = database
    application.add_middleware(
        CORSMiddleware, allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "PUT"], allow_headers=["Authorization", "Content-Type"],
    )

    @application.middleware("http")
    async def prevent_private_cache(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @application.exception_handler(ApplicationError)
    async def application_error(request, error):
        headers = {"WWW-Authenticate": "Bearer"} if error.status == 401 else None
        return JSONResponse(status_code=error.status, headers=headers,
                            content={"codigo": error.code, "mensagem": error.message})

    @application.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        errors = [{"campo": ".".join(str(p) for p in item["loc"]), "mensagem": item["msg"]}
                  for item in error.errors()]
        # Não devolver corpos de requisição ou valores que podem conter senhas/tokens.
        unknown = any(item["type"] == "extra_forbidden" for item in error.errors())
        message = "Dados inválidos. Revise os campos informados."
        if unknown and request.url.path == "/api/oportunidades":
            message = "Critério de busca não disponível. " + FILTER_HELP
        return JSONResponse(status_code=422, content={
            "codigo": "dados_invalidos", "mensagem": message, "erros": errors,
        })

    @application.exception_handler(sqlite3.Error)
    async def database_error(request, error):
        logging.getLogger(__name__).error("Falha de persistência: %s", type(error).__name__)
        return JSONResponse(status_code=503, content={
            "codigo": "persistencia_indisponivel", "mensagem": "Não foi possível acessar os dados. Tente novamente.",
        })

    application.add_exception_handler(psycopg.Error, database_error)

    def current_user(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
        return auth.authenticate(credentials.credentials if credentials else None)

    CurrentUser = Annotated[dict, Depends(current_user)]

    @application.get("/api/saude", tags=["Sistema"])
    def health():
        with database.connect() as connection:
            connection.execute("SELECT 1").fetchone()
        return {"status": "ok"}

    @application.post("/api/auth/cadastro", status_code=201, response_model=User, tags=["Autenticação"])
    def register(data: Registration):
        return auth.register(data.nome, data.email, data.senha)

    @application.post("/api/auth/login", response_model=Token, tags=["Autenticação"])
    def login(data: Credentials, response: Response):
        response.headers["Cache-Control"] = "no-store"
        return auth.login(data.email, data.senha)

    @application.get("/api/auth/me", response_model=User, tags=["Autenticação"])
    def me(user: CurrentUser):
        return user

    @application.post("/api/auth/logout", status_code=204, tags=["Autenticação"])
    def logout(user: CurrentUser, credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer)]):
        auth.logout(credentials.credentials)
        return Response(status_code=204)

    @application.get("/api/perfil", response_model=ProfileResponse, tags=["Perfil"])
    def get_profile(user: CurrentUser):
        return radar.get_profile(user["id"])

    @application.put("/api/perfil", response_model=ProfileResponse, tags=["Perfil"])
    def update_profile(data: Profile, user: CurrentUser):
        return radar.update_profile(user["id"], data.model_dump(mode="json"))

    @application.get("/api/oportunidades/filtros", response_model=FilterOptions, tags=["UC02 — Catálogo"])
    def filter_options(user: CurrentUser):
        return radar.filter_options()

    @application.get("/api/oportunidades", response_model=Catalog, tags=["UC02 — Catálogo"])
    def catalog(filters: Annotated[Filters, Query()], user: CurrentUser):
        return radar.catalog(filters.model_dump())

    @application.get("/api/oportunidades/{identifier}", response_model=Opportunity, tags=["UC02 — Catálogo"])
    def opportunity(identifier: str, user: CurrentUser):
        return radar.opportunity(identifier)

    @application.post("/api/oportunidades/{identifier}/simulacoes", status_code=201,
                      response_model=Simulation, tags=["UC01 — Simulador"])
    def simulate(identifier: str, user: CurrentUser):
        return radar.simulate(user["id"], identifier)

    @application.get("/api/simulacoes", response_model=SimulationHistory, tags=["UC01 — Simulador"])
    def history(pagination: Annotated[Pagination, Query()], user: CurrentUser):
        return radar.history(user["id"], pagination.model_dump())

    @application.get("/api/simulacoes/{identifier}", response_model=Simulation, tags=["UC01 — Simulador"])
    def simulation(identifier: str, user: CurrentUser):
        return radar.simulation(user["id"], identifier)

    return application


app = create_app()

