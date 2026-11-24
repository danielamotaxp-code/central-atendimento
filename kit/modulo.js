/**
 * Liga uma página ao portal único (danielamotaxp-code.github.io/central-atendimento/).
 * Dentro do portal: usa o login de lá (window.PLAT). Aberta direto: volta para o portal, na página certa.
 * Uso: <script src="/central-atendimento/kit/modulo.js" data-modulo="distratos"></script>
 */
(function () {
  var s = document.currentScript, id = (s && s.dataset.modulo) || '', portal = (s && s.dataset.portal) || '/central-atendimento/';
  var P = null; try { if (window.parent !== window) P = window.parent.PlataformaAtual || window.parent.PLAT || null; /* PLAT: página dentro de outra página do portal */ } catch (e) { /* outro endereço */ }
  if (!P) { document.documentElement.style.visibility = 'hidden'; location.replace(portal + '#' + id); return; }
  window.PLAT = P;
  var h = document.documentElement; h.classList.add('plat-embutido');
  var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null, atualT = 'auto';
  function tema(t) {
    atualT = t;
    if (t === 'claro' || t === 'escuro') { h.dataset.tema = t; h.dataset.theme = t === 'escuro' ? 'dark' : 'light'; }
    else { delete h.dataset.tema; delete h.dataset.theme; }
    /* classe "escuro" = tema escuro de fato (escolhido, ou automático com o computador no escuro) */
    h.classList.toggle('escuro', t === 'escuro' || (t !== 'claro' && !!(mq && mq.matches)));
  }
  tema(P.tema()); P.aoTema(tema);
  if (mq) { try { mq.addEventListener('change', function () { tema(atualT); }); } catch (e) { /* navegador antigo */ } }
})();
