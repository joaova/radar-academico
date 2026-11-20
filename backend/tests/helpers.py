from copy import deepcopy
from datetime import timedelta
import json

from app.config import BASE_DIR
from app.domain import today


def opportunity():
    item = json.loads((BASE_DIR / "seed.json").read_text(encoding="utf-8"))[0]
    return {**deepcopy(item), "data_limite": (today() + timedelta(days=90)).isoformat()}


def complete_profile(**changes):
    return {"nome": "Estudante", "nivel": "graduação", "i3": 8.0, "creditos": 58,
            "creditos_concluidos": None, "creditos_totais": None,
            "idiomas": {"Inglês": "B2"}, "experiencias": [], "disciplinas": [],
            "documentos": {"historico_escolar": "historico-escolar.pdf"}, **changes}

