/* A full-screen viewer for a word's tree: zoom with the wheel (as in a map: the page does not scroll) or by
   pinching, move by dragging, zoom buttons and keys. The tree inside stays interactive: a click chooses a final
   form, hovering (or tapping) a rule shows its change. A drag never counts as a click. */
(function () {
    'use strict';
    const L = (window.Letra = window.Letra || {});
    const I = L.i18n;
    const MAX_ZOOM = 6;
    const PAD = 28;               // px kept free around the tree when it is fitted
    const DRAG_FROM = 6;          // px the pointer must move before it counts as a drag
    let current = null;

    const el = (tag, cls, text) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    };
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    function icon(paths) {
        const NS = 'http://www.w3.org/2000/svg';
        const s = document.createElementNS(NS, 'svg');
        s.setAttribute('viewBox', '0 0 24 24');
        s.setAttribute('aria-hidden', 'true');
        paths.forEach((d) => { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p); });
        return s;
    }
    const ICONS = {
        max: ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'],
        fit: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M16 21h3a2 2 0 0 0 2-2v-3', 'M3 16v3a2 2 0 0 0 2 2h3'],
        close: ['M18 6 6 18', 'm6 6 12 12'],
        plus: ['M5 12h14', 'M12 5v14'],
        minus: ['M5 12h14'],
    };

    function button(cls, iconName, label) {
        const b = el('button', 'icon-btn ' + cls);
        b.type = 'button';
        b.appendChild(icon(ICONS[iconName]));
        b.setAttribute('aria-label', label);
        b.setAttribute('data-tip', label);
        return b;
    }

    /* opts: {title, orient, draw(box, orient) -> {choose, size: {w, h}}, returnFocus} */
    function open(opts) {
        if (current) return;
        let orient = opts.orient === 'h' ? 'h' : 'v';
        let handle = null;
        let size = { w: 1, h: 1 };
        let k = 1;
        let tx = 0;
        let ty = 0;
        let minK = 0.1;

        const overlay = el('div', 'viewer');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', opts.title + ' · ' + I.t('tree_title'));

        const bar = el('div', 'viewer-bar');
        bar.appendChild(el('span', 'viewer-title', opts.title));
        const seg = el('div', 'seg');
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', I.t('tree_view'));
        const segBtns = ['v', 'h'].map((v) => {
            const b = el('button', '', I.t(v === 'v' ? 'tree_vertical' : 'tree_horizontal'));
            b.type = 'button';
            b.addEventListener('click', () => { if (orient !== v) { orient = v; draw(); } });
            seg.appendChild(b);
            return b;
        });
        bar.appendChild(seg);
        bar.appendChild(el('span', 'grow'));
        const zoomOut = button('', 'minus', I.t('viewer_zoom_out'));
        const zoomIn = button('', 'plus', I.t('viewer_zoom_in'));
        const fitBtn = button('', 'fit', I.t('viewer_fit'));
        const closeBtn = button('close', 'close', I.t('viewer_close'));
        [zoomOut, zoomIn, fitBtn, closeBtn].forEach((b) => bar.appendChild(b));
        overlay.appendChild(bar);

        const stage = el('div', 'viewer-stage');
        const canvas = el('div', 'viewer-canvas');
        stage.appendChild(canvas);
        overlay.appendChild(stage);
        overlay.appendChild(el('p', 'viewer-hint', I.t('viewer_hint')));

        const apply = () => { canvas.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + k + ')'; };
        const stageBox = () => stage.getBoundingClientRect();

        function fit() {
            const r = stageBox();
            k = Math.min((r.width - 2 * PAD) / size.w, (r.height - 2 * PAD) / size.h, 1);
            minK = Math.min(0.1, k * 0.8);
            k = clamp(k, minK, MAX_ZOOM);
            tx = (r.width - size.w * k) / 2;
            ty = (r.height - size.h * k) / 2;
            apply();
        }

        function zoomAt(factor, cx, cy) {
            const next = clamp(k * factor, minK, MAX_ZOOM);
            tx = cx - (cx - tx) * (next / k);
            ty = cy - (cy - ty) * (next / k);
            k = next;
            apply();
            L.tooltip && L.tooltip.hide();
        }
        const zoomCentre = (factor) => { const r = stageBox(); zoomAt(factor, r.width / 2, r.height / 2); };

        function draw() {
            canvas.textContent = '';
            handle = opts.draw(canvas, orient);
            size = handle.size;
            segBtns.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0 ? 'v' : 'h') === orient)));
            fit();
        }

        // ---- wheel: zoom, as in a map; the page behind never scrolls ----
        stage.addEventListener('wheel', (e) => {
            e.preventDefault();
            const r = stageBox();
            const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
            zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top);        // ctrl: a trackpad pinch
        }, { passive: false });
        ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => stage.addEventListener(t, (e) => e.preventDefault()));          // Safari's own page zoom

        // ---- pointers: one moves the tree, two pinch ----
        const pointers = new Map();
        let dragging = false;
        let start = null;
        let moved = false;                          // a drag or a pinch happened: the click that follows is swallowed
        let pinch = null;
        const mid = () => { const [a, b] = [...pointers.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };

        stage.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            start = { x: e.clientX, y: e.clientY };
            if (pointers.size === 2) { pinch = mid(); moved = true; dragging = false; L.tooltip && L.tooltip.hide(); }
        });
        stage.addEventListener('pointermove', (e) => {
            const p = pointers.get(e.pointerId);
            if (!p) return;
            const dx = e.clientX - p.x;
            const dy = e.clientY - p.y;
            p.x = e.clientX;
            p.y = e.clientY;
            if (pointers.size >= 2) {
                const now = mid();
                const r = stageBox();
                if (pinch && pinch.d > 0) zoomAt(now.d / pinch.d, now.x - r.left, now.y - r.top);
                tx += now.x - pinch.x;
                ty += now.y - pinch.y;
                apply();
                pinch = now;
                return;
            }
            if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_FROM) {
                dragging = true;
                moved = true;
                stage.classList.add('dragging');
                try { stage.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ }
                L.tooltip && L.tooltip.hide();
            }
            if (dragging) { tx += dx; ty += dy; apply(); }
        });
        const release = (e) => {
            pointers.delete(e.pointerId);
            if (pointers.size < 2) pinch = null;
            if (pointers.size === 1) { const rest = [...pointers.values()][0]; start = { x: rest.x, y: rest.y }; dragging = false; }
            if (!pointers.size) { dragging = false; stage.classList.remove('dragging'); setTimeout(() => { moved = false; }, 60); }
        };
        stage.addEventListener('pointerup', release);
        stage.addEventListener('pointercancel', release);
        stage.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); } }, true);

        // ---- keys and buttons ----
        zoomIn.addEventListener('click', () => zoomCentre(1.3));
        zoomOut.addEventListener('click', () => zoomCentre(1 / 1.3));
        fitBtn.addEventListener('click', fit);
        closeBtn.addEventListener('click', close);
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(); return; }
            if (e.key === 'Tab') {                  // keep the focus inside the viewer
                const items = [...overlay.querySelectorAll('button, [tabindex="0"]')].filter((n) => n.getAttribute('tabindex') !== '-1');
                if (!items.length) return;
                const first = items[0];
                const last = items[items.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
                else if (!overlay.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
                return;
            }
            if (e.target && e.target.closest && e.target.closest('.tree-node')) return;       // Enter / Space on a form choose it
            const step = 60;
            if (e.key === '+' || e.key === '=') zoomCentre(1.3);
            else if (e.key === '-' || e.key === '_') zoomCentre(1 / 1.3);
            else if (e.key === '0') fit();
            else if (e.key === 'ArrowLeft') { tx += step; apply(); }
            else if (e.key === 'ArrowRight') { tx -= step; apply(); }
            else if (e.key === 'ArrowUp') { ty += step; apply(); }
            else if (e.key === 'ArrowDown') { ty -= step; apply(); }
        };
        document.addEventListener('keydown', onKey);
        const onResize = () => fit();
        window.addEventListener('resize', onResize);

        function close() {
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', onResize);
            overlay.remove();
            document.documentElement.classList.remove('viewer-open');
            L.tooltip && L.tooltip.hide();
            current = null;
            if (opts.returnFocus && document.contains(opts.returnFocus)) opts.returnFocus.focus();
        }

        document.body.appendChild(overlay);
        document.documentElement.classList.add('viewer-open');
        draw();
        closeBtn.focus();
        current = { close, choose: (f) => handle && handle.choose(f) };
    }

    L.viewer = { open, icon, ICONS, isOpen: () => !!current };
})();
