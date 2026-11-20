import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { api, salvarToken, limparSessao } from '../api.js';

const backend = fileURLToPath(new URL('../../backend/', import.meta.url));
const python = process.env.RADAR_TEST_PYTHON || backend + '.venv/bin/python';
const dependencias = spawnSync(python, ['-c', 'import fastapi, httpx'], { cwd: backend });

test('cliente JavaScript conversa com API real: conta, filtros, perfil, simulações e saída', {
  skip: dependencias.status !== 0 ? 'Ative as dependências do backend ou defina RADAR_TEST_PYTHON.' : false,
  timeout: 20000,
}, async () => {
  const originalFetch = globalThis.fetch;
  const armazenamento = new Map();
  globalThis.sessionStorage = {
    getItem: chave => armazenamento.get(chave) ?? null,
    setItem: (chave, valor) => armazenamento.set(chave, valor),
    removeItem: chave => armazenamento.delete(chave),
  };
  const ponte = spawn(python, ['-u', fileURLToPath(new URL('backend_bridge.py', import.meta.url))], {
    cwd: backend, env: { ...process.env, PYTHONPATH: backend }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pendentes = new Map();
  let contador = 0;
  let pronto, falhou;
  const inicio = new Promise((resolve, reject) => { pronto = resolve; falhou = reject; });
  const fim = new Promise(resolve => ponte.on('exit', resolve));
  // stderr fica separado: somente mensagens JSON entram no transporte.
  let diagnostico = '';
  ponte.stderr.on('data', dados => { diagnostico += dados; });
  ponte.on('error', falhou);
  ponte.on('exit', codigo => {
    if (codigo !== 0) falhou(new Error(diagnostico || `Backend de testes encerrou com ${codigo}.`));
    for (const pedido of pendentes.values()) pedido.reject(new Error('Transporte de testes encerrado.'));
  });
  const linhas = createInterface({ input: ponte.stdout });
  linhas.on('line', linha => {
    const mensagem = JSON.parse(linha);
    if (mensagem.ready) { pronto(); return; }
    const pedido = pendentes.get(mensagem.id);
    pendentes.delete(mensagem.id);
    pedido.resolve(new Response(mensagem.status === 204 ? null : mensagem.body, {
      status: mensagem.status, headers: { 'Content-Type': 'application/json' },
    }));
  });
  try {
    await inicio;
    globalThis.fetch = (endereco, opcoes) => new Promise((resolve, reject) => {
      const id = ++contador;
      pendentes.set(id, { resolve, reject });
      const url = new URL(endereco);
      ponte.stdin.write(JSON.stringify({ id, method: opcoes.method, path: url.pathname + url.search,
        headers: opcoes.headers, body: opcoes.body }) + '\n');
    });
    const credenciais = { email: 'integracao@example.com', senha: 'senha-para-teste' };
    const conta = await api('/auth/cadastro', { method: 'POST', publico: true, body: { ...credenciais, nome: 'Estudante' } });
    await assert.rejects(api('/auth/login', { method: 'POST', publico: true,
      body: { ...credenciais, senha: 'senha-incorreta' } }), erro => erro.status === 401);
    const sessao = await api('/auth/login', { method: 'POST', publico: true, body: credenciais });
    salvarToken(sessao.access_token);
    assert.equal((await api('/auth/me')).id, conta.id);
    assert.ok((await api('/oportunidades/filtros')).pais.includes('Itália'));
    const filtros = new URLSearchParams({ pais: 'Itália', idioma: 'Inglês', nivel: 'graduação', min: 6, max: 6 });
    const catalogo = await api(`/oportunidades?${filtros}`);
    assert.equal(catalogo.total, 1);
    assert.equal(catalogo.itens[0].id, 'milano');
    assert.equal((await api('/oportunidades/milano')).universidade, 'Politecnico di Milano');
    assert.equal((await api('/oportunidades?pais=Jap%C3%A3o')).total, 0);
    const primeira = await api('/oportunidades/milano/simulacoes', { method: 'POST' });
    assert.equal(primeira.situacao, 'incompleta');
    const perfil = { nome: 'Estudante', curso: 'Engenharia de Software', area: 'Engenharia e Tecnologia',
      nivel: 'graduação', i3: 8.4, creditos: 58, creditos_concluidos: null, creditos_totais: null,
      idiomas: { Inglês: 'B2' }, experiencias: [], disciplinas: [], documentos: { historico_escolar: 'historico.pdf' } };
    await api('/perfil', { method: 'PUT', body: perfil });
    assert.equal((await api('/perfil')).i3, 8.4);
    const segunda = await api('/oportunidades/milano/simulacoes', { method: 'POST' });
    assert.equal(segunda.indice, 80);
    assert.equal(segunda.candidatura_habilitada, true);
    assert.equal((await api(`/simulacoes/${primeira.id}`)).situacao, 'incompleta');
    assert.equal((await api('/simulacoes')).total, 2);
    await api('/perfil', { method: 'PUT', body: { ...perfil, i3: 6.5 } });
    assert.equal((await api('/oportunidades/milano/simulacoes', { method: 'POST' })).situacao, 'incompativel');
    assert.equal((await api(`/simulacoes/${segunda.id}`)).indice, 80);
    await api('/perfil', { method: 'PUT', body: { ...perfil, documentos: {} } });
    assert.equal((await api('/oportunidades/milano/simulacoes', { method: 'POST' })).situacao, 'incompleta');
    assert.equal(await api('/auth/logout', { method: 'POST' }), null);
    limparSessao();
    // Entrar novamente confirma a persistência do perfil e do histórico.
    salvarToken((await api('/auth/login', { method: 'POST', publico: true, body: credenciais })).access_token);
    assert.equal((await api('/simulacoes')).total, 4);
    assert.deepEqual((await api('/perfil')).documentos, {});
  } finally {
    globalThis.fetch = originalFetch;
    ponte.stdin.end();
    const timeout = setTimeout(() => ponte.kill(), 3000);
    await fim;
    clearTimeout(timeout);
    linhas.close();
  }
});
