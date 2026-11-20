// Google Analytics 4, property "Reset Traders website" (stream resettraders.com).
// Page views and the standard engagement events only: no ads features, no Google signals.
// Skipped on local previews and for visitors whose browser sends Do Not Track or Global Privacy Control.
(function () {
  var ID = 'G-LNB41Z43KM';
  if (!/(^|\.)resettraders\.com$/.test(location.hostname)) return;
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
  document.head.appendChild(s);
})();
