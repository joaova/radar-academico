# UC02 — Filtrar oportunidades

## Specify

Fonte: `Trabalho Pratico Eng Soft pt1.pdf`, US2, UC02, CA05–CA07,
RF04 e testes da seção 8.2. Como estudante, quero combinar filtros para
encontrar editais alinhados aos meus interesses.

- FIL01 / CA05: combinar área, duração mínima/máxima em meses, idioma, país,
  modalidade de bolsa e nível acadêmico com operador AND.
- FIL02: filtros omitidos ou vazios não restringem a busca. Remover todos
  retorna todo o catálogo ativo, respeitando paginação.
- FIL03: duração positiva em meses inteiros, limites inclusivos;
  mínimo maior que máximo retorna 422.
- FIL04 / CA06: busca vazia retorna 200, lista vazia, total zero e mensagem
  orientando a alterar/remover filtros.
- FIL05 / CA07: parâmetro desconhecido (por exemplo `orientador`) retorna
  422 e mensagem com os filtros permitidos, sem ser ignorado silenciosamente.
- FIL06: editais desativados ou com inscrição encerrada não aparecem.
- FIL07: comparação textual sem distinção de caixa/acentos. Valores de
  país/área/bolsa não cadastrados produzem busca vazia, sem inventar resultados.
- FIL08: busca textual `busca`, já existente no frontend, é complemento:
  pesquisa universidade, título e cidade; todos os termos devem corresponder.
  Não pesquisa orientadores ou campos arbitrários.
- FIL09: paginação com limite 1–100 e deslocamento >= 0; total representa
  todos os resultados filtrados, antes da paginação. Ordenação estável por id.
  Durações e deslocamento não podem exceder o inteiro de 64 bits do SQLite.
- FIL10: um endpoint fornece opções estruturadas dos filtros a partir dos
  editais ativos, evitando listas divergentes entre API e interface.

## Clarify

A busca textual complementa os seis filtros planejados para preservar a
funcionalidade já implementada no frontend. Não substitui o filtro por campo.
Resposta em tempo real depende de o frontend chamar a API a cada mudança;
o backend fornece uma consulta sem estado, reaplicando todos os filtros.
Prazo inclusivo e no fuso America/Sao_Paulo, como definido em UC01.

## Plan e Tasks

1. Definir filtros aceitos e validação de duração/paginação.
2. Implementar consultas parametrizadas em SQLite, com normalização textual.
3. Expor catálogo, opções de filtros e detalhes via FastAPI.
4. Testar combinações, limpeza, catálogo vazio e critérios desconhecidos.
5. Verificar coerência entre CA05–CA07, respostas HTTP e testes em SDD.txt.

## Validação prevista

Classes: sem filtro/um filtro/múltiplos; resultado/vazio;
atributo suportado/não suportado; ativo/inativo/vencido.
Limites: duração exata 6–6, mínimo e máximo invertidos, zero, negativo,
decimal, paginação 0/1/100/101 e offset além dos resultados.

