import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError, lerToken, salvarToken, limparSessao, destinoSeguro, pedirLogin } from '../api.js';

const fetchOriginal = globalThis.fetch;
let armazenamento;
let redirecionamento;
let principalOculto;
const resposta = (status, dados) => ({ status, ok: status >= 200 && status < 300, json: async () => dados });

beforeEach(() => {
  armazenamento = new Map();
  redirecionamento = null;
  principalOculto = false;
  globalThis.sessionStorage = {
    getItem: chave => armazenamento.get(chave) ?? null,
    setItem: (chave, valor) => armazenamento.set(chave, valor),
    removeItem: chave => armazenamento.delete(chave),
  };
  globalThis.location = {
    href: 'http://127.0.0.1:8000/resultado.html?simulacao=abc',
    origin: 'http://127.0.0.1:8000', pathname: '/resultado.html', search: '?simulacao=abc',
    replace: valor => { redirecionamento = valor; },
  };
  globalThis.document = { querySelector: () => ({ setAttribute: () => { principalOculto = true; } }) };
});
afterEach(() => { globalThis.fetch = fetchOriginal; });

test('login público envia credenciais literais sem token de outra sessão', async () => {
  salvarToken('anterior');
  globalThis.fetch = async (endereco, opcoes) => {
    assert.equal(endereco, 'http://127.0.0.1:8001/api/auth/login');
    assert.equal(opcoes.method, 'POST');
    assert.equal(opcoes.headers.Authorization, undefined);
    assert.equal(opcoes.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(opcoes.body), { email: 'aluno@example.com', senha: ' senha com espaços ' });
    return resposta(200, { access_token: 'novo' });
  };
  const resultado = await api('/auth/login', { method: 'POST', publico: true,
    body: { email: 'aluno@example.com', senha: ' senha com espaços ' } });
  assert.equal(resultado.access_token, 'novo');
});

test('consultas autenticadas enviam Bearer e preservam filtros codificados', async () => {
  salvarToken('sessao');
  globalThis.fetch = async (endereco, opcoes) => {
    assert.equal(new URL(endereco).searchParams.get('pais'), 'Itália');
    assert.equal(opcoes.headers.Authorization, 'Bearer sessao');
    assert.equal(opcoes.body, undefined);
    assert.equal(opcoes.cache, 'no-store');
    return resposta(200, { itens: [], total: 0 });
  };
  assert.equal((await api('/oportunidades?pais=It%C3%A1lia')).total, 0);
});

test('PUT de perfil serializa listas vazias, campos ausentes e referência documental', async () => {
  const perfil = { nome: 'Aluno', i3: 0, creditos: null, experiencias: [], disciplinas: null,
    documentos: { historico_escolar: 'historico.pdf' } };
  globalThis.fetch = async (endereco, opcoes) => {
    assert.equal(opcoes.method, 'PUT');
    assert.deepEqual(JSON.parse(opcoes.body), perfil);
    return resposta(200, perfil);
  };
  assert.deepEqual(await api('/perfil', { method: 'PUT', body: perfil }), perfil);
});

test('logout aceita resposta 204 sem tentar ler JSON', async () => {
  globalThis.fetch = async () => ({ status: 204, ok: true, json: () => assert.fail('204 não tem JSON') });
  assert.equal(await api('/auth/logout', { method: 'POST' }), null);
});

test('senha incorreta mostra erro sem iniciar ciclo de redirecionamentos', async () => {
  globalThis.fetch = async () => resposta(401, { mensagem: 'E-mail ou senha inválidos.' });
  await assert.rejects(api('/auth/login', { method: 'POST', publico: true }), erro => erro.status === 401);
  assert.equal(redirecionamento, null);
});

test('401 protegido remove sessão, oculta conteúdo e preserva destino para o login', async () => {
  salvarToken('expirado');
  globalThis.fetch = async () => resposta(401, { mensagem: 'Sessão inválida.' });
  await assert.rejects(api('/perfil'), erro => erro instanceof ApiError && erro.status === 401);
  assert.equal(lerToken(), null);
  assert.equal(principalOculto, true);
  const destino = new URL(redirecionamento, location.href);
  assert.equal(destino.pathname, '/login.html');
  assert.equal(destino.searchParams.get('expirada'), '1');
  assert.equal(destino.searchParams.get('voltar'), 'resultado.html?simulacao=abc');
});

test('erros de validação incluem orientação e campo retornado pela API', async () => {
  globalThis.fetch = async () => resposta(422, { mensagem: 'Dados inválidos.', erros: [{ campo: 'body.i3', mensagem: 'Máximo 10.' }] });
  await assert.rejects(api('/perfil', { method: 'PUT', body: {} }), erro =>
    erro.status === 422 && erro.message.includes('body.i3: Máximo 10.'));
});

test('edital encerrado mantém mensagem de negócio e sessão', async () => {
  salvarToken('sessao');
  globalThis.fetch = async () => resposta(409, { mensagem: 'Edital encerrado.' });
  await assert.rejects(api('/oportunidades/milano'), erro => erro.status === 409 && erro.message === 'Edital encerrado.');
  assert.equal(lerToken(), 'sessao');
});

test('servidor indisponível mostra instrução para iniciar o back-end', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(api('/perfil'), /Confira se o back-end está rodando/);
});

test('cancelamento de filtro anterior não vira mensagem de falha de conexão', async () => {
  const controller = new AbortController();
  globalThis.fetch = async (endereco, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')));
  });
  const pedido = api('/oportunidades', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pedido, erro => erro.name === 'AbortError');
});

test('tempo limite informa demora e permite tentar novamente', async contexto => {
  contexto.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = async (endereco, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Tempo esgotado', 'AbortError')));
  });
  const pedido = api('/perfil');
  contexto.mock.timers.tick(15000);
  await assert.rejects(pedido, /demorou para responder/);
});

test('retorno do login aceita apenas páginas internas conhecidas', () => {
  assert.equal(destinoSeguro('detalhes.html?edital=milano'), 'detalhes.html?edital=milano');
  for (const destino of ['https://outro.example/index.html', '//outro.example/index.html', 'javascript:alert(1)', '/outra/index.html', 'login.html', 'http://[']) {
    assert.equal(destinoSeguro(destino), 'index.html');
  }
  pedirLogin();
  assert.equal(new URL(redirecionamento, location.href).searchParams.get('expirada'), null);
});

test('bloqueio de armazenamento impede login com mensagem clara', () => {
  globalThis.sessionStorage = {
    getItem: () => { throw new Error('Bloqueado'); },
    setItem: () => { throw new Error('Bloqueado'); },
    removeItem: () => { throw new Error('Bloqueado'); },
  };
  assert.equal(lerToken(), null);
  assert.throws(() => salvarToken('token'), /Permita o armazenamento/);
  assert.doesNotThrow(limparSessao);
});
