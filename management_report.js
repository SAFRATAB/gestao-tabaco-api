// Leitura de snapshots: não altera registros, pagamentos ou estoque do produtor.
const etapas = ['mudas', 'pre_plantio', 'manejo', 'colheita', 'pos_colheita'];
const fixos = ['manutencao', 'seguros', 'impostos', 'arrendamento', 'emprestimos', 'outros_fixos'];
const numero = value => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const propria = item => { const nome = `${item.categoria || ''} ${item.produto || ''} ${item.descricao || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase(); return item.categoria === 'Mão de obra familiar' || (/lenha/.test(nome) && (item.origemLenha === 'propria' || /\(propria\)$/.test(nome))); };
const custo = item => item.estoqueOrigem === 'canteiro_mudas' || item.custoJaReconhecidoNaProducao === true ? 0 : numero(item.total);
function situacao(item, receita = false) {
  const total = numero(item.total);
  const legado = Object.hasOwn(item, 'valorLiquidadoLegado') ? numero(item.valorLiquidadoLegado) : !receita && item.pagamento === 'Pago' ? total : 0;
  const movimentos = Array.isArray(item.liquidacoes) ? item.liquidacoes : [];
  const liquidado = legado + movimentos.reduce((s, m) => s + numero(m.valor), 0);
  return { total, liquidado, restante: Math.max(0, total - liquidado), movimentos };
}
function buildManagementReport(archive, selectedId) {
  const data = archive.records;
  const lista = key => Array.isArray(data[key]) ? data[key] : [];
  const safras = lista('safras');
  const selected = selectedId || safras.find(s => s.status !== 'Finalizada')?.id || safras[0]?.id || null;
  if (selectedId && !safras.some(s => String(s.id) === String(selectedId))) { const e = new Error('Safra não encontrada neste backup.'); e.status = 404; throw e; }
  const local = key => selected === null ? lista(key) : lista(`safra_${selected}_${key}`);
  const propriedade = lista('propriedade')[0] || {};
  const lavouras = local('lavouras'); const vendas = local('receitas_tabaco'); const estufadas = local('estufadas_tabaco');
  const despesas = [...etapas.flatMap(etapa => local(`uso_producao_${etapa}`).map(d => ({ ...d, etapa }))), ...fixos.flatMap(chave => local(`despesas_${chave}`).map(d => ({ ...d, etapa: 'fixos' }))), ...local('mao_obra_familiar')];
  const coe = despesas.filter(d => !propria(d)).reduce((s, d) => s + custo(d), 0);
  const trabalhoProprio = despesas.filter(propria).reduce((s, d) => s + custo(d), 0);
  const depreciacao = Object.keys(data).filter(k => k.startsWith('patrimonio_')).flatMap(lista).reduce((s, p) => s + numero(p.depreciacaoAnual) * Math.min(100, Math.max(0, numero(p.percentualUsoFumo ?? 100))) / 100, 0);
  const receita = vendas.reduce((s, v) => s + numero(v.total), 0);
  const compras = lista('compras_insumos');
  const caixaDespesas = [...compras.filter(d => !propria(d)), ...despesas.filter(d => !propria(d) && !d.estoqueChave && custo(d) > 0)];
  const recebido = vendas.reduce((s, v) => s + situacao(v, true).liquidado, 0);
  const pago = caixaDespesas.reduce((s, d) => s + situacao(d).liquidado, 0);
  const aReceber = vendas.reduce((s, v) => s + situacao(v, true).restante, 0);
  const aPagar = caixaDespesas.reduce((s, d) => s + situacao(d).restante, 0);
  const producao = estufadas.reduce((s, e) => s + numero(e.quantidade), 0);
  const area = lavouras.reduce((s, l) => s + numero(l.area), 0);
  const custosPorEtapa = etapas.map(etapa => ({ etapa, total: despesas.filter(d => d.etapa === etapa).reduce((s, d) => s + custo(d), 0) }));
  const custoFixo = despesas.filter(d => d.etapa === 'fixos').reduce((s,d) => s + custo(d), 0);
  if (custoFixo) custosPorEtapa.push({ etapa: 'fixos', total: custoFixo });
  const ocorrencias = local('ocorrencias_pragas_doencas').map(({ fotos, ...o }) => ({ ...o, fotosQuantidade: Array.isArray(fotos) ? fotos.length : 0 }));
  const estoques = new Map();
  const key = item => item.estoqueChave || `${String(item.produto || '').trim().toLowerCase()}|${String(item.unidade || 'un').trim().toLowerCase()}`;
  for (const c of compras) {
    const k = key(c); const item = estoques.get(k) || { chave: k, produto: c.produto || 'Insumo', unidade: c.unidade || 'un', categoria: c.categoria || 'Outros', entradas: 0, quantidade: 0, total: 0 };
    item.entradas += numero(c.quantidade); item.quantidade += numero(c.quantidade); item.total += numero(c.total); estoques.set(k, item);
  }
  // O saldo pertence à propriedade: baixas de todas as safras, sem converter embalagens desconhecidas.
  const movimentosEstoque = Object.keys(data).filter(k => /^(safra_.+_)?(uso_producao_|saidas_estoque)/.test(k)).flatMap(lista);
  let conversoesPendentes = false;
  const vistos = new Set();
  for (const m of movimentosEstoque) {
    if (m.estoqueOrigem === 'canteiro_mudas') continue;
    if (m.id != null && vistos.has(String(m.id))) continue;
    if (m.id != null) vistos.add(String(m.id));
    if (!m.estoqueChave && !Object.hasOwn(m, 'produto')) continue;
    const item = estoques.get(key(m));
    if (!item || (m.unidade && m.unidade.toLowerCase() !== item.unidade.toLowerCase())) { conversoesPendentes = true; continue; }
    item.quantidade -= numero(m.quantidade);
  }
  const estoque = [...estoques.values()].map(e => ({ ...e, quantidade: conversoesPendentes ? null : Math.max(0,e.quantidade), custoMedio: e.entradas ? e.total / e.entradas : 0 }));
  const porLavoura = lavouras.map(l => {
    const produzida = estufadas.filter(e => String(e.lavouraId) === String(l.id)).reduce((s,e) => s + numero(e.quantidade), 0);
    const gasto = despesas.filter(d => String(d.lavouraId) === String(l.id)).reduce((s,d) => s + (d.estoqueOrigem === 'canteiro_mudas' ? numero(d.quantidade) * numero(d.custoUnitario) : custo(d)), 0);
    return { ...l, producaoArrobas: produzida, custoRegistrado: gasto, produtividade: numero(l.area) > 0 ? produzida / numero(l.area) : null };
  });
  return {
    propriedade, safras, selectedSafraId: selected,
    metrics: { receita, coe, trabalhoProprio, depreciacao, custoTotal: coe + trabalhoProprio + depreciacao, resultadoBruto: receita - coe, resultadoTotal: receita - coe - trabalhoProprio - depreciacao, recebido, pago, aReceber, aPagar, saldoCaixa: recebido - pago, producaoArrobas: producao, producaoKg: producao * 15, vendidoArrobas: vendas.reduce((s,v) => s + numero(v.arrobas),0), area, lavouras: lavouras.length, ocorrencias: ocorrencias.length },
    charts: { custosPorEtapa },
    records: { vendas: vendas.map(v => ({ ...v, financeiro: situacao(v,true) })), despesas: despesas.map(d => ({ ...d, custoReconhecido: custo(d), somenteCot: propria(d) })), lavouras: porLavoura, estoque, ocorrencias },
    warnings: [ 'Os valores refletem somente o backup selecionado.', 'Compras e estoque são globais da propriedade. Caixa não inclui saldo bancário inicial.', ...(conversoesPendentes ? ['Saldo de estoque parcial: há baixas que precisam de conversão ou conciliação. Confira os saldos no aplicativo.'] : []) ],
  };
}
module.exports = { buildManagementReport, situacao };
