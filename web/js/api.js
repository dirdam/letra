/* Calls to the server. Every function resolves to {ok, status, data} (data is null when the
   answer was not JSON, e.g. a gateway error page) and rejects only when the network fails. */
(function () {
    'use strict';
    const L = (window.Letra = window.Letra || {});

    async function request(path, body, signal) {
        const r = await fetch(path, body === undefined ? { signal } : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal,
        });
        const text = await r.text();
        let data = null;
        try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
        return { ok: r.ok, status: r.status, data, text };
    }

    /* A rule set is {preset: 'LA_ES'} for a bundled one or {rules: '<json text>'} for the user's own. */
    const source = (set) => (set.preset ? { preset: set.preset } : { rules: set.rules });

    L.api = {
        about: (lang) => request('api/about?lang=' + encodeURIComponent(lang)),
        ruleText: (preset) => request('api/rules/' + encodeURIComponent(preset)),
        template: (lang) => request('api/template?lang=' + encodeURIComponent(lang)),
        transform: (set, words, signal) =>
            request('api/transform', Object.assign({ terms: words }, source(set)), signal),
        rulebook: (set) => request('api/rulebook', source(set)),
        validate: (text, signal) => request('api/validate', { rules: text }, signal),
    };
})();
