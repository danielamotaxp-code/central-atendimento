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
  // qualquer coluna de instalação (ex.: "Instalação do cliente" e "Instalação da usina")
  function temInst(h) { return ehInst(h) || /(^|\s)instalacao(\s|$)/.test(norm(h)); }
  function reclamacaoDe(v) { var m = String(v || '').match(/reclama\S*\s*(?:n\S*\s*)?(\d+)/i); return m ? +m[1] : null; }
  // texto da coluna "Retorno da Cemig": Sim (data da última carta da Cemig) ou Não — qualquer carta conta, como no Registro de protocolos
  function textoRetorno(r) {
    if (r.status === 'pendente') return '';
    var rs = r.retornos || [];
    if (!rs.length) return 'Não';
    var u = rs.slice().sort(function (a, b) { return String(a.dataISO || a.recebidoEm || '').localeCompare(String(b.dataISO || b.recebidoEm || '')); }).pop();
    return 'Sim' + (u.dataISO ? ' (' + br(u.dataISO) + ')' : '');
  }
  function aspas(t) { return "'" + String(t).replace(/'/g, "''") + "'"; }

  var NAO_REG = 'Não registrada na plataforma';
  function ehProt(h) { return /^protocolo( da)? ouvidoria$|^protocolo$/.test(norm(h)); }
  function escolher(registros, inst, recl, desde, prot) {
    var rs = registros.filter(function (r) {
      return (inst ? chave(r.instalacao) === inst : (prot && chave(r.protocolo) === prot)) && (recl == null || recl.indexOf(+r.reclamacao) >= 0) && String(r.criadoEm || '').slice(0, 10) >= (desde || '');
    }).sort(function (a, b) { return String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')); });
    return rs.filter(function (r) { return r.status !== 'pendente'; })[0] || rs[0] || null;
  }

  async function umaAba(g, pid, folha, valores, p, registros, so) {
    var m = valores || [], pedidos = [], linhas = 0, cabecalho = [];
    // cabeçalho: linha com a instalação (ou, sem ela, com o protocolo)
    var hl = m.findIndex(function (row) { return (row || []).some(temInst); });
    if (hl < 0) hl = m.findIndex(function (row) { return (row || []).some(ehProt); });
    if (hl < 0) return 0;
    var cab = m[hl].slice(), ci = cab.findIndex(ehInst);
    var insCols = []; cab.forEach(function (h, k) { if (temInst(h)) insCols.push(k); });
    if (ci < 0) ci = insCols[0];
    var achar = function (re) { return cab.findIndex(function (h) { return re.test(norm(h)); }); };
    var cp = achar(/^protocolo( da)? ouvidoria$/); if (cp < 0) cp = achar(/^protocolo$/);
    var cc = achar(/^colaborador$/), cl = achar(/^ouvidoria na plataforma$/);
    var cs = achar(/^ouvidoria$/), cd = achar(/^data da ouvidoria$/), crt = achar(/^retorno da cemig$/);
    var temRetorno = !p.semRetorno; // a coluna Retorno da Cemig aparece em todas as planilhas (menos a de solicitações, que guarda o ID no fim)
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
      if (idx[x[1]] < 0 && !p.apenasRetorno) { var n = cab.length; cab.push(x[0]); novas.push([n, x[0]]); idx[x[1]] = n; }
    });
    cp = idx.cp; cc = idx.cc; cs = idx.cs; cd = idx.cd; cl = idx.cl;
    if (crt < 0 && temRetorno) { crt = cab.length; cab.push('Retorno da Cemig'); novas.push([crt, 'Retorno da Cemig']); }
    var precisa = cab.length;
    if (novas.length) {
      if (folha.properties.gridProperties && folha.properties.gridProperties.columnCount < precisa)
        // deixa colunas em branco sobrando no fim, para a planilha continuar rolando para a direita
        cabecalho.push({ appendDimension: { sheetId: folha.properties.sheetId, dimension: 'COLUMNS', length: precisa - folha.properties.gridProperties.columnCount + 10 } });
      // as colunas em branco do fim ficam sem cor nem borda (o Google copia a formatação da última coluna)
      if (folha.properties.gridProperties && folha.properties.gridProperties.columnCount < precisa)
        cabecalho.push({ repeatCell: { range: { sheetId: folha.properties.sheetId, startColumnIndex: precisa, endColumnIndex: precisa + 10 }, cell: {}, fields: 'userEnteredFormat' } });
      novas.forEach(function (x) {
        cabecalho.push({ updateCells: { range: { sheetId: folha.properties.sheetId, startRowIndex: hl, endRowIndex: hl + 1, startColumnIndex: x[0], endColumnIndex: x[0] + 1 },
          rows: [{ values: [{ userEnteredValue: { stringValue: x[1] } }] }], fields: 'userEnteredValue' } });
        if (x[0] > 0) cabecalho.push({ copyPaste: { source: { sheetId: folha.properties.sheetId, startRowIndex: hl, endRowIndex: hl + 1, startColumnIndex: x[0] - 1, endColumnIndex: x[0] },
          destination: { sheetId: folha.properties.sheetId, startRowIndex: hl, endRowIndex: hl + 1, startColumnIndex: x[0], endColumnIndex: x[0] + 1 }, pasteType: 'PASTE_FORMAT' } });
      });
    }
    var sid = folha.properties.sheetId;
    // bordinhas nas colunas da ouvidoria (como a equipe faz na planilha)
    var bloco = [cc, cs, cp, cd, cl].concat(crt >= 0 ? [crt] : []).filter(function (c) { return c >= 0; }), b0 = Math.min.apply(null, bloco), b1 = Math.max.apply(null, bloco) + 1;
    var LINHA = { style: 'SOLID', width: 1 };
    var centro = function (l0, l1, c0, c1) { pedidos.push({ repeatCell: { range: { sheetId: sid, startRowIndex: l0, endRowIndex: l1, startColumnIndex: c0, endColumnIndex: c1 },
      cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { bold: false } } }, fields: 'userEnteredFormat.horizontalAlignment,userEnteredFormat.textFormat.bold' } }); };
    var bordas = function (l0, l1, c0, c1) { centro(l0, l1, c0, c1); pedidos.push({ updateBorders: { range: { sheetId: sid, startRowIndex: l0, endRowIndex: l1, startColumnIndex: c0, endColumnIndex: c1 },
      top: LINHA, bottom: LINHA, left: LINHA, right: LINHA, innerHorizontal: LINHA, innerVertical: LINHA } }); };
    if (novas.length) {
      var ult = m.length; while (ult > hl + 1 && !(m[ult - 1] || []).some(function (v) { return String(v == null ? '' : v).trim(); })) ult--;
      novas.forEach(function (x) { bordas(hl, ult, x[0], x[0] + 1); });
    }
    var cel = function (lin, col, v) { pedidos.push({ updateCells: { range: { sheetId: sid, startRowIndex: lin, endRowIndex: lin + 1, startColumnIndex: col, endColumnIndex: col + 1 }, rows: [{ values: [{ userEnteredValue: { stringValue: String(v) } }] }], fields: 'userEnteredValue' } }); };
    for (var j = hl + 1; j < m.length; j++) {
      var row = m[j] || [];
      var insts = insCols.map(function (k) { return chave(row[k]); }).filter(function (x) { return x.length >= 6; });
      var inst = insts[0] || '';
      var protPlan = chave(row[cp]); if (protPlan.length < 6) protPlan = '';
      if (!inst && !protPlan) continue;
      if (so && !insts.some(function (x) { return so[x]; }) && !(protPlan && so['p' + protPlan])) continue;
      var recl = null;
      if (fixas.length) recl = fixas;
      else if (cr >= 0) { var n = reclamacaoDe(row[cr]); if (n == null) continue; recl = [n]; }
      var r = null;
      for (var q = 0; q < insts.length && !r; q++) r = escolher(registros, insts[q], recl, p.desde, protPlan);
      if (!r && !insts.length) r = escolher(registros, '', recl, p.desde, protPlan);
      if (!r && insts.length && protPlan) r = escolher(registros, '', recl, p.desde, protPlan);
      if (!r) {
        // tem protocolo na planilha, mas a ouvidoria não está registrada na plataforma
        if (!p.apenasRetorno && protPlan && !so && registros.length > 20 && String(row[cs] || '') !== NAO_REG) {
          var rf = cr >= 0 ? cr : ci;
          if (!p.colorir && rf >= 0 && rf !== cs) pedidos.push({ copyPaste: { source: { sheetId: sid, startRowIndex: j, endRowIndex: j + 1, startColumnIndex: rf, endColumnIndex: rf + 1 },
            destination: { sheetId: sid, startRowIndex: j, endRowIndex: j + 1, startColumnIndex: cs, endColumnIndex: cs + 1 }, pasteType: 'PASTE_FORMAT' } });
          cel(j, cs, NAO_REG); bordas(j, j + 1, cs, cs + 1); linhas++;
        }
        continue;
      }
      var pend = r.status === 'pendente', mudou = false, inicioLinha = pedidos.length;
      var txtRet = textoRetorno(r);
      if (crt >= 0 && txtRet && String(row[crt] || '') !== txtRet) { cel(j, crt, txtRet); mudou = true; }
      if (p.apenasRetorno) { if (mudou) { bordas(j, j + 1, crt, crt + 1); linhas++; } continue; }
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
      // sem pintar: as colunas da ouvidoria ficam com a cor que a linha já tem (copiada da coluna da reclamação ou da instalação)
      var ref = cr >= 0 ? cr : ci;
      if (mudou && !p.colorir && ref >= 0) [cc, cs, cd, cl].forEach(function (c) {
        if (c !== ref) pedidos.splice(inicioLinha, 0, { copyPaste: { source: { sheetId: sid, startRowIndex: j, endRowIndex: j + 1, startColumnIndex: ref, endColumnIndex: ref + 1 },
          destination: { sheetId: sid, startRowIndex: j, endRowIndex: j + 1, startColumnIndex: c, endColumnIndex: c + 1 }, pasteType: 'PASTE_FORMAT' } });
      });
      if (mudou && p.colorir) pedidos.push({ repeatCell: { range: { sheetId: sid, startRowIndex: j, endRowIndex: j + 1, startColumnIndex: Math.max(0, cab.findIndex(function (h) { return String(h == null ? '' : h).trim(); })), endColumnIndex: precisa },
        cell: { userEnteredFormat: { backgroundColor: pend ? LARANJA : VERDE } }, fields: 'userEnteredFormat.backgroundColor' } });
      if (mudou) { bordas(j, j + 1, b0, b1); linhas++; }
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
    // sem a lista de ouvidorias da plataforma não dá para saber quem está registrado: não mexe em nada
    if (!opts.registros || !opts.registros.length) throw new Error('A lista de ouvidorias da plataforma não carregou. Recarregue a página e tente de novo.');
    if (opts.instalacoes) { so = {}; opts.instalacoes.forEach(function (i) { var k = chave(i); if (k) so[k] = true; }); }
    if (opts.protocolos) { so = so || {}; opts.protocolos.forEach(function (i) { var k = chave(i); if (k) so['p' + k] = true; }); }
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

  raiz.Acompanhamento = { sincronizar: sincronizar, textoRetorno: textoRetorno, reclamacaoDe: reclamacaoDe, idDoLink: idDoLink };
})(typeof window !== 'undefined' ? window : this);
