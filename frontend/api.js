import { API_URL } from './config.js';

const chaveSessao = 'radar-academico:sessao:v1';
const paginas = new Set(['index.html', 'perfil.html', 'detalhes.html', 'resultado.html', 'historico.html']);

export class ApiError extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

export function lerToken() {
  try { return sessionStorage.getItem(chaveSessao); } catch { return null; }
}

export function salvarToken(token) {
  try { sessionStorage.setItem(chaveSessao, token); } catch {
    throw new Error('Permita o armazenamento da sessão neste navegador para entrar.');
  }
}

export function limparSessao() {
  try { sessionStorage.removeItem(chaveSessao); } catch { /* Sem sessão armazenada. */ }
}

export function destinoSeguro(valor) {
  try {
    const destino = new URL(valor || 'index.html', location.href);
    const arquivo = destino.pathname.split('/').pop();
    return destino.origin === location.origin && paginas.has(arquivo) &&
      destino.pathname === new URL(arquivo, location.href).pathname
      ? arquivo + destino.search : 'index.html';
  } catch { return 'index.html'; }
}

export function pedirLogin(expirada = false) {
  const consulta = new URLSearchParams({ voltar: destinoSeguro(location.pathname + location.search) });
  if (expirada) consulta.set('expirada', '1');
  location.replace(`login.html?${consulta}`);
}

export async function api(caminho, { method = 'GET', body, signal, publico = false } = {}) {
  const controller = new AbortController();
  const abortar = () => controller.abort();
  signal?.addEventListener('abort', abortar, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abortar, 15000);
  try {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = publico ? null : lerToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const resposta = await fetch(`${API_URL.replace(/\/$/, '')}/api${caminho}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal, cache: 'no-store',
    });
    const dados = resposta.status === 204 ? null : await resposta.json();
    if (!resposta.ok) {
      if (resposta.status === 401 && !publico) {
        limparSessao();
        document.querySelector('main')?.setAttribute('hidden', '');
        pedirLogin(true);
      }
      const detalhes = dados?.erros?.map(erro => `${erro.campo}: ${erro.mensagem}`).join(' ');
      throw new ApiError(resposta.status,
        [dados?.mensagem || 'Não foi possível concluir a operação.', detalhes].filter(Boolean).join(' '));
    }
    return dados;
  } catch (erro) {
    if (signal?.aborted) throw erro;
    if (erro instanceof ApiError) throw erro;
    throw new Error(controller.signal.aborted
      ? 'O servidor demorou para responder. Tente novamente.'
      : 'Não foi possível acessar o servidor. Confira se o back-end está rodando e tente novamente.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortar);
  }
}
