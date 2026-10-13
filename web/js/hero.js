/* The banner's "evolving word": the derivation of lítteram (from the server, with a built-in fallback)
   plays form by form, with the rule that caused each change. It is the app's signature, so it uses
   the real engine. With reduced motion it is a still line. */
(function () {
    'use strict';
    const L = (window.Letra = window.Letra || {});

    const FALLBACK = {
        forms: ['lítteram', 'líttera', 'lítera', 'lítra', 'létra'],
        rules: ['remove_m', 'simplify_double', 'remove_unstressed', 'vowel_shift'],
    };
    const STEP_MS = 1700;
    const PAUSE_MS = 2600;

    let timer = null;
    let settle = null;
    let data = FALLBACK;
    let i = 0;
    let els = null;

    const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mk = (tag, cls, text) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    };

    function renderTrail(upTo) {
        els.trail.textContent = '';
        data.forms.forEach((f, n) => {
            if (n) els.trail.appendChild(mk('span', 'sep', '›'));
            els.trail.appendChild(mk('span', 'tf' + (n < upTo ? ' done' : n === upTo ? ' cur' : ''), f));
        });
    }

    function show(n, animate) {
        i = n;
        const cur = data.forms[n];
        clearTimeout(settle);
        els.form.textContent = '';
        if (animate && n > 0) {
            const d = L.entries.diff(data.forms[n - 1], cur);
            els.form.appendChild(document.createTextNode(d.pre));
            const mid = mk('span', 'mid');
            mid.appendChild(mk('span', 'out', d.aMid));
            mid.appendChild(mk('span', 'in', d.bMid));
            els.form.appendChild(mid);
            els.form.appendChild(document.createTextNode(d.post));
            settle = setTimeout(() => { if (i === n) els.form.textContent = cur; }, 1100);      // drop the cross-fade's leftover width
        } else {
            els.form.textContent = cur;
        }
        els.rule.textContent = n > 0 ? '↓ ' + data.rules[n - 1] : '';
        els.rule.classList.remove('pop');
        if (n > 0) { void els.rule.offsetWidth; els.rule.classList.add('pop'); }       // restart the CSS animation
        renderTrail(n);
    }

    function tick() {
        if (document.hidden) { timer = setTimeout(tick, STEP_MS); return; }
        if (i + 1 < data.forms.length) {
            show(i + 1, true);
            timer = setTimeout(tick, i + 1 === data.forms.length - 1 ? PAUSE_MS : STEP_MS);
        } else {
            show(0, false);
            timer = setTimeout(tick, STEP_MS);
        }
    }

    async function start() {
        els = { form: document.getElementById('stripForm'), rule: document.getElementById('stripRule'), trail: document.getElementById('stripTrail') };
        try {
            const res = await L.api.transform({ preset: 'sample' }, ['lítteram'], false);
            const r = res.ok && res.data && res.data.results && res.data.results[0];
            if (r && !r.error && r.final.length) {
                const steps = L.entries.chainFor(r, r.final[0]);
                if (steps.length) {
                    data = { forms: [r.start].concat(steps.map((st) => st.to)).map((f) => f.trim()), rules: steps.map((st) => st.rule) };
                }
            }
        } catch (e) { /* the built-in derivation is used */ }
        if (reduced()) {
            show(data.forms.length - 1, false);
            els.rule.textContent = '';
            return;
        }
        show(0, false);
        timer = setTimeout(tick, 1200);
    }

    L.hero = { start };
})();
