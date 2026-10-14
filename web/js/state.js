/* The page's state, what is remembered between visits (localStorage) and what goes in a share link
   (the URL hash). Your own rules ("mine") are kept only in this browser, never in the link. */
(function () {
    'use strict';
    const L = (window.Letra = window.Letra || {});

    const PRESETS = ['sample', 'LA_ES', 'ES_IPA'];
    const KEY = 'letra.v2';
    const MINE_KEY = 'letra.mine';
    const MINE_NAME_KEY = 'letra.mineName';
    const BOUNDARY = '␣';                  // how the word boundary (a space at either end of a form or pattern) is shown
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
        mine: '',                     // the user's rules text (editor draft)
        mineName: 'my-rules.json',
        results: [],                  // one entry per word, as returned by the server
        truncated: false,
        selected: {},                 // word -> the form whose derivation is shown
        collapsed: {},                // word -> true when its card is folded up
        error: '',                    // error code of the last request
        loading: false,
    };

    function store(name, value) { try { localStorage.setItem(name, value); } catch (e) { /* storage blocked or full */ } }
    function stored(name) { try { return localStorage.getItem(name); } catch (e) { return null; } }

    function load() {
        try {
            const saved = JSON.parse(stored(KEY) || '{}');
            ['setId', 'words'].forEach((k) => { if (k in saved) s[k] = saved[k]; });
        } catch (e) { /* ignore a damaged value */ }
        s.mine = stored(MINE_KEY) || '';
        s.mineName = stored(MINE_NAME_KEY) || s.mineName;
        const q = new URLSearchParams(location.hash.slice(1));      // a share link wins over what was remembered
        if (q.has('r')) s.setId = q.get('r');
        if (q.has('w')) s.words = q.get('w');
        if (q.has('t') && ['evolve', 'rulebook', 'editor', 'about'].includes(q.get('t'))) s.tab = q.get('t');
        s.words = String(s.words).replace(/\s+/g, ' ').trim();        // one line; spaces separate the words
        if (s.setId !== 'mine' && !PRESETS.includes(s.setId)) s.setId = 'sample';
        if (s.setId === 'mine' && !s.mine.trim()) s.setId = 'sample';
    }

    function save() {
        store(KEY, JSON.stringify({ setId: s.setId, words: s.words }));
    }

    function saveMine() {
        store(MINE_KEY, s.mine);
        store(MINE_NAME_KEY, s.mineName);
    }

    function writeHash() {
        const q = new URLSearchParams();
        q.set('r', s.setId);
        if (s.words.trim()) q.set('w', s.words);
        if (s.tab !== 'evolve') q.set('t', s.tab);
        try { history.replaceState(null, '', '#' + q.toString()); } catch (e) { /* ignore */ }
    }

    /* Words from the search bar: separated by spaces (also commas, semicolons, line breaks); no duplicates. */
    function parseWords(text) {
        const seen = new Set();
        const out = [];
        text.split(/[\s,;]+/).forEach((w) => {
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

    L.state = { s, PRESETS, EXAMPLES, BOUNDARY, MAX_WORDS, MAX_RULES_BYTES, load, save, saveMine, writeHash, parseWords, currentSet };
})();
