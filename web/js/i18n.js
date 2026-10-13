/* Translations: strings come from /api/strings (data/localizations.csv).
   Markup: data-i18n="key" sets the text, data-i18n-attr="placeholder" sets that attribute instead,
   data-i18n-html="key" sets HTML (only the app's own strings, never user text). */
(function () {
    'use strict';
    const L = (window.Letra = window.Letra || {});
    const LANGS = ['en', 'es'];
    const STORAGE_KEY = 'dirdam-lang';
    let S = null;
    let lang = detect();
    const listeners = [];

    function detect() {
        const fromUrl = new URLSearchParams(location.search).get('lang');
        if (LANGS.includes(fromUrl)) return fromUrl;
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (LANGS.includes(stored)) return stored;
        } catch (e) { /* storage blocked */ }
        const browser = (navigator.language || 'en').slice(0, 2);
        return LANGS.includes(browser) ? browser : 'en';
    }

    const t = (key) => (S && ((S.raw[lang] && S.raw[lang][key]) || (S.raw.en && S.raw.en[key]))) || key;
    const h = (key) => (S && ((S.html[lang] && S.html[lang][key]) || (S.html.en && S.html.en[key]))) || '';

    /* t(key) with {name} placeholders filled in. */
    function fmt(key, vars) {
        let s = t(key);
        Object.keys(vars || {}).forEach((k) => { s = s.split('{' + k + '}').join(String(vars[k])); });
        return s;
    }

    /* fmt for counted things: uses key_one when n is 1, key_other otherwise. */
    const count = (key, n, vars) => fmt(key + (n === 1 ? '_one' : '_other'), Object.assign({ n }, vars || {}));

    function apply(root) {
        root = root || document;
        root.querySelectorAll('[data-i18n-html]').forEach((n) => { n.innerHTML = h(n.getAttribute('data-i18n-html')); });
        root.querySelectorAll('[data-i18n]').forEach((n) => {
            const value = t(n.getAttribute('data-i18n'));
            const attr = n.getAttribute('data-i18n-attr');
            if (attr) n.setAttribute(attr, value); else n.textContent = value;
        });
    }

    function renderToggle(el) {
        el.textContent = '';
        LANGS.forEach((l) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = l.toUpperCase();
            b.setAttribute('aria-pressed', String(l === lang));
            b.addEventListener('click', () => setLang(l));
            el.appendChild(b);
        });
    }

    function setLang(l) {
        if (l === lang || !LANGS.includes(l)) return;
        lang = l;
        try { localStorage.setItem(STORAGE_KEY, l); } catch (e) { /* ignore */ }
        document.documentElement.lang = l;
        apply();
        renderToggle(document.getElementById('langToggle'));
        listeners.forEach((fn) => fn(l));
    }

    L.i18n = {
        t, h, fmt, count, apply, setLang, renderToggle,
        get lang() { return lang; },
        onChange: (fn) => listeners.push(fn),
        load: () => fetch('api/strings').then((r) => r.json()).then((d) => { S = d; document.documentElement.lang = lang; }),
    };
})();
