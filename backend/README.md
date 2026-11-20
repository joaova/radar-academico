# Backend — Radar Acadêmico

API em **Python + FastAPI + SQLite/PostgreSQL** para simular compatibilidade (UC01) e
filtrar oportunidades (UC02). Inclui cadastro, login, perfil individual,
referências documentais e histórico de simulações.

As regras estão em [specs](specs/); o relato de SDD das duas funcionalidades
está em [SDD.txt](SDD.txt).

## Executar

Use Python 3.12 ou superior, com `venv` e `pip`. SQLite usa a biblioteca padrão.

```bash
cd "/home/yuuta/Documents/Engenharia de Software/radar-academico/backend"
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

Abra **http://127.0.0.1:8001/docs** para executar as operações pela documentação
interativa. OpenAPI: `/openapi.json`. Saúde: `/api/saude`. Encerre com `Ctrl+C`.

A aplicação cria `data/radar.sqlite3` e insere seis editais fictícios baseados
no frontend. Os prazos são de 90 dias a partir da inserção; reiniciar não
renova prazos nem sobrescreve dados. Os pesos são proficiência 80 e experiência
20, além dos critérios eliminatórios com peso zero. Os exemplos exigem
referência de histórico escolar. Não há conta ou senha predefinida.

A porta 8001 evita conflito com o servidor Node do frontend na porta 8000.
O frontend está integrado à API, incluindo cadastro, login, perfil, filtros,
simulações e histórico. Para testar pela interface, siga o [guia do projeto](../README.md).
Também é possível demonstrar a API pelo `/docs`.

## Demonstrar as funcionalidades

1. Em `/docs`, execute `POST /api/auth/cadastro` com nome, e-mail e senha
   de 8–128 caracteres.
2. Execute `POST /api/auth/login`. Copie `access_token`, clique em **Authorize**
   e cole apenas o token; o Swagger adiciona o prefixo Bearer.
3. Consulte `GET /api/oportunidades` combinando país Itália, idioma Inglês,
   nível graduação e duração mínima/máxima 6: retorna Milão. Troque o país
   por Japão: retorna lista vazia e orientação para alterar os filtros.
4. Execute `POST /api/oportunidades/milano/simulacoes`: o perfil recém-criado
   está incompleto; o resultado lista campos e documentos ausentes.
5. Preencha `PUT /api/perfil` com [examples/perfil.json](examples/perfil.json).
   PUT substitui o perfil inteiro; campos omitidos voltam aos padrões.
6. Repita a simulação: resultado `compativel`, índice **80%** e candidatura
   habilitada, mesmo sem experiência adicional na área.
7. Troque I3 por `6.5`: resultado `incompativel`, com justificativa. Remova a
   referência do histórico: `incompleta`, índice nulo e orientação para completar
   o perfil. I3 exatamente 7 e créditos exatamente 40 atendem aos mínimos.
8. Consulte `GET /api/simulacoes`: resultados anteriores preservam os dados
   usados no cálculo. Finalize com `POST /api/auth/logout`.

Requisições prontas: [examples/requisicoes.http](examples/requisicoes.http).

## Endpoints

| Método | Caminho | Finalidade |
| --- | --- | --- |
| GET | /api/saude | Público; verifica conexão com SQLite |
| POST | /api/auth/cadastro | Público; cria usuário e perfil incompleto |
| POST | /api/auth/login | Público; retorna sessão Bearer válida por 8 horas |
| GET | /api/auth/me | Usuário atual |
| POST | /api/auth/logout | Revoga a sessão atual |
| GET / PUT | /api/perfil | Consulta/substitui o próprio perfil |
| GET | /api/oportunidades/filtros | Opções disponíveis nos editais ativos |
| GET | /api/oportunidades | Catálogo com filtros e paginação |
| GET | /api/oportunidades/{id} | Detalhes e requisitos |
| POST | /api/oportunidades/{id}/simulacoes | Calcula e registra resultado |
| GET | /api/simulacoes | Histórico do próprio usuário |
| GET | /api/simulacoes/{id} | Resultado e snapshots preservados |

Com exceção de cadastro, login e saúde, todas as rotas acima exigem
`Authorization: Bearer SEU_TOKEN`. O dono é obtido da sessão; não é escolhido
pelo cliente. Consultar simulação de outro usuário retorna 404.

## Filtros e regras

Filtros: `area`, `min`, `max`, `idioma`, `pais`, `bolsa`, `nivel`.
Complemento `busca`: universidade, título e cidade, com todos os termos.
Textos ignoram caixa/acentos, exceto `nivel`, que usa os valores canônicos
`graduação` e `pós-graduação`. Todos os filtros se combinam com AND.
Filtros vazios são ignorados; duração é em meses inteiros positivos e inclusiva.
Paginação: `limite` 1–100 (padrão 20), `offset` >=0 (padrão 0).
`total` precede a paginação; ordenação estável por ID.

Parâmetro desconhecido, como `orientador`, gera 422 com orientação. Combinação
válida sem correspondência retorna 200, lista vazia e mensagem. Valores de
país/área/bolsa não cadastrados também resultam em lista vazia.

O perfil contém curso, área, nível, I3 (0–10), proficiências A1–C2, experiências,
disciplinas e referências documentais. Créditos podem ser percentual (0–100)
ou `creditos_concluidos` e `creditos_totais` juntos, nunca as duas fontes.
Na contagem, o percentual é calculado sem arredondar antes da comparação.
`experiencias=null` significa não informado; `[]` significa nenhuma experiência.
O mesmo vale para disciplinas. Referências documentais são texto; não há
upload, leitura de PDFs ou comprovação automática de autenticidade.

Cada requisito declara `campo`, `rotulo`, `esperado`, `obrigatorio`, `peso`
e eventualmente `chave`. Campos: `nivel`, `i3`, `creditos`, `idioma`,
`experiencia`, `disciplina`, `documento`. A chave identifica a disciplina,
o documento ou uma língua específica. Obrigatoriedade é explícita.

O resultado separa elegibilidade e pontuação, com critérios atendidos,
não atendidos e ausentes, justificativa, percentual binário, pontos e contribuição.
O índice é 100 × pesos atendidos / pesos totais, arredondado com meio ponto
para cima. Dado obrigatório ausente gera `incompleta` e índice nulo. Sem
pendências, requisito obrigatório insuficiente gera `incompativel`; atender
todos gera `compativel`, mesmo sem adicionais. Sem pesos positivos, índice nulo.
O índice mede aderência; não estima probabilidade de aprovação. A API retorna
a habilitação, sem executar o processo de candidatura.

O último dia de inscrição é inclusivo, no fuso America/Sao_Paulo. Edital
inexistente retorna 404; inativo/vencido retorna 409 em detalhes/simulação e
fica fora do catálogo. Resultados guardam instante UTC e snapshots de perfil
e edital; editar dados não modifica simulações passadas.

## Configuração e persistência

| Variável | Padrão | Efeito |
| --- | --- | --- |
| DATABASE_URL | não definida | URL PostgreSQL 18+; tem prioridade sobre RADAR_DATABASE. Use a URL do Neon com TLS na publicação |
| RADAR_REQUIRE_POSTGRES | 0 | Use 1 no Render para impedir uso acidental de SQLite temporário se DATABASE_URL estiver ausente |
| RADAR_DATABASE | backend/data/radar.sqlite3 | Caminho do banco; relativo à execução quando não absoluto |
| RADAR_SEED | 1 | Use 0 para banco vazio sem exemplos |
| RADAR_CORS_ORIGINS | http://127.0.0.1:8000,http://localhost:8000 | Origens autorizadas, separadas por vírgula |

SQLite usa transações, chaves estrangeiras e WAL. Tabelas: `usuarios`, `perfis`,
`sessoes`, `oportunidades`, `simulacoes`; schema v1. Senhas usam PBKDF2-SHA256
com 600.000 iterações e salt individual. Somente o hash dos tokens fica no
banco. Arquivos SQLite e `.venv` são ignorados pelo Git. Recuperação de senha,
confirmação de e-mail e administração de editais ficam fora do recorte acadêmico.

Na publicação gratuita, o banco fica no Neon e a aplicação roda no Render,
conforme o [guia de publicação](../README.md#publicar-no-render). PostgreSQL
usa transações, chaves estrangeiras e validação de JSON. O schema é compartilhado
com SQLite; a normalização Unicode dos filtros é reproduzida no servidor SQL
sem instalar extensões. As credenciais ficam somente em `DATABASE_URL` no
ambiente do serviço. A aplicação não lê arquivos `.env` automaticamente.

## Testes

```bash
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

