"""Transporte de testes por stdin/stdout para a API real, sem abrir portas."""
import json
from pathlib import Path
import selectors
import sys
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
from app.config import Settings
from app.main import create_app

# Alguns sandboxes não notificam o seletor entre threads. Apenas neste executor
# de testes, uma espera limitada também permite processar as notificações.
select_original = selectors.DefaultSelector.select

def select_limitado(self, timeout=None):
    return select_original(self, 0.01 if timeout is None else min(timeout, 0.01))

selectors.DefaultSelector.select = select_limitado

with TemporaryDirectory() as temp:
    with TestClient(create_app(Settings(database_path=Path(temp) / 'teste.sqlite3',
                                       database_url=None, require_postgres=False))) as client:
        print(json.dumps({'ready': True}), flush=True)
        for linha in sys.stdin:
            pedido = json.loads(linha)
            resposta = client.request(pedido['method'], pedido['path'],
                                      headers=pedido['headers'], content=pedido.get('body'))
            print(json.dumps({'id': pedido['id'], 'status': resposta.status_code,
                              'body': resposta.text}), flush=True)
