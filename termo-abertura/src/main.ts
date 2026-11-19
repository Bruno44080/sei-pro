/**
 * Content script isolado (`js/init_termo_abertura.js`). Só age na janela de topo, na chegada de um processo
 * recém-criado (ver `termo.ts`). Sempre ligado: não há opção nas configurações.
 */

import { abrirArvore } from '../../sei-nucleo/src/dominio/arvore';
import { criarDocumento } from '../../sei-nucleo/src/dominio/documento';
import { Sei } from '../../sei-nucleo/src/sei';
import { paginaDe } from '../../sei-nucleo/src/sessao/pagina';
import { h } from '../../sei-comum/src/ui/dom';
import { CHAVE_FEITOS, criarTermoSeNovo, type Dependencias, idDoProcessoNovo, TIPO_TERMO } from './termo';

function linkDaArvore(doc: Document): string {
  const src = doc.querySelector('#ifrArvore')?.getAttribute('src') ?? '';
  if (!src) throw new Error('a tela do processo não trouxe a árvore.');
  return new URL(src.replace(/&amp;/g, '&'), doc.location.href).href;
}

function recarregarArvore(doc: Document): void {
  const ifr = doc.querySelector<HTMLIFrameElement>('#ifrArvore');
  if (!ifr) return;
  try {
    ifr.contentWindow?.location.reload();
  } catch {
    const src = ifr.getAttribute('src');
    if (src) ifr.setAttribute('src', src);
  }
}

function aviso(doc: Document, tipo: 'ok' | 'erro', texto: string): void {
  doc.querySelector('[data-spro-termo-aviso]')?.remove();
  const fechar = h('button', { type: 'button', 'aria-label': 'Fechar', title: 'Fechar', onclick: () => caixa.remove() }, '×');
  Object.assign(fechar.style, { border: '0', background: 'transparent', color: 'inherit', fontSize: '18px', lineHeight: '1', cursor: 'pointer', marginLeft: '12px' });
  const caixa = h('div', { role: tipo === 'erro' ? 'alert' : 'status', 'data-spro-termo-aviso': '' }, h('span', {}, texto), fechar);
  Object.assign(caixa.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '100000',
    maxWidth: 'min(520px, calc(100vw - 32px))',
    display: 'flex',
    alignItems: 'flex-start',
    padding: '12px 14px',
    borderRadius: '6px',
    font: '14px/1.4 Arial, sans-serif',
    color: '#fff',
    background: tipo === 'erro' ? '#a4262c' : '#1f6e43',
    boxShadow: '0 4px 16px rgba(0,0,0,.3)',
  });
  doc.body.append(caixa);
  if (tipo === 'ok') setTimeout(() => caixa.remove(), 12_000);
}

function dependencias(doc: Document): Dependencias {
  const sei = new Sei(doc.location.href, () => paginaDe(doc, doc.location.href));
  return {
    arvore: () => abrirArvore(sei.http, linkDaArvore(doc)),
    async nomeDoTipo(protocolo) {
      // Simulação: escolhe o tipo pelo id exato e devolve o nome, sem gravar.
      const r = await criarDocumento(sei, protocolo, { tipo: TIPO_TERMO, tipoId: TIPO_TERMO, nivel: 'publico' }, { aplicar: false });
      return r.mudancas.find((m) => m.campo === 'Documento')?.depois ?? '';
    },
    async criar(protocolo) {
      let enviado = false;
      try {
        const r = await criarDocumento(
          sei,
          protocolo,
          {
            tipo: TIPO_TERMO,
            tipoId: TIPO_TERMO,
            nivel: 'publico',
            acompanharCadastro: (f) => {
              if (f.fase === 'enviado') enviado = true;
            },
          },
          { aplicar: true },
        );
        return String((r.dados as { numero?: string } | undefined)?.numero ?? '');
      } catch (e) {
        // O SEI confirmou a criação e só a releitura falhou: o termo existe.
        if (enviado) return '';
        throw e;
      }
    },
    feitos: {
      ler: async () => (await chrome.storage.local.get(CHAVE_FEITOS))[CHAVE_FEITOS],
      gravar: (lista) => chrome.storage.local.set({ [CHAVE_FEITOS]: lista }),
    },
    recarregarArvore: () => recarregarArvore(doc),
    avisar: (tipo, texto) => aviso(doc, tipo, texto),
  };
}

async function iniciar(): Promise<void> {
  if (window !== window.top || !idDoProcessoNovo(location.href)) return;
  const desfecho = await criarTermoSeNovo(location.href, dependencias(document));
  if (desfecho !== 'criado') console.info('[SEI Pro] termo de abertura:', desfecho);
}

const global = window as unknown as { __seiProTermoAbertura?: boolean };
if (!global.__seiProTermoAbertura) {
  global.__seiProTermoAbertura = true;
  const rodar = () => void iniciar().catch((e) => console.warn('[SEI Pro] termo de abertura:', e));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rodar, { once: true });
  else rodar();
}
