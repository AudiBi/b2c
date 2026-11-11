// Page racine : redirige vers la langue mémorisée, sinon vers celle du navigateur, sinon vers le français.
// Fichier externe (et non en ligne) pour permettre une politique CSP stricte : script-src 'self'.
(function () {
  var langs = ['fr', 'ht', 'en'];
  try {
    var stored = localStorage.getItem('b2c.lang');
    if (langs.indexOf(stored) >= 0) return location.replace('/' + stored);
  } catch (e) {
    /* stockage indisponible */
  }
  var prefs = navigator.languages || [navigator.language];
  for (var i = 0; i < prefs.length; i++) {
    var base = String(prefs[i]).toLowerCase().split('-')[0];
    if (langs.indexOf(base) >= 0) return location.replace('/' + base);
  }
  location.replace('/fr');
})();
