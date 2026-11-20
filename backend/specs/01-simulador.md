# UC01 — Simular compatibilidade

## Specify

Fonte: `Trabalho Pratico Eng Soft pt1.pdf`, seções 5–8, US1, UC01,
CA01–CA04, RF01–RF03 e RNF01. O enunciado versão 3 pede cenários de
sucesso, rejeição, exceção, classes de equivalência e valores limite.

Como estudante, quero comparar meu perfil cadastrado aos requisitos de um
edital ativo, conhecer as pendências e verificar minha elegibilidade.
O índice mede aderência às regras cadastradas; não é probabilidade de aprovação.

### Regras e critérios de aceitação

- SIM01 / CA01: requisito obrigatório conhecido e não atendido bloqueia a
  candidatura. A resposta informa requisito, mínimo e valor encontrado.
- SIM02 / CA02: critério adicional afeta a pontuação, mas não a elegibilidade.
- SIM03 / CA03: informação/documento obrigatório ausente gera `incompleta`,
  índice nulo, candidatura bloqueada e orientação para completar o perfil.
  Ausência de informação é diferente de informação avaliada e insuficiente.
- SIM04 / CA04: índice = 100 × soma dos pesos atendidos / soma dos pesos.
  Comparações são binárias; cada critério retorna percentual e contribuição.
  Pesos zero não pontuam. Sem pesos positivos, índice nulo (sem base pontuável).
- SIM05: com informações suficientes, todos os obrigatórios atendidos geram
  `compativel`; caso contrário, `incompativel`. Se houver simultaneamente
  ausências obrigatórias e reprovações, `incompleta` tem precedência, mantendo
  as justificativas das reprovações no relatório.
- SIM06: mínimos de I3, créditos e idioma são inclusivos. Níveis de idioma
  obedecem A1 < A2 < B1 < B2 < C1 < C2. Zero é valor informado.
- SIM07: edital inexistente retorna 404; inativo ou vencido retorna 409;
  perfil inexistente retorna 404; entrada inválida retorna 422.
- SIM08: cada execução registra resultado, critérios, perfil e edital usados,
  com identificador e instante UTC. Editar perfil não altera resultados anteriores.
- SIM09 / RNF01: verificar o fluxo em até 3 s no ambiente de teste; esse teste
  não representa garantia de desempenho em toda infraestrutura.
- SIM10: créditos podem ser informados em percentual ou calculados a partir
  dos créditos obrigatórios concluídos e totais, nunca de duas fontes simultâneas.

## Clarify

- D01: RF03 conflita com CA01 e com a pós-condição do UC01. Adota-se o bloqueio
  tanto por ausência obrigatória quanto por descumprimento obrigatório.
- D02: detalhes e simulações só são oferecidos para editais ativos e dentro
  do prazo; o último dia de inscrição é inclusivo, no fuso America/Sao_Paulo.
- D03: persistência de simulações decorre da pós-condição explícita do UC01.
- D04 (confirmado pelo usuário): cadastro e login fazem parte da entrega.
  Perfil e simulações são privados e vinculados ao usuário autenticado.
- D05 (confirmado pelo usuário): preservar os pesos dos exemplos do frontend:
  proficiência 80 e experiência 20; os pesos pertencem ao edital.
- D06 (confirmado pelo usuário): históricos/documentos são dados estruturados
  e referências, sem upload ou interpretação automática de PDFs.
- D07: referências documentais significam informação declarada pelo aluno,
  sem autenticação do conteúdo de certificados ou cálculo por OCR.
- D08: cada edital de demonstração exige referência de histórico escolar,
  com peso zero. Trata-se de dado fictício adicional para demonstrar CA03.
- D09: o índice nulo em avaliação incompleta evita apresentar uma avaliação
  parcial como definitiva. Critérios conhecidos continuam discriminados.
- D10: utiliza-se I3 entre 0 e 10, conforme exemplos do texto e do frontend;
  o atributo `mediaAcademica [0..1]` do diagrama de classes precisa ser alinhado
  a essa escala em uma revisão do planejamento.
- D11: a API desta versão mantém um nível e um idioma principal por edital,
  como os dados do frontend. As cardinalidades múltiplas do diagrama de
  classes são extensão futura; perfis têm múltiplas proficiências e critérios
  de idioma podem indicar explicitamente a língua em `chave`.

## Plan e Tasks

1. Definir contratos validados de perfil, edital, requisito e resultado.
2. Implementar domínio puro: presença, comparação, pontuação e elegibilidade.
3. Persistir perfis, editais e snapshots de simulação em SQLite.
4. Expor consulta/atualização de perfil e execução/consulta de simulação via FastAPI.
5. Derivar testes dos cenários 1–5 da seção 8.1 e das regras acima.
6. Confrontar especificação, código e testes; registrar resultados em SDD.txt.

## Validação prevista

Classes: perfil completo/incompleto; requisito atendido/não atendido/ausente;
obrigatório/adicional; edital ativo/inativo/vencido/inexistente.
Limites: I3 6,99/7/7,01; créditos 39,99/40/40,01; idioma B1/B2/C1;
último dia de inscrição; peso total zero; percentuais 0/100.

