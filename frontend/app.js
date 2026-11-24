import { areas, idiomas, niveisIdioma } from './dados.js';
import { imagens } from './imagens.js';
import { api, ApiError, lerToken, salvarToken, limparSessao, pedirLogin, destinoSeguro } from './api.js';

import { MODO_USA_PERFIL_EXEMPLO } from './config.js';
import { PERFIL_EXEMPLO } from './perfil-exemplo.js';

// Modo mock: grava o perfil de exemplo na conta antes de consultar/simular.
async function aplicarPerfilExemplo() {
  if (!MODO_USA_PERFIL_EXEMPLO) return;
  await api('/perfil', { method: 'PUT', body: PERFIL_EXEMPLO });
}

const $ = seletor => document.querySelector(seletor);
const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];
const params = new URLSearchParams(location.search);
const pagina = document.body.dataset.page;
const chavesFiltros = ['busca', 'nivel', 'area', 'idioma', 'pais', 'bolsa', 'min', 'max'];
const numero = new Intl.NumberFormat('pt-BR');
const dataHora = valor => new Date(valor).toLocaleString('pt-BR');
let edital;
let perfil;

function mostrarErro(elemento, erro) {
  elemento.textContent = erro.message;
  elemento.hidden = false;
}

function url(destino, id = edital?.id) {
  const consulta = new URLSearchParams();
  if (id && destino !== 'index') consulta.set('edital', id);
  const origem = pagina === 'index' ? location.search.slice(1) : params.get('catalogo');
  const filtros = new URLSearchParams(origem ?? '');
  const catalogo = new URLSearchParams();
  for (const campo of [...chavesFiltros, 'offset']) {
    if (filtros.has(campo)) catalogo.set(campo, filtros.get(campo));
  }
  if (destino === 'index') return `index.html${catalogo.size ? '?' + catalogo : ''}`;
  if (catalogo.size) consulta.set('catalogo', catalogo.toString());
  if (destino === 'perfil' && pagina !== 'perfil') {
    consulta.set('voltar', pagina);
    if (pagina === 'resultado' && params.get('simulacao')) consulta.set('simulacao', params.get('simulacao'));
  }
  return `${destino}.html${consulta.size ? '?' + consulta : ''}`;
}

function urlResultado(resultado) {
  const destino = new URL(url('resultado', resultado.oportunidade_id), location.href);
  destino.searchParams.set('simulacao', resultado.id);
  return destino.pathname.split('/').pop() + destino.search;
}

function atualizarSlots(raiz, valores) {
  for (const elemento of $$('[data-slot]', raiz)) {
    const valor = valores[elemento.dataset.slot];
    if (valor === undefined) continue;
    if (elemento instanceof HTMLImageElement) {
      elemento.hidden = !valor;
      if (valor) elemento.src = valor;
      else elemento.removeAttribute('src');
      continue;
    }
    const icone = elemento.firstElementChild;
    if (icone?.classList.contains('material-symbols-outlined')) {
      elemento.replaceChildren(icone, document.createTextNode(' ' + valor));
    } else elemento.textContent = valor;
  }
}

function valoresEdital(item) {
  return { ...item,
    nivel: item.nivel === 'graduação' ? 'Graduação' : 'Pós-graduação',
    meses: `${item.meses} meses`, idioma: `${item.idioma} ${item.proficiencia}`,
    local: `${item.cidade}, ${item.pais}`, vagas: `${item.vagas} vagas`,
    inscricoes: item.data_limite ? item.data_limite.split('-').reverse().join('/') : '',
    imagem: imagens[item.id] || '',
  };
}

function links() {
  for (const a of $$('[data-catalogo]')) a.href = url('index');
  for (const a of $$('[data-perfil]')) a.href = url('perfil');
}

function opcoes(select, valores) {
  for (const valor of valores) select.append(new Option(valor, valor));
}

