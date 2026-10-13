/* LETRA page: picks the rules, sends the term to the API, shows the results as
   chips and the derivation of the chosen one as a table. All text from the
   server (derived terms, rule text, uploaded JSON) goes in with textContent,
   never innerHTML; only the app's own translated strings are set as HTML. */
(function () {
    'use strict';

    var LANGS = ['en', 'es'];
    var STORAGE_KEY = 'dirdam-lang';
    var MAX_FILE_BYTES = 256 * 1024;
    var PRESETS = ['sample', 'LA_ES', 'ES_IPA'];
    var PRESET_LABEL = { sample: 'use_sample', LA_ES: 'use_la_es', ES_IPA: 'use_es_ipa' };
    var PLACEHOLDER = {
        sample: 'lítteram',
        LA_ES: 'lítteram, trophaéum, óperam, dóminum, quinquagínta, dígitum...',
        ES_IPA: 'civilización, chascarrillo, halagüeño, verdad, rejuvenecer, water...'
    };

    var S = null;                       // { raw: {lang: {key: text}}, html: {lang: {key: html}} }
    var lang = detectLang();
    var state = {
        preset: 'sample',               // 'sample' | 'LA_ES' | 'ES_IPA' | 'own'
        rulesText: '',                  // contents of the rules file shown in the viewer
        fileName: 'sample.json',
        result: null,                   // last answer from /api/transform
        selected: null,                 // the chip whose derivation is shown
        error: '',                      // error code of the last request ('' = none)
        fileTooBig: false               // the chosen file was over the size limit
    };
    var inflight = null;
    var debounce = null;
    var aboutCache = {};

    function $(id) { return document.getElementById(id); }
    var el = {
        tabTool: $('tabTool'), tabAbout: $('tabAbout'), panelTool: $('panelTool'), panelAbout: $('panelAbout'),
        about: $('aboutContent'), preset: $('preset'), uploadRow: $('uploadRow'), file: $('fileInput'),
        explain: $('presetExplain'), fileError: $('fileError'), afterRules: $('afterRules'), term: $('term'), error: $('error'),
        results: $('results'), interm: $('interm'), chips: $('chips'), chain: $('chain'),
        chainTerm: $('chainTerm'), chainBody: $('chainBody'), download: $('download'),
        downloadName: $('downloadName'), jsonName: $('jsonName'), jsonView: $('jsonView'),
        toggle: $('langToggle')
    };

    // ---------- language ----------

    function detectLang() {
        var fromUrl = new URLSearchParams(location.search).get('lang');
        if (LANGS.indexOf(fromUrl) !== -1) return fromUrl;
        try {
            var stored = localStorage.getItem(STORAGE_KEY);
            if (LANGS.indexOf(stored) !== -1) return stored;
        } catch (e) { /* storage blocked: fall through */ }
        var browser = (navigator.language || 'en').slice(0, 2);
        return LANGS.indexOf(browser) !== -1 ? browser : 'en';
    }

    function t(key) { return (S && S.raw[lang] && S.raw[lang][key]) || (S && S.raw.en[key]) || key; }
    function h(key) { return (S && S.html[lang] && S.html[lang][key]) || (S && S.html.en[key]) || ''; }

    function applyStatic() {
        document.documentElement.lang = lang;
        Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-html]'), function (n) {
            n.innerHTML = h(n.getAttribute('data-i18n-html'));
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (n) {
            n.textContent = t(n.getAttribute('data-i18n'));
        });
        buildPresetOptions();
        renderToggle();
        renderExplain();
        el.term.placeholder = placeholder();
    }

    function renderToggle() {
        el.toggle.textContent = '';
        LANGS.forEach(function (l) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = l.toUpperCase();
            b.setAttribute('aria-pressed', String(l === lang));
            b.addEventListener('click', function () { setLang(l); });
            el.toggle.appendChild(b);
        });
    }

    function setLang(l) {
        if (l === lang) return;
        lang = l;
        try { localStorage.setItem(STORAGE_KEY, l); } catch (e) { /* ignore */ }
        applyStatic();
        render();
        if (!el.panelAbout.hidden) loadAbout();
    }

    // ---------- rules selection ----------

    function buildPresetOptions() {
        var current = state.preset;
        el.preset.textContent = '';
        PRESETS.concat(['own']).forEach(function (id) {
            var o = document.createElement('option');
            o.value = id;
            o.textContent = t(id === 'own' ? 'upload_own' : PRESET_LABEL[id]);
            el.preset.appendChild(o);
        });
        el.preset.value = current;
    }

    function placeholder() { return state.preset === 'own' ? t('placeholder') : PLACEHOLDER[state.preset]; }

    function renderExplain() {
        el.explain.innerHTML = state.preset === 'own' ? '' : h('explain_' + state.preset);
    }

    function setPreset(id) {
        state.preset = id;
        state.result = null;
        state.selected = null;
        state.error = '';
        state.fileTooBig = false;
        el.uploadRow.hidden = id !== 'own';
        el.term.placeholder = placeholder();
        renderExplain();
        if (id === 'own') {
            state.rulesText = '';
            state.fileName = '';
            el.file.value = '';
            render();
            return;
        }
        state.fileName = id + '.json';
        fetch('api/rules/' + id)
            .then(function (r) { return r.text(); })
            .then(function (text) {
                if (state.preset !== id) return;
                state.rulesText = text;
                render();
                runTransform();
            });
    }

    function onFile() {
        var f = el.file.files[0];
        if (!f) return;
        if (f.size > MAX_FILE_BYTES) {
            state.fileTooBig = true;
            state.error = '';
            state.rulesText = '';
            state.fileName = '';
            state.result = null;
            el.file.value = '';
            render();
            return;
        }
        var reader = new FileReader();
        reader.onload = function () {
            state.rulesText = String(reader.result);
            state.fileName = f.name;
            state.fileTooBig = false;
            state.error = '';
            render();
            runTransform();
        };
        reader.readAsText(f, 'utf-8');
    }

    // ---------- transform ----------

    function scheduleTransform() {
        clearTimeout(debounce);
        debounce = setTimeout(runTransform, 250);
    }

    function runTransform() {
        clearTimeout(debounce);
        var term = el.term.value;
        if (inflight) inflight.abort();
        if (!term.trim() || (state.preset === 'own' && !state.rulesText)) {
            state.result = null;
            state.selected = null;
            state.error = '';
            render();
            return;
        }
        var body = { term: term };
        if (state.preset === 'own') body.rules = state.rulesText; else body.preset = state.preset;
        inflight = new AbortController();
        fetch('api/transform', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: inflight.signal
        }).then(function (r) {
            return r.text().then(function (text) {
                var data = null;
                try { data = JSON.parse(text); } catch (e) { /* not JSON (e.g. a gateway error page) */ }
                return { ok: r.ok, status: r.status, data: data };
            });
        }).then(function (res) {
            if (res.ok && res.data) {
                state.result = res.data;
                state.error = '';
                if (state.selected && !res.data.terms[state.selected]) state.selected = null;
            } else {
                state.result = null;
                state.selected = null;
                state.error = res.data && res.data.error ? res.data.error
                    : (res.status >= 500 ? 'timeout' : 'server');
            }
            render();
        }).catch(function (err) {
            if (err && err.name === 'AbortError') return;
            state.result = null;
            state.error = 'server';
            render();
        });
    }

    // ---------- rendering ----------

    function cell(text, cls) {
        var td = document.createElement('td');
        td.textContent = text;
        if (cls) td.className = cls;
        return td;
    }

    // Steps from the start term to `term`, following the "mother" links back.
    function chainFor(term) {
        var rows = [];
        var cur = term;
        var info = state.result.terms[cur];
        var guard = 0;
        while (info && cur !== state.result.start && guard++ < 500) {
            rows.push([info.rule, info.rule_text, info.mother, cur]);
            cur = info.mother;
            info = state.result.terms[cur];
        }
        return rows.reverse();
    }

    function prettyRules(text) {
        try { return JSON.stringify(JSON.parse(text.replace(/(?:\/\/[^\n]*)/g, '')), null, 2); }
        catch (e) { return text; }
    }

    function render() {
        var haveRules = state.preset !== 'own' || !!state.rulesText;
        el.afterRules.hidden = !haveRules;

        // errors: a too-big file next to the upload box, the rest under the term
        el.fileError.hidden = !state.fileTooBig;
        el.fileError.textContent = state.fileTooBig ? t('err_file_too_big') : '';
        var msg = state.error ? t('err_' + state.error) : '';
        el.error.hidden = !msg;
        el.error.textContent = msg;

        // results
        var r = state.result;
        el.results.hidden = !r;
        if (r) {
            var list = el.interm.checked ? r.all : r.final;
            el.chips.textContent = '';
            if (!list.length) {
                var none = document.createElement('p');
                none.textContent = t('no_results');
                el.chips.appendChild(none);
            }
            list.forEach(function (term) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'chip';
                b.textContent = term;
                b.disabled = term === r.start;
                b.setAttribute('aria-pressed', String(term === state.selected));
                b.addEventListener('click', function () {
                    state.selected = term;
                    render();
                });
                el.chips.appendChild(b);
            });

            var rows = state.selected && state.selected !== r.start ? chainFor(state.selected) : [];
            el.chain.hidden = !rows.length;
            if (rows.length) {
                el.chainTerm.textContent = state.selected;
                el.chainBody.textContent = '';
                rows.forEach(function (row, i) {
                    var tr = document.createElement('tr');
                    tr.appendChild(cell(String(i + 1)));
                    tr.appendChild(cell(row[0]));
                    tr.appendChild(cell(row[1]));
                    tr.appendChild(cell(row[2], 'mono'));
                    tr.appendChild(cell(row[3], 'mono'));
                    el.chainBody.appendChild(tr);
                });
            }
        }

        // rules file: viewer and download
        el.jsonName.textContent = state.fileName;
        el.downloadName.textContent = state.fileName;
        el.jsonView.textContent = state.rulesText ? prettyRules(state.rulesText) : '';
        if (state.preset === 'own') {
            if (el.download.dataset.blob) URL.revokeObjectURL(el.download.dataset.blob);
            var url = URL.createObjectURL(new Blob([state.rulesText], { type: 'application/json' }));
            el.download.dataset.blob = url;
            el.download.href = url;
        } else {
            el.download.href = 'api/rules/' + state.preset;
        }
        el.download.setAttribute('download', state.fileName || 'rules.json');
    }

    // ---------- tabs ----------

    function showTab(about) {
        el.panelTool.hidden = about;
        el.panelAbout.hidden = !about;
        el.tabTool.setAttribute('aria-selected', String(!about));
        el.tabAbout.setAttribute('aria-selected', String(about));
        if (about) loadAbout();
    }

    function loadAbout() {
        var l = lang;
        if (aboutCache[l]) { el.about.innerHTML = aboutCache[l]; return; }
        fetch('api/about?lang=' + l)
            .then(function (r) { return r.json(); })
            .then(function (d) {
                aboutCache[l] = d.html;
                if (l === lang) el.about.innerHTML = d.html;
            });
    }

    // ---------- start ----------

    $('footerYear').textContent = new Date().getFullYear();
    el.tabTool.addEventListener('click', function () { showTab(false); });
    el.tabAbout.addEventListener('click', function () { showTab(true); });
    el.preset.addEventListener('change', function () { setPreset(el.preset.value); });
    el.file.addEventListener('change', onFile);
    el.term.addEventListener('input', function () { state.selected = null; scheduleTransform(); });
    el.term.addEventListener('keydown', function (e) { if (e.key === 'Enter') runTransform(); });
    el.interm.addEventListener('change', render);

    fetch('api/strings')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            S = data;
            applyStatic();
            el.term.value = 'lítteram';
            setPreset('sample');
        })
        .catch(function () {
            el.error.hidden = false;
            el.error.textContent = 'Could not load the page texts. Please reload.';
        });
})();
