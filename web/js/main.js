/* Starts the page and ties the parts together: tabs, the rule-set shelf, evolving the words, the rule book,
   the editor, export and sharing. */
(function () {
    'use strict';
    const L = (window.Letra = window.Letra || {});
    const I = L.i18n;
    const ST = L.state;
    const S = ST.s;

    const $ = (id) => document.getElementById(id);
    const TABS = ['evolve', 'rulebook', 'editor'];          // the working tabs, left to right; Evolve is the one open by default. About is a page of its own (link in the hero)
    const SETS = ['sample', 'LA_ES', 'ES_IPA', 'ES_Miquitrifi', 'mine'];
    const SET_LABEL = { sample: 'set_sample', LA_ES: 'set_la_es', ES_IPA: 'set_es_ipa', ES_Miquitrifi: 'set_es_miquitrifi', mine: 'set_mine' };
    const setLabel = (id) => I.t(SET_LABEL[id]);

    let runTimer = null;
    let inflight = null;
    let runSeq = 0;
    let toastTimer = null;
    let rulebookSeq = 0;
    let rulebookError = '';
    const aboutCache = {};

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function toast(message) {
        const t = $('toast');
        t.textContent = message;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
    }

    // ---------- rule sets ----------

    function renderShelf() {
        const box = $('shelfSets');
        box.textContent = '';
        SETS.forEach((id) => {
            const b = el('button', 'book' + (id === 'mine' && !S.mine.trim() ? ' empty' : ''), (id === 'mine' ? '★ ' : '') + setLabel(id));          // the user's own set is starred
            b.type = 'button';
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', String(S.setId === id));
            if (id === 'mine') b.title = S.mine.trim() ? S.mineName : I.t('mine_empty_hint');
            b.addEventListener('click', () => selectSet(id));
            box.appendChild(b);
        });
    }

    function renderSetPanel() {
        $('setTitle').textContent = setLabel(S.setId);
        // what the rules file says about itself ("description": bullets of Markdown); My rules without one gets a standard line
        $('splitIdentity').hidden = !L.rulebook.identity(ST.currentSet()).length;          // the toggle only exists for sets that have an identity rule
        const bullets = L.rulebook.description(ST.currentSet(), I.lang);
        $('setExplain').innerHTML = bullets ? '<ul>' + bullets.map((b) => '<li>' + b + '</li>').join('') + '</ul>' : S.setId === 'mine' ? I.h('explain_mine') : '';
        const st = L.rulebook.stats();
        $('setStats').textContent = rulebookError ? I.t('err_' + rulebookError) : st ? I.fmt('set_stats', st) : '…';
        $('setStats').className = 'set-stats' + (rulebookError ? ' error' : '');
        const names = S.setId === 'mine' ? S.mineName : '';
        $('setTitle').title = names;
    }

    function renderExamples() {
        const box = $('examples');
        box.textContent = '';
        const list = S.setId === 'sample' ? [] : ST.EXAMPLES[S.setId] || [];          // the sample already holds its word in the bar
        if (!list.length) return;
        box.appendChild(el('span', 'examples-label', I.t('examples')));
        list.forEach((w) => {
            const b = el('button', 'example', w);
            b.type = 'button';
            b.addEventListener('click', () => {
                const box = $('words');
                box.value = w;          // replaces what is in the bar
                evolveNow();
            });
            box.appendChild(b);
        });
    }

    async function loadRulebook() {
        const set = ST.currentSet();
        const mine = ++rulebookSeq;
        rulebookError = '';
        if (!set) { renderSetPanel(); renderRulebookTab(); return; }
        const data = await L.rulebook.load(set);
        if (mine !== rulebookSeq) return;
        rulebookError = data && data.error ? data.error : '';
        renderSetPanel();
        renderRulebookTab();
        if (S.results.length) renderResults();          // chains can now show the rules' entries
    }

    function selectSet(id) {
        if (id === 'mine' && !S.mine.trim()) {
            switchTab('editor');
            toast(I.t('mine_empty_toast'));
            return;
        }
        S.setId = id;
        $('words').value = id === 'sample' ? ST.EXAMPLES.sample[0] : '';          // only the sample comes with its word; the other sets show the placeholder
        S.results = [];
        S.selected = {};
        S.collapsed = {};
        S.chainFolded = {};
        S.error = '';
        ST.save();
        renderShelf();
        renderSetPanel();
        renderExamples();
        L.editor.refresh();
        loadRulebook();
        evolveNow();
    }

    // ---------- evolving ----------

    function updateWordCount(n) {
        const e = $('wordCount');
        const tooMany = n > ST.MAX_WORDS;
        e.hidden = !tooMany;
        e.textContent = tooMany ? I.fmt('words_too_many', { max: ST.MAX_WORDS, n }) : '';
    }

    function scheduleRun() {
        clearTimeout(runTimer);
        runTimer = setTimeout(evolveNow, 500);
    }

    async function evolveNow() {
        clearTimeout(runTimer);
        const set = ST.currentSet();
        const all = ST.parseWords($('words').value);
        S.words = $('words').value;
        ST.save();
        ST.writeHash();
        updateWordCount(all.length);
        if (inflight) inflight.abort();
        if (!set || !all.length) {
            S.results = [];
            S.truncated = false;
            S.error = '';
            S.loading = false;
            renderResults();
            return;
        }
        inflight = new AbortController();
        const mine = ++runSeq;
        S.loading = true;
        renderStatus();
        try {
            const res = await L.api.transform(set, all.slice(0, ST.MAX_WORDS), inflight.signal);
            if (mine !== runSeq) return;
            if (res.ok && res.data && res.data.results) {
                S.results = res.data.results;
                S.truncated = !!res.data.truncated;
                S.error = '';
            } else {
                S.results = [];
                S.error = (res.data && res.data.error) || (res.status >= 500 ? 'timeout' : 'server');
            }
        } catch (e) {
            if ((e && e.name === 'AbortError') || mine !== runSeq) return;
            S.results = [];
            S.error = 'server';
        }
        S.loading = false;
        renderResults();
    }

    function renderStatus() {
        const s = $('status');
        s.className = 'status';
        if (S.loading) { s.textContent = I.t('status_loading'); return; }
        if (S.error) { s.textContent = I.t('err_' + S.error); s.classList.add('error'); return; }
        if (!S.results.length) { s.textContent = ''; return; }
        const ok = S.results.filter((r) => !r.error);
        const forms = ok.reduce((n, r) => n + r.final.length, 0);
        let text = I.count('n_words', S.results.length) + ' → ' + I.count('n_forms', forms);
        if (S.truncated) { text += ' ' + I.t('status_truncated'); s.classList.add('warn'); }
        s.textContent = text;
    }

    function setSplit(value) {
        S.splitIdentity = value;
        $('splitIdentity').setAttribute('aria-pressed', String(value));
        ST.save();
    }

    function syncTreeView() {
        document.querySelectorAll('#treeView button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === S.treeView)));
    }

    function renderResults() {
        const box = $('results');
        renderStatus();
        $('toolbar').hidden = !S.results.length;
        box.classList.toggle('loading', S.loading);
        if (S.loading && S.results.length) return;
        if (!S.results.length) {
            box.textContent = '';
            if (!S.error && !S.loading) {
                const empty = el('div', 'empty-state');
                empty.appendChild(el('h3', '', I.t(ST.currentSet() ? 'empty_title' : 'empty_no_rules_title')));
                empty.appendChild(el('p', '', I.t(ST.currentSet() ? 'empty_body' : 'empty_no_rules_body')));
                box.appendChild(empty);
            }
            L.rulebook.mark($('rbBody'), new Set());
            return;
        }
        L.entries.renderAll(box);
    }

    // ---------- tabs ----------

    let lastTab = 'evolve';          // the working tab the corner link returns to from the About page

    // The link in the hero's corner goes to the About page ("About", question mark) and, from there, back to the app ("App", play).
    const LINK_ICONS = {
        about: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',          // Lucide circle-question-mark
        app: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',          // Lucide play
    };

    function renderAboutLink() {
        const inAbout = S.tab === 'about';
        const key = inAbout ? 'about_app' : 'tab_about';
        $('aboutLink').querySelector('svg').innerHTML = LINK_ICONS[inAbout ? 'app' : 'about'];
        const label = $('aboutLink').querySelector('span');
        label.setAttribute('data-i18n', key);
        label.textContent = I.t(key);
        $('aboutLink').setAttribute('href', inAbout ? '#' : '#t=about');
    }

    function switchTab(name) {
        if (name !== 'about' && !TABS.includes(name)) name = 'evolve';
        S.tab = name;
        if (name !== 'about') lastTab = name;
        $('shelfBar').hidden = name === 'about';          // About does not depend on the rule set: no rule set bar, no tabs
        $('workbench').hidden = name === 'about';
        $('panel-about').hidden = name !== 'about';
        renderAboutLink();
        TABS.forEach((t) => {
            const on = t === name;
            $('panel-' + t).hidden = !on;
            const b = $('tab-' + t);
            b.setAttribute('aria-selected', String(on));
            b.tabIndex = on ? 0 : -1;
        });
        if (name === 'rulebook') renderRulebookTab();
        if (name === 'about') renderAbout();
        if (name === 'editor') L.editor.refresh(); else L.editor.collapse();
        ST.writeHash();
    }

    function renderRulebookTab() {
        $('rbTitle').textContent = I.fmt('rb_title', { set: setLabel(S.setId) });
        if (S.tab !== 'rulebook' && !$('rbBody').children.length && !L.rulebook.info()) return;
        if (rulebookError) {
            $('rbBody').textContent = '';
            $('rbBody').appendChild(el('p', 'error', I.t('err_' + rulebookError)));
            return;
        }
        L.rulebook.render($('rbBody'), $('rbSearch').value, L.entries.used());
    }

    async function renderAbout() {
        $('aboutHowto').innerHTML = I.h('howto');
        $('aboutSyntax').innerHTML = I.h('syntax');
        const lang = I.lang;
        if (aboutCache[lang]) { $('aboutContent').innerHTML = aboutCache[lang]; return; }
        let res;
        try { res = await L.api.about(lang); } catch (e) { return; }          // network failure: leave the tab as it is
        if (res.ok && res.data) {
            aboutCache[lang] = res.data.html;
            if (lang === I.lang) $('aboutContent').innerHTML = res.data.html;
        }
    }

    function goToRule(rule) {
        switchTab('rulebook');
        const target = Array.from(document.querySelectorAll('#rbBody .rb-rule')).find((e) => e.dataset.rule === rule);
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('flash');
        setTimeout(() => target.classList.remove('flash'), 1600);
    }

    // ---------- export and share ----------

    async function doExport(copy) {
        const kind = $('exportKind').value;
        const format = $('exportFormat').value;
        const out = L.exporter.build(kind, format);
        if (copy) toast((await L.exporter.copy(out.text)) ? I.t('copied') : I.t('copy_failed'));
        else L.exporter.download(out.text, out.mime, L.exporter.filename(S.setId, kind, out.ext));
        $('exportMenu').open = false;
    }

    async function share() {
        ST.writeHash();
        const ok = await L.exporter.copy(location.href);
        toast(ok ? I.t(S.setId === 'mine' ? 'share_copied_mine' : 'share_copied') : I.t('copy_failed'));
    }

    // ---------- start ----------

    function applyStateToUI() {
        $('words').value = S.words;
        syncTreeView();
        renderShelf();
        renderSetPanel();
        renderExamples();
        switchTab(S.tab);
    }

    function bind() {
        $('words').addEventListener('input', scheduleRun);
        $('words').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); evolveNow(); } });
        // a single-line field can drop line breaks when pasting and glue two words together: make them spaces
        $('words').addEventListener('paste', (e) => {
            const text = e.clipboardData && e.clipboardData.getData('text');
            if (!text || !/[\r\n]/.test(text)) return;
            e.preventDefault();
            const box = $('words');
            const a = box.selectionStart;
            const z = box.selectionEnd;
            const clean = text.replace(/[\r\n]+/g, ' ');
            box.value = box.value.slice(0, a) + clean + box.value.slice(z);
            box.setSelectionRange(a + clean.length, a + clean.length);
            scheduleRun();
        });
        $('evolveBtn').addEventListener('click', evolveNow);
        $('exportCopy').addEventListener('click', () => doExport(true));
        $('exportDownload').addEventListener('click', () => doExport(false));
        $('shareBtn').addEventListener('click', share);
        document.addEventListener('click', (e) => { if (!$('exportMenu').contains(e.target)) $('exportMenu').open = false; });          // a click anywhere else closes the export menu
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('exportMenu').open = false; });
        document.querySelectorAll('#treeView button').forEach((b) => b.addEventListener('click', () => {
            if (S.treeView === b.dataset.view) return;
            S.treeView = b.dataset.view;
            ST.save();
            syncTreeView();
            if (S.results.length) renderResults();          // the trees are drawn again the other way round
        }));
        $('splitIdentity').setAttribute('aria-pressed', String(S.splitIdentity));
        $('splitIdentity').addEventListener('click', () => {
            setSplit(!S.splitIdentity);
            if (S.results.length) renderResults();          // the trees are drawn again, with or without the identity branches
        });
        // the same choice from the full-screen viewer: the viewer redraws its own tree; the cards behind are redrawn when it closes
        let splitChangedInViewer = false;
        L.entries.handlers.onSplit = (value) => { setSplit(value); splitChangedInViewer = true; };
        L.entries.handlers.onViewerClose = () => {
            if (splitChangedInViewer && S.results.length) renderResults();
            splitChangedInViewer = false;
        };
        $('rbSearch').addEventListener('input', renderRulebookTab);
        $('aboutLink').addEventListener('click', (e) => { e.preventDefault(); switchTab(S.tab === 'about' ? lastTab : 'about'); });
        // on a phone the links of the hero's corner (Report / Suggestion, About) live in the footer instead
        const narrow = window.matchMedia('(max-width: 860px)');
        const placeLinks = () => {
            if (narrow.matches) $('footerLinks').appendChild($('heroLinks'));
            else $('hero').insertBefore($('heroLinks'), $('hero').firstChild);
        };
        placeLinks();
        if (narrow.addEventListener) narrow.addEventListener('change', placeLinks);
        document.querySelectorAll('.tab').forEach((b) => {
            b.addEventListener('click', () => switchTab(b.dataset.tab));
            b.addEventListener('keydown', (e) => {
                const i = TABS.indexOf(b.dataset.tab);
                const to = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
                if (to < 0) return;
                e.preventDefault();
                switchTab(TABS[to]);
                $('tab-' + TABS[to]).focus();
            });
        });
        window.addEventListener('hashchange', () => { ST.load(); applyStateToUI(); loadRulebook(); evolveNow(); });
        I.onChange(() => {
            renderShelf();
            renderSetPanel();
            renderExamples();
            renderRulebookTab();
            renderResults();
            updateWordCount(ST.parseWords($('words').value).length);
            L.editor.refresh();
            if (S.tab === 'about') renderAbout();
        });
        L.entries.handlers.onRule = goToRule;
        L.entries.handlers.onUsedChange = (set) => L.rulebook.mark($('rbBody'), set);
        L.editor.hooks.setLabel = setLabel;
        L.editor.hooks.onDraftChange = renderShelf;
        L.editor.hooks.onRun = () => {
            S.setId = 'mine';
            S.results = [];
            S.selected = {};
        S.collapsed = {};
        S.chainFolded = {};
            ST.save();
            renderShelf();
            renderSetPanel();
            renderExamples();
            loadRulebook();
            switchTab('evolve');
            evolveNow();
        };
    }

    async function init() {
        ST.load();
        try {
            await I.load();
        } catch (e) {
            document.getElementById('status').textContent = 'Could not load the page texts. Please reload.';
            return;
        }
        I.apply();
        I.renderToggle($('langToggle'));
        $('footerYear').textContent = new Date().getFullYear();
        L.editor.init();
        bind();
        applyStateToUI();
        loadRulebook();
        evolveNow();
        L.hero.start();
    }

    init();
})();