async function iniciarCatalogo() {
  const opcoesApi = await api('/oportunidades/filtros');
  const grade = $('#opportunities-grid');
  const modelo = $('#modelo-edital').content.firstElementChild.cloneNode(true);
  grade.replaceChildren();
  const abas = $$('.level-tab-btn');
  const entrada = Object.fromEntries(chavesFiltros.filter(campo => campo !== 'nivel').map(campo => [campo, $('#' + campo)]));
  const paineis = $$('.filter-trigger-btn');
  let nivel = ['graduação', 'pós-graduação'].includes(params.get('nivel')) ? params.get('nivel') : '';
  let offset = /^\d+$/.test(params.get('offset') || '') && Number.isSafeInteger(Number(params.get('offset'))) ? Number(params.get('offset')) : 0;
  let total = 0;
  const limite = 20;
  let painelAberto = null;
  let controller;
  let temporizador;
  let geracao = 0;

  for (const campo of ['area', 'idioma', 'pais', 'bolsa']) {
    opcoes(entrada[campo], opcoesApi[campo]);
    // Um filtro da URL pode já não existir nas opções atuais. Mantém a busca explícita.
    const valor = params.get(campo);
    if (valor && !opcoesApi[campo].includes(valor)) opcoes(entrada[campo], [valor]);
  }
  for (const [campo, input] of Object.entries(entrada)) input.value = (params.get(campo) || '').slice(0, 200);

  function paginacao(carregando = false) {
    $('#pagina-anterior').disabled = carregando || offset === 0;
    $('#pagina-seguinte').disabled = carregando || offset + limite >= total;
    $('#pagina-atual').textContent = total ? `Página ${Math.floor(offset / limite) + 1} de ${Math.ceil(total / limite)}` : '';
  }

  async function carregar(consulta, versao) {
    controller = new AbortController();
    const sinal = controller.signal;
    const pedido = new URLSearchParams(consulta);
    pedido.set('limite', limite);
    try {
      const resposta = await api(`/oportunidades?${pedido}`, { signal: sinal });
      if (versao !== geracao) return;
      total = resposta.total;
      for (const item of resposta.itens) {
        const card = modelo.cloneNode(true);
        card.dataset.edital = item.id;
        atualizarSlots(card, { ...valoresEdital(item), indice: 'Simular', estado: 'Confira sua compatibilidade' });
        card.querySelector('.radar-estado').dataset.tom = 'alerta';
        card.querySelector('.radar-estado .material-symbols-outlined').textContent = 'info';
        card.querySelector('a').href = url('detalhes', item.id);
        grade.append(card);
      }
      $('#results-count').textContent = total;
      $('#sem-resultados').hidden = total !== 0;
      if (total === 0) $('#sem-resultados p').textContent = resposta.mensagem;
      if (total > 0 && resposta.itens.length === 0) {
        $('#catalogo-status').textContent = 'Esta página não possui resultados. Volte à página anterior ou limpe os filtros.';
      } else $('#catalogo-status').hidden = true;
    } catch (erro) {
      if (sinal.aborted || versao !== geracao) return;
      mostrarErro($('#erro-catalogo p'), erro);
      $('#erro-catalogo').hidden = false;
      $('#catalogo-status').hidden = true;
    } finally {
      if (versao === geracao) {
        grade.setAttribute('aria-busy', 'false');
        paginacao();
      }
    }
  }

  function atualizar({ manterPagina = false, adiar = false } = {}) {
    if (!manterPagina) offset = 0;
    controller?.abort();
    clearTimeout(temporizador);
    const versao = ++geracao;
    const filtros = { nivel };
    for (const [campo, input] of Object.entries(entrada)) filtros[campo] = input.value.trim();
    const erro = !entrada.min.validity.valid || !entrada.max.validity.valid ||
      (filtros.min && filtros.max && Number(filtros.min) > Number(filtros.max));
    $('#erro-duracao').hidden = !erro;
    for (const campo of ['min', 'max']) entrada[campo].setAttribute('aria-invalid', String(Boolean(erro)));
    const consulta = new URLSearchParams(Object.entries(filtros).filter(([, valor]) => valor));
    if (offset) consulta.set('offset', offset);
    history.replaceState(null, '', `index.html${consulta.size ? '?' + consulta : ''}`);
    links();
    grade.replaceChildren();
    $('#results-count').textContent = '—';
    $('#sem-resultados').hidden = true;
    $('#erro-catalogo').hidden = true;
    $('#catalogo-status').hidden = Boolean(erro);
    $('#catalogo-status').textContent = 'Buscando oportunidades…';
    grade.setAttribute('aria-busy', String(!erro));
    paginacao(true);
    const rotulos = { area: 'Área de Estudo', duracao: 'Duração', idioma: 'Idioma', pais: 'País', bolsa: 'Bolsa' };
    for (const botao of paineis) {
      const campo = botao.id.replace('btn-filter-', '');
      const valor = campo === 'duracao'
        ? (filtros.min && filtros.max ? `${filtros.min}–${filtros.max} meses` :
          filtros.min ? `A partir de ${filtros.min} meses` : filtros.max ? `Até ${filtros.max} meses` : '')
        : filtros[campo];
      botao.querySelector('.filter-btn-label').textContent = valor || rotulos[campo];
      botao.classList.toggle('radar-ativo', Boolean(valor));
    }
    for (const aba of abas) {
      const valor = ({ graduacao: 'graduação', pos: 'pós-graduação' })[aba.dataset.level] ?? '';
      aba.className = 'level-tab-btn px-space-md py-1.5 rounded-full font-label-sm text-label-sm ' +
        (nivel === valor ? 'bg-surface-container-lowest text-primary shadow-sm font-bold' : 'text-on-surface-variant');
      aba.setAttribute('aria-pressed', String(nivel === valor));
    }
    if (erro) return;
    if (adiar) temporizador = setTimeout(() => carregar(consulta, versao), 250);
    else return carregar(consulta, versao);
  }

  function fecharPainel(devolverFoco = false) {
    if (!painelAberto) return;
    document.getElementById(painelAberto.getAttribute('aria-controls')).hidden = true;
    painelAberto.setAttribute('aria-expanded', 'false');
    if (devolverFoco) painelAberto.focus();
    painelAberto = null;
  }
  for (const botao of paineis) {
    const painel = document.getElementById(botao.getAttribute('aria-controls'));
    botao.addEventListener('click', () => {
      const jaAberto = painelAberto === botao;
      fecharPainel();
      if (jaAberto) return;
      painelAberto = botao;
      painel.hidden = false;
      botao.setAttribute('aria-expanded', 'true');
      painel.style.removeProperty('--radar-painel-esquerda');
      const excesso = painel.getBoundingClientRect().right + 12 - innerWidth;
      painel.style.setProperty('--radar-painel-esquerda', `${-Math.max(0, excesso)}px`);
      painel.querySelector('input, select').focus();
    });
    painel.querySelector('.radar-fechar').addEventListener('click', () => fecharPainel(true));
  }
  document.addEventListener('click', evento => {
    if (!evento.target.closest('.filter-dropdown-wrapper')) fecharPainel();
  });
  document.addEventListener('keydown', evento => { if (evento.key === 'Escape') fecharPainel(true); });
  for (const aba of abas) aba.addEventListener('click', () => {
    nivel = ({ graduacao: 'graduação', pos: 'pós-graduação' })[aba.dataset.level] ?? '';
    atualizar();
  });
  for (const input of Object.values(entrada)) input.addEventListener('input', () => atualizar({ adiar: true }));
  $('#explorar').closest('form').addEventListener('submit', evento => {
    evento.preventDefault();
    atualizar();
  });
  for (const botao of [$('#btn-reset-all-filters'), $('#limpar-vazio')]) {
    botao.addEventListener('click', () => {
      nivel = '';
      for (const input of Object.values(entrada)) input.value = '';
      atualizar();
      if (botao.id === 'limpar-vazio') entrada.busca.focus();
    });
  }
  $('#pagina-anterior').addEventListener('click', () => {
    offset = Math.max(0, offset - limite);
    atualizar({ manterPagina: true });
  });
  $('#pagina-seguinte').addEventListener('click', () => {
    offset += limite;
    atualizar({ manterPagina: true });
  });
  $('#tentar-catalogo').addEventListener('click', () => atualizar({ manterPagina: true }));
  await atualizar({ manterPagina: true });
}

