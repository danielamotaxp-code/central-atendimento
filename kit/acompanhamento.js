/*
 * Planilhas de acompanhamento de ouvidorias (ex.: Auditoria Clientes Thiago, Ouvidorias - Reclamação 7, Ouvidorias Enviadas no Grupo).
 * A plataforma não cria linhas: só atualiza as linhas dos clientes que já estão na planilha, conforme as ouvidorias
 * registradas em Ouvidorias Cemig.
 *  - acha o cabeçalho pela coluna da instalação;
 *  - reclamacoes: [7, 8] → só valem ouvidorias dessas reclamações; sem isso, se alguma coluna tem "Reclamação N"
 *    nas linhas, vale a reclamação de cada linha ("-" = sem ouvidoria); sem coluna, vale qualquer reclamação;
 *  - preenche, como na planilha das faturas: "Ouvidoria" (Enviada / Não enviada), "Protocolo Ouvidoria" (ou "Erro"),
 *    "Data da ouvidoria", "Colaborador" (se vazio) e o link "Ouvidoria na plataforma" (cria as colunas que faltam no fim);
 *  - pinta a linha de verde (enviada) ou laranja (erro) só nas planilhas marcadas com colorir.
 * Usa a conexão com o Google da plataforma (PLAT.google: planilha, ler, lote).
 */
