"""Catálogo fictício inicial. Não cria usuários ou senhas de demonstração."""

from datetime import timedelta
import json

from .config import BASE_DIR
from .domain import today
from .repository import Repository
from .schemas import Opportunity


def seed_catalog(database):
    examples = json.loads((BASE_DIR / "seed.json").read_text(encoding="utf-8"))
    with database.connect() as connection:
        repository = Repository(connection)
        for item in examples:
            if repository.opportunity(item["id"]) is not None:
                continue
            # Prazo relativo somente na primeira inserção; reiniciar não renova editais.
            opportunity = Opportunity.model_validate({
                **item, "data_limite": today() + timedelta(days=90),
            }).model_dump(mode="json")
            repository.add_opportunity(opportunity)

