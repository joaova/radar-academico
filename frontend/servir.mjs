import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const tipos = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};
const porta = process.argv[2] === undefined ? 8000 : Number(process.argv[2]);
if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
  console.error('Informe uma porta válida.');
  process.exit(1);
}

const servidor = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const caminho = (req.url ?? '/').split('?')[0];
  const arquivo = caminho === '/' ? 'index.html' : caminho.slice(1);
  const tipo = tipos[extname(arquivo)];
  if (!tipo || !/^[a-z0-9-]+\.(?:html|css|js)$/.test(arquivo)) {
    res.writeHead(404).end();
    return;
  }

  try {
    const conteudo = await readFile(new URL(arquivo, import.meta.url));
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : conteudo);
  } catch (erro) {
    res.writeHead(erro.code === 'ENOENT' ? 404 : 500).end();
  }
});

servidor.on('error', erro => {
  console.error(erro.code === 'EADDRINUSE'
    ? `A porta ${porta} já está em uso. Tente: node frontend/servir.mjs ${porta === 8000 ? 8002 : 8000}`
    : erro.message);
  process.exitCode = 1;
});
servidor.listen(porta, '127.0.0.1', () => {
  console.log(`Radar Acadêmico disponível em http://127.0.0.1:${porta}/`);
});
