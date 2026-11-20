# Plano, tarefas e análise de convergência

As especificações de UC01 e UC02 foram escritas antes dos módulos de
implementação. As respostas do usuário resolveram as decisões D04–D06.
Este arquivo registra a situação final e a relação entre os artefatos.

## Organização

| Camada prevista no UML | Implementação | Responsabilidade |
| --- | --- | --- |
| Apresentação | app/main.py, app/schemas.py | HTTP, autenticação da requisição, validação e respostas |
| Aplicação | app/services.py | Casos de uso e transações |
| Domínio | app/domain.py | Comparação, presença, pontuação, elegibilidade e prazo |
| Persistência | app/database.py, app/repository.py | Conexões, schema e consultas parametrizadas SQLite |
| Suporte | app/security.py, app/config.py, app/seed.py | Credenciais, configuração e exemplos |

Entidades do diagrama de classes: Aluno corresponde a usuarios; PerfilAcademico
a perfis; OportunidadeIntercambio a oportunidades; Requisito é uma lista JSON
do edital; ResultadoSimulacao corresponde a simulacoes; AvaliacaoRequisito é
uma lista JSON do resultado. Proficiência e documentos são mapas do perfil.
Snapshots são cópias dos dados efetivamente avaliados, não referências mutáveis.

Optou-se por sqlite3 da biblioteca padrão, sem ORM, para manter transações e
consultas visíveis em um trabalho acadêmico pequeno. Colunas de filtro ficam
estruturadas; dados de avaliação são JSON validados. Chaves estrangeiras estão
ativadas em cada conexão. Schema v1 com rejeição de versões desconhecidas.

## Tarefas

| ID | Tarefa | Situação |
| --- | --- | --- |
| T01 | Ler os dois enunciados, o planejamento e os cinco diagramas UML | Concluída |
| T02 | Especificar US1/UC01 e US2/UC02 e levantar ambiguidades | Concluída |
| T03 | Confirmar autenticação, pesos e tratamento de documentos | Concluída pelo usuário |
| T04 | Implementar domínio puro e contratos validados | Concluída |
| T05 | Implementar persistência, seed e snapshots | Concluída |
| T06 | Implementar serviços, autenticação e endpoints FastAPI | Concluída |
| T07 | Testar domínio, contratos, serviços e SQLite real | Concluída |
| T08 | Escrever testes HTTP de integração | Concluída; execução pendente no ambiente com FastAPI |
| T09 | Escrever execução, exemplos e relato do SDD | Concluída |

## Rastreabilidade

| Requisito | Regra da especificação | Código | Evidência em testes |
| --- | --- | --- | --- |
| CA01/RF02 | SIM01, SIM05 | domain.evaluate_criterion / simulate | insufficient_i3, i3_boundaries, insufficient_required_criterion |
| CA02 | SIM02, SIM04 | domain.simulate | optional_experience_missing, all_criteria_met |
| CA03/RF03 | SIM03 | domain.criterion_value / simulate | missing_required_document, missing_language, complete_profile_and_resimulate |
| CA04 | SIM04 | domain.simulate | per_criterion_points, weights_are_configured, zero_total_weight |
| RF01/UC01 | SIM07 | services.require_active | missing_inactive_and_expired_opportunities |
| UC01 pós-condição | SIM08 | repository.save_simulation | snapshots_are_immutable, restart_preserves, users_do_not_share |
| RNF01 | SIM09 | services.simulate / endpoint POST | rnf01_simulation_under_three_seconds; teste HTTP preparado |
| Seção 8.1 teste 5 | SIM06/SIM10 | domain.credit_percentage | credit_boundaries, credit_percentage_from_counts, not_rounded_before_comparison |
| CA05/RF04 | FIL01–FIL03 | repository.catalog | successive_filters_use_and, duration_limits, combined_filters_and_details |
| CA06 | FIL04 | services.catalog | no_results_has_explanatory_message, empty_results_and_reset |
| CA07 | FIL05 | schemas.Filters / handler 422 | unknown_filter_is_rejected; unknown_filter_is_not_silently_ignored preparado |
| Catálogo ativo | FIL06/FIL10 | repository.catalog / filter_options | inactive_expired_and_last_day |
| Complemento de busca | FIL07–FIL09 | repository.catalog | normalization_multi_term_search, pagination_has_stable_order |
| Decisão do usuário | AUT01–AUT07 | security / AuthService / dependência HTTP | registro, sessão, logout e isolamento em test_services; test_api preparado |

Os nomes na última coluna são trechos dos métodos de tests/test_domain.py,
test_validation.py, test_services.py e test_api.py. O resultado efetivamente
executado e suas limitações estão em SDD.txt.

## Limites de convergência com o planejamento

O RNF02 refere-se à responsividade da interface e não é validado pelo backend.
O frontend continua como demonstração local até ser conectado aos endpoints.
Esta entrega não implementa o processo de candidatura; retorna apenas a
elegibilidade. Também não executa seleção real ou prevê aprovação.

Os cinco diagramas originais foram examinados. As adaptações identificadas
(escala do I3, cardinalidade de idioma/nível, UUIDs de usuários/simulações e
armazenamento de agregados em JSON) estão explicitadas nas especificações e
em SDD.txt; os PDFs originais não foram alterados.