function textoCriterio(criterio, valor) {
  if (valor === null || valor === undefined || valor === '') return 'Não informado';
  if (criterio.campo === 'creditos') return numero.format(valor) + '%';
  return typeof valor === 'number' ? numero.format(valor) : valor;
}

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function obterValorPerfil(perfilAluno, criterio, editalObj) {
  if (!perfilAluno) return null;
  const campo = criterio.campo;
  const chave = criterio.chave;
  if (campo === 'nivel') return perfilAluno.nivel ?? null;
  if (campo === 'i3') return perfilAluno.i3 ?? null;
  if (campo === 'creditos') {
    if (perfilAluno.creditos_totais) {
      return Number((perfilAluno.creditos_concluidos * 100 / perfilAluno.creditos_totais).toFixed(2));
    }
    return perfilAluno.creditos ?? null;
  }
  if (campo === 'idioma') {
    return perfilAluno.idiomas?.[chave || editalObj.idioma] ?? null;
  }
  if (campo === 'experiencia') {
    if (perfilAluno.experiencias === null || perfilAluno.experiencias === undefined) return null;
    const alvo = normalizar(chave || editalObj.area);
    const tem = (perfilAluno.experiencias || []).some(exp => normalizar(exp) === alvo);
    return tem ? 'Sim' : 'Não';
  }
  if (campo === 'disciplina') {
    if (perfilAluno.disciplinas === null || perfilAluno.disciplinas === undefined) return null;
    const alvo = normalizar(chave);
    const tem = (perfilAluno.disciplinas || []).some(disc => normalizar(disc) === alvo);
    return tem ? 'Sim' : 'Não';
  }
  if (campo === 'documento') {
    return perfilAluno.documentos?.[chave] ?? null;
  }
  return perfilAluno[campo] ?? null;
}

function avaliarPrevia(criterio, valor) {
  if (valor === null || valor === undefined || valor === '') return 'ausente';
  const campo = criterio.campo;
  const esperado = criterio.esperado;
  if (campo === 'i3' || campo === 'creditos') {
    return Number(valor) >= Number(esperado) ? 'atendido' : 'não atendido';
  }
  if (campo === 'idioma') {
    const niveis = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const idxPerfil = niveis.indexOf(valor);
    const idxEsp = niveis.indexOf(esperado);
    if (idxPerfil === -1) return 'ausente';
    return idxPerfil >= idxEsp ? 'atendido' : 'não atendido';
  }
  if (campo === 'documento') {
    return String(valor).trim() ? 'atendido' : 'ausente';
  }
  return normalizar(valor) === normalizar(esperado) ? 'atendido' : 'não atendido';
}

function cartaoDetalhesCriterio(criterio, perfilAluno, editalObj) {
  const item = document.createElement('div');
  item.className = 'radar-card-criterio';

  const cabecalho = document.createElement('div');
  cabecalho.className = 'flex items-center justify-between gap-2 mb-2 flex-wrap';

  const titulo = document.createElement('h3');
  titulo.className = 'text-title-md font-bold text-on-surface';
  titulo.textContent = criterio.rotulo;

  const badgeTipo = document.createElement('span');
  badgeTipo.className = criterio.obrigatorio ? 'radar-badge radar-badge-obrigatorio' : 'radar-badge radar-badge-adicional';
  badgeTipo.textContent = criterio.obrigatorio ? 'Obrigatório' : 'Adicional';
  cabecalho.append(titulo, badgeTipo);

  const corpo = document.createElement('div');
  corpo.className = 'flex flex-col gap-1.5 text-body-sm text-on-surface-variant my-1';

  const linhaExigido = document.createElement('p');
  linhaExigido.innerHTML = `<strong>Exigência do edital:</strong> ${textoCriterio(criterio, criterio.esperado)}`;
  corpo.append(linhaExigido);

  if (criterio.peso && !criterio.obrigatorio) {
    const linhaPeso = document.createElement('p');
    linhaPeso.innerHTML = `<span class="radar-badge radar-badge-info text-[11px]">Peso na pontuação: ${criterio.peso}</span>`;
    corpo.append(linhaPeso);
  }

  // Comparação com perfil do aluno (se logado)
  if (perfilAluno) {
    const valorPerfil = obterValorPerfil(perfilAluno, criterio, editalObj);
    const estado = avaliarPrevia(criterio, valorPerfil);
    item.dataset.estado = estado;

    const linhaPerfil = document.createElement('div');
    linhaPerfil.className = 'mt-2 pt-2 border-t border-surface-container flex items-center justify-between gap-2 flex-wrap';

    const textoVal = document.createElement('span');
    textoVal.className = 'text-body-sm';
    textoVal.innerHTML = `<strong>No seu perfil:</strong> ${textoCriterio(criterio, valorPerfil)}`;

    const statusBadge = document.createElement('span');
    if (estado === 'atendido') {
      statusBadge.className = 'radar-badge radar-badge-sucesso';
      statusBadge.innerHTML = '<span class="material-symbols-outlined text-[14px]">check</span> Atendido';
    } else if (estado === 'não atendido') {
      statusBadge.className = 'radar-badge radar-badge-erro';
      statusBadge.innerHTML = `<span class="material-symbols-outlined text-[14px]">close</span> ${criterio.obrigatorio ? 'Impeditivo' : 'Não atende'}`;
    } else {
      statusBadge.className = 'radar-badge radar-badge-alerta';
      statusBadge.innerHTML = '<span class="material-symbols-outlined text-[14px]">warning</span> Pendente de preenchimento';
    }
    linhaPerfil.append(textoVal, statusBadge);
    corpo.append(linhaPerfil);

    if (estado === 'ausente' && criterio.obrigatorio) {
      const alerta = document.createElement('p');
      alerta.className = 'text-[11px] text-amber-800 bg-amber-50 p-1.5 rounded border border-amber-200 mt-1';
      alerta.innerHTML = '⚠️ <strong>Pendente:</strong> Informe este dado no seu perfil para habilitar sua elegibilidade.';
      corpo.append(alerta);
    }
  }

  item.append(cabecalho, corpo);
  return item;
}

