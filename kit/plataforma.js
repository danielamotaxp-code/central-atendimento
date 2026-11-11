/**
 * Plataforma — base comum a todas as plataformas (padrão WattWise).
 *
 * Cuida de: tela de login (usuário + senha + "Manter conectado"), cofre de acesso,
 * Minha conta (senha, aparência e preferências de cada pessoa), Administração
 * (incluir, remover e redefinir usuários; trocar o token do GitHub), leitura e
 * gravação no repositório privado de dados e, quando a plataforma pedir,
 * "Entrar com Google" para ler e alterar planilhas.
 *
 * Cofre (cofre.json, no repositório público, sem nenhum dado em texto aberto):
 *   - uma chave-mestra aleatória tranca o token do GitHub (AES-256-GCM);
 *   - cada usuário guarda a chave-mestra trancada com a própria senha
 *     (PBKDF2-SHA256, 600 mil iterações). Trocar a senha de alguém, incluir ou
 *     remover pessoas e trocar o token não exige saber a senha dos outros.
 *
 * Uso numa plataforma:
 *   Plataforma.iniciar({ id, nome, subtitulo, letra, cor, repoSite, cofre,
 *     repoDados, usuariosIniciais, admins, preferencias, admin, abas, google,
 *     aoEntrar(ctx) { ... } });
 */
