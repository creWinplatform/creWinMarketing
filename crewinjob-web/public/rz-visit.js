/* Ryzevo visitor companies: sends one page view only after the visitor consents in the site's own consent banner.
   Call ryzevoVisit.consent() when the visitor accepts (and ryzevoVisit.revoke() when they withdraw). */
(function () {
  var script = document.currentScript, key = script && script.getAttribute('data-key');
  if (!key) return;
  var endpoint = script.src.split('/rz-visit.js')[0] + '/api/visit', sent = false;
  function allowed() { try { return window.ryzevoConsent === true || window.localStorage.getItem('ryzevo_visit_consent') === '1'; } catch (e) { return window.ryzevoConsent === true; } }
  function send() {
    if (sent || !allowed()) return; sent = true;
    var body = JSON.stringify({ k: key, p: (location.pathname || '/').slice(0, 200) });
    try { if (navigator.sendBeacon) { navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' })); return; } } catch (e) { /* fall back */ }
    try { fetch(endpoint, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true, mode: 'cors', credentials: 'omit' }); } catch (e) { /* ignore */ }
  }
  window.ryzevoVisit = {
    consent: function () { try { window.localStorage.setItem('ryzevo_visit_consent', '1'); } catch (e) { window.ryzevoConsent = true; } send(); },
    revoke: function () { try { window.localStorage.removeItem('ryzevo_visit_consent'); } catch (e) { /* ignore */ } window.ryzevoConsent = false; }
  };
  send();
})();