(function (raiz) {
  'use strict';
  var PORTAL = 'https://danielamotaxp-code.github.io/central-atendimento/#ouvidorias/cad/';
  var VERDE = { red: 0.204, green: 0.659, blue: 0.325 }, LARANJA = { red: 0.992, green: 0.851, blue: 0.663 };
  function norm(x) { return String(x == null ? '' : x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function chave(v) { return String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+/, ''); }
  function idDoLink(l) { var m = String(l || '').match(/\/d\/([\w-]{20,})/); return m ? m[1] : ''; }
  function br(iso) { var p = String(iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : ''; }
  function ehInst(h) { return /^(n|no|n o)?\s*(numero\s*(da\s*)?)?instalacao$/.test(norm(h)); }
  function reclamacaoDe(v) { var m = String(v || '').match(/reclama\S*\s*(?:n\S*\s*)?(\d+)/i); return m ? +m[1] : null; }
  function aspas(t) { return "'" + String(t).replace(/'/g, "''") + "'"; }

  function escolher(registros, inst, recl, desde) {
    var rs = registros.filter(function (r) {
      return chave(r.instalacao) === inst && (recl == null || recl.indexOf(+r.reclamacao) >= 0) && String(r.criadoEm || '').slice(0, 10) >= (desde || '');
    }).sort(function (a, b) { return String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')); });
    return rs.filter(function (r) { return r.status !== 'pendente'; })[0] || rs[0] || null;
  }

  async function umaAba(g, pid, folha, valores, p, registros, so) {
    var m = valores || [], pedidos = [], linhas = 0, cabecalho = [];
    var hl = m.findIndex(function (row) { return (row || []).some(ehInst); });
    if (hl < 0) return 0;
    var cab = m[hl].slice(), ci = cab.findIndex(ehInst);
    var achar = function (re) { return cab.findIndex(function (h) { return re.test(norm(h)); }); };
    var cp = achar(/^protocolo( da)? ouvidoria$/); if (cp < 0) cp = achar(/^protocolo$/);
    var cc = achar(/^colaborador$/), cl = achar(/^ouvidoria na plataforma$/);
    var cs = achar(/^ouvidoria$/), cd = achar(/^data da ouvidoria$/);
    // coluna com "Reclamação N" nas linhas (ex.: "situação" ou "Observação 2")
    var fixas = (p.reclamacoes || []).map(Number).filter(function (n) { return !isNaN(n); });
    var cr = -1, melhor = 0;
    if (!fixas.length) for (var c = 0; c < cab.length; c++) {
      var q = 0; for (var i = hl + 1; i < m.length; i++) if (reclamacaoDe((m[i] || [])[c]) != null) q++;
      if (q > melhor) { melhor = q; cr = c; }
    }
    // colunas que faltam vão para o fim do cabeçalho
    var novas = [];
    var idx = { cp: cp, cc: cc, cs: cs, cd: cd, cl: cl };
    [['Colaborador', 'cc'], ['Ouvidoria', 'cs'], ['Protocolo Ouvidoria', 'cp'], ['Data da ouvidoria', 'cd'], ['Ouvidoria na plataforma', 'cl']].forEach(function (x) {
      if (idx[x[1]] < 0) { var n = cab.length; cab.push(x[0]); novas.push([n, x[0]]); idx[x[1]] = n; }
    });
    cp = idx.cp; cc = idx.cc; cs = idx.cs; cd = idx.cd; cl = idx.cl;
    var precisa = cab.length;
    if (novas.length) {
      if (folha.properties.gridProperties && folha.properties.gridProperties.columnCount < precisa)
        cabecalho.push({ appendDimension: { sheetId: folha.properties.sheetId, dimension: 'COLUMNS', length: precisa - folha.properties.gridProperties.columnCount } });
      novas.forEach(function (x) {
        cabecalho.push({ updateCells: { range: { sheetId: folha.properties.sheetId, startRowIndex: hl, endRowIndex: hl + 1, startColumnIndex: x[0], endColumnIndex: x[0] + 1 },
          rows: [{ values: [{ userEnteredValue: { stringValue: x[1] } }] }], fields: 'userEnteredValue' } });
        if (x[0] > 0) cabecalho.push({ copyPaste: { source: { sheetId: folha.properties.sheetId, startRowIndex: hl, endRowIndex: hl + 1, startColumnIndex: x[0] - 1, endColumnIndex: x[0] },
          destination: { sheetId: folha.properties.sheetId, startRowIndex: hl, endRowIndex: hl + 1, startColumnIndex: x[0], endColumnIndex: x[0] + 1 }, pasteType: 'PASTE_FORMAT' } });
      });
    }
    var sid = folha.properties.sheetId;
    var cel = function (lin, col, v) { pedidos.push({ updateCells: { range: { sheetId: sid, startRowIndex: lin, endRowIndex: lin + 1, startColumnIndex: col, endColumnIndex: col + 1 }, rows: [{ values: [{ userEnteredValue: { stringValue: String(v) } }] }], fields: 'userEnteredValue' } }); };
    for (var j = hl + 1; j < m.length; j++) {
      var row = m[j] || [], inst = chave(row[ci]);
      if (!inst || (so && !so[inst])) continue;
      var recl = null;
      if (fixas.length) recl = fixas;
      else if (cr >= 0) { var n = reclamacaoDe(row[cr]); if (n == null) continue; recl = [n]; }
      var r = escolher(registros, inst, recl, p.desde);
      if (!r) continue;
      var pend = r.status === 'pendente', mudou = false;
      var protAtual = String(row[cp] == null ? '' : row[cp]).trim();
      var prot = pend ? (protAtual && protAtual.toLowerCase() !== 'erro' ? null : 'Erro') : (r.protocolo || null);
      if (prot != null && protAtual !== prot) { cel(j, cp, prot); mudou = true; }
      if (!String(row[cc] || '').trim() && r.responsavel) { cel(j, cc, r.responsavel); mudou = true; }
      var sit = pend ? 'Não enviada (problema no site)' : 'Enviada';
      if (String(row[cs] || '') !== sit) { cel(j, cs, sit); mudou = true; }
      var dt = br((pend ? r.ultimaTentativa : r.dataAbertura) || r.criadoEm);
      if (dt && String(row[cd] || '') !== dt) { cel(j, cd, dt); mudou = true; }
      if (String(row[cl] || '') !== 'Abrir ouvidoria') {
        pedidos.push({ updateCells: { range: { sheetId: sid, startRowIndex: j, endRowIndex: j + 1, startColumnIndex: cl, endColumnIndex: cl + 1 },
          rows: [{ values: [{ userEnteredValue: { stringValue: 'Abrir ouvidoria' }, textFormatRuns: [{ startIndex: 0, format: { link: { uri: PORTAL + r.id } } }] }] }], fields: 'userEnteredValue,textFormatRuns' } });
        mudou = true;
      }
      if (mudou && p.colorir) pedidos.push({ repeatCell: { range: { sheetId: sid, startRowIndex: j, endRowIndex: j + 1, startColumnIndex: 0, endColumnIndex: precisa },
        cell: { userEnteredFormat: { backgroundColor: pend ? LARANJA : VERDE } }, fields: 'userEnteredFormat.backgroundColor' } });
      if (mudou) linhas++;
    }
    // colunas novas só entram quando alguma linha vai ser preenchida
    if (linhas) await g.lote(pid, cabecalho.concat(pedidos));
    return linhas;
  }

  /**
   * opts: { google: PLAT.google, planilhas: [{nome, link, colorir, desde}], registros: [...], instalacoes: [opcional, só essas] }
   * Devolve [{ nome, linhas, erro }].
   */
  async function sincronizar(opts) {
    var g = opts.google, so = null, saida = [];
    if (opts.instalacoes) { so = {}; opts.instalacoes.forEach(function (i) { var k = chave(i); if (k) so[k] = true; }); }
    for (var i = 0; i < (opts.planilhas || []).length; i++) {
      var p = opts.planilhas[i], pid = idDoLink(p.link), tot = 0;
      if (!pid) continue;
      try {
        var meta = await g.planilha(pid);
        for (var k = 0; k < (meta.sheets || []).length; k++) {
          var f = meta.sheets[k], vals = await g.ler(pid, aspas(f.properties.title));
          tot += await umaAba(g, pid, f, vals, p, opts.registros || [], so);
        }
        saida.push({ nome: p.nome, linhas: tot });
      } catch (e) { saida.push({ nome: p.nome, linhas: tot, erro: e && e.message || String(e) }); }
    }
    return saida;
  }

  raiz.Acompanhamento = { sincronizar: sincronizar, reclamacaoDe: reclamacaoDe, idDoLink: idDoLink };
})(typeof window !== 'undefined' ? window : this);
