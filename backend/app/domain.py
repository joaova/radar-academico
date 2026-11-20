"""Regras puras de UC01/UC02. Não importa FastAPI, Pydantic ou SQLite."""

from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
import unicodedata
from zoneinfo import ZoneInfo

LANGUAGE_LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
ACADEMIC_LEVELS = ("graduação", "pós-graduação")
LANGUAGES = ("Inglês", "Espanhol", "Francês", "Alemão", "Italiano", "Português")
AREAS = (
    "Engenharia e Tecnologia", "Ciências Exatas e Computação",
    "Negócios, Gestão e Finanças", "Ciências Sociais e Relações Internacionais",
    "Saúde e Bioeconomia",
)


def normalize(value: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", value)
                   if unicodedata.category(c) != "Mn").casefold().strip()


def today() -> date:
    return datetime.now(ZoneInfo("America/Sao_Paulo")).date()


def is_active(opportunity: dict, on_date: date | None = None) -> bool:
    return bool(opportunity["ativa"]) and date.fromisoformat(
        opportunity["data_limite"]
    ) >= (on_date or today())


def credit_percentage(profile: dict) -> float | None:
    completed = profile.get("creditos_concluidos")
    total = profile.get("creditos_totais")
    if completed is not None and total is not None:
        # Não arredondar antes de comparar com o mínimo do edital.
        return float(Decimal(str(completed)) * 100 / Decimal(str(total)))
    return profile.get("creditos")


def criterion_value(profile: dict, opportunity: dict, criterion: dict):
    field = criterion["campo"]
    key = criterion.get("chave")
    if field == "idioma":
        return profile.get("idiomas", {}).get(key or opportunity["idioma"])
    if field == "creditos":
        return credit_percentage(profile)
    if field in ("experiencia", "disciplina"):
        values = profile.get("experiencias" if field == "experiencia" else "disciplinas")
        if values is None:
            return None
        expected = key or opportunity["area"]
        return "Sim" if normalize(expected) in {normalize(v) for v in values} else "Não"
    if field == "documento":
        return profile.get("documentos", {}).get(key)
    return profile.get(field)


def evaluate_criterion(profile: dict, opportunity: dict, criterion: dict) -> dict:
    value = criterion_value(profile, opportunity, criterion)
    expected = criterion["esperado"]
    field = criterion["campo"]
    missing = value is None or value == ""
    meets = False
    if not missing:
        if field in ("i3", "creditos"):
            meets = Decimal(str(value)) >= Decimal(str(expected))
        elif field == "idioma":
            meets = LANGUAGE_LEVELS.index(value) >= LANGUAGE_LEVELS.index(expected)
        elif field == "documento":
            meets = bool(str(value).strip())
        else:
            meets = normalize(str(value)) == normalize(str(expected))
    state = "ausente" if missing else "atendido" if meets else "não atendido"
    if missing:
        explanation = f"{criterion['rotulo']} não informado."
    elif meets:
        explanation = f"{criterion['rotulo']}: critério atendido."
    else:
        kind = "obrigatório" if criterion["obrigatorio"] else "adicional"
        explanation = (f"Requisito {kind} não atendido: {criterion['rotulo']}; "
                       f"exigido: {expected}; valor registrado: {value}.")
    return {**criterion, "estado": state, "valor": value, "justificativa": explanation,
            "percentual": 100 if meets else 0,
            "pontos_obtidos": criterion.get("peso", 0) if meets else 0}


def simulate(profile: dict, opportunity: dict) -> dict:
    criteria = [evaluate_criterion(profile, opportunity, c) for c in opportunity["requisitos"]]
    required = [c for c in criteria if c["obrigatorio"]]
    incomplete = any(c["estado"] == "ausente" for c in required)
    failed = any(c["estado"] == "não atendido" for c in required)
    eligible = not incomplete and not failed
    weight = sum(Decimal(str(c.get("peso", 0))) for c in criteria)
    obtained = sum(Decimal(str(c["pontos_obtidos"])) for c in criteria)
    index = None if incomplete or not weight else int(
        (obtained * 100 / weight).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )
    for criterion in criteria:
        criterion["contribuicao_percentual"] = (
            float((Decimal(str(criterion["pontos_obtidos"])) * 100 / weight)
                  .quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)) if weight else 0
        )
    status = "incompleta" if incomplete else "compativel" if eligible else "incompativel"
    label = {"incompleta": "Avaliação incompleta", "compativel": "Elegível",
             "incompativel": "Requisito obrigatório não atendido"}[status]
    return {"situacao": status, "estado": label, "indice": index,
            "incompleta": incomplete, "elegivel": eligible,
            "candidatura_habilitada": eligible, "completar_perfil": incomplete,
            "peso_total": float(weight), "pontos_obtidos": float(obtained),
            "criterios": criteria,
            "atendidos": [c for c in criteria if c["estado"] == "atendido"],
            "nao_atendidos": [c for c in criteria if c["estado"] == "não atendido"],
            "ausentes": [c for c in criteria if c["estado"] == "ausente"]}