function cartaoCriterio(criterio, avaliado = false) {
  const item = document.createElement(avaliado ? 'li' : 'div');
  item.className = 'bg-surface-container-lowest rounded-xl shadow-sm p-space-md border border-surface-container-high/50';
  const titulo = document.createElement('strong');
  titulo.className = 'text-title-md text-on-surface block';
  titulo.textContent = criterio.rotulo;
  const tipo = document.createElement('p');
  tipo.className = 'text-body-sm text-on-surface-variant mt-0.5';
  tipo.textContent = [criterio.obrigatorio ? 'Obrigatório (Elegibilidade)' : 'Adicional (Pontuação)', criterio.peso ? `Peso: ${criterio.peso}` : null].filter(Boolean).join(' · ');
  const detalhe = document.createElement('p');
  detalhe.className = 'text-body-sm mt-space-xs';
  detalhe.textContent = (['i3', 'creditos', 'idioma'].includes(criterio.campo) ? 'Exigência mínima: ' : 'Critério: ') + textoCriterio(criterio, criterio.esperado);
  item.append(titulo, tipo, detalhe);
  if (avaliado) {
    detalhe.textContent += ` · Registrado no perfil: ${textoCriterio(criterio, criterio.valor)}`;
    const estado = document.createElement('p');
    estado.className = 'font-bold mt-space-xs';
    estado.textContent = ({ atendido: 'Atendido', 'não atendido': 'Não atendido', ausente: 'Pendente · Informação ausente' })[criterio.estado];
    const justificativa = document.createElement('p');
    justificativa.className = 'text-body-sm text-on-surface-variant mt-0.5';
    justificativa.textContent = criterio.justificativa;
    item.append(estado, justificativa);
  }
  return item;
}

function conectarSimulacao(botao) {
  let processando = false;
  botao.addEventListener('click', async evento => {
    evento.preventDefault();
    if (processando) return;
    processando = true;
    botao.setAttribute('aria-disabled', 'true');
    botao.setAttribute('aria-busy', 'true');
    $('#erro-simulacao').hidden = true;
    try {
      await aplicarPerfilExemplo();
      const resultado = await api(`/oportunidades/${encodeURIComponent(edital.id)}/simulacoes`, { method: 'POST' });
      location.assign(urlResultado(resultado));
    } catch (erro) { mostrarErro($('#erro-simulacao'), erro); }
    finally {
      processando = false;
      botao.removeAttribute('aria-disabled');
      botao.removeAttribute('aria-busy');
    }
  });
}

async function iniciarDetalhes() {
  if (!params.get('edital')) throw new Error('Escolha uma oportunidade no catálogo.');
  edital = await api(`/oportunidades/${encodeURIComponent(params.get('edital'))}`);
  atualizarSlots($('main'), valoresEdital(edital));
  const botao = $('[data-resultado]');
  botao.href = '#';
  conectarSimulacao(botao);

  // Tenta carregar perfil para exibir comparação imediata
  let perfilAluno = null;
  try { await aplicarPerfilExemplo(); } catch {}
  try { perfilAluno = await api('/perfil'); } catch {}
  if (MODO_USA_PERFIL_EXEMPLO) {
    const aviso = document.createElement('p');
    aviso.className = 'radar-aviso radar-aviso-alerta';
    aviso.textContent = 'Modo perfil de exemplo ativo: os dados do seu perfil são fictícios (MODO_USA_PERFIL_EXEMPLO em config.js).';
    $('#erro-simulacao').before(aviso);
  }

  const obrigatorios = edital.requisitos.filter(c => c.obrigatorio);
  const adicionais = edital.requisitos.filter(c => !c.obrigatorio);

  const containerObrigatorios = $('#requisitos-obrigatorios');
  if (containerObrigatorios) {
    containerObrigatorios.replaceChildren(...obrigatorios.map(c => cartaoDetalhesCriterio(c, perfilAluno, edital)));
  }

  const containerAdicionais = $('#requisitos-adicionais');
  if (containerAdicionais) {
    if (adicionais.length === 0) {
      $('#sem-adicionais')?.removeAttribute('hidden');
    } else {
      $('#sem-adicionais')?.setAttribute('hidden', 'true');
      containerAdicionais.replaceChildren(...adicionais.map(c => cartaoDetalhesCriterio(c, perfilAluno, edital)));
    }
  }

  // Compatibilidade legada
  const containerLegado = $('#requisitos');
  if (containerLegado) {
    containerLegado.replaceChildren(...edital.requisitos.map(item => cartaoCriterio(item)));
  }
}

