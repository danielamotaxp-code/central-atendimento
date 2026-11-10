/**
 * Central de Atendimento — mensagens padronizadas de WeGen, SmartBen e WattWise.
 *
 * As mensagens ficam no repositório privado central-atendimento-dados
 * (data/mensagens.json). Criar, editar e excluir aqui grava lá na hora e vale
 * para toda a equipe. Cada empresa tem as próprias etapas, abertura e assinatura.
 */
(function () {
  'use strict';

  var ARQ = 'data/mensagens.json';
  var SETORES = { financeiro: 'Financeiro', juridico: 'Jurídico' };
  var EMPRESAS_PADRAO = ['wegen', 'smartben', 'wattwise'];
  var esc = Plataforma.util.esc;

  var ctx, D = null, carregadoEm = 0;
  var empresa = 'wegen', busca = '', abertas = new Set(), valores = {}, usos = {}, opcOff = {}, semSaud = new Set();
  var editando = null, confirmarExc = null, salvando = false;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function prefs() { return ctx.preferencias || {}; }
  function G(k, p) { return ctx.guarda.ler(k + ':' + ctx.usuario.login, p); }
  function S(k, v) { ctx.guarda.gravar(k + ':' + ctx.usuario.login, v); }

  /* ======================= partida ======================= */
  Plataforma.iniciar({
    id: 'central-atendimento',
    moduloId: 'atendimento', // página do portal único
    nome: 'Central de Atendimento',
    subtitulo: 'WeGen · SmartBen · WattWise',
    letra: 'A',
    cor: '#2f4fa8',
    repoSite: 'danielamotaxp-code/central-atendimento',
    cofre: 'cofre.json',
    repoDados: 'danielamotaxp-code/central-atendimento-dados',
    usuariosIniciais: ['Daniela', 'Paula', 'Luis', 'Victor'],
    admins: ['Daniela'],
    preferencias: [
      { chave: 'atendente', rotulo: 'Seu nome nas mensagens', ajuda: 'Entra onde a mensagem diz "Me chamo…" e na assinatura da WattWise. Em branco, usa o seu nome de usuário.' },
      { chave: 'empresa', rotulo: 'Empresa que abre primeiro', tipo: 'select', opcoes: [{ valor: '', rotulo: 'A última que usei' }, { valor: 'wegen', rotulo: 'WeGen' }, { valor: 'smartben', rotulo: 'SmartBen' }, { valor: 'wattwise', rotulo: 'WattWise' }] },
      { chave: 'saudacao', rotulo: 'Saudação', tipo: 'select', opcoes: [{ valor: 'auto', rotulo: 'Automática pelo horário' }, 'Bom dia', 'Boa tarde', 'Boa noite'] },
      { chave: 'assinatura', rotulo: 'Minha assinatura (opcional)', tipo: 'textarea', exemplo: '*Atenciosamente,*\n*{atendente}*\n*Setor {setor} | {empresa}*',
        ajuda: 'Em branco, usa a assinatura de cada empresa. Pode usar {atendente}, {setor} e {empresa}.' }
    ],
    admin: [
      { titulo: 'Etapas do atendimento', desenhar: admEtapas },
      { titulo: 'Abertura e assinatura de cada empresa', desenhar: admEmpresas },
      { titulo: 'Mensagens excluídas', desenhar: admLixeira }
    ],
    aoEntrar: async function (c) { ctx = c; montar(); await carregar(); verificarAlteracoesAntigas(); },
    aoMudarPreferencias: function () { if (D) desenhar(); },
    aoSair: function () { D = null; abertas.clear(); valores = {}; }
  });

  /* ======================= dados ======================= */
  async function carregar(silencioso) {
    try {
      var d = await ctx.dados.ler(ARQ, null);
      if (!d) throw new Error('Arquivo de mensagens não encontrado.');
      D = normalizarDados(d); carregadoEm = Date.now();
      if (!silencioso) {
        usos = G('usos', {}); opcOff = G('opc', {}); semSaud = new Set(G('semsaud', []));
        try { valores = JSON.parse(sessionStorage.getItem('plat:central-atendimento:valores') || '{}') || {}; } catch (e) { valores = {}; }
        var p = prefs().empresa || G('empresa', 'wegen'); empresa = D.empresas[p] ? p : 'wegen';
      }
      desenhar();
    } catch (e) { $('#ca-etapas').innerHTML = '<div class="ca-vazio">Não foi possível carregar as mensagens: ' + esc(e.message) + '</div>'; }
  }
  function normalizarDados(d) {
    d.etapas = d.etapas || []; d.empresas = d.empresas || {}; d.mensagens = d.mensagens || []; d.lixeira = d.lixeira || [];
    return d;
  }
  /** Grava para toda a equipe: relê o arquivo, aplica a mudança e salva. */
  async function alterar(fn, mensagem) {
    salvando = true;
    try { D = normalizarDados(await ctx.dados.alterar(ARQ, function (d) { normalizarDados(d); fn(d); d.atualizadoEm = new Date().toISOString().slice(0, 10); return d; }, mensagem)); carregadoEm = Date.now(); desenhar(); return true; }
    catch (e) { ctx.aviso('Não foi salvo: ' + e.message, 'erro'); return false; }
    finally { salvando = false; }
  }
  window.addEventListener('focus', function () { if (D && !editando && !salvando && Date.now() - carregadoEm > 60000) carregar(true); });

  /* ======================= moldura ======================= */
  function montar() {
    ctx.conteudo().innerHTML =
      '<div class="ca-barra"><div class="p-seg" id="ca-empresas" role="group" aria-label="Empresa"></div>' +
      '<label class="ca-saud">Saudação <select id="ca-saudsel"><option value="auto">Automática</option><option>Bom dia</option><option>Boa tarde</option><option>Boa noite</option></select></label>' +
      '<div class="ca-busca"><input id="ca-q" type="search" placeholder="Buscar mensagem (ex.: protesto, distrato, saldo)" aria-label="Buscar mensagem"></div>' +
      '<button class="btn btn-peq btn-primario" id="ca-nova">Nova mensagem</button><button class="btn btn-peq" id="ca-atualizar" title="Buscar alterações feitas pela equipe">Atualizar</button></div>' +
      '<div class="ca-wrap"><nav class="ca-nav" id="ca-nav" aria-label="Etapas do atendimento"></nav><main class="ca-main">' +
        '<div id="ca-banner"></div>' +
        '<section class="ca-caixa" aria-label="Dados do cliente"><div class="ca-caixa-topo"><h2>Dados do cliente atual</h2><button class="btn btn-peq" id="ca-limpar">Limpar para novo cliente</button></div>' +
          '<div class="ca-campos" id="ca-campos"></div><div class="ca-legenda"><span>Os campos entre <code>[colchetes]</code> são preenchidos aqui e valem para todas as mensagens.</span><span>A saudação segue o campo Saudação do topo e a assinatura de cada empresa entra sozinha no fim.</span><span><code>*texto*</code> fica em negrito no WhatsApp.</span></div></section>' +
        '<div id="ca-migrar"></div>' +
        '<section class="ca-top" id="ca-top" hidden><h2>Mais usadas por você</h2><div class="ca-chips" id="ca-topchips"></div></section>' +
        '<div id="ca-editor"></div><div id="ca-etapas" style="display:flex;flex-direction:column;gap:28px"><div class="ca-vazio"><span class="p-spinner"></span> Carregando mensagens…</div></div><p class="ca-rodape" id="ca-rodape"></p>' +
      '</main></div>';
  }

  /* ======================= texto das mensagens ======================= */
  var RE_SAUD = /^(ol[aá]|oi|eii?|bom dia|boa tarde|boa noite|prezad[oa]s?|tudo bem|\{saudacao\})(?=[\s,!.?:]|$)|tudo bem\s*[?!.]*\s*$/i;
  var RE_FECHO = /^(qualquer d[uú]vida|estamos [àa] disposi|estou [àa] disposi|fico [àa] disposi|ficamos [àa] disposi|permanecemos [àa] disposi|atenciosamente|att\b|abra[çc]os|obrigad[oa]\s*[!.]*$|\*?(financeiro|jur[ií]dico|equipe)\b)/i;
  var RE_OPC = /^\{opcional:([^}]+)\}\s*/;
  function emp(k) { return D.empresas[k || empresa] || { nome: k, abertura: '', fecho: '', assinatura: '' }; }
  function nomeEmp(k) { return emp(k).nome || k; }
  function atendente() { return (prefs().atendente || '').trim() || ctx.usuario.nome; }
  function saudPref() { return prefs().saudacao || G('saud', 'auto'); }
  function saudacao() { var p = saudPref(); if (['Bom dia', 'Boa tarde', 'Boa noite'].indexOf(p) >= 0) return p; var h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; }
  function tirarSaud(t) { var l = String(t).split('\n'), i = 0; while (i < l.length && (!l[i].trim() || (l[i].trim().length < 90 && RE_SAUD.test(l[i].trim())))) i++; return i ? l.slice(i).join('\n') : t; }
  function comAbertura(m) { var a = emp().abertura; return a ? a + '\n\n' + tirarSaud(m.texto).trim() : m.texto; }
  function temSaud(m) { var t = comAbertura(m); return tirarSaud(t) !== t; }
  function opcionais(m) { return String(m.texto).split('\n\n').map(function (p) { return (p.match(RE_OPC) || [])[1]; }).filter(Boolean); }
  function aplicarOpc(m, t) { var off = opcOff[m.id] || []; return t.split('\n\n').filter(function (p) { var r = p.match(RE_OPC); return !r || off.indexOf(r[1]) < 0; }).map(function (p) { return p.replace(RE_OPC, ''); }).join('\n\n'); }
  function corpo(m) { var t = comAbertura(m); if (semSaud.has(m.id)) t = tirarSaud(t); return aplicarOpc(m, t); }
  function assinatura(m) {
    var s = m.setor || 'financeiro'; if (!SETORES[s]) return '';
    var e = emp(), modelo = (prefs().assinatura || '').trim() || e.assinatura || '*{setor} {empresa}*';
    var sig = modelo.replace(/\{setor\}/gi, SETORES[s]);
    return (m.fecho === 'assinatura' || !e.fecho ? '' : e.fecho + (sig.indexOf('\n') >= 0 ? '\n\n' : '\n')) + sig;
  }
  function completa(m) { var a = assinatura(m); return corpo(m) + (a ? '\n\n' + a : ''); }
  function tokens(t) {
    return t.replace(/\{saudacao\}/gi, function (x, o, str) { var s = saudacao(), prev = str.slice(Math.max(0, o - 2), o); return /[,a-z]\s?$/i.test(prev) && !/[.!?\n]\s?$/.test(prev) ? s.toLowerCase() : s; })
      .replace(/\{empresa\}/gi, nomeEmp()).replace(/\{atendente\}/gi, atendente());
  }
  function campos(t) { var s = new Set(); (t.match(/\[[^\]\n]+\]/g) || []).forEach(function (m) { s.add(m.slice(1, -1)); }); return Array.from(s); }
  function preencher(t) {
    if (!(valores.Nome || '').trim()) t = t.replace(/,\s*\[Nome\]\s*([,!.])/g, '$1').replace(/,\s*\[Nome\]/g, '').replace(/\[Nome\]\s*,\s*/g, '');
    return tokens(t).replace(/\[([^\]\n]+)\]/g, function (m, k) { return valores[k] ? valores[k] : m; });
  }
  function htmlTexto(t) {
    var cru = tokens(t), re = /\[([^\]\n]+)\]/g, m, ult = 0, out = '';
    while ((m = re.exec(cru))) { out += esc(cru.slice(ult, m.index)); out += valores[m[1]] ? '<span class="ok">' + esc(valores[m[1]]) + '</span>' : '<span class="ph">[' + esc(m[1]) + ']</span>'; ult = re.lastIndex; }
    out += esc(cru.slice(ult));
    return out.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>').replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,!?)]|$)/g, '$1<em>$2</em>');
  }

  /* ======================= desenho ======================= */
  function etapasDaEmpresa() { return D.etapas.filter(function (e) { return (e.empresas || EMPRESAS_PADRAO).indexOf(empresa) >= 0; }); }
  function visiveis() {
    var q = busca.trim().toLowerCase();
    return D.mensagens.filter(function (m) { return (m.empresas || []).indexOf(empresa) >= 0 && (!q || (m.titulo + ' ' + m.texto + ' ' + (m.nota || '')).toLowerCase().indexOf(q) >= 0); });
  }
  function desenhar() {
    if (!D) return;
    var marca = Plataforma.marcas[empresa];
    document.documentElement.style.setProperty('--cor', (marca && marca.cor) || ctx.cfg.cor);
    $('#ca-banner').innerHTML = Plataforma.banner(empresa);
    ctx.marca([empresa]);
    $('#ca-empresas').innerHTML = Object.keys(D.empresas).map(function (k) { return '<button type="button" data-emp="' + k + '" aria-pressed="' + (k === empresa) + '">' + esc(nomeEmp(k)) + '</button>'; }).join('');
    var sel = $('#ca-saudsel'); sel.value = saudPref(); var h = new Date().getHours(); sel.options[0].textContent = 'Automática (' + (h < 12 ? 'bom dia' : h < 18 ? 'boa tarde' : 'boa noite') + ')';
    desenharNav(); desenharTop(); desenharLista(); desenharCampos();
    $('#ca-rodape').textContent = D.atualizadoEm ? 'Mensagens atualizadas em ' + D.atualizadoEm.split('-').reverse().join('/') + '. O que você salvar aqui vale na hora para toda a equipe.' : '';
  }
  function desenharNav() {
    var v = visiveis();
    $('#ca-nav').innerHTML = '<div class="ca-navlabel">Ordem do atendimento · ' + esc(nomeEmp()) + '</div>' + etapasDaEmpresa().map(function (e, i) {
      return '<a href="#' + esc(e.k) + '" data-ir="' + esc(e.k) + '"><span class="n">' + String(i + 1).padStart(2, '0') + '</span>' + esc(e.t) + '<span class="c">' + v.filter(function (m) { return m.etapa === e.k; }).length + '</span></a>';
    }).join('');
  }
  function desenharTop() {
    var v = visiveis().filter(function (m) { return usos[m.id]; }).sort(function (a, b) { return usos[b.id] - usos[a.id]; }).slice(0, 6);
    $('#ca-top').hidden = !v.length || !!busca;
    $('#ca-topchips').innerHTML = v.map(function (m) { return '<button class="ca-chip" data-pular="' + esc(m.id) + '"><span class="k">' + usos[m.id] + '×</span>' + esc(m.titulo) + '</button>'; }).join('');
  }
  function cartao(m) {
    var aberta = abertas.has(m.id), es = m.empresas || [], tag;
    tag = es.length === Object.keys(D.empresas).length ? '<span class="ca-tag">Todas as empresas</span>' : '<span class="ca-tag so">' + (es.length === 1 ? 'Só ' : '') + es.map(nomeEmp).map(esc).join(' e ') + '</span>';
    var corpoH = '';
    if (aberta) {
      var falta = campos(corpo(m)).filter(function (f) { return !valores[f]; });
      corpoH = '<div class="ca-corpo"><div class="ca-msg">' + htmlTexto(completa(m)) + '</div>' + (m.nota ? '<div class="ca-nota">' + esc(m.nota) + '</div>' : '') +
        '<div class="ca-acoes"><button class="btn btn-primario" data-copiar="' + esc(m.id) + '">Copiar mensagem</button>' +
        (temSaud(m) ? '<label class="ca-chk"><input type="checkbox" data-saud="' + esc(m.id) + '"' + (semSaud.has(m.id) ? '' : ' checked') + '>Com saudação</label>' : '') +
        opcionais(m).map(function (l) { return '<label class="ca-chk"><input type="checkbox" data-opc="' + esc(m.id) + '" data-rot="' + esc(l) + '"' + ((opcOff[m.id] || []).indexOf(l) >= 0 ? '' : ' checked') + '>' + esc(l) + '</label>'; }).join('') +
        '<button class="btn btn-peq" data-editar="' + esc(m.id) + '">Editar</button>' +
        (confirmarExc === m.id ? '<button class="btn btn-peq btn-perigo" data-excsim="' + esc(m.id) + '">Confirmar exclusão</button><button class="btn btn-peq" data-excnao="1">Manter</button>' : '<button class="btn btn-peq btn-perigo" data-exc="' + esc(m.id) + '">Excluir</button>') +
        '<span class="ca-copiada" data-ok="' + esc(m.id) + '" hidden>Copiada</span><span class="ca-falta">' + (falta.length ? 'Falta preencher: ' + falta.map(esc).join(', ') : '') + '</span></div></div>';
    }
    return '<article class="ca-card" id="m-' + esc(m.id) + '"><div class="ca-card-topo"><button class="t" data-abrir="' + esc(m.id) + '" aria-expanded="' + aberta + '">' + esc(m.titulo) + '</button>' + tag +
      '<span class="ca-usos">' + (usos[m.id] ? usos[m.id] + (usos[m.id] === 1 ? ' uso' : ' usos') : '') + '</span><button class="btn btn-peq" data-abrir="' + esc(m.id) + '">' + (aberta ? 'Fechar' : 'Abrir') + '</button></div>' + corpoH + '</article>';
  }
  function desenharLista() {
    var v = visiveis();
    var html = etapasDaEmpresa().map(function (e, i) {
      var itens = v.filter(function (m) { return m.etapa === e.k; }).sort(function (a, b) { return (a.ordem == null ? 99 : a.ordem) - (b.ordem == null ? 99 : b.ordem); });
      if (busca && !itens.length) return '';
      return '<section class="ca-etapa" id="' + esc(e.k) + '"><h2><span class="n">' + String(i + 1).padStart(2, '0') + '</span>' + esc(e.t) + '<span class="d">' + esc(e.d || '') + '</span></h2><div class="ca-lista">' +
        (itens.length ? itens.map(cartao).join('') : '<div class="ca-vazio">Nenhuma mensagem nesta etapa para ' + esc(nomeEmp()) + '.</div>') + '</div></section>';
    }).join('');
    $('#ca-etapas').innerHTML = html || '<div class="ca-vazio">Nenhuma mensagem encontrada para "' + esc(busca) + '".</div>';
  }
  function desenharCampos() {
    var el = $('#ca-campos'), foco = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.campo;
    var lista = ['Nome'];
    abertas.forEach(function (id) { var m = acha(id); if (m) campos(corpo(m)).forEach(function (f) { if (lista.indexOf(f) < 0) lista.push(f); }); });
    el.innerHTML = lista.map(function (f) { return '<label>' + esc(f) + '<input data-campo="' + esc(f) + '" value="' + esc(valores[f] || '') + '" autocomplete="off"></label>'; }).join('') +
      (abertas.size ? '' : '<span class="p-dica">Abra uma mensagem para ver os campos que ela pede.</span>');
    if (foco) { var i = el.querySelector('[data-campo="' + CSS.escape(foco) + '"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }
  function acha(id) { return D.mensagens.find(function (m) { return m.id === id; }); }
  function piscar(id) { var c = document.getElementById('m-' + id); if (!c) return; c.scrollIntoView({ block: 'center' }); c.classList.add('flash'); setTimeout(function () { c.classList.remove('flash'); }, 1500); }

  /* ======================= editor ======================= */
  function editorHTML(m) {
    var nova = !m.id, es = m.empresas || [empresa];
    return '<form class="ca-editor" id="ca-form" data-id="' + esc(m.id || '') + '"><h2>' + (nova ? 'Nova mensagem' : 'Editar mensagem') + '</h2>' +
      '<label class="p-campo">Título (como aparece na lista)<input name="titulo" value="' + esc(m.titulo || '') + '" required placeholder="Ex.: Cancelamento concluído"></label>' +
      '<div><span class="ca-rot">Empresas</span><div class="marcas">' + Object.keys(D.empresas).map(function (k) { return '<label><input type="checkbox" name="emp" value="' + k + '"' + (es.indexOf(k) >= 0 ? ' checked' : '') + '>' + esc(nomeEmp(k)) + '</label>'; }).join('') + '</div></div>' +
      '<div class="linha"><label class="p-campo">Etapa do atendimento<select name="etapa">' + D.etapas.map(function (e) {
        var so = (e.empresas || EMPRESAS_PADRAO).length < Object.keys(D.empresas).length ? ' (' + (e.empresas || []).map(nomeEmp).join(', ') + ')' : '';
        return '<option value="' + esc(e.k) + '"' + (e.k === (m.etapa || (etapasDaEmpresa()[0] || {}).k) ? ' selected' : '') + '>' + esc(e.t + so) + '</option>'; }).join('') + '</select></label>' +
      '<label class="p-campo">Assinatura<select name="setor"><option value="financeiro"' + (m.setor === 'financeiro' || !m.setor ? ' selected' : '') + '>Financeiro</option><option value="juridico"' + (m.setor === 'juridico' ? ' selected' : '') + '>Jurídico</option><option value="nenhum"' + (m.setor === 'nenhum' ? ' selected' : '') + '>Sem assinatura</option></select></label>' +
      '<label class="p-campo">Fechamento<select name="fecho"><option value="completo"' + (m.fecho !== 'assinatura' ? ' selected' : '') + '>Frase de fechamento da empresa + assinatura</option><option value="assinatura"' + (m.fecho === 'assinatura' ? ' selected' : '') + '>Só a assinatura</option></select></label>' +
      '<label class="p-campo">Posição na etapa<input name="ordem" type="number" min="1" step="1" value="' + esc(m.ordem != null && m.ordem < 900 ? m.ordem : '') + '" placeholder="No fim"></label></div>' +
      '<label class="p-campo">Texto da mensagem<textarea name="texto" required placeholder="Use [Nome], [valor], [protocolo] etc. para os campos que mudam a cada cliente. {saudacao} vira bom dia/boa tarde; {atendente} vira o seu nome.">' + esc(m.texto || '') + '</textarea></label>' +
      '<p class="p-dica" id="ca-dica-abertura"></p>' +
      '<label class="p-campo">Observação interna (não vai na mensagem)<input name="nota" value="' + esc(m.nota || '') + '"></label>' +
      '<div><span class="ca-rot">Como a mensagem vai sair (' + esc(nomeEmp()) + ')</span><div class="ca-msg" id="ca-prev"></div></div>' +
      '<div class="ca-acoes"><button class="btn btn-primario" type="submit">' + (nova ? 'Adicionar para a equipe' : 'Salvar para a equipe') + '</button><button class="btn" type="button" id="ca-cancelar">Cancelar</button><span class="ca-falta" id="ca-erro"></span></div></form>';
  }
  function rascunho() {
    var f = $('#ca-form'); if (!f) return null; var fd = new FormData(f), es = fd.getAll('emp');
    var comAbert = es.length && es.every(function (k) { return !!emp(k).abertura; });
    var txt = String(fd.get('texto') || '').replace(/\r/g, '').replace(/[ \t]+$/gm, '').trim();
    if (comAbert) txt = normalizarComAbertura(txt);
    var ord = parseInt(fd.get('ordem'), 10);
    return { titulo: String(fd.get('titulo') || '').trim(), etapa: fd.get('etapa'), empresas: es, setor: fd.get('setor'), fecho: fd.get('fecho'), nota: String(fd.get('nota') || '').trim(), texto: txt, ordem: isNaN(ord) ? null : ord, comAbert: comAbert };
  }
  /** WeGen e SmartBen: a abertura e o fechamento entram sozinhos (como já era). */
  function normalizarComAbertura(t) {
    t = t.replace(/\p{Extended_Pictographic}️?/gu, '').replace(/\[\s*nome[^\]]*\]|\{\s*nome\s*\}|\(\s*nome\s*\)|\bNOME DO CLIENTE\b/gi, '[Nome]');
    var l = t.split('\n');
    while (l.length && (!l[0].trim() || (l[0].trim().length < 90 && RE_SAUD.test(l[0].trim())))) l.shift();
    while (l.length && (!l[l.length - 1].trim() || (l[l.length - 1].trim().length < 120 && RE_FECHO.test(l[l.length - 1].trim())))) l.pop();
    return l.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function previa() {
    var r = rascunho(), pv = $('#ca-prev'); if (!r || !pv) return;
    var m = { id: '_prev', texto: r.texto, setor: r.setor, fecho: r.fecho };
    pv.innerHTML = r.texto ? htmlTexto(completa(m)) : '<span class="p-dica">A prévia aparece aqui.</span>';
    $('#ca-dica-abertura').textContent = r.comAbert ? 'Para ' + r.empresas.map(nomeEmp).join(' e ') + ', a abertura "' + emp(r.empresas[0]).abertura + '" e o fechamento entram sozinhos; cumprimentos e emojis repetidos são retirados.' : 'O texto sai exatamente como escrito (com a saudação que você colocar), mais a assinatura escolhida.';
  }
  function abrirEditor(m) { editando = m || {}; confirmarExc = null; $('#ca-editor').innerHTML = editorHTML(editando); previa(); $('#ca-editor').scrollIntoView({ block: 'start' }); $('#ca-form [name=titulo]').focus(); }
  function fecharEditor() { editando = null; $('#ca-editor').innerHTML = ''; }

  /* ======================= eventos ======================= */
  document.addEventListener('click', async function (ev) {
    if (!D || !ev.target.closest('#p-conteudo')) return;
    var t = ev.target.closest('button,a'); if (!t) return;
    var ds = t.dataset;
    if (ds.emp) { empresa = ds.emp; S('empresa', empresa); desenhar(); return; }
    if (ds.ir) { ev.preventDefault(); var alvo = document.getElementById(ds.ir); if (alvo) alvo.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); return; }
    if (ds.abrir) { abertas.has(ds.abrir) ? abertas.delete(ds.abrir) : abertas.add(ds.abrir); desenhar(); return; }
    if (ds.pular) { abertas.add(ds.pular); desenhar(); piscar(ds.pular); return; }
    if (ds.copiar) {
      var m = acha(ds.copiar); if (!m) return;
      var ok = await copiar(preencher(completa(m))), el = document.querySelector('[data-ok="' + CSS.escape(m.id) + '"]');
      if (el) { el.hidden = false; el.textContent = ok ? 'Copiada' : 'Não foi possível copiar: selecione o texto e copie'; setTimeout(function () { el.hidden = true; }, 2500); }
      if (ok) { usos[m.id] = (usos[m.id] || 0) + 1; S('usos', usos); desenharTop(); }
      return;
    }
    if (t.id === 'ca-limpar') { valores = {}; guardarValores(); opcOff = {}; S('opc', opcOff); abertas.clear(); desenhar(); return; }
    if (t.id === 'ca-nova') { abrirEditor(null); return; }
    if (t.id === 'ca-atualizar') { await carregar(true); ctx.aviso('Mensagens atualizadas.'); return; }
    if (t.id === 'ca-cancelar') { fecharEditor(); return; }
    if (ds.editar) { var me = acha(ds.editar); if (me) abrirEditor(me); return; }
    if (ds.exc) { confirmarExc = ds.exc; desenharLista(); return; }
    if (ds.excnao) { confirmarExc = null; desenharLista(); return; }
    if (ds.excsim) {
      var id = ds.excsim, tit = (acha(id) || {}).titulo; t.disabled = true;
      var feito = await alterar(function (d) {
        var i = d.mensagens.findIndex(function (x) { return x.id === id; }); if (i < 0) return;
        d.lixeira.unshift({ mensagem: d.mensagens[i], por: ctx.usuario.nome, em: new Date().toISOString() }); d.lixeira = d.lixeira.slice(0, 60);
        d.mensagens.splice(i, 1);
      }, 'Mensagem excluída: ' + tit);
      if (feito) { confirmarExc = null; abertas.delete(id); ctx.aviso('Mensagem excluída para toda a equipe.'); }
      return;
    }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target; if (!D || !t.closest('#p-conteudo')) return;
    if (t.id === 'ca-saudsel') { S('saud', t.value); if (prefs().saudacao) ctx.preferencias.saudacao = t.value; desenhar(); previa(); return; }
    if (t.closest('#ca-form')) { previa(); return; }
    if (t.dataset.opc) { var id = t.dataset.opc, r = t.dataset.rot, s = new Set(opcOff[id] || []); t.checked ? s.delete(r) : s.add(r); opcOff[id] = Array.from(s); S('opc', opcOff); desenhar(); return; }
    if (t.dataset.saud) { t.checked ? semSaud.delete(t.dataset.saud) : semSaud.add(t.dataset.saud); S('semsaud', Array.from(semSaud)); desenhar(); }
  });
  document.addEventListener('input', function (ev) {
    var i = ev.target; if (!D || !i.closest('#p-conteudo')) return;
    if (i.id === 'ca-q') { busca = i.value; desenharNav(); desenharTop(); desenharLista(); return; }
    if (i.closest('#ca-form')) { previa(); return; }
    if (i.dataset.campo) {
      valores[i.dataset.campo] = i.value; guardarValores();
      abertas.forEach(function (id) {
        var m = acha(id); if (!m) return; var card = document.getElementById('m-' + id); if (!card) return;
        var c = card.querySelector('.ca-msg'); if (c) c.innerHTML = htmlTexto(completa(m));
        var f = card.querySelector('.ca-falta'); if (f) { var falta = campos(corpo(m)).filter(function (x) { return !valores[x]; }); f.textContent = falta.length ? 'Falta preencher: ' + falta.join(', ') : ''; }
      });
    }
  });
  document.addEventListener('submit', async function (ev) {
    if (ev.target.id !== 'ca-form') return; ev.preventDefault();
    var r = rascunho(), err = $('#ca-erro'); err.textContent = '';
    if (!r.titulo || !r.texto) { err.textContent = 'Preencha o título e o texto.'; return; }
    if (!r.empresas.length) { err.textContent = 'Marque pelo menos uma empresa.'; return; }
    var et = D.etapas.find(function (e) { return e.k === r.etapa; }), fora = r.empresas.filter(function (k) { return (et.empresas || EMPRESAS_PADRAO).indexOf(k) < 0; });
    if (fora.length) { err.textContent = 'A etapa "' + et.t + '" não aparece para ' + fora.map(nomeEmp).join(' e ') + '. Escolha outra etapa ou desmarque a empresa.'; return; }
    var id = ev.target.dataset.id, novoId = id || ('m' + Date.now().toString(36)), btn = ev.target.querySelector('[type=submit]');
    var campos_ = { titulo: r.titulo, etapa: r.etapa, empresas: r.empresas, setor: r.setor, fecho: r.fecho, nota: r.nota, texto: r.texto };
    btn.disabled = true; btn.innerHTML = '<span class="p-spinner"></span> Salvando…';
    var ok = await alterar(function (d) {
      var x = d.mensagens.find(function (m) { return m.id === novoId; });
      var ordem = r.ordem != null ? r.ordem : (x && x.etapa === r.etapa ? x.ordem : 900 + d.mensagens.length);
      if (x) Object.assign(x, campos_, { ordem: ordem, editadaPor: ctx.usuario.nome, editadaEm: new Date().toISOString().slice(0, 10) });
      else d.mensagens.push(Object.assign({ id: novoId }, campos_, { ordem: ordem, criadaPor: ctx.usuario.nome, criadaEm: new Date().toISOString().slice(0, 10) }));
    }, (id ? 'Mensagem editada: ' : 'Mensagem nova: ') + r.titulo);
    if (!ok) { btn.disabled = false; btn.textContent = id ? 'Salvar para a equipe' : 'Adicionar para a equipe'; return; }
    fecharEditor(); abertas.add(novoId);
    if (r.empresas.indexOf(empresa) < 0) { empresa = r.empresas[0]; S('empresa', empresa); }
    desenhar(); piscar(novoId); ctx.aviso(id ? 'Alteração salva para toda a equipe.' : 'Mensagem adicionada para toda a equipe.');
  });
  function guardarValores() { try { sessionStorage.setItem('plat:central-atendimento:valores', JSON.stringify(valores)); } catch (e) { /* sem armazenamento */ } }
  async function copiar(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch (e) { var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (x) { /* nada */ } ta.remove(); return ok; }
  }

  /* ======================= alterações antigas (só neste navegador) ======================= */
  function verificarAlteracoesAntigas() {
    var e; try { e = JSON.parse(localStorage.getItem('ca-edits') || 'null'); } catch (x) { e = null; }
    if (!e) return;
    var importadas = new Set(); try { JSON.parse(localStorage.getItem('ca-importadas') || '[]').forEach(function (i) { importadas.add(i); }); } catch (x) { /* nada */ }
    var jaFeitas = new Set(), jaEditadas = new Set();
    (D.importacoes || []).forEach(function (imp) { (imp.novas || []).forEach(function (i) { jaFeitas.add(i); }); (imp.editadas || []).forEach(function (i) { jaEditadas.add(i); }); });
    // WattWise agora segue só o documento novo: alterações antigas valem apenas para WeGen e SmartBen
    var semWatt = function (m) { return Object.assign({}, m, { empresas: (m.empresas || []).filter(function (k) { return k !== 'wattwise'; }) }); };
    var novas = (e.novas || []).filter(function (m) { return !jaFeitas.has(m.id); }).map(semWatt).filter(function (m) { return m.empresas.length; });
    var editadas = Object.keys(e.editadas || {}).filter(function (id) { return !jaEditadas.has(id) && acha(id); });
    var ocultas = (e.ocultas || []).filter(function (id) { return acha(id) && id.indexOf('ww-') !== 0; });
    var total = novas.length + editadas.length + ocultas.length;
    if (!total) { try { localStorage.removeItem('ca-edits'); } catch (x) { /* nada */ } return; }
    var box = $('#ca-migrar');
    box.innerHTML = '<div class="p-faixa aviso" style="margin:0"><span style="flex:1 1 300px">Este navegador tem <b>' + total + ' alteração(ões)</b> feitas na versão antiga, que ficaram só aqui (' + novas.length + ' nova(s), ' + editadas.length + ' editada(s), ' + ocultas.length + ' excluída(s)). Para WeGen e SmartBen, você pode enviá-las agora para toda a equipe.</span>' +
      '<button class="btn btn-peq btn-primario" id="ca-mig-sim">Enviar para a equipe</button><button class="btn btn-peq" id="ca-mig-nao">Descartar</button></div>';
    $('#ca-mig-nao').onclick = function () { try { localStorage.removeItem('ca-edits'); } catch (x) { /* nada */ } box.innerHTML = ''; };
    $('#ca-mig-sim').onclick = async function () {
      this.disabled = true;
      var ok = await alterar(function (d) {
        novas.forEach(function (m) { if (!d.mensagens.some(function (x) { return x.id === m.id; })) { var n = Object.assign({}, m); delete n.local; n.texto = normalizarComAbertura(n.texto); n.criadaPor = ctx.usuario.nome; d.mensagens.push(n); } });
        editadas.forEach(function (id) { var x = d.mensagens.find(function (m) { return m.id === id; }); if (!x) return; var ed = Object.assign({}, e.editadas[id]); delete ed.local; ed.empresas = (ed.empresas || x.empresas).filter(function (k) { return k !== 'wattwise'; }); if (!ed.empresas.length) return; ed.texto = normalizarComAbertura(ed.texto || x.texto); Object.assign(x, ed, { editadaPor: ctx.usuario.nome }); });
        ocultas.forEach(function (id) { var i = d.mensagens.findIndex(function (m) { return m.id === id; }); if (i >= 0) { d.lixeira.unshift({ mensagem: d.mensagens[i], por: ctx.usuario.nome, em: new Date().toISOString() }); d.mensagens.splice(i, 1); } });
      }, 'Alterações antigas do navegador de ' + ctx.usuario.nome);
      if (ok) { try { localStorage.removeItem('ca-edits'); } catch (x) { /* nada */ } box.innerHTML = ''; ctx.aviso('Alterações enviadas para a equipe.'); }
      else this.disabled = false;
    };
  }

  /* ======================= Administração ======================= */
  function admEtapas(box) {
    var lista = JSON.parse(JSON.stringify(D.etapas)), ks = Object.keys(D.empresas);
    function desenha() {
      var cont = {}; D.mensagens.forEach(function (m) { cont[m.etapa] = (cont[m.etapa] || 0) + 1; });
      box.innerHTML = '<h3>Etapas do atendimento</h3><p class="p-ajuda">Ordem, nome e em quais empresas cada etapa aparece. Uma etapa só pode ser excluída quando não tem mensagens.</p>' +
        lista.map(function (e, i) {
          return '<div class="ca-adm-item" data-i="' + i + '"><div class="p-linha"><input class="p-entrada" data-c="t" value="' + esc(e.t) + '" aria-label="Nome da etapa"><button class="btn btn-peq" data-m="-1" type="button" aria-label="Subir"' + (i ? '' : ' disabled') + '>↑</button><button class="btn btn-peq" data-m="1" type="button" aria-label="Descer"' + (i < lista.length - 1 ? '' : ' disabled') + '>↓</button>' +
            (cont[e.k] ? '<span class="p-dica">' + cont[e.k] + ' msg</span>' : '<button class="btn btn-peq btn-perigo" data-x="1" type="button">Excluir</button>') + '</div>' +
            '<input class="p-entrada" data-c="d" value="' + esc(e.d || '') + '" placeholder="Descrição" aria-label="Descrição da etapa"><div class="p-linha">' +
            ks.map(function (k) { return '<label><input type="checkbox" data-e="' + k + '"' + ((e.empresas || EMPRESAS_PADRAO).indexOf(k) >= 0 ? ' checked' : '') + '> ' + esc(nomeEmp(k)) + '</label>'; }).join('') + '</div></div>';
        }).join('') +
        '<div class="p-linha"><input class="p-entrada" id="ca-et-nova" placeholder="Nova etapa"><button class="btn" type="button" id="ca-et-add">Incluir etapa</button></div>' +
        '<div class="p-linha"><button class="btn btn-primario" type="button" id="ca-et-salvar">Salvar etapas</button></div>';
    }
    function ler() { $$('.ca-adm-item', box).forEach(function (it) { var e = lista[+it.dataset.i]; e.t = $('[data-c=t]', it).value.trim() || e.t; e.d = $('[data-c=d]', it).value.trim(); e.empresas = $$('[data-e]', it).filter(function (c) { return c.checked; }).map(function (c) { return c.dataset.e; }); }); }
    box.onclick = async function (ev) {
      var b = ev.target.closest('button'); if (!b) return; ler();
      var it = b.closest('.ca-adm-item'), i = it ? +it.dataset.i : -1;
      if (b.dataset.m) { var j = i + +b.dataset.m; var x = lista[i]; lista[i] = lista[j]; lista[j] = x; desenha(); }
      else if (b.dataset.x) { lista.splice(i, 1); desenha(); }
      else if (b.id === 'ca-et-add') { var t = $('#ca-et-nova').value.trim(); if (!t) return; var k = Plataforma.util.slug(t) || ('etapa' + Date.now()); while (lista.some(function (e) { return e.k === k; })) k += '-2'; lista.push({ k: k, t: t, d: '', empresas: ks.slice() }); desenha(); }
      else if (b.id === 'ca-et-salvar') {
        b.disabled = true;
        var ok = await alterar(function (d) {
          var usadas = {}; d.mensagens.forEach(function (m) { usadas[m.etapa] = 1; });
          // não deixa sumir etapa que alguém acabou de usar
          d.etapas.forEach(function (e) { if (usadas[e.k] && !lista.some(function (x) { return x.k === e.k; })) lista.push(e); });
          d.etapas = lista;
        }, 'Etapas atualizadas');
        b.disabled = false; if (ok) { lista = JSON.parse(JSON.stringify(D.etapas)); desenha(); ctx.aviso('Etapas salvas.'); }
      }
    };
    desenha();
  }
  function admEmpresas(box) {
    box.innerHTML = '<h3>Abertura e assinatura de cada empresa</h3><p class="p-ajuda">Cada empresa tem o seu jeito. A abertura entra antes de toda mensagem (deixe em branco para a mensagem trazer a própria saudação). Pode usar {saudacao}, [Nome], {setor}, {empresa} e {atendente}.</p>' +
      Object.keys(D.empresas).map(function (k) {
        var e = D.empresas[k];
        return '<div class="ca-adm-item" data-k="' + k + '"><strong>' + esc(e.nome) + '</strong>' +
          '<label class="p-campo">Abertura<input data-c="abertura" value="' + esc(e.abertura || '') + '"></label>' +
          '<label class="p-campo">Frase de fechamento<input data-c="fecho" value="' + esc(e.fecho || '') + '"></label>' +
          '<label class="p-campo">Assinatura<textarea data-c="assinatura" style="min-height:96px">' + esc(e.assinatura || '') + '</textarea></label></div>';
      }).join('') + '<div class="p-linha"><button class="btn btn-primario" type="button" id="ca-emp-salvar">Salvar empresas</button></div>';
    $('#ca-emp-salvar', box).onclick = async function () {
      var b = this, mud = {}; b.disabled = true;
      $$('.ca-adm-item', box).forEach(function (it) { var m = {}; $$('[data-c]', it).forEach(function (c) { m[c.dataset.c] = c.value; }); mud[it.dataset.k] = m; });
      var ok = await alterar(function (d) { Object.keys(mud).forEach(function (k) { Object.assign(d.empresas[k], mud[k]); }); }, 'Abertura e assinatura das empresas');
      b.disabled = false; if (ok) ctx.aviso('Empresas salvas.');
    };
  }
  function admLixeira(box) {
    function desenha() {
      var l = D.lixeira || [];
      box.innerHTML = '<h3>Mensagens excluídas</h3>' + (l.length ? '<p class="p-ajuda">As últimas 60 exclusões. Restaurar devolve a mensagem para a equipe.</p>' + l.map(function (x, i) {
        return '<div class="p-usuario-item"><strong>' + esc(x.mensagem.titulo) + ' <span class="p-dica">· ' + esc((x.mensagem.empresas || []).map(nomeEmp).join(', ')) + ' · excluída por ' + esc(x.por) + ' em ' + esc(new Date(x.em).toLocaleDateString('pt-BR')) + '</span></strong><button class="btn btn-peq" data-r="' + i + '" type="button">Restaurar</button></div>';
      }).join('') : '<p class="p-ajuda">Nenhuma mensagem excluída.</p>');
    }
    box.onclick = async function (ev) {
      var b = ev.target.closest('[data-r]'); if (!b) return; b.disabled = true;
      var alvo = D.lixeira[+b.dataset.r];
      var ok = await alterar(function (d) {
        var i = d.lixeira.findIndex(function (x) { return x.em === alvo.em && x.mensagem.id === alvo.mensagem.id; }); if (i < 0) return;
        var m = d.lixeira[i].mensagem; d.lixeira.splice(i, 1);
        if (!d.mensagens.some(function (x) { return x.id === m.id; })) d.mensagens.push(m);
      }, 'Mensagem restaurada: ' + alvo.mensagem.titulo);
      if (ok) ctx.aviso('Mensagem restaurada.'); desenha();
    };
    desenha();
  }
})();
