import { areas, idiomas, niveisIdioma } from './dados.js';
import { imagens } from './imagens.js';
import { api, ApiError, lerToken, salvarToken, limparSessao, pedirLogin, destinoSeguro } from './api.js';

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
  if (valor === null) return 'Não informado';
  if (criterio.campo === 'creditos') return numero.format(valor) + '%';
  return typeof valor === 'number' ? numero.format(valor) : valor;
}

function cartaoCriterio(criterio, avaliado = false) {
  const item = document.createElement(avaliado ? 'li' : 'div');
  item.className = 'bg-surface-container-lowest rounded-xl shadow-sm p-space-md';
  const titulo = document.createElement('strong');
  titulo.textContent = criterio.rotulo;
  const tipo = document.createElement('p');
  tipo.className = 'text-body-sm text-on-surface-variant';
  tipo.textContent = [criterio.obrigatorio ? 'Obrigatório' : 'Adicional', criterio.peso ? `peso ${criterio.peso}` : null].filter(Boolean).join(' · ');
  const detalhe = document.createElement('p');
  detalhe.className = 'text-body-sm mt-space-xs';
  detalhe.textContent = (['i3', 'creditos', 'idioma'].includes(criterio.campo) ? 'Mínimo: ' : 'Critério: ') + textoCriterio(criterio, criterio.esperado);
  item.append(titulo, tipo, detalhe);
  if (avaliado) {
    detalhe.textContent += ` · Perfil: ${textoCriterio(criterio, criterio.valor)}`;
    const estado = document.createElement('p');
    estado.className = 'font-bold mt-space-xs';
    estado.textContent = ({ atendido: 'Atendido', 'não atendido': 'Não atendido', ausente: 'Não avaliado · falta informação' })[criterio.estado];
    const justificativa = document.createElement('p');
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
  $('#requisitos').append(...edital.requisitos.map(item => cartaoCriterio(item)));
  const prazo = document.createElement('p');
  prazo.textContent = `Inscrições até ${edital.data_limite.split('-').reverse().join('/')}.`;
  $('#requisitos').before(prazo);
}

async function iniciarResultado() {
  if (!params.get('simulacao')) throw new Error('Abra os detalhes de um edital e clique em Simular Minha Compatibilidade.');
  const avaliacao = await api(`/simulacoes/${encodeURIComponent(params.get('simulacao'))}`);
  edital = avaliacao.oportunidade_snapshot;
  atualizarSlots($('main'), { ...valoresEdital(edital), estado: avaliacao.estado });
  $('[data-detalhes]').href = url('detalhes');
  $('#indice').textContent = avaliacao.indice === null ? '—' : `${avaliacao.indice}%`;
  $('#elegibilidade').textContent = avaliacao.candidatura_habilitada
    ? 'Você atende aos requisitos obrigatórios deste edital.'
    : avaliacao.incompleta ? 'Candidatura bloqueada. Complete as informações obrigatórias.'
      : 'Candidatura bloqueada. Consulte abaixo os requisitos obrigatórios.';
  $('main [data-perfil]').textContent = avaliacao.incompleta ? 'Completar perfil' : 'Editar perfil';
  $('#data-simulacao').textContent = `Simulação salva em ${dataHora(avaliacao.criado_em)}. Alterações posteriores no perfil não modificam este resultado.`;
  for (const criterio of avaliacao.criterios) {
    const lista = criterio.estado === 'atendido' ? $('#atendidos') : $('#pendencias');
    lista.append(cartaoCriterio(criterio, true));
  }
  for (const [id, mensagem] of [['atendidos', 'Nenhum critério atendido.'], ['pendencias', 'Nenhuma pendência.']]) {
    if (!document.getElementById(id).children.length) {
      const item = document.createElement('li');
      item.textContent = mensagem;
      document.getElementById(id).append(item);
    }
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
