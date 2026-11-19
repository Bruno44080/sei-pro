import assert from 'node:assert/strict';
import { comFeito, criarTermoSeNovo, type Dependencias, idDoProcessoNovo, jaFeito, jaTemTermo, MAX_FEITOS } from '../src/termo';

let n = 0;
async function teste(nome: string, fn: () => void | Promise<void>) {
  await fn();
  console.log(`OK ${++n}: ${nome}`);
}

const BASE = 'https://sei.exemplo.gov.br/sei/controlador.php';
const CHEGADA = `${BASE}?acao=procedimento_trabalhar&acao_origem=procedimento_gerar&id_procedimento=7000001&infra_sistema=1&infra_hash=00`;

await teste('chegada de processo novo: id do endereço', () => {
  assert.equal(idDoProcessoNovo(CHEGADA), '7000001');
});
await teste('outras telas não contam', () => {
  assert.equal(idDoProcessoNovo(`${BASE}?acao=procedimento_trabalhar&id_procedimento=7000001`), null, 'processo aberto pela pesquisa');
  assert.equal(idDoProcessoNovo(`${BASE}?acao=procedimento_trabalhar&acao_origem=procedimento_visualizar&id_procedimento=7000001`), null);
  assert.equal(idDoProcessoNovo(`${BASE}?acao=procedimento_gerar&acao_origem=procedimento_gerar`), null, 'a própria tela de Iniciar Processo');
  assert.equal(idDoProcessoNovo(`${BASE}?acao=procedimento_trabalhar&acao_origem=procedimento_gerar&id_procedimento=abc`), null);
  assert.equal(idDoProcessoNovo('não é url'), null);
});
await teste('árvore com termo', () => {
  assert.equal(jaTemTermo([{ titulo: 'Despacho 1' }, { titulo: 'Termo de Abertura de Processo Eletrônico 100' }]), true);
  assert.equal(jaTemTermo([{ titulo: 'Despacho 1' }]), false);
});
await teste('lista de feitos: sem repetir e com teto', () => {
  assert.deepEqual(comFeito(['1', '2'], '1'), ['2', '1']);
  assert.deepEqual(comFeito('lixo', '3'), ['3']);
  const cheia = Array.from({ length: MAX_FEITOS }, (_, i) => String(i));
  const nova = comFeito(cheia, 'x');
  assert.equal(nova.length, MAX_FEITOS);
  assert.equal(nova.at(-1), 'x');
  assert.equal(nova[0], '1');
  assert.equal(jaFeito(['7000001'], '7000001'), true);
  assert.equal(jaFeito(undefined, '7000001'), false);
});

function deps(o: Partial<Dependencias> & { lista?: unknown; documentos?: Array<{ titulo: string }>; nivel?: string; nome?: string } = {}) {
  const log: string[] = [];
  let lista: unknown = o.lista;
  const d: Dependencias = {
    arvore: o.arvore ?? (async () => ({ protocolo: '00.00.00000001/2026.00', nivel: o.nivel ?? 'publico', documentos: o.documentos ?? [] })),
    nomeDoTipo: o.nomeDoTipo ?? (async () => o.nome ?? 'Termo de Abertura de Processo Eletrônico'),
    criar:
      o.criar ??
      (async (p) => {
        log.push(`criar ${p}`);
        return '1000123';
      }),
    feitos: {
      ler: async () => lista,
      gravar: async (l) => {
        log.push(`gravar ${l.join(',')}`);
        lista = l;
      },
    },
    recarregarArvore: () => log.push('recarregar'),
    avisar: (tipo, texto) => log.push(`${tipo}: ${texto}`),
  };
  return { d, log, lista: () => lista };
}

await teste('cria o termo no processo novo, recarrega a árvore e avisa', async () => {
  const t = deps();
  assert.equal(await criarTermoSeNovo(CHEGADA, t.d), 'criado');
  assert.deepEqual(t.log.slice(0, 3), ['gravar 7000001', 'criar 00.00.00000001/2026.00', 'recarregar']);
  assert.match(t.log[3], /^ok: Termo de Abertura de Processo Eletrônico 1000123 criado no processo 00\.00\.00000001\/2026\.00\.$/);
});
await teste('F5 na mesma chegada: não cria de novo', async () => {
  const t = deps();
  await criarTermoSeNovo(CHEGADA, t.d);
  const t2 = deps({ lista: t.lista() });
  assert.equal(await criarTermoSeNovo(CHEGADA, t2.d), 'ja-feito');
  assert.ok(!t2.log.some((l) => l.startsWith('criar')));
});
await teste('fora da chegada: nada acontece (nem marca)', async () => {
  const t = deps();
  assert.equal(await criarTermoSeNovo(`${BASE}?acao=procedimento_trabalhar&id_procedimento=7000001`, t.d), 'fora');
  assert.deepEqual(t.log, []);
});
await teste('árvore já tem termo: não cria', async () => {
  const t = deps({ documentos: [{ titulo: 'Termo de Abertura de Processo Eletrônico 99' }] });
  assert.equal(await criarTermoSeNovo(CHEGADA, t.d), 'ja-tinha');
  assert.ok(!t.log.some((l) => l.startsWith('criar')));
});
await teste('tipo 289 com outro nome (outro SEI): não cria, sem aviso', async () => {
  const t = deps({ nome: 'Ofício' });
  assert.equal(await criarTermoSeNovo(CHEGADA, t.d), 'tipo-diferente');
  assert.ok(!t.log.some((l) => l.startsWith('criar') || l.startsWith('erro')));
});
await teste('unidade sem o tipo 289: não cria, sem aviso', async () => {
  const t = deps({
    nomeDoTipo: async () => {
      throw new Error('O tipo (id 289) não está disponível nesta unidade.');
    },
  });
  assert.equal(await criarTermoSeNovo(CHEGADA, t.d), 'sem-tipo');
  assert.ok(!t.log.some((l) => l.startsWith('criar') || l.startsWith('erro')));
});
await teste('processo sigiloso: avisa e não cria', async () => {
  const t = deps({ nivel: 'sigiloso' });
  assert.equal(await criarTermoSeNovo(CHEGADA, t.d), 'sigiloso');
  assert.ok(t.log.some((l) => /^erro: Processo sigiloso/.test(l)));
  assert.ok(!t.log.some((l) => l.startsWith('criar')));
});
await teste('erro do SEI ao criar: avisa com o motivo, sem tentar de novo', async () => {
  const t = deps({
    criar: async () => {
      throw new Error('O SEI recusou o cadastro.');
    },
  });
  assert.equal(await criarTermoSeNovo(CHEGADA, t.d), 'erro');
  const erro = t.log.find((l) => l.startsWith('erro'));
  assert.match(erro ?? '', /não foi criado no processo 00\.00\.00000001\/2026\.00: O SEI recusou o cadastro\. Inclua-o/);
  assert.ok(!t.log.includes('recarregar'));
  const t2 = deps({ lista: t.lista() });
  assert.equal(await criarTermoSeNovo(CHEGADA, t2.d), 'ja-feito', 'marcado: não repete sozinho');
});

console.log(`${n} verificações ok`);