async function iniciarResultado() {
  if (!params.get('simulacao')) throw new Error('Abra os detalhes de um edital e clique em Simular Minha Compatibilidade.');
  const avaliacao = await api(`/simulacoes/${encodeURIComponent(params.get('simulacao'))}`);
  edital = avaliacao.oportunidade_snapshot;
  atualizarSlots($('main'), { ...valoresEdital(edital), estado: avaliacao.estado });
  $('[data-detalhes]').href = url('detalhes');

  // --- 1. RESULTADO DA ELEGIBILIDADE ---
  const painelElegibilidade = $('#painel-elegibilidade');
  const badgeElegibilidade = $('#badge-elegibilidade');
  const iconeElegibilidade = $('#icone-elegibilidade');
  const tituloElegibilidade = $('#titulo-elegibilidade');
  const textoElegibilidade = $('#elegibilidade');
  const btnPerfil = $('#btn-acao-perfil') || $('main [data-perfil]');

  if (avaliacao.candidatura_habilitada) {
    painelElegibilidade.dataset.situacao = 'compativel';
    badgeElegibilidade.className = 'radar-badge radar-badge-sucesso';
    badgeElegibilidade.innerHTML = '<span class="material-symbols-outlined text-[16px]">check_circle</span> Candidatura Habilitada';
    iconeElegibilidade.textContent = 'check_circle';
    iconeElegibilidade.className = 'material-symbols-outlined text-[36px] text-emerald-600 shrink-0';
    tituloElegibilidade.textContent = 'Elegível';
    textoElegibilidade.textContent = 'Você atende a todos os critérios obrigatórios deste edital. Sua candidatura está autorizada.';
    if (btnPerfil) btnPerfil.textContent = 'Editar perfil';
  } else if (avaliacao.incompleta) {
    painelElegibilidade.dataset.situacao = 'incompleta';
    badgeElegibilidade.className = 'radar-badge radar-badge-alerta';
    badgeElegibilidade.innerHTML = '<span class="material-symbols-outlined text-[16px]">pending_actions</span> Avaliação Incompleta';
    iconeElegibilidade.textContent = 'pending_actions';
    iconeElegibilidade.className = 'material-symbols-outlined text-[36px] text-amber-600 shrink-0';
    tituloElegibilidade.textContent = 'Avaliação Incompleta';
    textoElegibilidade.textContent = 'Candidatura bloqueada. Existem informações ou documentos obrigatórios ausentes no seu perfil. Complete o perfil para viabilizar a análise.';
    if (btnPerfil) btnPerfil.textContent = 'Completar perfil';
  } else {
    painelElegibilidade.dataset.situacao = 'incompativel';
    badgeElegibilidade.className = 'radar-badge radar-badge-erro';
    badgeElegibilidade.innerHTML = '<span class="material-symbols-outlined text-[16px]">cancel</span> Não Elegível';
    iconeElegibilidade.textContent = 'cancel';
    iconeElegibilidade.className = 'material-symbols-outlined text-[36px] text-red-600 shrink-0';
    tituloElegibilidade.textContent = 'Não Elegível';
    textoElegibilidade.textContent = 'Candidatura bloqueada. Pelo menos um critério obrigatório mínimo não foi atendido. Critérios adicionais não substituem critérios obrigatórios.';
    if (btnPerfil) btnPerfil.textContent = 'Ajustar perfil';
  }

  // --- 2. COMPATIBILIDADE GERAL ---
  const adicionais = avaliacao.criterios.filter(c => !c.obrigatorio);
  const temAdicionais = adicionais.length > 0;
  const elementoIndice = $('#indice');
  const formulaExplicacao = $('#formula-explicacao');
  const badgeFormula = $('#badge-formula');
  const msgNaoAplicavel = $('#compatibilidade-nao-aplicavel');

  if (!temAdicionais) {
    elementoIndice.textContent = 'N/A';
    if (badgeFormula) badgeFormula.textContent = 'Fórmula: Não aplicável';
    if (formulaExplicacao) formulaExplicacao.hidden = true;
    if (msgNaoAplicavel) msgNaoAplicavel.hidden = false;
  } else {
    if (badgeFormula) badgeFormula.textContent = 'Fórmula: Média Ponderada';
    if (msgNaoAplicavel) msgNaoAplicavel.hidden = true;
    if (formulaExplicacao) formulaExplicacao.hidden = false;

    if (avaliacao.incompleta) {
      elementoIndice.textContent = '—';
      if (formulaExplicacao) {
        formulaExplicacao.textContent = 'O cálculo do percentual geral permanece suspenso até que as informações obrigatórias do perfil sejam preenchidas.';
      }
    } else {
      elementoIndice.textContent = avaliacao.indice === null ? '—' : `${avaliacao.indice}%`;
      if (formulaExplicacao) {
        formulaExplicacao.textContent = `Calculada pela média ponderada dos critérios adicionais pontuados (${avaliacao.pontos_obtidos} de ${avaliacao.peso_total} pontos possíveis).`;
      }
    }
  }

  $('#data-simulacao').textContent = `Simulação realizada em ${dataHora(avaliacao.criado_em)}.`;

  // --- 3. SEÇÃO DE CRITÉRIOS OBRIGATÓRIOS (ELIMINATÓRIOS) ---
  const obrigatorios = avaliacao.criterios.filter(c => c.obrigatorio);
  const obAtendidos = obrigatorios.filter(c => c.estado === 'atendido');
  const obNaoAtendidos = obrigatorios.filter(c => c.estado === 'não atendido');
  const obAusentes = obrigatorios.filter(c => c.estado === 'ausente');

  $('#contagem-obrigatorios-atendidos').textContent = obAtendidos.length;
  $('#contagem-obrigatorios-nao-atendidos').textContent = obNaoAtendidos.length;
  $('#contagem-obrigatorios-ausentes').textContent = obAusentes.length;

  function renderCardObrigatorio(criterio, tipo) {
    const li = document.createElement('li');
    li.className = 'p-space-sm rounded-xl border flex flex-col gap-1 text-body-sm';
    if (tipo === 'atendido') {
      li.className += ' bg-emerald-50/60 border-emerald-200 text-emerald-950';
    } else if (tipo === 'nao_atendido') {
      li.className += ' bg-red-50/60 border-red-200 text-red-950';
    } else {
      li.className += ' bg-amber-50/60 border-amber-200 text-amber-950';
    }

    const topo = document.createElement('div');
    topo.className = 'flex items-center justify-between gap-1';
    const strong = document.createElement('strong');
    strong.textContent = criterio.rotulo;
    topo.append(strong);

    const detalhe = document.createElement('p');
    detalhe.className = 'text-[12px] opacity-90';
    detalhe.innerHTML = `<strong>Exigido:</strong> ${textoCriterio(criterio, criterio.esperado)} · <strong>Seu perfil:</strong> ${textoCriterio(criterio, criterio.valor)}`;

    const motivo = document.createElement('p');
    motivo.className = 'text-[11px] font-medium mt-0.5';
    if (tipo === 'nao_atendido') {
      motivo.textContent = '⛔ Requisito não atendido: impede a candidatura.';
    } else if (tipo === 'ausente') {
      motivo.textContent = '⚠️ Documento/informação ausente: impede a avaliação de elegibilidade.';
    } else {
      motivo.textContent = '✓ Requisito atendido com sucesso.';
    }

    li.append(topo, detalhe, motivo);
    return li;
  }

  function preencherListaObrigatorios(containerId, itens, tipo, vazioMsg) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (itens.length === 0) {
      const li = document.createElement('li');
      li.className = 'text-[12px] text-on-surface-variant italic p-2';
      li.textContent = vazioMsg;
      container.replaceChildren(li);
    } else {
      container.replaceChildren(...itens.map(c => renderCardObrigatorio(c, tipo)));
    }
  }

  preencherListaObrigatorios('obrigatorios-atendidos', obAtendidos, 'atendido', 'Nenhum requisito atendido.');
  preencherListaObrigatorios('obrigatorios-nao-atendidos', obNaoAtendidos, 'nao_atendido', 'Nenhum requisito impeditivo.');
  preencherListaObrigatorios('obrigatorios-ausentes', obAusentes, 'ausente', 'Nenhuma informação pendente.');

  // --- 4. SEÇÃO DE CRITÉRIOS ADICIONAIS (CLASSIFICATÓRIOS) ---
  const containerAdicionais = $('#lista-adicionais');
  const msgSemAdicionais = $('#sem-criterios-adicionais-msg');

  if (adicionais.length === 0) {
    if (msgSemAdicionais) msgSemAdicionais.hidden = false;
    if (containerAdicionais) containerAdicionais.replaceChildren();
  } else {
    if (msgSemAdicionais) msgSemAdicionais.hidden = true;
    containerAdicionais.replaceChildren(...adicionais.map(criterio => {
      const card = document.createElement('div');
      card.className = 'radar-card-criterio bg-surface-container-lowest border border-surface-container-high/60';

      const topo = document.createElement('div');
      topo.className = 'flex items-start justify-between gap-2 mb-2';

      const rotulo = document.createElement('h4');
      rotulo.className = 'text-title-md font-bold text-on-surface';
      rotulo.textContent = criterio.rotulo;

      const badges = document.createElement('div');
      badges.className = 'flex items-center gap-1.5 flex-wrap';

      const badgeAdicional = document.createElement('span');
      badgeAdicional.className = 'radar-badge radar-badge-adicional';
      badgeAdicional.textContent = 'Não impeditivo';
      badges.append(badgeAdicional);

      if (criterio.peso) {
        const badgePeso = document.createElement('span');
        badgePeso.className = 'radar-badge radar-badge-info';
        badgePeso.textContent = `Peso: ${criterio.peso}`;
        badges.append(badgePeso);
      }
      topo.append(rotulo, badges);

      // Pontuação individual (0% a 100%)
      const pontuacaoDiv = document.createElement('div');
      pontuacaoDiv.className = 'my-2';

      const pontuacaoRotulo = document.createElement('div');
      pontuacaoRotulo.className = 'flex justify-between items-center text-body-sm font-semibold mb-1';
      pontuacaoRotulo.innerHTML = `<span>Pontuação Individual:</span> <span class="font-bold text-primary">${criterio.percentual}%</span>`;

      const barraContainer = document.createElement('div');
      barraContainer.className = 'radar-barra-progresso';
      const barraValor = document.createElement('div');
      barraValor.className = 'radar-barra-valor';
      barraValor.style.width = `${criterio.percentual}%`;
      barraValor.dataset.pontuacao = String(criterio.percentual);
      barraContainer.append(barraValor);
      pontuacaoDiv.append(pontuacaoRotulo, barraContainer);

      // Detalhes da avaliação
      const corpo = document.createElement('div');
      corpo.className = 'text-body-sm text-on-surface-variant flex flex-col gap-1 mt-1';

      const linhaDados = document.createElement('p');
      linhaDados.className = 'text-[12px]';
      linhaDados.innerHTML = `<strong>Condição:</strong> ${textoCriterio(criterio, criterio.esperado)} · <strong>Seu perfil:</strong> ${textoCriterio(criterio, criterio.valor)}`;

      const justificativa = document.createElement('p');
      justificativa.className = 'text-[11px] text-on-surface-variant italic mt-1';
      justificativa.textContent = criterio.justificativa;

      corpo.append(linhaDados, justificativa);
      card.append(topo, pontuacaoDiv, corpo);
      return card;
    }));
  }

  // --- Suporte a Contêineres Legados (evita regressão) ---
  const listaAtendidos = $('#atendidos');
  const listaPendencias = $('#pendencias');
  if (listaAtendidos && listaPendencias) {
    listaAtendidos.replaceChildren(...avaliacao.atendidos.map(c => cartaoCriterio(c, true)));
    listaPendencias.replaceChildren(...[...avaliacao.nao_atendidos, ...avaliacao.ausentes].map(c => cartaoCriterio(c, true)));
  }

  conectarSimulacao($('#simular-novamente'));
}

