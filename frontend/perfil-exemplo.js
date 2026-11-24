// Perfil de exemplo usado SOMENTE quando MODO_USA_PERFIL_EXEMPLO = true (config.js).
// Corresponde ao Teste 1/5: obrigatórios atendidos (I3 8,0; créditos 60%; inglês B2;
// histórico escolar informado) e experiência na área do edital "Milão" (critério adicional = 100%).
// Para remover: apague este arquivo e o uso em app.js (busque por "PERFIL_EXEMPLO").
export const PERFIL_EXEMPLO = {
  nome: 'Aluna Exemplo (mock)',
  curso: 'Engenharia de Software',
  area: 'Engenharia e Tecnologia',
  nivel: 'graduação',
  i3: 8.0,
  creditos: 60,
  creditos_concluidos: null,
  creditos_totais: null,
  idiomas: { Inglês: 'B2' },
  experiencias: ['Engenharia e Tecnologia'],
  disciplinas: [],
  documentos: { historico_escolar: 'historico-escolar-exemplo.pdf' },
};
