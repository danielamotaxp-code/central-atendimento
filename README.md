# Plataforma WeGen · SmartBen · WattWise

Portal único: https://danielamotaxp-code.github.io/central-atendimento/

- **Um login só** (usuário + senha; senha inicial 102030) e menu lateral com as páginas:
  Central de Atendimento, Cobrança Inadimplentes, Faturas e Contratos, Ouvidorias Cemig, Central de Distratos e Auditoria de Injeção.
- **Administração** (administradoras): incluir/remover pessoas, escolher quais páginas cada uma vê, voltar senha para 102030, trocar o token do GitHub.
- **Minha conta**: cada pessoa troca a própria senha e o tema.
- Cada página continua no próprio repositório (`/<repositório>/app.html`) e usa o login do portal. Os links antigos redirecionam para cá.

## Arquivos
- `index.html`: o portal (lista de páginas e quem usava cada uma).
- `cofre.json`: acessos **criptografados** (token do GitHub trancado por uma chave-mestra; a chave-mestra trancada pela senha de cada pessoa).
- `kit/`: base comum (login, cofre, Administração, Minha conta, GitHub, Google, cores das empresas) e `modulo.js` (liga cada página ao portal).
- `atendimento/`: a Central de Atendimento. As mensagens ficam no repositório privado `central-atendimento-dados`.