async function iniciarPerfil() {
  perfil = await api('/perfil');
  // O ID basta para retornar ao edital; resultados anteriores continuam preservados.
  edital = params.get('edital') ? { id: params.get('edital') } : null;
  const retorno = params.get('voltar');
  const simularAoSalvar = edital && retorno === 'resultado';
  $('#cancelar-perfil').href = simularAoSalvar && params.get('simulacao')
    ? urlResultado({ oportunidade_id: edital.id, id: params.get('simulacao') })
    : edital && ['resultado', 'detalhes'].includes(retorno) ? url('detalhes') : url('index');
  for (const campo of ['nome', 'curso', 'area', 'nivel']) $('#' + campo + '-perfil').value = perfil[campo] ?? '';
  $('#i3').value = perfil.i3 ?? '';
  $('#creditos').value = perfil.creditos ?? '';
  $('#creditos-concluidos').value = perfil.creditos_concluidos ?? '';
  $('#creditos-totais').value = perfil.creditos_totais ?? '';
  $('#fonte-creditos').value = perfil.creditos_totais === null ? 'percentual' : 'contagem';
  opcoes($('#areas-perfil'), areas);
  $('#historico-escolar').value = perfil.documentos.historico_escolar ?? '';
  function fonteCreditos() {
    const contagem = $('#fonte-creditos').value === 'contagem';
    $('#campo-percentual').hidden = contagem;
    $('#creditos').disabled = contagem;
    $('#campos-contagem').hidden = !contagem;
    for (const campo of ['#creditos-concluidos', '#creditos-totais']) {
      $(campo).disabled = !contagem;
      $(campo).required = contagem;
    }
  }
  $('#fonte-creditos').addEventListener('change', fonteCreditos);
  fonteCreditos();
  for (const idioma of idiomas) {
    const campo = document.createElement('select');
    campo.className = 'radar-campo';
    campo.dataset.idioma = idioma;
    campo.append(new Option('Não informado', ''));
    opcoes(campo, niveisIdioma);
    campo.value = perfil.idiomas[idioma] ?? '';
    const label = document.createElement('label');
    label.append(idioma, campo);
    $('#idiomas-perfil').append(label);
  }
  for (const campo of ['experiencias', 'disciplinas']) {
    const informado = $('#' + campo + '-informadas');
    const texto = $('#' + campo + '-perfil');
    informado.checked = perfil[campo] !== null;
    texto.value = (perfil[campo] ?? []).join('\n');
    texto.disabled = !informado.checked;
    informado.addEventListener('change', () => { texto.disabled = !informado.checked; });
  }
  const botao = $('#form-perfil button[type="submit"]');
  botao.textContent = simularAoSalvar ? 'Salvar perfil e simular novamente' : 'Salvar perfil';
  let salvando = false;
  $('#form-perfil').addEventListener('submit', async evento => {
    evento.preventDefault();
    if (salvando) return;
    $('#erro-perfil').hidden = true;
    const lerNumero = id => $(id).value === '' ? null : $(id).valueAsNumber;
    const lista = campo => $('#' + campo + '-informadas').checked
      ? $('#' + campo + '-perfil').value.split('\n').map(linha => linha.trim()).filter(Boolean) : null;
    const contagem = $('#fonte-creditos').value === 'contagem';
    if (contagem && lerNumero('#creditos-concluidos') > lerNumero('#creditos-totais')) {
      mostrarErro($('#erro-perfil'), new Error('Créditos concluídos não podem exceder os créditos totais.'));
      return;
    }
    const documentos = { ...perfil.documentos };
    const historico = $('#historico-escolar').value.trim();
    if (historico) documentos.historico_escolar = historico;
    else delete documentos.historico_escolar;
    // PUT aceita apenas os campos de entrada; metadados da resposta não são reenviados.
    const atualizado = {
      nome: $('#nome-perfil').value.trim(), curso: $('#curso-perfil').value.trim() || null,
      area: $('#area-perfil').value.trim() || null, nivel: $('#nivel-perfil').value || null,
      i3: lerNumero('#i3'), creditos: contagem ? null : lerNumero('#creditos'),
      creditos_concluidos: contagem ? lerNumero('#creditos-concluidos') : null,
      creditos_totais: contagem ? lerNumero('#creditos-totais') : null,
      idiomas: Object.fromEntries($$('[data-idioma]').filter(e => e.value).map(e => [e.dataset.idioma, e.value])),
      experiencias: lista('experiencias'), disciplinas: lista('disciplinas'), documentos,
    };
    salvando = true;
    botao.disabled = true;
    let salvo = false;
    try {
      perfil = await api('/perfil', { method: 'PUT', body: atualizado });
      salvo = true;
      if (simularAoSalvar) {
        const resultado = await api(`/oportunidades/${encodeURIComponent(edital.id)}/simulacoes`, { method: 'POST' });
        location.assign(urlResultado(resultado));
      } else location.assign(edital && retorno === 'detalhes' ? url('detalhes') : url('index'));
    } catch (erro) {
      mostrarErro($('#erro-perfil'), new Error((salvo ? 'Perfil salvo, mas não foi possível criar a simulação. ' : '') + erro.message));
    } finally { salvando = false; botao.disabled = false; }
  });
}

