# Suporte — Cadastro, login e perfil privado

## Origem e decisão humana

Os testes planejados têm como pré-condição aluno autenticado. A inclusão de
cadastro e login foi explicitamente confirmada pelo usuário nesta sessão.
Essas operações apoiam UC01 e UC02 e não substituem as duas funcionalidades.

## Contrato

- AUT01: cadastro exige nome não vazio, e-mail normalizado e único, senha
  de 8–128 caracteres. Cria usuário e perfil incompleto na mesma transação.
- AUT02: login válido retorna token Bearer opaco de 256 bits de entropia,
  com validade de 8 h e usuário público. Senhas são derivadas com PBKDF2-SHA256,
  600.000 iterações e salt individual. Não são retornadas na API.
- AUT03: só o hash SHA256 do token é persistido. Login inválido e sessão
  ausente/inválida/expirada retornam 401. Logout revoga a sessão atual.
- AUT04: catálogo, opções, detalhes, perfil e simulações exigem autenticação.
  Cadastro, login, saúde e documentação OpenAPI são públicos.
- AUT05: o identificador do dono vem do token, nunca de um corpo ou query
  enviado pelo cliente. Consultar simulação de outro usuário retorna 404.
- AUT06: PUT de perfil substitui os dados acadêmicos, preservando vínculo
  de identidade. Campos omitidos voltam aos padrões; não é um PATCH.
- AUT07: erro 422 não retorna senha ou valor de entrada; respostas da API
  têm Cache-Control no-store. CORS autoriza o frontend local na porta 8000.

## Tarefas e validação

1. Criar tabelas de usuários, perfis e sessões e garantir chaves estrangeiras.
2. Implementar derivação de senha, login, expiração e revogação.
3. Autenticar as rotas e restringir a consulta por dono.
4. Testar cadastro duplicado, senha inválida, expiração, logout, isolamento
   e persistência após reinicializar a aplicação.

Escopo de aplicação local acadêmica: não inclui recuperação de senha,
confirmação de e-mail, autenticação institucional ou administração de usuários.

