/* The page's state, what is remembered between visits (localStorage) and what goes in a share link
   (the URL hash). Your own rules ("mine") are kept only in this browser, never in the link. */
(function () {
    'use strict';
    const L = (window.Letra = window.Letra || {});

    const PRESETS = ['sample', 'LA_ES', 'ES_IPA'];
    const KEY = 'letra.v2';
    const MINE_KEY = 'letra.mine';
    const MINE_NAME_KEY = 'letra.mineName';
    const MAX_WORDS = 100;
    const MAX_RULES_BYTES = 256 * 1024;

    const EXAMPLES = {
        sample: ['lítteram'],
        LA_ES: ['lítteram', 'trophaéum', 'óperam', 'dóminum', 'quinquagínta', 'dígitum'],
        ES_IPA: ['civilización', 'chascarrillo', 'halagüeño', 'verdad', 'rejuvenecer', 'water'],
        mine: [],
    };

    const s = {
        tab: 'evolve',                // evolve | rulebook | editor | about
        setId: 'sample',              // a preset id, or 'mine'
        words: 'lítteram',            // the textarea's text
        matchCase: false,
        view: 'cards',                // cards | table
        deriv: 'chain',               // chain | tree
        mine: '',                     // the user's rules text (editor draft)
        mineName: 'my-rules.json',
        results: [],                  // one entry per word, as returned by the server
        truncated: false,
        selected: {},                 // word -> the form whose derivation is shown
        error: '',                    // error code of the last request
        loading: false,
    };

    function store(name, value) { try { localStorage.setItem(name, value); } catch (e) { /* storage blocked or full */ } }
    function stored(name) { try { return localStorage.getItem(name); } catch (e) { return null; } }

    function load() {
        try {
            const saved = JSON.parse(stored(KEY) || '{}');
            ['setId', 'words', 'matchCase', 'view', 'deriv'].forEach((k) => { if (k in saved) s[k] = saved[k]; });
        } catch (e) { /* ignore a damaged value */ }
        s.mine = stored(MINE_KEY) || '';
        s.mineName = stored(MINE_NAME_KEY) || s.mineName;
        const q = new URLSearchParams(location.hash.slice(1));      // a share link wins over what was remembered
        if (q.has('r')) s.setId = q.get('r');
        if (q.has('w')) s.words = q.get('w');
        if (q.get('v') === 'table' || q.get('v') === 'cards') s.view = q.get('v');
        if (q.get('d') === 'tree' || q.get('d') === 'chain') s.deriv = q.get('d');
        if (q.get('mc') === '1') s.matchCase = true;
        if (q.has('t') && ['evolve', 'rulebook', 'editor', 'about'].includes(q.get('t'))) s.tab = q.get('t');
        if (s.setId !== 'mine' && !PRESETS.includes(s.setId)) s.setId = 'sample';
        if (s.setId === 'mine' && !s.mine.trim()) s.setId = 'sample';
    }

    function save() {
        store(KEY, JSON.stringify({ setId: s.setId, words: s.words, matchCase: s.matchCase, view: s.view, deriv: s.deriv }));
    }

    function saveMine() {
        store(MINE_KEY, s.mine);
        store(MINE_NAME_KEY, s.mineName);
    }

    function writeHash() {
        const q = new URLSearchParams();
        q.set('r', s.setId);
        if (s.words.trim()) q.set('w', s.words);
        if (s.view !== 'cards') q.set('v', s.view);
        if (s.deriv !== 'chain') q.set('d', s.deriv);
        if (s.matchCase) q.set('mc', '1');
        if (s.tab !== 'evolve') q.set('t', s.tab);
        try { history.replaceState(null, '', '#' + q.toString()); } catch (e) { /* ignore */ }
    }

    /* Words from the textarea: one per line, or separated by commas or semicolons; no duplicates. */
    function parseWords(text) {
        const seen = new Set();
        const out = [];
        text.split(/[\n\r,;\t]+/).forEach((w) => {
            w = w.trim();
            if (w && !seen.has(w)) { seen.add(w); out.push(w); }
        });
        return out;
    }

    /* The rule set to send to the server, or null when "mine" has no rules yet. */
    function currentSet() {
        if (s.setId === 'mine') return s.mine.trim() ? { id: 'mine', rules: s.mine } : null;
        return { id: s.setId, preset: s.setId };
    }

    L.state = { s, PRESETS, EXAMPLES, MAX_WORDS, MAX_RULES_BYTES, load, save, saveMine, writeHash, parseWords, currentSet };
})();