async function iniciarHistorico() {
  let offset = 0;
  let carregando = false;
  const botao = $('#mais-simulacoes');
  async function carregar() {
    if (carregando) return;
    carregando = true;
    botao.disabled = true;
    $('#erro-historico').hidden = true;
    $('#historico-status').textContent = 'Carregando simulações…';
    try {
      const resposta = await api(`/simulacoes?limite=20&offset=${offset}`);
      for (const resultado of resposta.itens) {
        const item = document.createElement('article');
        item.className = 'bg-surface-container-lowest rounded-2xl p-space-lg shadow-sm';
        const titulo = document.createElement('h2');
        titulo.className = 'text-title-md font-bold';
        titulo.textContent = resultado.oportunidade_snapshot.universidade;
        const descricao = document.createElement('p');
        descricao.textContent = `${dataHora(resultado.criado_em)} · ${resultado.estado} · Índice: ${resultado.indice === null ? 'sem índice' : resultado.indice + '%'}`;
        const link = document.createElement('a');
        link.className = 'inline-block mt-space-sm text-primary font-bold';
        link.href = urlResultado(resultado);
        link.textContent = 'Ver resultado salvo';
        item.append(titulo, descricao, link);
        $('#lista-simulacoes').append(item);
      }
      offset += resposta.itens.length;
      botao.hidden = offset >= resposta.total;
      $('#historico-status').textContent = resposta.total ? `${offset} de ${resposta.total} simulações.` : 'Você ainda não realizou simulações. Explore o catálogo para começar.';
    } catch (erro) {
      mostrarErro($('#erro-historico p'), erro);
      $('#erro-historico').hidden = false;
      $('#historico-status').textContent = '';
    } finally { carregando = false; botao.disabled = false; }
  }
  botao.addEventListener('click', carregar);
  $('#tentar-historico').addEventListener('click', carregar);
  await carregar();
}

