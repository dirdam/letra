/* A styled tooltip in place of the browser's own `title` bubble: it appears at once beside the element,
   fades in, stays inside the window and also shows on keyboard focus. Any element with a `title`
   (set by any script, at any time) is picked up: the text moves to `data-tip` the first time it is shown. */
(function () {
    'use strict';
    const L = (window.Letra = window.Letra || {});
    const GAP = 8;            // px between the element and the bubble
    const DELAY = 120;        // ms before it appears on hover

    let tip = null;
    let target = null;
    let timer = null;

    function ensure() {
        if (tip) return tip;
        tip = document.createElement('div');
        tip.id = 'tip';
        tip.className = 'tip';
        tip.setAttribute('role', 'tooltip');
        document.body.appendChild(tip);
        return tip;
    }

    function textOf(el) {
        if (el.hasAttribute('title')) {
            const t = el.getAttribute('title');
            el.removeAttribute('title');                 // otherwise the browser's bubble shows as well
            if (t) el.setAttribute('data-tip', t);
        }
        return el.getAttribute('data-tip') || '';
    }

    function place() {
        const r = target.getBoundingClientRect();
        const w = tip.offsetWidth;
        const h = tip.offsetHeight;
        const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
        const above = r.top - h - GAP >= 8;
        tip.style.left = left + 'px';
        tip.style.top = (above ? r.top - h - GAP : r.bottom + GAP) + 'px';
        tip.classList.toggle('below', !above);
        tip.style.setProperty('--arrow-x', Math.max(10, Math.min(w - 10, r.left + r.width / 2 - left)) + 'px');
    }

    function show(el, immediate) {
        clearTimeout(timer);
        const open = () => {
            const text = textOf(el);
            if (!text) return;
            ensure().textContent = text;
            target = el;
            el.setAttribute('aria-describedby', 'tip');
            tip.classList.add('show');
            place();
        };
        if (immediate || (tip && tip.classList.contains('show'))) open();
        else timer = setTimeout(open, DELAY);
    }

    function hide() {
        clearTimeout(timer);
        if (target) target.removeAttribute('aria-describedby');
        target = null;
        if (tip) tip.classList.remove('show');
    }

    function owner(node) {
        return node && node.closest ? node.closest('[title], [data-tip]') : null;
    }

    document.addEventListener('mouseover', (e) => {
        const el = owner(e.target);
        if (!el) return;
        if (el.hasAttribute('title')) textOf(el);        // take the text before the browser shows its bubble
        if (el !== target) show(el, false);
    });
    document.addEventListener('mouseout', (e) => {
        const el = owner(e.target);
        if (el && el === target && !el.contains(e.relatedTarget)) hide();
        else if (!target) clearTimeout(timer);
    });
    document.addEventListener('focusin', (e) => { const el = owner(e.target); if (el) show(el, true); });
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);

    L.tooltip = { hide };
})();
