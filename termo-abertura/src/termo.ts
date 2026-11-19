/**
 * Termo de Abertura de Processo Eletrônico criado junto com o processo.
 *
 * Depois do "Salvar" da tela "Iniciar Processo" (`acao=procedimento_gerar`), o SEI abre o processo novo em
 * `acao=procedimento_trabalhar&acao_origem=procedimento_gerar&id_procedimento=...`. É nessa chegada que o
 * termo é criado: tipo de documento 289 (o do SEI de Maringá), público, sem texto inicial (o SEI usa o
 * modelo do próprio tipo).
 *
 * Quatro travas contra termo em dobro ou no lugar errado:
 * - só a chegada de processo NOVO (`acao_origem=procedimento_gerar`), na janela de topo;
 * - o processo fica marcado como feito ANTES de criar (F5 na mesma tela não repete, nem em outra aba);
 * - a árvore já tem um "Termo de Abertura": não cria;
 * - o tipo 289 da unidade tem de se chamar "Termo de Abertura..." (em outro SEI o 289 é outro tipo).
 */

export const TIPO_TERMO = '289';
export const NOME_ESPERADO = /termo\s+de\s+abertura/i;
export const CHAVE_FEITOS = 'spro-termo-abertura-feitos';
/** Quantos processos lembrar como feitos (o suficiente para F5 e abas repetidas). */
export const MAX_FEITOS = 200;

/** Id do processo recém-criado, lido do endereço da chegada; `null` fora dela. */
export function idDoProcessoNovo(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const p = u.searchParams;
  if (p.get('acao') !== 'procedimento_trabalhar' || p.get('acao_origem') !== 'procedimento_gerar') return null;
  const id = p.get('id_procedimento') ?? '';
  return /^\d+$/.test(id) ? id : null;
}

export function jaTemTermo(documentos: ReadonlyArray<{ titulo: string }>): boolean {
  return documentos.some((d) => NOME_ESPERADO.test(d.titulo));
}

export function comFeito(lista: unknown, id: string): string[] {
  const atual = Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string' && x !== id) : [];
  return [...atual, id].slice(-MAX_FEITOS);
}

export function jaFeito(lista: unknown, id: string): boolean {
  return Array.isArray(lista) && lista.includes(id);
}

export interface ArvoreResumo {
  protocolo: string;
  nivel: string;
  documentos: ReadonlyArray<{ titulo: string }>;
}

export interface Dependencias {
  /** Árvore do processo que está na tela. */
  arvore(): Promise<ArvoreResumo>;
  /** Nome do tipo 289 na unidade, sem criar nada (lança se o tipo não existe nela). */
  nomeDoTipo(protocolo: string): Promise<string>;
  /** Cria o termo; devolve o nº SEI. */
  criar(protocolo: string): Promise<string>;
  feitos: { ler(): Promise<unknown>; gravar(lista: string[]): Promise<void> };
  recarregarArvore(): void;
  avisar(tipo: 'ok' | 'erro', texto: string): void;
}

export type Desfecho = 'fora' | 'ja-feito' | 'ja-tinha' | 'sigiloso' | 'tipo-diferente' | 'sem-tipo' | 'criado' | 'erro';

export async function criarTermoSeNovo(url: string, d: Dependencias): Promise<Desfecho> {
  const id = idDoProcessoNovo(url);
  if (!id) return 'fora';
  const lista = await d.feitos.ler();
  if (jaFeito(lista, id)) return 'ja-feito';
  // Marcado antes de tudo: duas abas ou um F5 no meio do caminho não criam outro termo.
  await d.feitos.gravar(comFeito(lista, id));

  let protocolo = '';
  try {
    const arv = await d.arvore();
    protocolo = arv.protocolo;
    if (jaTemTermo(arv.documentos)) return 'ja-tinha';
    if (arv.nivel === 'sigiloso') {
      d.avisar('erro', 'Processo sigiloso: o Termo de Abertura não foi criado automaticamente. Inclua-o pelo "Incluir Documento".');
      return 'sigiloso';
    }
    let nome: string;
    try {
      nome = await d.nomeDoTipo(protocolo);
    } catch {
      // Unidade sem o tipo 289: outro órgão ou tipo não liberado. Não é erro do usuário.
      return 'sem-tipo';
    }
    if (!NOME_ESPERADO.test(nome)) return 'tipo-diferente';
    const numero = await d.criar(protocolo);
    d.recarregarArvore();
    d.avisar('ok', `${nome}${numero ? ` ${numero}` : ''} criado no processo ${protocolo}.`);
    return 'criado';
  } catch (e) {
    d.avisar(
      'erro',
      `O Termo de Abertura não foi criado${protocolo ? ` no processo ${protocolo}` : ''}: ${e instanceof Error ? e.message : String(e)} Inclua-o pelo "Incluir Documento".`,
    );
    return 'erro';
  }
}
