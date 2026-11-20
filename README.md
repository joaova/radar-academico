# Radar Acadêmico

Projeto de Engenharia de Software para explorar oportunidades de intercâmbio e simular a compatibilidade do perfil do estudante com os critérios de cada edital.

| Pasta | Conteúdo |
| --- | --- |
| [frontend](frontend/) | Interface HTML/JavaScript integrada à API: cadastro, login, catálogo, perfil, detalhes, simulações e histórico. |
| [backend](backend/) | API Python/FastAPI/SQLite com autenticação, perfil individual, filtros e simulações persistidas. |

## Executar os dois servidores

Siga o [guia do backend](backend/README.md) para instalar as dependências. No primeiro terminal:

```bash
cd backend
source .venv/bin/activate
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

Em outro terminal, na raiz deste repositório, com Node.js instalado:

```bash
node frontend/servir.mjs
```

Abra **http://127.0.0.1:8000/**. A interface encaminha para o login quando não há sessão. Use **Criar uma conta** no primeiro acesso; não há usuário ou senha predefinidos. A API também pode ser testada em **http://127.0.0.1:8001/docs**; saúde: `/api/saude`.

Abra pelo servidor HTTP: abrir os HTML diretamente pela pasta pode bloquear módulos JavaScript. Não é necessário instalar pacotes npm para executar a interface. Imagens e fontes externas precisam de internet; os estilos estão no projeto.

## Testar o fluxo pela interface

1. Crie uma conta e entre. O catálogo e as opções de filtros vêm da API.
2. Combine país **Itália**, idioma **Inglês**, nível **Graduação** e duração de **6 a 6 meses**: o catálogo inicial retorna Milão. Remova os filtros para ver os demais editais.
3. Abra Milão e clique em **Simular Minha Compatibilidade**. Uma conta nova possui perfil incompleto; o resultado mostra os requisitos ausentes.
4. Em **Completar perfil**, informe nível **Graduação**, I3 **8,4**, créditos **58%**, Inglês **B2** e referência do histórico escolar, por exemplo `historico-escolar.pdf`. Marque que informou experiências e disciplinas e deixe ambas vazias para declarar nenhuma.
5. Clique em **Salvar perfil e simular novamente**: o resultado esperado é elegível/compatível, com índice **80%**. A referência documental é texto; não há upload de arquivo.
6. Em **Simulações**, abra os dois resultados salvos. O primeiro continua incompleto; o segundo preserva os dados usados para calcular os 80%. Recarregar um resultado apenas o consulta, sem criar nova simulação.
7. Teste I3 **6,5** e simule de novo: o requisito mínimo não é atendido. Apague a referência do histórico e simule: o resultado fica incompleto.
8. Use **Sair** e entre novamente: perfil e resultados continuam no banco, vinculados à sua conta.

Os cards convidam a simular, sem calcular percentuais no navegador nem criar simulações automaticamente. Filtros são enviados ao servidor; o catálogo possui paginação. Editais iniciais são fictícios, com prazo definido na primeira inserção. O índice mede aderência aos critérios, não probabilidade de aprovação; a candidatura não é executada por este projeto.

## Configuração da conexão

O endereço da API está em [frontend/config.js](frontend/config.js), por padrão `http://127.0.0.1:8001`. Altere se executar o backend em outro endereço.

O backend já permite as origens `http://127.0.0.1:8000` e `http://localhost:8000` via CORS. Se mudar a porta/origem da interface, configure `RADAR_CORS_ORIGINS` antes de iniciar a API. Por exemplo, para servir a interface na porta 8002:

```bash
# No terminal do backend:
RADAR_CORS_ORIGINS=http://127.0.0.1:8002 python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
# No terminal do frontend, na raiz do repositório:
node frontend/servir.mjs 8002
```

O token de autenticação fica em `sessionStorage`, limitado à sessão da aba. Senhas não são armazenadas pela interface. A sessão da API dura oito horas; uma resposta 401 solicita login novamente. Dados do perfil e resultados ficam no SQLite, não no armazenamento local do navegador. O antigo perfil de demonstração não é importado automaticamente.

## Verificação automatizada

```bash
# Na raiz do repositório, Node.js 20 ou superior:
node --test frontend/tests/*.test.mjs

# No diretório backend, com o ambiente virtual ativado:
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

Os testes JavaScript verificam autenticação, requisições, falhas de conexão e redirecionamentos. Há também um teste que conecta o cliente JavaScript à API real por transporte em memória, com banco temporário, sem alterar seus dados. Ele usa `backend/.venv/bin/python` por padrão (ou `RADAR_TEST_PYTHON`) e é ignorado se as dependências Python não estiverem disponíveis. Os testes Python verificam regras, persistência, endpoints e CORS.

Na validação desta integração passaram **13 testes do cliente JavaScript, 1 teste JavaScript/API real e 65 testes Python**, sem testes ignorados. O ambiente bloqueou portas locais, portanto a validação visual no navegador deve seguir o roteiro acima.

O relato do SDD das duas funcionalidades está em [backend/SDD.txt](backend/SDD.txt).