function iniciarLogin() {
  $('.radar-conta').hidden = true;
  $('.radar-navegacao').hidden = true;
  let cadastro = false;
  let enviando = false;
  if (params.get('expirada')) $('#aviso-login').textContent = 'Sua sessão expirou ou foi encerrada. Entre novamente para continuar.';
  $('#alternar-login').addEventListener('click', () => {
    cadastro = !cadastro;
    $('#campo-nome-login').hidden = !cadastro;
    $('#nome-login').required = cadastro;
    $('#titulo-login').textContent = cadastro ? 'Criar sua conta' : 'Entrar na sua conta';
    $('#enviar-login').textContent = cadastro ? 'Criar conta e entrar' : 'Entrar';
    $('#alternar-login').textContent = cadastro ? 'Já tenho uma conta' : 'Criar uma conta';
    $('#senha-login').autocomplete = cadastro ? 'new-password' : 'current-password';
    $('#erro-login').hidden = true;
  });
  $('#form-login').addEventListener('submit', async evento => {
    evento.preventDefault();
    if (enviando) return;
    enviando = true;
    $('#enviar-login').disabled = true;
    $('#alternar-login').disabled = true;
    $('#erro-login').hidden = true;
    const credenciais = { email: $('#email-login').value.trim(), senha: $('#senha-login').value };
    try {
      if (cadastro) {
        await api('/auth/cadastro', { method: 'POST', body: { ...credenciais, nome: $('#nome-login').value.trim() }, publico: true });
        // Se o login falhar após cadastrar, a próxima tentativa deve apenas entrar.
        cadastro = false;
        $('#campo-nome-login').hidden = true;
        $('#nome-login').required = false;
        $('#titulo-login').textContent = 'Entrar na sua conta';
        $('#enviar-login').textContent = 'Entrar';
        $('#alternar-login').textContent = 'Criar uma conta';
        $('#senha-login').autocomplete = 'current-password';
        $('#aviso-login').textContent = 'Conta criada. Você já pode entrar com seu e-mail e senha.';
      }
      const sessao = await api('/auth/login', { method: 'POST', body: credenciais, publico: true });
      salvarToken(sessao.access_token);
      $('#senha-login').value = '';
      location.assign(destinoSeguro(params.get('voltar')));
    } catch (erro) { mostrarErro($('#erro-login'), erro); }
    finally { enviando = false; $('#enviar-login').disabled = false; $('#alternar-login').disabled = false; }
  });
}

async function iniciar() {
  const principal = $('main');
  if (pagina === 'login') {
    iniciarLogin();
    principal.hidden = false;
    $('#estado-pagina').hidden = true;
    return;
  }
  if (!lerToken()) { pedirLogin(); return; }
  try {
    const usuario = await api('/auth/me');
    atualizarSlots(document, { nomePerfil: usuario.nome });
    const rotas = { index: iniciarCatalogo, perfil: iniciarPerfil, detalhes: iniciarDetalhes, resultado: iniciarResultado, historico: iniciarHistorico };
    await rotas[pagina]();
    // O nome acadêmico pode ser editado independentemente do nome de cadastro.
    if (perfil) atualizarSlots(document, { nomePerfil: perfil.nome });
    links();
    principal.hidden = false;
    $('#estado-pagina').hidden = true;
  } catch (erro) {
    if (erro instanceof ApiError && erro.status === 401) return;
    const estado = $('#estado-pagina');
    estado.setAttribute('role', 'alert');
    estado.textContent = erro.message + ' ';
    const voltar = document.createElement('a');
    voltar.href = url('index');
    voltar.textContent = 'Voltar ao catálogo';
    const tentar = document.createElement('button');
    tentar.className = 'radar-botao';
    tentar.textContent = 'Tentar novamente';
    tentar.addEventListener('click', () => location.reload());
    estado.append(voltar, ' ', tentar);
  }
}

$('#sair').addEventListener('click', async () => {
  $('#sair').disabled = true;
  try {
    await api('/auth/logout', { method: 'POST' });
    limparSessao();
    location.replace('login.html');
  } catch (erro) {
    if (erro instanceof ApiError && erro.status === 401) return;
    let aviso = $('#erro-sair');
    if (!aviso) {
      aviso = document.createElement('p');
      aviso.id = 'erro-sair';
      aviso.className = 'radar-status-pagina';
      aviso.setAttribute('role', 'alert');
      $('main').before(aviso);
    }
    aviso.textContent = 'Não foi possível encerrar a sessão. ' + erro.message;
    $('#sair').disabled = false;
  }
});

iniciar();
