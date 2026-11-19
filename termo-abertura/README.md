# Termo de Abertura automático

**Específico do SEI da Prefeitura do Município de Maringá (PMM).** Não se destina à versão oficial do SEI
Pro: o tipo 289 é um cadastro local.

Contribuição do IPPLAM (Instituto de Pesquisa e Planejamento Urbano de Maringá, Município de Maringá/PR),
por Bruno Albuquerque. Ver [CREDITOS.md](../CREDITOS.md). Manual do usuário: [pages/TERMOABERTURA.md](../pages/TERMOABERTURA.md).

Ao salvar um processo novo ("Iniciar Processo"), cria junto o documento **Termo de Abertura de Processo
Eletrônico** (tipo de documento **289** do SEI de Maringá), **público**, sem texto inicial (o SEI usa o
modelo do próprio tipo). Sempre ligado, sem opção nas configurações.

Content script isolado `dist/js/init_termo_abertura.js`, só na janela de topo. O SEI, depois do Salvar de
`acao=procedimento_gerar`, abre o processo em `acao=procedimento_trabalhar&acao_origem=procedimento_gerar`;
é essa chegada que dispara a criação (`src/termo.ts`), pelo `criarDocumento` do `sei-nucleo` (tipo pelo
id exato). Depois a árvore da tela é recarregada e um aviso mostra o nº SEI do termo.

Travas: só a chegada de processo novo; o processo é marcado como feito antes de criar
(`chrome.storage.local`, `spro-termo-abertura-feitos`, últimos 200), então F5 ou outra aba não repetem;
árvore que já tem "Termo de Abertura" não ganha outro; o tipo 289 da unidade tem de se chamar "Termo de
Abertura..." (em outro SEI o 289 é outro tipo, e nada é criado); processo sigiloso só recebe um aviso.

```
npm install
npm run build    # testes + dist/js/init_termo_abertura.js
npm run tipos
```
