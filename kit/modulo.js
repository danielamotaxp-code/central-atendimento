/**
 * Liga uma página ao portal único (danielamotaxp-code.github.io/central-atendimento/).
 * Dentro do portal: usa o login de lá (window.PLAT). Aberta direto: volta para o portal, na página certa.
 * Uso: <script src="/central-atendimento/kit/modulo.js" data-modulo="distratos"></script>
 */
(function () {
  var s = document.currentScript, id = (s && s.dataset.modulo) || '', portal = (s && s.dataset.portal) || '/central-atendimento/';
  var P = null; try { if (window.parent !== window) P = window.parent.PlataformaAtual || null; } catch (e) { /* outro endereço */ }
  if (!P) { document.documentElement.style.visibility = 'hidden'; location.replace(portal + '#' + id); return; }
  window.PLAT = P;
  var h = document.documentElement; h.classList.add('plat-embutido');
  function tema(t) {
    if (t === 'claro' || t === 'escuro') { h.dataset.tema = t; h.dataset.theme = t === 'escuro' ? 'dark' : 'light'; }
    else { delete h.dataset.tema; delete h.dataset.theme; }
  }
  tema(P.tema()); P.aoTema(tema);
})();