Para executar também o contrato HTTP e as verificações de persistência em
PostgreSQL 18+, defina `RADAR_TEST_POSTGRES_URL` com a URL de um banco exclusivo
para testes antes do mesmo comando. Cada teste cria um schema isolado, que é
removido ao final; não use um banco de produção. Sem essa variável, esses testes
ficam explicitamente ignorados e os testes locais continuam usando SQLite.

Testes de domínio, validação, serviços, SQLite real temporário e HTTP com
TestClient (sem abrir portas). O RNF01 mede a execução da simulação em até 3 s
no ambiente de testes; RNF02, de responsividade visual, depende do frontend.

Na validação da integração, **65 testes passaram**, incluindo os 13 testes HTTP,
sem testes ignorados. Neste ambiente restrito foi necessário limitar a espera
do seletor asyncio no executor de testes para permitir as notificações entre
threads. A aplicação não foi alterada para isso. A abertura de portas locais
foi bloqueada pelo ambiente; o teste visual com Uvicorn e o servidor Node
deve seguir o roteiro do [guia do projeto](../README.md).

## Referências técnicas

Regras do negócio: PDFs fornecidos na pasta superior ao repositório.
Documentação oficial consultada:
[testes FastAPI](https://fastapi.tiangolo.com/tutorial/testing/),
[modelos de query](https://fastapi.tiangolo.com/tutorial/query-param-models/),
[sqlite3 do Python](https://docs.python.org/3/library/sqlite3.html).

