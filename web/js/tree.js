/* The branching tree of a word: every form as a node, every change as an edge labelled with its rule.
   A form reached from two different parents is ONE node with two incoming edges (the chain view only
   shows the first path). Columns are derivation depth: the longest path from the start. */
(function () {
    'use strict';
    const L = (window.Letra = window.Letra || {});
    const I = L.i18n;
    const NS = 'http://www.w3.org/2000/svg';
    const MAX_NODES = 300;
    const NODE_H = 32;
    const ROW = 46;
    const PAD_X = 14;
    const MARGIN = 18;
    let uid = 0;

    function svg(tag, attrs, text) {
        const e = document.createElementNS(NS, tag);
        Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k]));
        if (text !== undefined) e.textContent = text;
        return e;
    }

    const measureCtx = document.createElement('canvas').getContext('2d');
    function width(text, font) {
        measureCtx.font = font;
        return measureCtx.measureText(text).width;
    }

    /* Nodes, merged edges and depths of the derivation graph of a result. */
    function graph(r) {
        const nodes = new Set([r.start]);
        const merged = new Map();               // "from\0to" -> {from, to, rules: [...], step}
        r.edges.forEach((e) => {
            nodes.add(e[2]);
            nodes.add(e[3]);
            const key = e[2] + '\u0000' + e[3];
            if (!merged.has(key)) merged.set(key, { from: e[2], to: e[3], rules: [], step: e[0] });
            const m = merged.get(key);
            if (!m.rules.includes(e[1])) m.rules.push(e[1]);
        });
        const edges = Array.from(merged.values());
        const depth = new Map([[r.start, 0]]);
        for (let pass = 0, changed = true; changed && pass <= nodes.size; pass++) {   // longest path; it is a DAG, so it settles
            changed = false;
            edges.forEach((e) => {
                const d = (depth.get(e.from) || 0) + 1;
                if (d > (depth.get(e.to) || 0)) { depth.set(e.to, d); changed = true; }
            });
        }
        const parents = new Map();
        edges.forEach((e) => {
            if (!parents.has(e.to)) parents.set(e.to, new Set());
            parents.get(e.to).add(e.from);
        });
        return { nodes, edges, depth, parents };
    }

    const fits = (r) => graph(r).nodes.size <= MAX_NODES;

    /* Orders the nodes of each column to keep the edges from crossing (barycentre sweeps). */
    function layoutOrder(g, cols) {
        const index = new Map();
        const reindex = () => cols.forEach((col) => col.forEach((n, i) => index.set(n, i)));
        reindex();
        const children = new Map();
        g.edges.forEach((e) => {
            if (!children.has(e.from)) children.set(e.from, []);
            children.get(e.from).push(e.to);
        });
        const avg = (list) => list.reduce((s, n) => s + index.get(n), 0) / list.length;
        for (let sweep = 0; sweep < 3; sweep++) {
            for (let d = 1; d < cols.length; d++) {
                cols[d].sort((a, b) => avg(Array.from(g.parents.get(a) || [a])) - avg(Array.from(g.parents.get(b) || [b])));
                reindex();
            }
            for (let d = cols.length - 2; d >= 0; d--) {
                cols[d].sort((a, b) => (children.has(a) ? avg(children.get(a)) : index.get(a)) - (children.has(b) ? avg(children.get(b)) : index.get(b)));
                reindex();
            }
        }
    }

    function ancestors(g, node) {
        const seen = new Set([node]);
        const stack = [node];
        while (stack.length) {
            const n = stack.pop();
            (g.parents.get(n) || []).forEach((p) => { if (!seen.has(p)) { seen.add(p); stack.push(p); } });
        }
        return seen;
    }

    /* Draws the tree of `r` into `box`; `form` is the chosen final form, `onSelect(form)` is called for a click. */
    function render(box, r, form, onSelect) {
        const g = graph(r);
        if (g.nodes.size > MAX_NODES) { box.appendChild(Object.assign(document.createElement('p'), { className: 'dim', textContent: I.t('tree_too_big') })); return; }
        const id = 'tr' + (++uid);
        const finals = new Set(r.final);

        const maxDepth = Math.max(...Array.from(g.nodes).map((n) => g.depth.get(n) || 0));
        const cols = Array.from({ length: maxDepth + 1 }, () => []);
        const seen = new Set();
        [r.start].concat(r.edges.flatMap((e) => [e[2], e[3]])).forEach((n) => {     // first-seen order as the starting point
            if (!seen.has(n)) { seen.add(n); cols[g.depth.get(n) || 0].push(n); }
        });
        layoutOrder(g, cols);

        const label = (n) => (n === r.start ? L.entries.show(n) : L.entries.plain(n));
        const nodeW = new Map();
        g.nodes.forEach((n) => nodeW.set(n, Math.max(46, width(label(n), '17px Gentium, serif') + 2 * PAD_X)));
        const colW = cols.map((c) => Math.max(0, ...c.map((n) => nodeW.get(n))));
        const gapBefore = cols.map((c, d) => {
            if (d === 0) return 0;
            const longest = Math.max(0, ...g.edges.filter((e) => g.depth.get(e.to) === d).map((e) => width(e.rules.join(' | '), '12px sans-serif')));
            return Math.max(96, longest + 50);
        });
        const colX = [];
        let x = MARGIN;
        cols.forEach((c, d) => { x += gapBefore[d]; colX[d] = x; x += colW[d]; });
        const totalW = x + MARGIN;
        const maxRows = Math.max(...cols.map((c) => c.length));
        const totalH = maxRows * ROW + 2 * MARGIN;

        const pos = new Map();                  // node -> {x, y, w}
        cols.forEach((c, d) => c.forEach((n, i) => {
            const y = MARGIN + ((maxRows - c.length) * ROW) / 2 + i * ROW + ROW / 2;
            pos.set(n, { x: colX[d], y, w: nodeW.get(n) });
        }));

        const root = svg('svg', { width: totalW, height: totalH, viewBox: '0 0 ' + totalW + ' ' + totalH, role: 'group', 'aria-label': I.fmt('tree_label', { word: r.term }) });
        const defs = svg('defs');
        const marker = svg('marker', { id: id + 'a', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
        marker.appendChild(svg('path', { d: 'M0 0 L10 5 L0 10 z', class: 'tree-arrow' }));
        defs.appendChild(marker);
        root.appendChild(defs);

        const edgeEls = [];
        const edgeLayer = svg('g', { class: 'tree-edges' });
        g.edges.forEach((e) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            const x1 = a.x + a.w;
            const x2 = b.x;
            const dx = Math.max(24, (x2 - x1) / 2);
            const grp = svg('g', { class: 'tree-edge' });
            grp.appendChild(svg('path', { d: 'M' + x1 + ' ' + a.y + ' C' + (x1 + dx) + ' ' + a.y + ' ' + (x2 - dx) + ' ' + b.y + ' ' + x2 + ' ' + b.y, 'marker-end': 'url(#' + id + 'a)' }));
            grp.appendChild(svg('text', { x: (x1 + x2) / 2, y: (a.y + b.y) / 2 - 5, 'text-anchor': 'middle', class: 'tree-rule' }, e.rules.join(' | ')));
            edgeLayer.appendChild(grp);
            edgeEls.push({ e, grp });
        });
        root.appendChild(edgeLayer);

        const nodeEls = new Map();
        const nodeLayer = svg('g', { class: 'tree-nodes' });
        g.nodes.forEach((n) => {
            const p = pos.get(n);
            const kind = n === r.start ? 'start' : finals.has(n) ? 'final' : 'mid';
            const grp = svg('g', { class: 'tree-node ' + kind, transform: 'translate(' + p.x + ' ' + (p.y - NODE_H / 2) + ')' });
            grp.appendChild(svg('rect', { width: p.w, height: NODE_H, rx: 8 }));
            grp.appendChild(svg('text', { x: p.w / 2, y: NODE_H / 2 + 5.5, 'text-anchor': 'middle' }, label(n)));
            if (kind === 'final') {
                grp.setAttribute('tabindex', '0');
                grp.setAttribute('role', 'button');
                grp.setAttribute('aria-label', label(n));
                grp.addEventListener('click', () => onSelect(n));
                grp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(n); } });
            }
            nodeEls.set(n, grp);
            nodeLayer.appendChild(grp);
        });
        root.appendChild(nodeLayer);

        const highlight = (target) => {
            const on = target ? ancestors(g, target) : new Set();
            nodeEls.forEach((grp, n) => grp.classList.toggle('on', on.has(n)));
            edgeEls.forEach(({ e, grp }) => grp.classList.toggle('on', on.has(e.from) && on.has(e.to)));
            root.classList.toggle('has-path', on.size > 0);
        };
        nodeEls.forEach((grp, n) => {
            grp.addEventListener('mouseenter', () => highlight(n));
            grp.addEventListener('focus', () => highlight(n));
            grp.addEventListener('mouseleave', () => highlight(form));
            grp.addEventListener('blur', () => highlight(form));
        });
        highlight(form);
        nodeEls.get(form) && nodeEls.get(form).classList.add('chosen');

        const scroll = document.createElement('div');
        scroll.className = 'tree-scroll';
        scroll.appendChild(root);
        const legend = document.createElement('p');
        legend.className = 'tree-legend';
        legend.textContent = I.t('tree_hint');
        box.appendChild(scroll);
        box.appendChild(legend);
        const chosen = pos.get(form);                       // bring the chosen form into view (once the box is on the page)
        if (chosen) requestAnimationFrame(() => { scroll.scrollLeft = Math.max(0, chosen.x + chosen.w / 2 - scroll.clientWidth / 2); });
    }

    L.tree = { render, fits, graph, MAX_NODES };
})();
