# [![Home](./img/home.png)](./) |  SEI Pro ![Icone](./img/icon-32.png)

## Créditos

### Projeto original

O **SEI Pro** é criado e mantido por **Pedro Soares** e colaboradores, em
[github.com/SEI-Pro/sei-pro](https://github.com/SEI-Pro/sei-pro), sob a licença
[AGPL-3.0](./LICENSE.txt). Todo o resto da extensão, as funções, a documentação e a identidade visual, é
desse projeto.

### Contribuição do IPPLAM (Maringá/PR)

As funções abaixo foram desenvolvidas por **Bruno Albuquerque**, do **IPPLAM, Instituto de Pesquisa e
Planejamento Urbano de Maringá**, autarquia municipal vinculada ao Poder Executivo do **Município de
Maringá (PMM, Prefeitura do Município de Maringá)**. Elas foram feitas para o uso diário do SEI 5.0.5 do
município e são oferecidas ao projeto original, para serem incorporadas às versões oficiais se o
mantenedor quiser.

| Função | Manual | Código |
| ------ | ------ | ------ |
| Tabela com colunas em %: larguras, posição, temas personalizados, bordas para o "Gerar PDF", limpeza de tabela colada | [pages/TABELACOLUNAS.md](./pages/TABELACOLUNAS.md) | [tabela-colunas/](./tabela-colunas/) |
| Termo de Abertura criado junto com o processo novo (**específico do SEI de Maringá**, tipo 289; não se destina à versão oficial) | [pages/TERMOABERTURA.md](./pages/TERMOABERTURA.md) | [termo-abertura/](./termo-abertura/) |
| Gerar documento com modelo limpo | [pages/MODELOLIMPO.md](./pages/MODELOLIMPO.md) | [modelo-limpo/](./modelo-limpo/) |
| Núcleo: estilos do editor lidos de `infra.estilo`, como chegam no SEI 5.0.5 | n/a | [sei-nucleo/src/dominio/editor.ts](./sei-nucleo/src/dominio/editor.ts) |
| Botões de tabela do SEI Pro num grupo próprio da barra do CK5, para não se sobreporem | n/a | `inserirGrupoTabelaCK5` em [dist/js/sei-pro-editor.js](./dist/js/sei-pro-editor.js) |

### Aviso de modificação (AGPL-3.0, seção 5)

Esta é uma **versão modificada** do SEI Pro 3.8, feita pelo IPPLAM em novembro de 2026. Para não ser
confundida com a extensão oficial no navegador, ela aparece como **SEI Pro Lab PMM-5.0.5**. Essa troca de
nome é feita só no `manifest.json` e fica em um commit separado, que não precisa ser incorporado.

Dúvidas e problemas desta versão devem ir ao IPPLAM, e não ao projeto original.
