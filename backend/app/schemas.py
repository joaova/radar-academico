"""Contratos HTTP e validação dos dados estruturados."""

from datetime import date, datetime
from typing import Annotated, Literal
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .domain import LANGUAGE_LEVELS, ACADEMIC_LEVELS, LANGUAGES

Level = Literal["graduação", "pós-graduação"]
LanguageLevel = Literal["A1", "A2", "B1", "B2", "C1", "C2"]
Language = Literal["Inglês", "Espanhol", "Francês", "Alemão", "Italiano", "Português"]
Text = Annotated[str, Field(min_length=1, max_length=200)]
Reference = Annotated[str, Field(min_length=1, max_length=1000)]
SQLITE_MAX_INTEGER = 9_223_372_036_854_775_807


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)


class Credentials(Model):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    email: str = Field(max_length=254)
    senha: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value):
        value = value.strip().casefold()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Informe um e-mail válido.")
        return value

    # Senhas são preservadas literalmente, inclusive espaços nas extremidades.
    @field_validator("senha", mode="before")
    @classmethod
    def preserve_password(cls, value):
        if not isinstance(value, str):
            raise ValueError("A senha deve ser texto.")
        return value


class Registration(Credentials):
    nome: Text

    @field_validator("nome", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class User(Model):
    id: str
    nome: str
    email: str
    criado_em: datetime


class Token(Model):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expira_em: datetime
    usuario: User


class Profile(Model):
    nome: Text
    curso: Text | None = None
    area: Text | None = None
    nivel: Level | None = None
    i3: float | None = Field(default=None, ge=0, le=10)
    creditos: float | None = Field(default=None, ge=0, le=100)
    creditos_concluidos: int | None = Field(default=None, ge=0)
    creditos_totais: int | None = Field(default=None, gt=0)
    idiomas: dict[Language, LanguageLevel] = Field(default_factory=dict)
    experiencias: list[Text] | None = Field(default=None, max_length=100)
    disciplinas: list[Text] | None = Field(default=None, max_length=200)
    documentos: dict[Text, Reference] = Field(default_factory=dict, max_length=50)

    @field_validator("i3", "creditos", "creditos_concluidos", "creditos_totais", mode="before")
    @classmethod
    def reject_bool(cls, value):
        if isinstance(value, bool):
            raise ValueError("Informe um valor numérico, não um booleano.")
        return value

    @model_validator(mode="after")
    def credit_source(self):
        if (self.creditos_concluidos is None) != (self.creditos_totais is None):
            raise ValueError("Informe créditos concluídos e totais juntos.")
        if self.creditos_totais is not None:
            if self.creditos is not None:
                raise ValueError("Use percentual ou contagem de créditos, não ambos.")
            if self.creditos_concluidos > self.creditos_totais:
                raise ValueError("Créditos concluídos não podem exceder o total.")
        return self


class ProfileResponse(Profile):
    usuario_id: str
    atualizado_em: datetime
    creditos_percentual: float | None


class Filters(Model):
    busca: str = Field(default="", max_length=200)
    nivel: Literal["", "graduação", "pós-graduação"] = ""
    area: str = Field(default="", max_length=200)
    idioma: str = Field(default="", max_length=100)
    pais: str = Field(default="", max_length=100)
    bolsa: str = Field(default="", max_length=100)
    min: int | None = Field(default=None, ge=1, le=SQLITE_MAX_INTEGER)
    max: int | None = Field(default=None, ge=1, le=SQLITE_MAX_INTEGER)
    limite: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=SQLITE_MAX_INTEGER)

    @field_validator("min", "max", mode="before")
    @classmethod
    def empty_duration(cls, value):
        return None if isinstance(value, str) and not value.strip() else value

    @model_validator(mode="after")
    def duration_range(self):
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("A duração mínima não pode ser maior que a máxima.")
        return self


class Pagination(Model):
    limite: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=SQLITE_MAX_INTEGER)


class Criterion(Model):
    campo: Literal["nivel", "i3", "creditos", "idioma", "experiencia", "disciplina", "documento"]
    rotulo: Text
    esperado: str | float
    obrigatorio: bool
    peso: float = Field(default=0, ge=0)
    chave: Text | None = None

    @model_validator(mode="after")
    def expected_type(self):
        if self.campo in ("i3", "creditos"):
            limit = 10 if self.campo == "i3" else 100
            if not isinstance(self.esperado, (int, float)) or not 0 <= self.esperado <= limit:
                raise ValueError(f"Mínimo de {self.campo} deve estar entre 0 e {limit}.")
        elif self.campo == "idioma" and self.esperado not in LANGUAGE_LEVELS:
            raise ValueError("Proficiência inválida.")
        elif self.campo == "nivel" and self.esperado not in ACADEMIC_LEVELS:
            raise ValueError("Nível acadêmico inválido.")
        elif self.campo in ("experiencia", "disciplina") and self.esperado not in ("Sim", "Não"):
            raise ValueError("Experiência/disciplina deve exigir Sim ou Não.")
        elif self.campo == "documento" and self.esperado != "Presente":
            raise ValueError("Documento deve exigir Presente.")
        if self.campo in ("documento", "disciplina") and not self.chave:
            raise ValueError("Documento/disciplina deve identificar a chave avaliada.")
        if self.campo == "idioma" and self.chave is not None and self.chave not in LANGUAGES:
            raise ValueError("Chave de idioma inválida.")
        return self


class Opportunity(Model):
    id: Text
    universidade: Text
    titulo: Text
    cidade: Text
    pais: Text
    area: Text
    meses: int = Field(gt=0)
    nivel: Level
    idioma: Language
    proficiencia: LanguageLevel
    bolsa: Text
    beneficio: Text
    vagas: int = Field(ge=0)
    ativa: bool
    data_limite: date
    requisitos: list[Criterion] = Field(min_length=1)


class Catalog(Model):
    itens: list[Opportunity]
    total: int
    limite: int
    offset: int
    mensagem: str | None


class FilterOptions(Model):
    area: list[str]
    idioma: list[str]
    pais: list[str]
    bolsa: list[str]
    nivel: list[str]
    duracao: dict[str, int | None]


class CriterionResult(Criterion):
    estado: Literal["ausente", "atendido", "não atendido"]
    valor: str | float | None
    justificativa: str
    percentual: int
    pontos_obtidos: float
    contribuicao_percentual: float


class Simulation(Model):
    id: str
    usuario_id: str
    oportunidade_id: str
    criado_em: datetime
    situacao: Literal["incompleta", "compativel", "incompativel"]
    estado: str
    indice: int | None
    incompleta: bool
    elegivel: bool
    candidatura_habilitada: bool
    completar_perfil: bool
    peso_total: float
    pontos_obtidos: float
    criterios: list[CriterionResult]
    atendidos: list[CriterionResult]
    nao_atendidos: list[CriterionResult]
    ausentes: list[CriterionResult]
    perfil_snapshot: Profile
    oportunidade_snapshot: Opportunity


class SimulationHistory(Model):
    itens: list[Simulation]
    total: int
    limite: int
    offset: int