(function (global) {
  'use strict';

  var VERSAO_KIT = '1.0';
  var ITER = 600000;
  var SENHA_PADRAO = '102030';
  var API = 'https://api.github.com';
  var enc = new TextEncoder(), dec = new TextDecoder();
  var CLIENTE_GOOGLE = '164834594868-vaihaied48tm370kpkp6km6fagjcasog.apps.googleusercontent.com';

  /* ======================= utilidades ======================= */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function b64(bytes) { var s = '', u = new Uint8Array(bytes); for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(t) { var s = atob(String(t).replace(/\s/g, '')), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function textoParaB64(t) { return b64(enc.encode(t)); }
  function b64ParaTexto(t) { return dec.decode(unb64(t)); }
  function aleatorio(n) { return crypto.getRandomValues(new Uint8Array(n)); }
  function slug(nome) { return String(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function espera(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* armazenamento do navegador, separado por plataforma (todas ficam no mesmo endereço) */
  function Guarda(id) {
    function k(c) { return 'plat:' + id + ':' + c; }
    function de(onde) { try { return onde === 'sessao' ? sessionStorage : localStorage; } catch (e) { return null; } }
    return {
      ler: function (c, padrao, onde) { try { var v = de(onde).getItem(k(c)); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; } },
      gravar: function (c, v, onde) { try { de(onde).setItem(k(c), JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
      apagar: function (c, onde) { try { de(onde).removeItem(k(c)); } catch (e) { /* sem armazenamento */ } }
    };
  }

  /* ======================= criptografia ======================= */
  function chaveDaSenha(senha, salt) {
    return crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function chaveCrua(bytes, usos) { return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, usos || ['encrypt', 'decrypt']); }
  async function cifrar(chave, bytes) { var iv = aleatorio(12); var c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, chave, bytes); return { iv: b64(iv), dados: b64(c) }; }
  async function decifrar(chave, obj) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) }, chave, unb64(obj.dados))); }

  /** Tranca a chave-mestra com a senha de um usuário. */
  async function entradaUsuario(nome, papel, senha, mestra, padrao, modulos) {
    var salt = aleatorio(16);
    var c = await cifrar(await chaveDaSenha(senha, salt), mestra);
    var e = { nome: nome, papel: papel, salt: b64(salt), iv: c.iv, chave: c.dados, senhaPadrao: !!padrao };
    if (Array.isArray(modulos) && modulos.length && modulos.length < 6) e.modulos = modulos; // todas marcadas = vê tudo
    return e;
  }
  async function abrirEntrada(u, senha) {
    return decifrar(await chaveDaSenha(senha, unb64(u.salt)), { iv: u.iv, dados: u.chave });
  }
  async function trancarToken(token, mestra) { return cifrar(await chaveCrua(mestra), enc.encode(token)); }
  async function abrirToken(obj, mestra) { return dec.decode(await decifrar(await chaveCrua(mestra), obj)); }

  /* ======================= GitHub ======================= */
  function GitHub(obterToken, aoFalharAcesso) {
    async function chamar(metodo, caminho, corpo, aceitar) {
      var tok = obterToken();
      var r = await fetch(API + caminho, {
        method: metodo, cache: 'no-store',
        headers: Object.assign({ 'Accept': aceitar || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          tok ? { 'Authorization': 'Bearer ' + tok } : {}, corpo ? { 'Content-Type': 'application/json' } : {}),
        body: corpo ? JSON.stringify(corpo) : undefined
      });
      if (r.status === 401 && aoFalharAcesso) aoFalharAcesso();
      return r;
    }
    function caminho(repo, arq) { return '/repos/' + repo + '/contents/' + arq.split('/').map(encodeURIComponent).join('/'); }
    async function erro(r, oque) {
      var msg = ''; try { msg = (await r.json()).message || ''; } catch (e) { /* sem corpo */ }
      var e = new Error(oque + ' (' + r.status + (msg ? ': ' + msg : '') + ')'); e.status = r.status; return e;
    }
    var api = {
      chamar: chamar,
      /** Lê um arquivo de texto. Devolve { texto, sha } ou null se não existir. */
      ler: async function (repo, arq) {
        var r = await chamar('GET', caminho(repo, arq) + '?t=' + Date.now());
        if (r.status === 404) return null;
        if (!r.ok) throw await erro(r, 'Não foi possível ler ' + arq);
        var j = await r.json();
        if (j.content) return { texto: b64ParaTexto(j.content), sha: j.sha };
        // arquivos grandes (mais de 1 MB) vêm sem conteúdo: busca pelo blob
        var rb = await chamar('GET', '/repos/' + repo + '/git/blobs/' + j.sha);
        if (!rb.ok) throw await erro(rb, 'Não foi possível ler ' + arq);
        return { texto: b64ParaTexto((await rb.json()).content), sha: j.sha };
      },
      /** Grava (cria ou substitui) um arquivo de texto. */
      gravar: async function (repo, arq, texto, sha, mensagem) {
        var r = await chamar('PUT', caminho(repo, arq), { message: mensagem || ('Atualiza ' + arq), content: textoParaB64(texto), sha: sha || undefined });
        if (!r.ok) throw await erro(r, 'Não foi possível salvar ' + arq);
        return (await r.json()).content.sha;
      },
      /** Grava um arquivo binário (Uint8Array). */
      gravarBinario: async function (repo, arq, bytes, sha, mensagem) {
        var r = await chamar('PUT', caminho(repo, arq), { message: mensagem || ('Atualiza ' + arq), content: b64(bytes), sha: sha || undefined });
        if (!r.ok) throw await erro(r, 'Não foi possível salvar ' + arq);
        return (await r.json()).content.sha;
      },
      excluir: async function (repo, arq, sha, mensagem) {
        if (!sha) { var a = await api.ler(repo, arq); if (!a) return; sha = a.sha; }
        var r = await chamar('DELETE', caminho(repo, arq), { message: mensagem || ('Exclui ' + arq), sha: sha });
        if (!r.ok && r.status !== 404) throw await erro(r, 'Não foi possível excluir ' + arq);
      },
      listar: async function (repo, pasta) {
        var r = await chamar('GET', caminho(repo, pasta) + '?t=' + Date.now());
        if (r.status === 404) return [];
        if (!r.ok) throw await erro(r, 'Não foi possível listar ' + pasta);
        return r.json();
      },
      /** Confere se o token grava no repositório. */
      podeGravar: async function (repo) {
        var r = await chamar('GET', '/repos/' + repo);
        if (!r.ok) return false;
        var j = await r.json(); return !!(j.permissions && j.permissions.push);
      }
    };
    return api;
  }

  /* ======================= Google (opcional) ======================= */
  function Google(clientId) {
    var tokenAtual = null, validoAte = 0, carregando = null;
    function carregar() {
      if (global.google && global.google.accounts && global.google.accounts.oauth2) return Promise.resolve();
      if (carregando) return carregando;
      carregando = new Promise(function (ok, falha) {
        var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
        s.onload = function () { ok(); }; s.onerror = function () { carregando = null; falha(new Error('Não foi possível carregar o login do Google.')); };
        document.head.appendChild(s);
      });
      return carregando;
    }
    async function token(forcar) {
      if (!forcar && tokenAtual && Date.now() < validoAte) return tokenAtual;
      await carregar();
      return new Promise(function (ok, falha) {
        var cli = global.google.accounts.oauth2.initTokenClient({
          client_id: clientId, scope: 'https://www.googleapis.com/auth/spreadsheets',
          callback: function (resp) {
            if (resp.error) return falha(new Error('Login do Google não concluído.'));
            tokenAtual = resp.access_token; validoAte = Date.now() + (resp.expires_in - 60) * 1000; ok(tokenAtual);
          },
          error_callback: function () { falha(new Error('Login do Google cancelado.')); }
        });
        cli.requestAccessToken({ prompt: tokenAtual ? '' : 'consent' });
      });
    }
    async function sheets(metodo, url, corpo) {
      var t = await token();
      var r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + url, { method: metodo, headers: Object.assign({ Authorization: 'Bearer ' + t }, corpo ? { 'Content-Type': 'application/json' } : {}), body: corpo ? JSON.stringify(corpo) : undefined });
      if (!r.ok) { var m = ''; try { m = (await r.json()).error.message; } catch (e) { /* sem corpo */ } throw new Error('Google Planilhas: ' + (m || r.status)); }
      return r.json();
    }
    return {
      conectado: function () { return !!tokenAtual && Date.now() < validoAte; },
      entrar: function () { return token(true); },
      /** ID da planilha a partir do link. */
      idDoLink: function (link) { var m = String(link).match(/\/d\/([a-zA-Z0-9-_]{20,})/); return m ? m[1] : String(link).trim(); },
      planilha: function (id) { return sheets('GET', id + '?fields=properties.title,sheets.properties'); },
      ler: function (id, intervalo) { return sheets('GET', id + '/values/' + encodeURIComponent(intervalo) + '?valueRenderOption=FORMATTED_VALUE').then(function (j) { return j.values || []; }); },
      gravar: function (id, intervalo, valores) { return sheets('PUT', id + '/values/' + encodeURIComponent(intervalo) + '?valueInputOption=USER_ENTERED', { values: valores }); },
      acrescentar: function (id, intervalo, valores) { return sheets('POST', id + '/values/' + encodeURIComponent(intervalo) + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', { values: valores }); },
      lote: function (id, pedidos) { return sheets('POST', id + ':batchUpdate', { requests: pedidos }); },
      /** Leitura livre da API (ex.: 'includeGridData=true&ranges=...&fields=...'). */
      obter: function (id, consulta) { return sheets('GET', id + '?' + consulta); }
    };
  }

  /* ======================= a plataforma ======================= */
  function iniciar(cfg) {
    cfg = Object.assign({ cofre: 'cofre.json', cofreRepo: null, letra: (cfg.nome || 'P').charAt(0), cor: '#1f4e79', usuariosIniciais: [], admins: [], preferencias: [], admin: [], abas: null }, cfg);
    if (!cfg.cofreRepo) cfg.cofreRepo = cfg.cofre; // caminho do cofre dentro do repositório do site
    var guarda = Guarda(cfg.id);
    var cofre = null, shaCofre = null, sessao = null, prefs = {}, shaPrefs = null, abaAtual = null;
    var raiz = document.getElementById('plataforma') || document.body;
    var PAI = null; try { if (window.parent !== window && window.parent.PlataformaAtual) PAI = window.parent.PlataformaAtual; } catch (e) { /* outro endereço */ }
    var modoModulo = !!cfg.moduloId, modoPortal = !!(cfg.modulos && cfg.modulos.length);
    if (modoModulo && !PAI) { document.documentElement.style.visibility = 'hidden'; location.replace((cfg.portal || '/central-atendimento/') + '#' + cfg.moduloId); return {}; }
    if (modoModulo) document.documentElement.classList.add('p-modulo');
    document.documentElement.style.setProperty('--cor', cfg.cor);
    if (cfg.corTexto) document.documentElement.style.setProperty('--cor-texto', cfg.corTexto);
    aplicarTema(modoModulo ? PAI.tema() : guarda.ler('tema', 'auto'));
    if (!modoModulo) document.title = cfg.nome;

    var gh = GitHub(function () { return sessao && sessao.token; }, function () { faixa('erro', 'O acesso ao GitHub foi recusado (token vencido ou sem permissão). ' + (ehAdmin() ? 'Troque o token em <b>Administração</b>.' : 'Avise a administradora.'), 'token'); });
    var google = cfg.google === false ? null : Google((cfg.google && cfg.google.clientId) || CLIENTE_GOOGLE);

    function ehAdmin() { return !!(sessao && sessao.papel === 'admin'); }
    function aplicarTema(t) { if (t === 'claro' || t === 'escuro') document.documentElement.dataset.tema = t; else delete document.documentElement.dataset.tema; }

    /* ---------- moldura ---------- */
    function heroiLogin(ks) {
      return '<div class="p-palco" aria-hidden="true">' + placas() + '</div>' +
        '<header class="p-cena-topo"><div class="p-marca"><span class="p-marca-logo" aria-hidden="true">' + esc(cfg.letra) + '</span><div><strong>' + esc(cfg.nome) + '</strong><small>' + esc(cfg.subtitulo || '') + '</small></div></div>' +
        '<nav class="p-cena-marcas" aria-label="Empresas">' + ks.map(function (k) { return '<span style="--m:' + MARCAS[k].cor + '">' + esc(MARCAS[k].nome) + '</span>'; }).join('') + '</nav></header>' +
        '<div class="p-cena-titulo"><h1>' + esc(cfg.tituloLogin || cfg.nome) + '</h1><p>' + esc(cfg.fraseLogin || '') + '</p></div>';
    }
    function placas() { return '<span class="p-placa p1"><i></i><b></b></span><span class="p-placa p2"><i></i><b></b></span><span class="p-placa p3"><i></i><b></b></span>'; }
    function seloLogin(ks) {
      var giro = ks.map(function (k) { return MARCAS[k].nome; }).join(' · ') + ' · energia solar · ';
      return '<svg class="p-selo" viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="99" fill="#111"/><defs><path id="p-selo-c" d="M100,100 m-74,0 a74,74 0 1,1 148,0 a74,74 0 1,1 -148,0"/></defs>' +
        '<g class="p-selo-giro"><text><textPath href="#p-selo-c" textLength="462" lengthAdjust="spacing">' + ks.map(function (k) { return '<tspan fill="' + MARCAS[k].cor2 + '">' + esc(MARCAS[k].nome.toUpperCase()) + '</tspan> · '; }).join('') + 'ENERGIA SOLAR · </textPath></text></g>' +
        '<circle cx="100" cy="100" r="44" fill="#fff"/><g fill="#111">' + [[78, 78], [101, 78], [78, 101], [101, 101]].map(function (q) { return '<path d="M' + (q[0] + 4) + ' ' + q[1] + 'h13l4 4v13l-4 4h-13l-4-4v-13z"/>'; }).join('') + '</g></svg>';
    }
    function faixaLogin() {
      return '<footer class="p-cena-faixa"><p>Acesso restrito à equipe. Esqueceu a senha? Fale com a administradora.</p><p>' + esc(cfg.rodape || '') + '</p></footer>';
    }
    function marcaHTML(sub) { return '<div class="p-marca"><span class="p-marca-logo" aria-hidden="true">' + esc(cfg.letra) + '</span><div><strong>' + esc(cfg.nome) + '</strong><small>' + esc(sub || cfg.subtitulo || '') + '</small></div></div>'; }
    raiz.innerHTML =
      '<section class="p-login' + (cfg.marcasLogin ? ' p-login-cena' : '') + '" id="p-tela-login" hidden>' + (cfg.marcasLogin ? heroiLogin(cfg.marcasLogin) : '') + '<form class="p-login-card" id="p-form-login" autocomplete="on">' + (cfg.marcasLogin ? seloLogin(cfg.marcasLogin) : '') + marcaHTML() +
        '<label class="p-campo">Usuário<select id="p-login-usuario" required></select></label>' +
        '<label class="p-campo">Senha<input id="p-login-senha" type="password" required autocomplete="current-password"></label>' +
        '<label class="p-campo p-check"><input type="checkbox" id="p-login-lembrar"> Manter conectado neste computador</label>' +
        '<button class="btn btn-primario" type="submit" id="p-login-btn">Entrar</button><p class="p-erro" id="p-login-erro" role="alert"></p></form>' + (cfg.marcasLogin ? faixaLogin() : '') + '</section>' +
      '<section class="p-login" id="p-tela-config" hidden></section>' +
      (modoPortal ? '<div id="p-tela-app" class="p-portal" hidden><aside class="p-lateral" id="p-lateral"><div class="p-lateral-topo">' + marcaHTML() + '</div><nav class="p-menu" id="p-menu" aria-label="Páginas"></nav>' +
        '<div class="p-lateral-pe"><div class="p-eu"><span class="p-avatar" id="p-avatar" aria-hidden="true"></span><span class="p-nome" id="p-nome"></span></div><button class="btn-link" id="p-btn-conta">Minha conta</button><button class="btn-link" id="p-btn-admin" hidden>Administração</button><a class="btn-link" href="#ajuda" data-mod="ajuda">Ajuda</a><button class="btn-link" id="p-btn-sair">Sair</button>' +
        '<p class="p-versao">' + esc(cfg.rodape || '') + '</p></div></aside>' +
        '<div class="p-veu-menu" id="p-veu-menu" hidden></div><main class="p-principal"><header class="p-mod-topo" id="p-mod-topo"><button class="btn btn-peq p-menu-btn" id="p-menu-btn" type="button" aria-label="Abrir menu">☰</button><div class="p-mod-titulo" id="p-mod-titulo"></div><div class="p-mod-acoes" id="p-mod-acoes"></div></header>' +
        '<nav class="p-abas" id="p-abas" hidden></nav><div class="p-faixas" id="p-faixas"></div><div id="p-conteudo" class="p-portal-conteudo"></div></main></div>' :
      '<div id="p-tela-app" hidden><header class="p-topo">' + marcaHTML() +
        '<div class="p-usuario"><span class="p-nome" id="p-nome"></span><button class="btn-link" id="p-btn-conta">Minha conta</button><button class="btn-link" id="p-btn-admin" hidden>Administração</button><button class="btn-link" id="p-btn-sair">Sair</button></div></header>' +
        '<nav class="p-abas" id="p-abas" role="tablist" hidden></nav><div class="p-faixas" id="p-faixas"></div><div id="p-conteudo"></div></div>') +
      '<div class="p-veu" id="p-veu" hidden></div><aside class="p-gaveta" id="p-gaveta" hidden aria-modal="true" role="dialog"><div class="p-gaveta-topo"><h2 id="p-gaveta-titulo"></h2><button class="btn btn-peq" id="p-gaveta-fechar">Fechar</button></div><div class="p-gaveta-corpo" id="p-gaveta-corpo"></div></aside>' +
      '<div class="p-toast" id="p-toast" hidden role="status"></div><div class="p-carregando" id="p-carregando"><span><span class="p-spinner"></span> Carregando…</span></div>';

    function mostrar(tela) {
      var c = $('#p-carregando'); if (c) c.remove(); ['p-tela-login', 'p-tela-config', 'p-tela-app'].forEach(function (t) { $('#' + t).hidden = t !== tela; }); }
    var toastT = null;
    function aviso(msg, tipo) { var t = $('#p-toast'); t.textContent = msg; t.className = 'p-toast' + (tipo === 'erro' ? ' erro' : ''); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, tipo === 'erro' ? 6000 : 2600); }
    function faixa(tipo, html, chave) {
      var box = $('#p-faixas'); if (chave && box.querySelector('[data-chave="' + chave + '"]')) return;
      var d = document.createElement('div'); d.className = 'p-faixa ' + tipo; if (chave) d.dataset.chave = chave;
      d.innerHTML = '<span style="flex:1 1 260px">' + html + '</span><button class="btn btn-peq" type="button">Ok</button>';
      d.querySelector('button').onclick = function () { d.remove(); }; box.appendChild(d); return d;
    }

    /* ---------- cofre ---------- */
    function cofreValido(c) { return !!(c && c.usuarios && Object.keys(c.usuarios).length && c.token); }
    /**
     * Lê o cofre publicado. O GitHub Pages leva ~1 minuto para publicar uma
     * mudança, então fica com a versão mais nova entre a publicada, a que está
     * na memória e a última que este navegador salvou.
     */
    async function carregarCofre() {
      var publicado = null;
      try { var r = await fetch(cfg.cofre + '?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) publicado = await r.json(); } catch (e) { /* sem rede */ }
      var opcoes = [publicado, cofre, guarda.ler('cofre', null)].filter(cofreValido);
      opcoes.sort(function (a, b) { return String(b.atualizadoEm || '').localeCompare(String(a.atualizadoEm || '')); });
      cofre = opcoes[0] || null;
    }
    /** Grava o cofre no repositório do site. Relê o sha atual para não falhar. */
    async function salvarCofre(novo, mensagem) {
      novo.versao = 2; novo.plataforma = cfg.id; novo.atualizadoEm = new Date().toISOString();
      var atual = await gh.ler(cfg.repoSite, cfg.cofreRepo);
      shaCofre = await gh.gravar(cfg.repoSite, cfg.cofreRepo, JSON.stringify(novo, null, 2) + '\n', atual && atual.sha, mensagem);
      cofre = novo; guarda.gravar('cofre', novo);
    }
    function listaUsuarios() {
      return Object.keys(cofre.usuarios).map(function (k) { return Object.assign({ login: k }, cofre.usuarios[k]); })
        .sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
    }

    /* ---------- login ---------- */
    function paralaxe() {
      var t = $('#p-tela-login'); if (!t || t.dataset.paralaxe || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      t.dataset.paralaxe = '1';
      t.addEventListener('pointermove', function (ev) {
        var x = ev.clientX / innerWidth - .5, y = ev.clientY / innerHeight - .5;
        t.style.setProperty('--px', x.toFixed(3)); t.style.setProperty('--py', y.toFixed(3));
      });
    }
    function prepararLogin() {
      paralaxe();
      var sel = $('#p-login-usuario'), ult = guarda.ler('ultimo', '');
      sel.innerHTML = '<option value="">Selecione…</option>' + listaUsuarios().map(function (u) { return '<option value="' + esc(u.login) + '"' + (u.login === ult ? ' selected' : '') + '>' + esc(u.nome) + '</option>'; }).join('');
      $('#p-login-lembrar').checked = guarda.ler('lembrar', false);
      $('#p-login-erro').textContent = '';
      mostrar('p-tela-login');
      setTimeout(function () { (sel.value ? $('#p-login-senha') : sel).focus(); }, 30);
    }
    $('#p-form-login').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var login = $('#p-login-usuario').value, senha = $('#p-login-senha').value, btn = $('#p-login-btn'), err = $('#p-login-erro');
      err.textContent = '';
      if (!login) { err.textContent = 'Escolha o seu nome.'; return; }
      btn.disabled = true; btn.innerHTML = '<span class="p-spinner"></span> Verificando…';
      try {
        await carregarCofre();
        var u = cofre && cofre.usuarios[login];
        if (!u) throw new Error('Este usuário não existe mais. Recarregue a página.');
        var mestra;
        try { mestra = await abrirEntrada(u, senha); } catch (e) { throw new Error('Senha incorreta.'); }
        var token = await abrirToken(cofre.token, mestra);
        var lembrar = $('#p-login-lembrar').checked;
        sessao = { login: login, nome: u.nome, papel: u.papel, mestra: b64(mestra), token: token, senhaPadrao: !!u.senhaPadrao };
        guarda.gravar('ultimo', login); guarda.gravar('lembrar', lembrar);
        guarda.gravar('sessao', sessao, lembrar ? 'local' : 'sessao');
        $('#p-login-senha').value = '';
        await entrar();
      } catch (e) { err.textContent = e.message || 'Não foi possível entrar.'; $('#p-login-senha').select(); }
      finally { btn.disabled = false; btn.textContent = 'Entrar'; }
    });

    function sair() {
      if (modoModulo) return PAI.sair();
      guarda.apagar('sessao', 'sessao'); guarda.apagar('sessao', 'local'); sessao = null;
      (cfg.limparAoSair || []).forEach(function (k) { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch (e) { /* nada */ } });
      if (modoPortal) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* nada */ } Object.keys(abertos).forEach(function (k) { abertos[k].remove(); delete abertos[k]; }); apis = {}; ouvintesTema = []; delete window.PlataformaAtual; var hi = $('#p-inicio'); if (hi) hi.remove(); }
      document.documentElement.style.setProperty('--cor', cfg.cor);
      fecharGaveta(); $('#p-conteudo').innerHTML = ''; $('#p-faixas').innerHTML = '';
      if (cfg.aoSair) try { cfg.aoSair(); } catch (e) { /* ignora */ }
      prepararLogin();
    }
    $('#p-btn-sair').onclick = sair;

    /* ---------- dados ---------- */
    var dados = {
      /** Lê um JSON do repositório de dados. Devolve padrao se o arquivo não existir. */
      ler: async function (arq, padrao) { var a = await gh.ler(cfg.repoDados, arq); return a ? JSON.parse(a.texto) : padrao; },
      lerComVersao: async function (arq) { var a = await gh.ler(cfg.repoDados, arq); return a ? { valor: JSON.parse(a.texto), sha: a.sha } : { valor: undefined, sha: null }; },
      /**
       * Altera um JSON do repositório de dados para toda a equipe.
       * fn recebe o conteúdo mais recente e devolve o novo. Se outra pessoa salvou
       * ao mesmo tempo, relê e aplica de novo (até 4 tentativas).
       */
      alterar: async function (arq, fn, mensagem, padrao) {
        for (var tentativa = 0; tentativa < 4; tentativa++) {
          var a = await gh.ler(cfg.repoDados, arq);
          var atual = a ? JSON.parse(a.texto) : (typeof padrao === 'function' ? padrao() : JSON.parse(JSON.stringify(padrao == null ? {} : padrao)));
          var novo = await fn(atual);
          if (novo === undefined) novo = atual;
          try {
            await gh.gravar(cfg.repoDados, arq, JSON.stringify(novo, null, 1) + '\n', a && a.sha, (mensagem || ('Atualiza ' + arq)) + ' (' + sessao.nome + ')');
            return novo;
          } catch (e) { if ((e.status === 409 || e.status === 422) && tentativa < 3) { await espera(400 + 500 * tentativa); continue; } throw e; }
        }
      },
      gravar: async function (arq, valor, mensagem) { return dados.alterar(arq, function () { return valor; }, mensagem); },
      excluir: function (arq, mensagem) { return gh.excluir(cfg.repoDados, arq, null, (mensagem || ('Exclui ' + arq)) + ' (' + sessao.nome + ')'); },
      listar: function (pasta) { return gh.listar(cfg.repoDados, pasta); },
      lerTexto: async function (arq) { var a = await gh.ler(cfg.repoDados, arq); return a ? a.texto : null; },
      gravarBinario: async function (arq, bytes, mensagem) { var a = null; try { a = await gh.ler(cfg.repoDados, arq); } catch (e) { /* novo */ } return gh.gravarBinario(cfg.repoDados, arq, bytes, a && a.sha, (mensagem || ('Envia ' + arq)) + ' (' + sessao.nome + ')'); }
    };

    /* ---------- preferências de cada pessoa ---------- */
    function arqPrefs() { return 'preferencias/' + sessao.login + '.json'; }
    async function carregarPrefs() {
      prefs = Object.assign({}, guarda.ler('prefs:' + sessao.login, {}));
      try { var r = await dados.lerComVersao(arqPrefs()); if (r.valor) prefs = r.valor; shaPrefs = r.sha; } catch (e) { /* usa a cópia do navegador */ }
      guarda.gravar('prefs:' + sessao.login, prefs);
      if (prefs.tema && !modoModulo) { guarda.gravar('tema', prefs.tema); aplicarTema(prefs.tema); }
    }
    async function salvarPrefs(mudancas) {
      Object.assign(prefs, mudancas); guarda.gravar('prefs:' + sessao.login, prefs);
      if (mudancas.tema) { guarda.gravar('tema', mudancas.tema); aplicarTema(mudancas.tema); ouvintesTema.forEach(function (fn) { try { fn(mudancas.tema); } catch (e) { /* página fechada */ } }); }
      await dados.alterar(arqPrefs(), function (p) { return Object.assign(p || {}, mudancas); }, 'Preferências de ' + sessao.nome, {});
      if (cfg.aoMudarPreferencias) cfg.aoMudarPreferencias(prefs, ctx);
    }

    /* ---------- entrar ---------- */
    var ctx = {
      cfg: cfg, dados: dados, github: gh, google: google,
      get usuario() { return sessao ? { login: sessao.login, nome: sessao.nome, papel: sessao.papel } : null; },
      get admin() { return ehAdmin(); },
      get preferencias() { return prefs; },
      salvarPreferencias: salvarPrefs,
      get usuarios() { return cofre ? listaUsuarios().map(function (u) { return { login: u.login, nome: u.nome, papel: u.papel }; }) : []; },
      conteudo: function () { return $('#p-conteudo'); },
      aviso: aviso, faixa: faixa, esc: esc, guarda: guarda,
      abrirConta: function () { abrirConta(); }, abrirAdmin: function () { abrirAdmin(); },
      irPara: function (aba) { escolherAba(aba); },
      /** Página dentro do portal: muda as cores do topo para a(s) empresa(s) em uso. */
      marca: function (chaves) { if (modoModulo && PAI.marca) PAI.marca(cfg.moduloId, chaves); }
    };

    async function entrar() {
      if (modoModulo) return entrarModulo();
      $('#p-nome').innerHTML = esc(sessao.nome) + (ehAdmin() ? ' <span class="p-papel">Admin</span>' : '');
      $('#p-btn-admin').hidden = !ehAdmin();
      var av = $('#p-avatar'); if (av) av.textContent = (sessao.nome || '?').charAt(0).toUpperCase();
      mostrar('p-tela-app');
      await carregarPrefs();
      if (sessao.senhaPadrao) faixa('aviso', 'Você ainda está com a senha padrão. Para mais segurança, troque em <b>Minha conta</b>.', 'senha');
      if (modoPortal) { registrarAcesso('login'); if (ehAdmin()) incluirFaltantes(); return montarPortal(); }
      montarAbas();
      if (cfg.aoEntrar) await cfg.aoEntrar(ctx);
    }

    /* ======== página dentro do portal ======== */
    async function entrarModulo() {
      mostrar('p-tela-app');
      await carregarPrefs();
      PAI.aoTema(function (t) { aplicarTema(t); });
      PAI.registrarModulo(cfg.moduloId, {
        preferencias: cfg.preferencias.length ? abrirConta : null,
        configuracoes: (cfg.admin.length && ehAdmin()) ? abrirAdmin : null
      });
      montarAbas();
      if (cfg.aoEntrar) await cfg.aoEntrar(ctx);
    }

    /* ======== portal: menu lateral com as páginas ======== */
    var abertos = {}, apis = {}, ouvintesTema = [], atual = null;
    function permitido(m) {
      if (ehAdmin()) return true;
      var u = cofre && cofre.usuarios[sessao.login];
      var lista = u && u.modulos;
      if (Array.isArray(lista)) return lista.indexOf(m.id) >= 0;
      return true;
    }
    function corDe(m) { var k = (m.marcas || [])[0]; return (MARCAS[k] && MARCAS[k].cor) || cfg.cor; }
    function montarPortal() {
      var visiveis = cfg.modulos.filter(permitido);
      window.PlataformaAtual = {
        get usuario() { return { login: sessao.login, nome: sessao.nome, papel: sessao.papel }; },
        get token() { return sessao.token; },
        google: google, marcas: MARCAS, banner: banner,
        tema: function () { return prefs.tema || guarda.ler('tema', 'auto'); },
        aoTema: function (fn) { ouvintesTema.push(fn); },
        marca: function (id, chaves) { var m = cfg.modulos.find(function (x) { return x.id === id; }); if (m) { m.marcasAtuais = chaves; if (atual === id) topoModulo(m); } },
        registrarModulo: function (id, api) { apis[id] = api; if (atual === id) acoesModulo(); },
        aviso: aviso, sair: sair, irPara: function (id) { location.hash = id; }
      };
      $('#p-menu').innerHTML = '<a href="#inicio" data-mod="inicio" class="p-menu-item"><span class="p-ponto" style="background:var(--texto-3)"></span>Início</a>' +
        visiveis.map(function (m) {
          return '<a href="#' + esc(m.id) + '" data-mod="' + esc(m.id) + '" class="p-menu-item"><span class="p-ponto" style="background:' + (m.marcas.length > 1 ? 'linear-gradient(135deg,' + m.marcas.map(function (k) { return MARCAS[k].cor; }).join(',') + ')' : corDe(m)) + '"></span><span>' + esc(m.nome) + '<small>' + esc(nomesMarcas(m.marcas)) + '</small></span></a>';
        }).join('');
      $('#p-menu-btn').onclick = function () { document.documentElement.classList.toggle('p-menu-aberto'); };
      $('#p-veu-menu').onclick = function () { document.documentElement.classList.remove('p-menu-aberto'); };
      window.addEventListener('hashchange', rota);
      rota();
    }
    function rota() {
      if (!sessao || !modoPortal) return;
      document.documentElement.classList.remove('p-menu-aberto');
      var id = location.hash.slice(1).split('/')[0] || 'inicio';
      var m = cfg.modulos.find(function (x) { return x.id === id; });
      if (id === 'ajuda') { atual = 'ajuda'; Object.keys(abertos).forEach(function (k) { abertos[k].hidden = true; }); document.querySelectorAll('.p-menu-item').forEach(function (a) { a.classList.remove('ativo'); }); document.documentElement.style.setProperty('--cor', cfg.cor); topoModulo(null, 'Ajuda', 'Como usar a plataforma'); return ajuda(); }
      var aj = $('#p-ajuda'); if (aj) aj.hidden = true;
      if (m && !permitido(m)) { aviso('Você não tem acesso a ' + m.nome + '. Peça à administradora.', 'erro'); m = null; }
      atual = m ? m.id : 'inicio';
      document.querySelectorAll('.p-menu-item').forEach(function (a) { a.classList.toggle('ativo', a.dataset.mod === atual); });
      Object.keys(abertos).forEach(function (k) { abertos[k].hidden = k !== atual; });
      var home = $('#p-inicio'); if (home) home.hidden = !!m;
      if (!m) { document.documentElement.style.setProperty('--cor', cfg.cor); topoModulo(null); return inicio(); }
      registrarAcesso('pagina', m.id);
      if (!abertos[m.id]) {
        var f = document.createElement('iframe'); f.className = 'p-quadro'; f.title = m.nome; f.src = m.src + (m.src.indexOf('?') < 0 ? '?' : '&') + 'v=' + (cfg.versao || '1');
        f.setAttribute('allow', 'clipboard-read; clipboard-write'); $('#p-conteudo').appendChild(f); abertos[m.id] = f;
      }
      topoModulo(m); document.title = m.nome + ' · ' + cfg.nome;
    }
    function topoModulo(m, titulo, sub) {
      var t = $('#p-mod-titulo'), topo = $('#p-mod-topo');
      if (!m) { t.innerHTML = '<strong>' + esc(titulo || 'Início') + '</strong><small>' + esc(sub || cfg.subtitulo || '') + '</small>'; topo.style.removeProperty('--linha'); topo.classList.remove('colorido'); $('#p-mod-acoes').innerHTML = ''; document.title = cfg.nome; return; }
      var ks = m.marcasAtuais || m.marcas, cores = ks.map(function (k) { return MARCAS[k].cor; });
      document.documentElement.style.setProperty('--cor', cores[0]);
      topo.classList.add('colorido');
      topo.style.setProperty('--linha', 'linear-gradient(90deg,' + (cores.length > 1 ? cores.join(',') : cores[0] + ',' + MARCAS[ks[0]].cor2) + ')');
      t.innerHTML = '<strong>' + esc(m.nome) + '</strong><small>' + esc(m.descricao || '') + ' — ' + esc(nomesMarcas(ks)) + '</small>';
      acoesModulo();
    }
    function acoesModulo() {
      var a = apis[atual] || {}, box = $('#p-mod-acoes');
      box.innerHTML = (a.preferencias ? '<button class="btn btn-peq" type="button" data-acao="pref">Minhas preferências</button>' : '') + (a.configuracoes ? '<button class="btn btn-peq" type="button" data-acao="conf">Configurações da página</button>' : '');
      box.onclick = function (ev) { var b = ev.target.closest('[data-acao]'); if (!b) return; (b.dataset.acao === 'pref' ? a.preferencias : a.configuracoes)(); };
    }
    function nomesMarcas(ks) { var n = ks.map(function (k) { return MARCAS[k].nome; }); return n.length > 1 ? n.slice(0, -1).join(', ') + ' e ' + n[n.length - 1] : n[0]; }
    function ajuda() {
      var box = $('#p-ajuda'), hi = $('#p-inicio'); if (hi) hi.hidden = true;
      if (!box) { box = document.createElement('section'); box.id = 'p-ajuda'; box.className = 'p-inicio p-texto'; $('#p-conteudo').appendChild(box); }
      box.hidden = false;
      box.innerHTML = '<h1>Ajuda</h1>' +
        '<h2>Entrar</h2><p>Escolha o seu nome e digite a sua senha. A senha inicial de todos é <b>' + SENHA_PADRAO + '</b>; troque em <b>Minha conta</b> no primeiro acesso. Marque <b>Manter conectado</b> só no seu computador.</p>' +
        '<h2>Esqueci a senha</h2><p>Peça a uma administradora: em <b>Administração</b> ela volta a sua senha para ' + SENHA_PADRAO + ' e você troca de novo.</p>' +
        '<h2>Páginas</h2><dl class="p-dl">' + cfg.modulos.map(function (m) { return '<dt><a href="#' + esc(m.id) + '">' + esc(m.nome) + '</a></dt><dd>' + esc(m.descricao || '') + ' (' + esc(nomesMarcas(m.marcas)) + ').</dd>'; }).join('') + '</dl>' +
        '<h2>O que eu altero aqui vale para todos?</h2><p>Sim. Mensagens, registros e planilhas salvos numa página ficam guardados na hora para toda a equipe. O que é só seu (senha, tema, nome nas mensagens, assinatura) fica em <b>Minha conta</b> e em <b>Minhas preferências</b> de cada página.</p>' +
        '<h2>Onde ficam os dados</h2><p>Cada página guarda os dados no seu repositório privado no GitHub, com histórico de todas as alterações. As planilhas da cobrança e das faturas continuam no Google; antes de alterar uma planilha, a plataforma guarda uma cópia de como ela estava.</p>' +
        '<h2>Contatos</h2>' + listaMarcas(['wegen', 'smartben', 'wattwise'], true) +
        (cfg.novidades ? '<h2>Novidades</h2><ul class="p-novidades">' + cfg.novidades.map(function (n) { return '<li><time>' + esc(n[0]) + '</time> ' + esc(n[1]) + '</li>'; }).join('') + '</ul>' : '');
    }
    /* Registro de acessos: só a administradora vê (Administração > Acompanhamento de acessos). */
    var registrados = {};
    function registrarAcesso(tipo, pagina) {
      if (!modoPortal || !sessao || !cfg.registroAcessos) return;
      var chave = tipo + ':' + (pagina || ''); if (registrados[chave]) return; registrados[chave] = 1;
      var agora = new Date(), dia = agora.toISOString().slice(0, 10), login = sessao.login, nome = sessao.nome;
      dados.alterar(cfg.registroAcessos + '/' + login + '.json', function (r) {
        r = r || {}; r.nome = nome; r.paginas = r.paginas || {}; r.dias = r.dias || {}; r.eventos = r.eventos || [];
        if (tipo === 'login') { r.acessos = (r.acessos || 0) + 1; r.dias[dia] = (r.dias[dia] || 0) + 1; r.ultimo = agora.toISOString(); if (!r.primeiro) r.primeiro = r.ultimo; }
        else r.paginas[pagina] = (r.paginas[pagina] || 0) + 1;
        r.eventos.unshift({ em: agora.toISOString(), tipo: tipo, pagina: pagina || undefined }); r.eventos = r.eventos.slice(0, 80);
        var limite = new Date(agora - 120 * 864e5).toISOString().slice(0, 10); Object.keys(r.dias).forEach(function (d) { if (d < limite) delete r.dias[d]; });
        return r;
      }, 'Atualiza registro', {}).catch(function () { /* não atrapalha o uso */ });
    }
    async function desenharAcompanhamento(box) {
      box.innerHTML = '<h3>Acompanhamento de acessos</h3><p class="p-ajuda">Só administradoras veem este quadro. Conta cada entrada na plataforma e cada página aberta.</p><p class="p-dica"><span class="p-spinner"></span> Carregando…</p>';
      try {
        var lista = (await dados.listar(cfg.registroAcessos)).filter(function (f) { return /\.json$/.test(f.name); });
        var regs = await Promise.all(lista.map(function (f) { return dados.ler(f.path, null).then(function (r) { return Object.assign({ login: f.name.replace(/\.json$/, '') }, r); }); }));
        var hoje = new Date(), d7 = new Date(hoje - 6 * 864e5).toISOString().slice(0, 10), d30 = new Date(hoje - 29 * 864e5).toISOString().slice(0, 10);
        var soma = function (r, desde) { return Object.keys(r.dias || {}).filter(function (d) { return d >= desde; }).reduce(function (t, d) { return t + r.dias[d]; }, 0); };
        var nomeMod = function (id) { var m = cfg.modulos.find(function (x) { return x.id === id; }); return m ? m.nome : id; };
        var pessoas = listaUsuarios().map(function (u) { return regs.find(function (r) { return r.login === u.login; }) || { login: u.login, nome: u.nome }; });
        pessoas.sort(function (a, b) { return (b.acessos || 0) - (a.acessos || 0); });
        box.innerHTML = '<h3>Acompanhamento de acessos</h3><p class="p-ajuda">Só administradoras veem este quadro. Conta cada entrada na plataforma e cada página aberta.</p>' +
          '<div class="p-tabela-rolagem"><table class="p-tabela"><thead><tr><th scope="col">Pessoa</th><th scope="col" class="num">Total</th><th scope="col" class="num">7 dias</th><th scope="col" class="num">30 dias</th><th scope="col">Último acesso</th><th scope="col">Páginas mais abertas</th></tr></thead><tbody>' +
          pessoas.map(function (r) {
            var pags = Object.keys(r.paginas || {}).sort(function (a, b) { return r.paginas[b] - r.paginas[a]; }).slice(0, 3).map(function (k) { return esc(nomeMod(k)) + ' (' + r.paginas[k] + ')'; }).join(', ');
            return '<tr><th scope="row">' + esc(r.nome || r.login) + '</th><td class="num">' + (r.acessos || 0) + '</td><td class="num">' + soma(r, d7) + '</td><td class="num">' + soma(r, d30) + '</td><td>' + (r.ultimo ? esc(new Date(r.ultimo).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })) : '<span class="p-dica">nunca entrou</span>') + '</td><td>' + (pags || '<span class="p-dica">—</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      } catch (e) { box.innerHTML = '<h3>Acompanhamento de acessos</h3><p class="p-erro">Não foi possível carregar: ' + esc(e.message) + '</p>'; }
    }
    function listaMarcas(ks, claro) {
      return '<ul class="p-marcas' + (claro ? ' claro' : '') + '">' + ks.map(function (k) { var m = MARCAS[k]; return '<li style="--m:' + m.cor + '"><strong>' + esc(m.nome) + '</strong><span>' + m.whatsapp.map(function (n) { return 'WhatsApp ' + esc(n); }).join('<br>') + '</span></li>'; }).join('') + '</ul>';
    }
    function inicio() {
      var box = $('#p-inicio');
      if (!box) { box = document.createElement('section'); box.id = 'p-inicio'; box.className = 'p-inicio'; $('#p-conteudo').appendChild(box); }
      box.hidden = false;
      var h = new Date().getHours(), oi = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
      var vis = cfg.modulos.filter(permitido);
      var hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
      box.innerHTML = '<header class="p-inicio-cena"><div class="p-palco" aria-hidden="true">' + placas() + '</div><div class="p-inicio-cena-texto"><p class="p-cena-local">' + esc(hoje.charAt(0).toUpperCase() + hoje.slice(1)) + '</p><h1>' + oi + ', ' + esc(sessao.nome) + '</h1>' +
        '<dl class="p-numeros"><div><dt>Páginas</dt><dd>' + String(vis.length).padStart(2, '0') + '</dd></div><div><dt>Cooperativas</dt><dd>03</dd></div><div><dt>Pessoas na equipe</dt><dd>' + String(Object.keys(cofre.usuarios).length).padStart(2, '0') + '</dd></div></dl></div></header>' +
        '<h2 class="p-inicio-sub">Suas páginas</h2>' +
        '<div class="p-cartoes">' + vis.map(function (m) {
          var cores = m.marcas.map(function (k) { return MARCAS[k].cor; });
          return '<a class="p-cartao" href="#' + esc(m.id) + '" style="--c1:' + cores[0] + ';--c2:' + (cores[1] || MARCAS[m.marcas[0]].cor2) + '"><span class="p-cartao-faixa"></span><strong>' + esc(m.nome) + '</strong><span class="p-ajuda">' + esc(m.descricao || '') + '</span><small>' + esc(nomesMarcas(m.marcas)) + '</small></a>';
        }).join('') + '</div>' +
        '<h2 class="p-inicio-sub">Contatos das empresas</h2>' + listaMarcas(['wegen', 'smartben', 'wattwise'], true);
    }

    function montarAbas() {
      var nav = $('#p-abas');
      if (!cfg.abas || !cfg.abas.length) { nav.hidden = true; return; }
      nav.hidden = cfg.abas.length < 2;
      nav.innerHTML = cfg.abas.map(function (a) { return '<button role="tab" data-p-aba="' + esc(a.id) + '">' + esc(a.titulo) + '</button>'; }).join('');
      nav.onclick = function (ev) { var b = ev.target.closest('[data-p-aba]'); if (b) escolherAba(b.dataset.pAba); };
      var h = location.hash.slice(1); escolherAba(cfg.abas.some(function (a) { return a.id === h; }) ? h : cfg.abas[0].id);
    }
    function escolherAba(id) {
      abaAtual = id;
      document.querySelectorAll('[data-p-aba]').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.pAba === id); });
      if (cfg.abas && cfg.abas.length > 1) history.replaceState(null, '', '#' + id);
      if (cfg.aoMudarAba) cfg.aoMudarAba(id, ctx);
    }

    /* ---------- gaveta ---------- */
    function abrirGaveta(titulo, html, largo) {
      $('#p-gaveta').classList.toggle('largo', !!largo);
      $('#p-gaveta-titulo').textContent = titulo; $('#p-gaveta-corpo').innerHTML = html;
      $('#p-veu').hidden = false; $('#p-gaveta').hidden = false; $('#p-gaveta-fechar').focus();
      return $('#p-gaveta-corpo');
    }
    function fecharGaveta() { $('#p-veu').hidden = true; $('#p-gaveta').hidden = true; }
    $('#p-gaveta-fechar').onclick = fecharGaveta; $('#p-veu').onclick = fecharGaveta;
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !$('#p-gaveta').hidden) fecharGaveta(); });
    async function comBotao(btn, fn) { var t = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="p-spinner"></span> ' + esc(t); try { return await fn(); } finally { btn.disabled = false; btn.textContent = t; } }

    /* ---------- Minha conta ---------- */
    function campoPref(p) {
      var v = prefs[p.chave] != null ? prefs[p.chave] : (p.padrao != null ? p.padrao : '');
      var id = 'p-pref-' + p.chave, ajuda = p.ajuda ? '<span class="p-dica">' + esc(p.ajuda) + '</span>' : '';
      if (p.tipo === 'select') return '<label class="p-campo">' + esc(p.rotulo) + '<select id="' + id + '" data-pref="' + esc(p.chave) + '">' + p.opcoes.map(function (o) { var val = typeof o === 'string' ? o : o.valor, rot = typeof o === 'string' ? o : o.rotulo; return '<option value="' + esc(val) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + esc(rot) + '</option>'; }).join('') + '</select>' + ajuda + '</label>';
      if (p.tipo === 'textarea') return '<label class="p-campo">' + esc(p.rotulo) + '<textarea id="' + id + '" data-pref="' + esc(p.chave) + '" placeholder="' + esc(p.exemplo || '') + '">' + esc(v) + '</textarea>' + ajuda + '</label>';
      return '<label class="p-campo">' + esc(p.rotulo) + '<input id="' + id + '" data-pref="' + esc(p.chave) + '" value="' + esc(v) + '" placeholder="' + esc(p.exemplo || '') + '">' + ajuda + '</label>';
    }
    function abrirConta() {
      if (modoModulo) return prefsModulo();
      var tema = prefs.tema || guarda.ler('tema', 'auto');
      var corpo = abrirGaveta('Minha conta',
        '<div class="p-bloco"><h3>' + esc(sessao.nome) + '</h3><p class="p-ajuda">' + (ehAdmin() ? 'Administradora desta plataforma.' : 'Usuário desta plataforma.') + '</p></div>' +
        '<form class="p-bloco" id="p-form-senha"><h3>Trocar minha senha</h3>' +
          '<label class="p-campo">Senha atual<input type="password" id="p-senha-atual" autocomplete="current-password" required></label>' +
          '<label class="p-campo">Nova senha<input type="password" id="p-senha-nova" autocomplete="new-password" minlength="6" required></label>' +
          '<label class="p-campo">Repita a nova senha<input type="password" id="p-senha-nova2" autocomplete="new-password" minlength="6" required></label>' +
          '<div class="p-linha"><button class="btn btn-primario" type="submit">Trocar senha</button></div><p class="p-erro" id="p-senha-erro" role="alert"></p></form>' +
        '<div class="p-bloco"><h3>Aparência</h3><div class="p-seg" id="p-tema" role="group" aria-label="Tema">' +
          [['auto', 'Automático'], ['claro', 'Claro'], ['escuro', 'Escuro']].map(function (t) { return '<button type="button" data-tema="' + t[0] + '" aria-pressed="' + (tema === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div></div>' +
        (cfg.preferencias.length ? '<form class="p-bloco" id="p-form-prefs"><h3>Minhas preferências</h3><p class="p-ajuda">Valem só para você e acompanham você em qualquer computador.</p>' + cfg.preferencias.map(campoPref).join('') +
          '<div class="p-linha"><button class="btn btn-primario" type="submit">Salvar preferências</button></div></form>' : ''));

      $('#p-form-senha', corpo).onsubmit = async function (ev) {
        ev.preventDefault(); var err = $('#p-senha-erro'); err.textContent = '';
        var atual = $('#p-senha-atual').value, nova = $('#p-senha-nova').value;
        if (nova !== $('#p-senha-nova2').value) { err.textContent = 'As duas senhas novas não são iguais.'; return; }
        if (nova.length < 6) { err.textContent = 'A nova senha precisa ter pelo menos 6 caracteres.'; return; }
        await comBotao(ev.submitter || $('#p-form-senha button'), async function () {
          try {
            await carregarCofre(); var u = cofre.usuarios[sessao.login], mestra;
            try { mestra = await abrirEntrada(u, atual); } catch (e) { err.textContent = 'A senha atual está incorreta.'; return; }
            var novoCofre = JSON.parse(JSON.stringify(cofre));
            novoCofre.usuarios[sessao.login] = await entradaUsuario(u.nome, u.papel, nova, mestra, nova === SENHA_PADRAO, u.modulos);
            await salvarCofre(novoCofre, 'Senha trocada por ' + sessao.nome);
            sessao.senhaPadrao = nova === SENHA_PADRAO; guardarSessao();
            ev.target.reset(); aviso('Senha trocada. Vale em cerca de 1 minuto.');
            var f = document.querySelector('[data-chave="senha"]'); if (f && !sessao.senhaPadrao) f.remove();
          } catch (e) { err.textContent = e.message; }
        });
      };
      $('#p-tema', corpo).onclick = async function (ev) {
        var b = ev.target.closest('[data-tema]'); if (!b) return;
        corpo.querySelectorAll('[data-tema]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        try { await salvarPrefs({ tema: b.dataset.tema }); } catch (e) { aviso('Tema aplicado neste computador, mas não foi salvo: ' + e.message, 'erro'); }
      };
      var fp = $('#p-form-prefs', corpo);
      if (fp) fp.onsubmit = async function (ev) {
        ev.preventDefault(); var m = {};
        fp.querySelectorAll('[data-pref]').forEach(function (i) { m[i.dataset.pref] = i.value; });
        await comBotao(ev.submitter || fp.querySelector('button'), async function () {
          try { await salvarPrefs(m); aviso('Preferências salvas.'); } catch (e) { aviso(e.message, 'erro'); }
        });
      };
    }
    $('#p-btn-conta').onclick = abrirConta;
    function guardarSessao() { guarda.gravar('sessao', sessao, guarda.ler('lembrar', false) ? 'local' : 'sessao'); }

    /* ---------- Administração ---------- */
    function prefsModulo() {
      var corpo = abrirGaveta('Minhas preferências', '<form class="p-bloco" id="p-form-prefs"><p class="p-ajuda">Valem só para você e acompanham você em qualquer computador.</p>' + cfg.preferencias.map(campoPref).join('') + '<div class="p-linha"><button class="btn btn-primario" type="submit">Salvar preferências</button></div></form>');
      var fp = $('#p-form-prefs', corpo);
      fp.onsubmit = async function (ev) {
        ev.preventDefault(); var m = {}; fp.querySelectorAll('[data-pref]').forEach(function (i) { m[i.dataset.pref] = i.value; });
        await comBotao(ev.submitter || fp.querySelector('button'), async function () { try { await salvarPrefs(m); aviso('Preferências salvas.'); fecharGaveta(); } catch (e) { aviso(e.message, 'erro'); } });
      };
    }
    function abrirAdmin() {
      if (!ehAdmin()) return;
      if (modoModulo) { abrirGaveta('Configurações da página', '<div id="p-admin-extra"></div>'); (cfg.admin || []).forEach(function (sec) { var d = document.createElement('div'); d.className = 'p-bloco'; d.innerHTML = '<h3>' + esc(sec.titulo) + '</h3>'; $('#p-admin-extra').appendChild(d); sec.desenhar(d, ctx); }); return; }
      var corpo = abrirGaveta('Administração',
        '<div class="p-bloco"><h3>Usuários</h3><p class="p-ajuda">Quem entra é incluído com a senha <b>' + SENHA_PADRAO + '</b> e pode trocá-la em Minha conta. As mudanças valem em cerca de 1 minuto.</p>' +
          '<div class="p-usuarios" id="p-lista-usuarios"></div>' +
          '<form class="p-novo" id="p-form-novo"><div class="p-linha"><input class="p-entrada" id="p-novo-nome" placeholder="Nome da pessoa" required><select class="p-entrada" id="p-novo-papel" style="flex:0 1 170px"><option value="usuario">Usuário</option><option value="admin">Administradora</option></select><button class="btn btn-primario" type="submit">Incluir</button></div>' + (modoPortal ? '<div class="p-chips">' + cfg.modulos.map(function (m) { return '<label class="p-chip"><input type="checkbox" checked data-mod-novo="' + esc(m.id) + '">' + esc(m.nome) + '</label>'; }).join('') + '</div>' : '') + '</form>' +
          (modoPortal ? '<div id="p-faltam"></div>' : '') +
          '<p class="p-erro" id="p-admin-erro" role="alert"></p></div>' +
        '<form class="p-bloco" id="p-form-token"><h3>Token do GitHub</h3><p class="p-ajuda">Use quando o token vencer. Ele precisa de <b>Contents: Read and write</b> em <code>' + esc(cfg.repoSite) + '</code> e <code>' + esc(cfg.repoDados) + '</code>. Ninguém precisa trocar a senha.</p>' +
          '<input class="p-entrada" type="password" id="p-token-novo" placeholder="github_pat_..." autocomplete="off" required><div class="p-linha"><button class="btn btn-primario" type="submit">Trocar token</button></div><p class="p-erro" id="p-token-erro" role="alert"></p></form>' +
        '<div id="p-admin-extra"></div>', modoPortal);
      desenharUsuarios();
      $('#p-form-novo', corpo).onsubmit = async function (ev) {
        ev.preventDefault(); var nome = $('#p-novo-nome').value.trim(), papel = $('#p-novo-papel').value, login = slug(nome), err = $('#p-admin-erro'); err.textContent = '';
        if (!login) return;
        await comBotao(ev.submitter || ev.target.querySelector('button'), async function () {
          try {
            await carregarCofre();
            if (cofre.usuarios[login]) { err.textContent = 'Já existe alguém com esse nome.'; return; }
            var novo = JSON.parse(JSON.stringify(cofre));
            novo.usuarios[login] = await entradaUsuario(nome, papel, SENHA_PADRAO, unb64(sessao.mestra), true, modoPortal ? modulosMarcados(ev.target) : undefined);
            await salvarCofre(novo, 'Acesso incluído: ' + nome + ' (por ' + sessao.nome + ')');
            ev.target.reset(); desenharUsuarios(); aviso(nome + ' incluída(o) com a senha ' + SENHA_PADRAO + '.');
          } catch (e) { err.textContent = e.message; }
        });
      };
      $('#p-form-token', corpo).onsubmit = async function (ev) {
        ev.preventDefault(); var tok = $('#p-token-novo').value.trim(), err = $('#p-token-erro'); err.textContent = '';
        await comBotao(ev.submitter || ev.target.querySelector('button'), async function () {
          try {
            var teste = GitHub(function () { return tok; });
            var repos = [cfg.repoSite, cfg.repoDados].concat((cfg.modulos || []).reduce(function (l, m) { return l.concat(m.repos || []); }, [])).filter(function (r, i, l) { return l.indexOf(r) === i; });
            for (var ri = 0; ri < repos.length; ri++) if (!(await teste.podeGravar(repos[ri]))) { err.textContent = 'Esse token não consegue gravar em ' + repos[ri] + '. Marque esse repositório no token.'; return; }
            var antigo = sessao.token; sessao.token = tok;
            try {
              await carregarCofre(); var novo = JSON.parse(JSON.stringify(cofre));
              novo.token = await trancarToken(tok, unb64(sessao.mestra));
              await salvarCofre(novo, 'Token do GitHub trocado por ' + sessao.nome);
            } catch (e) { sessao.token = antigo; throw e; }
            guardarSessao(); ev.target.reset(); var f = document.querySelector('[data-chave="token"]'); if (f) f.remove();
            aviso('Token trocado.');
          } catch (e) { err.textContent = e.message; }
        });
      };
      (cfg.admin || []).forEach(function (sec) { var d = document.createElement('div'); d.className = 'p-bloco'; d.innerHTML = '<h3>' + esc(sec.titulo) + '</h3>'; $('#p-admin-extra').appendChild(d); sec.desenhar(d, ctx); });
      if (modoPortal && cfg.registroAcessos) { var ac = document.createElement('div'); ac.className = 'p-bloco'; corpo.prepend(ac); desenharAcompanhamento(ac); }
    }
    function modulosMarcados(form) { return Array.prototype.map.call(form.querySelectorAll('[data-mod-novo]:checked'), function (i) { return i.dataset.modNovo; }); }
    /** Administradora entrou: inclui sozinho quem tinha acesso às plataformas antigas e ainda não está aqui. */
    async function incluirFaltantes() {
      try {
        var pessoas = {};
        cfg.modulos.forEach(function (m) { (m.usuarios || []).forEach(function (n) { var l = slug(n); if (!cofre.usuarios[l]) pessoas[l] = n; }); });
        (cfg.equipe || []).forEach(function (n) { var l = slug(n); if (!cofre.usuarios[l]) pessoas[l] = n; });
        var ls = Object.keys(pessoas); if (!ls.length) return;
        await carregarCofre(); var n = JSON.parse(JSON.stringify(cofre)), mestra = unb64(sessao.mestra);
        for (var i = 0; i < ls.length; i++) if (!n.usuarios[ls[i]]) n.usuarios[ls[i]] = await entradaUsuario(pessoas[ls[i]], 'usuario', SENHA_PADRAO, mestra, true);
        await salvarCofre(n, 'Acessos das plataformas antigas incluídos');
        aviso('Incluímos ' + ls.map(function (l) { return pessoas[l]; }).join(', ') + ' com a senha ' + SENHA_PADRAO + '.');
      } catch (e) { /* tenta de novo no próximo acesso */ }
    }
    function desenharFaltam() {
      var box = $('#p-faltam'); if (!box) return;
      var pessoas = {};
      cfg.modulos.forEach(function (m) { (m.usuarios || []).forEach(function (n) { var l = slug(n); if (cofre.usuarios[l]) return; (pessoas[l] = pessoas[l] || { nome: n, modulos: [] }).modulos.push(m.id); }); });
      (cfg.equipe || []).forEach(function (n) { var l = slug(n); if (!cofre.usuarios[l] && !pessoas[l]) pessoas[l] = { nome: n, modulos: [] }; });
      var ls = Object.keys(pessoas);
      if (!ls.length) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="p-faixa aviso" style="margin:0"><span style="flex:1 1 260px">Pessoas que usavam as plataformas antigas e ainda não estão aqui: <b>' + ls.map(function (l) { return esc(pessoas[l].nome); }).join(', ') + '</b>. Elas entram com a senha ' + SENHA_PADRAO + ' e veem todas as páginas.</span><button class="btn btn-peq btn-primario" type="button" id="p-incluir-faltam">Incluir todas</button></div>';
      $('#p-incluir-faltam').onclick = function () {
        var b = this;
        comBotao(b, async function () {
          try {
            await carregarCofre(); var n = JSON.parse(JSON.stringify(cofre)), mestra = unb64(sessao.mestra);
            for (var i = 0; i < ls.length; i++) if (!n.usuarios[ls[i]]) n.usuarios[ls[i]] = await entradaUsuario(pessoas[ls[i]].nome, 'usuario', SENHA_PADRAO, mestra, true);
            await salvarCofre(n, 'Acessos das plataformas antigas incluídos (por ' + sessao.nome + ')');
            aviso('Incluídas com a senha ' + SENHA_PADRAO + '.'); desenharUsuarios();
          } catch (e) { $('#p-admin-erro').textContent = e.message; }
        });
      };
    }
    function desenharUsuarios() {
      var box = $('#p-lista-usuarios'); if (!box) return;
      desenharFaltam();
      box.innerHTML = listaUsuarios().map(function (u) {
        var eu = u.login === sessao.login;
        return '<div class="p-usuario-item" data-login="' + esc(u.login) + '"><strong>' + esc(u.nome) + (eu ? ' <span class="p-dica">(você)</span>' : '') + (u.senhaPadrao ? ' <span class="p-dica">· senha padrão</span>' : '') + '</strong>' +
          '<select data-acao="papel"' + (eu ? ' disabled title="Você não pode tirar o seu próprio acesso de administradora"' : '') + '><option value="usuario"' + (u.papel !== 'admin' ? ' selected' : '') + '>Usuário</option><option value="admin"' + (u.papel === 'admin' ? ' selected' : '') + '>Administradora</option></select>' +
          '<button class="btn btn-peq" data-acao="redefinir" type="button">Senha ' + SENHA_PADRAO + '</button>' +
          (modoPortal ? '<div class="p-chips">' + cfg.modulos.map(function (m) { var on = u.papel === 'admin' || (Array.isArray(u.modulos) ? u.modulos.indexOf(m.id) >= 0 : true); return '<label class="p-chip' + (u.papel === 'admin' ? ' fixo' : '') + '"><input type="checkbox" data-acao="modulo" value="' + esc(m.id) + '"' + (on ? ' checked' : '') + (u.papel === 'admin' ? ' disabled title="Administradoras veem todas as páginas"' : '') + '>' + esc(m.nome) + '</label>'; }).join('') + '</div>' : '') +
          (eu ? '' : '<button class="btn btn-peq btn-perigo" data-acao="remover" type="button">Remover</button>') + '</div>';
      }).join('');
      box.onclick = async function (ev) {
        var b = ev.target.closest('button[data-acao]'); if (!b) return;
        var login = b.closest('[data-login]').dataset.login, u = cofre.usuarios[login], err = $('#p-admin-erro'); err.textContent = '';
        if (b.dataset.acao === 'remover') {
          if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = 'Confirmar remoção'; setTimeout(function () { if (b.isConnected) { b.dataset.confirmar = ''; b.textContent = 'Remover'; } }, 5000); return; }
          await comBotao(b, async function () { try { await carregarCofre(); var n = JSON.parse(JSON.stringify(cofre)); delete n.usuarios[login]; await salvarCofre(n, 'Acesso removido: ' + u.nome + ' (por ' + sessao.nome + ')'); aviso(u.nome + ' não tem mais acesso.'); } catch (e) { err.textContent = e.message; } });
          desenharUsuarios();
        } else if (b.dataset.acao === 'redefinir') {
          await comBotao(b, async function () { try { await carregarCofre(); var n = JSON.parse(JSON.stringify(cofre)); n.usuarios[login] = await entradaUsuario(u.nome, u.papel, SENHA_PADRAO, unb64(sessao.mestra), true, u.modulos); await salvarCofre(n, 'Senha redefinida: ' + u.nome + ' (por ' + sessao.nome + ')'); aviso('Senha de ' + u.nome + ' voltou para ' + SENHA_PADRAO + '.'); } catch (e) { err.textContent = e.message; } });
          desenharUsuarios();
        }
      };
      box.onchange = async function (ev) {
        var cb = ev.target.closest('input[data-acao="modulo"]');
        if (cb) {
          var lg = cb.closest('[data-login]').dataset.login, marcados = Array.prototype.map.call(cb.closest('.p-chips').querySelectorAll('input:checked'), function (i) { return i.value; });
          cb.disabled = true;
          try { await carregarCofre(); var nc = JSON.parse(JSON.stringify(cofre)); nc.usuarios[lg].modulos = marcados; await salvarCofre(nc, 'Páginas de ' + nc.usuarios[lg].nome + ' (por ' + sessao.nome + ')'); aviso('Acesso às páginas atualizado.'); }
          catch (e) { $('#p-admin-erro').textContent = e.message; } finally { desenharUsuarios(); }
          return;
        }
        var s = ev.target.closest('select[data-acao="papel"]'); if (!s) return;
        var login = s.closest('[data-login]').dataset.login, err = $('#p-admin-erro'); s.disabled = true;
        try { await carregarCofre(); var n = JSON.parse(JSON.stringify(cofre)); n.usuarios[login].papel = s.value; await salvarCofre(n, 'Perfil de ' + n.usuarios[login].nome + ': ' + s.value + ' (por ' + sessao.nome + ')'); aviso('Perfil atualizado.'); }
        catch (e) { err.textContent = e.message; } finally { desenharUsuarios(); }
      };
    }
    $('#p-btn-admin').onclick = abrirAdmin;

    /* ---------- configuração inicial (uma vez, pela administradora) ---------- */
    function telaConfig(jaConfigurada) {
      var tela = $('#p-tela-config');
      tela.innerHTML = '<form class="p-login-card largo" id="p-form-config" autocomplete="off">' + marcaHTML('Configuração inicial') +
        (jaConfigurada ? '<p class="p-faixa aviso" style="margin:0">Esta plataforma já está configurada. Salvar aqui <b>recria todos os acessos</b> com a senha ' + SENHA_PADRAO + '. Para só trocar o token, entre como administradora e use <b>Administração</b>.</p>' : '') +
        '<p class="p-ajuda">Os dados ficam no repositório privado <b>' + esc(cfg.repoDados) + '</b>. A plataforma usa um token do GitHub, guardado <b>criptografado</b>: só abre com a senha de quem está na lista.</p>' +
        '<label class="p-campo">Token do GitHub (fine-grained, <i>Contents: Read and write</i> em ' + esc(cfg.repoSite.split('/')[1]) + ' e ' + esc(cfg.repoDados.split('/')[1]) + ')<input id="p-config-token" type="password" required placeholder="github_pat_..."></label>' +
        '<label class="p-campo">Usuários (um por linha; a senha de todos começa como ' + SENHA_PADRAO + ')<textarea id="p-config-usuarios" required>' + esc(cfg.usuariosIniciais.join('\n')) + '</textarea></label>' +
        '<label class="p-campo">Administradoras (separe por vírgula)<input id="p-config-admins" value="' + esc(cfg.admins.join(', ')) + '"></label>' +
        '<details><summary class="p-ajuda" style="cursor:pointer">Como criar o token</summary><ol class="p-ajuda"><li>GitHub → <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b>.</li><li><b>Repository access</b> → <i>Only select repositories</i> → marque os repositórios das plataformas (pode ser o mesmo token para todas).</li><li><b>Permissions → Contents → Read and write</b>. Validade: a mais longa.</li></ol></details>' +
        '<button class="btn btn-primario" type="submit">Salvar configuração</button>' + (jaConfigurada ? '<button class="btn btn-link" type="button" id="p-config-voltar">Voltar ao login</button>' : '') +
        '<p class="p-erro" id="p-config-erro" role="alert"></p></form>';
      mostrar('p-tela-config');
      var v = $('#p-config-voltar'); if (v) v.onclick = function () { history.replaceState(null, '', location.pathname); prepararLogin(); };
      $('#p-form-config').onsubmit = async function (ev) {
        ev.preventDefault(); var err = $('#p-config-erro'); err.textContent = '';
        var tok = $('#p-config-token').value.trim();
        var nomes = $('#p-config-usuarios').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        var admins = $('#p-config-admins').value.split(',').map(function (s) { return slug(s); }).filter(Boolean);
        if (!nomes.length) { err.textContent = 'Inclua pelo menos um usuário.'; return; }
        if (!nomes.some(function (n) { return admins.indexOf(slug(n)) >= 0; })) { err.textContent = 'Pelo menos uma pessoa da lista precisa ser administradora.'; return; }
        await comBotao(ev.submitter || ev.target.querySelector('.btn-primario'), async function () {
          try {
            var teste = GitHub(function () { return tok; });
            if (!(await teste.podeGravar(cfg.repoSite))) { err.textContent = 'O token não consegue gravar em ' + cfg.repoSite + '.'; return; }
            if (!(await teste.podeGravar(cfg.repoDados))) { err.textContent = 'O token não consegue gravar em ' + cfg.repoDados + '.'; return; }
            var mestra = aleatorio(32), novo = { usuarios: {}, token: await trancarToken(tok, mestra) };
            for (var i = 0; i < nomes.length; i++) { var l = slug(nomes[i]); novo.usuarios[l] = await entradaUsuario(nomes[i], admins.indexOf(l) >= 0 ? 'admin' : 'usuario', SENHA_PADRAO, mestra, true); }
            sessao = { token: tok, nome: 'configuração' };
            await salvarCofre(novo, 'Configuração de acessos');
            sessao = null; history.replaceState(null, '', location.pathname);
            aviso('Configurado. Entre com seu nome e a senha ' + SENHA_PADRAO + '.');
            prepararLogin();
          } catch (e) { sessao = null; err.textContent = e.message; }
        });
      };
    }

    /* ---------- partida ---------- */
    (async function () {
      if (modoModulo) { var u = PAI.usuario; sessao = { login: u.login, nome: u.nome, papel: u.papel, token: PAI.token }; return entrar(); }
      await carregarCofre();
      if (location.hash === '#configurar') return telaConfig(!!cofre);
      if (!cofre) return telaConfig(false);
      var s = guarda.ler('sessao', null, 'sessao') || guarda.ler('sessao', null, 'local');
      if (s && s.login && cofre.usuarios[s.login] && s.token) {
        sessao = s; sessao.papel = cofre.usuarios[s.login].papel; sessao.nome = cofre.usuarios[s.login].nome; sessao.senhaPadrao = !!cofre.usuarios[s.login].senhaPadrao;
        try { await entrar(); return; } catch (e) { /* volta ao login */ }
      } else if (s) { guarda.apagar('sessao', 'sessao'); guarda.apagar('sessao', 'local'); }
      prepararLogin();
    })();
    global.addEventListener('hashchange', function () { if (location.hash === '#configurar') telaConfig(!!cofre); });
    return ctx;
  }

  /* ======================= identidade de cada empresa ======================= */
  /** Cores e dados de cada empresa, usados por todas as plataformas. */
  var MARCAS = {
    wegen: { nome: 'WeGen', cor: '#1e874b', cor2: '#8fd16a', ceu: '#d9f2c7', frase: 'Cooperativa de energia solar · desconto na conta de luz da Cemig', whatsapp: ['(31) 9718-4014', '(31) 7160-1581'] },
    smartben: { nome: 'SmartBen', cor: '#1d5fc2', cor2: '#5cc2f2', ceu: '#d4ecfb', frase: 'Cooperativa de energia solar · desconto na conta de luz da Cemig', whatsapp: ['(31) 9775-6674'] },
    wattwise: { nome: 'WattWise', cor: '#d23c80', cor2: '#ffa2c8', ceu: '#fde0ec', frase: 'Cooperativa de energia solar · desconto na conta de luz da Cemig', whatsapp: ['(31) 99712-6777'] }
  };
  /** Ilustração original: sol, campo e placas solares, na cor da empresa. */
  function ilustracao(m) {
    var id = 'g' + Math.random().toString(36).slice(2, 8), raios = '';
    for (var i = 0; i < 12; i++) { var a = i * Math.PI / 6; raios += '<line x1="' + (1030 + Math.cos(a) * 58).toFixed(1) + '" y1="' + (62 + Math.sin(a) * 58).toFixed(1) + '" x2="' + (1030 + Math.cos(a) * 80).toFixed(1) + '" y2="' + (62 + Math.sin(a) * 80).toFixed(1) + '"/>'; }
    var placas = '';
    for (var p = 0; p < 6; p++) { var x = 690 + p * 72, y = 150 - p * 4; placas += '<g transform="translate(' + x + ' ' + y + ')"><path d="M0 0 L56 0 L66 -26 L10 -26 Z" fill="#14324d" opacity=".82"/><path d="M5 -13 L61 -13 M19 0 L28 -26 M37 0 L47 -26" stroke="#9fd3ff" stroke-width="1.2" opacity=".55"/><path d="M30 0 L30 14" stroke="#14324d" stroke-width="3" opacity=".7"/></g>'; }
    return '<svg class="p-banner-arte" viewBox="0 0 1200 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + m.cor + '"/><stop offset="1" stop-color="' + m.cor2 + '"/></linearGradient>' +
      '<radialGradient id="' + id + 's"><stop offset="0" stop-color="#fff6c9"/><stop offset="1" stop-color="#ffc94a"/></radialGradient></defs>' +
      '<rect width="1200" height="200" fill="url(#' + id + ')"/>' +
      '<g stroke="#ffe08a" stroke-width="5" stroke-linecap="round" opacity=".75">' + raios + '</g><circle cx="1030" cy="62" r="44" fill="url(#' + id + 's)"/>' +
      '<path d="M0 170 C 220 120 420 190 640 150 S 1000 120 1200 160 L1200 200 L0 200 Z" fill="#fff" opacity=".16"/>' +
      '<path d="M560 200 C 700 150 900 140 1200 175 L1200 200 Z" fill="' + m.ceu + '" opacity=".45"/>' + placas +
      '<path d="M0 200 C 300 170 700 205 1200 185 L1200 200 Z" fill="#fff" opacity=".22"/></svg>';
  }
  /** Banner da empresa (HTML). opcoes: { titulo, subtitulo, whatsapp: true|false } */
  function banner(chave, opcoes) {
    var m = MARCAS[chave]; opcoes = opcoes || {};
    if (!m) return '';
    var zap = opcoes.whatsapp === false ? '' : '<div class="p-banner-zap">' + m.whatsapp.map(function (n) { return '<span>WhatsApp ' + esc(n) + '</span>'; }).join('') + '</div>';
    return '<section class="p-banner' + (opcoes.compacto ? ' compacto' : '') + '" style="--marca:' + m.cor + '" aria-label="' + esc(m.nome) + '"><span class="p-banner-palco" aria-hidden="true"><span class="p-placa p1"><i></i><b></b></span></span>' +
      '<div class="p-banner-texto"><strong>' + esc(opcoes.titulo || m.nome) + '</strong><span>' + esc(opcoes.subtitulo || m.frase) + '</span>' + zap + '</div></section>';
  }

  global.Plataforma = { iniciar: iniciar, versao: VERSAO_KIT, marcas: MARCAS, banner: banner, util: { esc: esc, slug: slug } };
})(window);
