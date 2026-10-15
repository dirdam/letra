"""LETRA web server: a small Flask API and page around the Transformer engine.

Run locally:   python server.py            (http://127.0.0.1:8506/)
On the server: gunicorn -w 2 -b 127.0.0.1:8506 --timeout 10 --no-control-socket server:app

The page and the API use relative URLs, so the app works the same at "/" and
behind nginx under "/letra/".
"""
import csv
import hashlib
import json
import os
import re
import textwrap
import time
import unicodedata

import markdown
from flask import Flask, jsonify, request, send_from_directory

from src import description, letra, marks, validate

BASE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(BASE, 'web')
DATA = os.path.join(BASE, 'data')
TRANSFORMATIONS = os.path.join(BASE, 'transformations')

LANGS = ('en', 'es')

# Rule files bundled with the app, as offered in the page: id -> file name.
PRESETS = {'sample': 'sample.json', 'LA_ES': 'LA_ES.json', 'ES_IPA': 'ES_IPA.json'}

# Limits, because user-supplied rules are compiled to regular expressions here.
MAX_BODY_BYTES = 256 * 1024     # request body (an uploaded rules file is inside it)
MAX_TERM_CHARS = 64
MAX_WORDS = 100                 # words in one request
TIME_BUDGET = 6.0               # seconds spent on words in one request (gunicorn stops a worker at 10)
MAX_RULE_ITEMS = validate.MAX_ITEMS
MAX_GROUP_VALUES = validate.MAX_GROUP_VALUES
GROUP_MEMBERS_SHOWN = 200       # members listed per group in the rule book

app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = MAX_BODY_BYTES


# ---------- texts ----------

def _html(text):
    """Markdown to HTML; a single paragraph is returned without its <p> wrapper."""
    out = markdown.markdown(textwrap.dedent(text).strip(), extensions=['sane_lists'])
    m = re.fullmatch(r'<p>(.*)</p>', out, re.S)
    return m.group(1) if m and '<p>' not in m.group(1) else out


def _load_strings():
    raw = {lang: {} for lang in LANGS}
    with open(os.path.join(DATA, 'localizations.csv'), encoding='utf-8', newline='') as f:
        for row in csv.DictReader(f):
            raw[row['lang']][row['key']] = row['value']
    html = {lang: {k: (_html(v) if v.strip() else '') for k, v in d.items()} for lang, d in raw.items()}
    return {'raw': raw, 'html': html}


def _load_about():
    out = {}
    for lang in LANGS:
        with open(os.path.join(DATA, f'LETRA_{lang}.md'), encoding='utf-8') as f:
            out[lang] = markdown.markdown(f.read(), extensions=['sane_lists', 'tables', 'fenced_code'])
    return out


STRINGS = _load_strings()
ABOUT = _load_about()


# ---------- rules ----------

class RulesError(Exception):
    """A problem with the rules file; `code` maps to an `err_<code>` text in the page."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _normalize(text):
    """Unicode NFC: "é" typed as one character or as e + combining accent must mean the same."""
    return unicodedata.normalize('NFC', text)


def _check_rules_text(text):
    """Cheap structural checks on a user-supplied rules file, before the engine compiles it."""
    try:
        data = json.loads(re.sub(r'(?://[^\n]*)', '', text))  # same comment stripping as the engine
    except ValueError:
        raise RulesError('invalid_json')
    if not isinstance(data, dict) or any(k not in data for k in ('groups', 'rules', 'order')):
        raise RulesError('missing_sections')
    if not (isinstance(data['groups'], dict) and isinstance(data['rules'], dict) and isinstance(data['order'], list)):
        raise RulesError('invalid_rules')
    if any(len(data[k]) > MAX_RULE_ITEMS for k in ('groups', 'rules', 'order')):
        raise RulesError('too_large')
    if not all(isinstance(v, list) and all(isinstance(x, str) for x in v) for v in data['groups'].values()):
        raise RulesError('invalid_rules')
    if not all(isinstance(v, dict) and all(isinstance(a, str) and isinstance(b, str) for a, b in v.items())
               for v in data['rules'].values()):
        raise RulesError('invalid_rules')
    if not all(isinstance(x, str) for x in data['order']):
        raise RulesError('invalid_rules')
    # groups can reference other groups: refuse sets that would expand to billions of values
    if any(size > MAX_GROUP_VALUES for size in validate.group_sizes(data['groups']).values()):
        raise RulesError('too_large')


def _build(preset=None, rules_text=None):
    """The compiled Transformer for a bundled preset or for the user's rules text."""
    if preset is not None:
        return letra.Transformer(json_path=PRESETS[preset])
    rules_text = _normalize(rules_text)
    _check_rules_text(rules_text)
    try:
        return letra.Transformer(rules_text)
    except Exception:
        raise RulesError('invalid_rules')


def _pieces(t, edge):
    """The pieces of the word the edge's rule replaced, as [[was, now], ...] (see src/marks.py); None if they do not add up to the engine's result."""
    cut = marks.pieces(t.json_dict['rules'][edge['rule']], edge['from'])
    return cut if ''.join(now for _, now in cut) == edge['to'] else None


def _apply(t, term):
    """Transform one word with an already compiled Transformer."""
    try:
        final = t.transform(term, verbose=False)
    except Exception:
        raise RulesError('invalid_rules')

    original_rules = t.json_dict_original.get('rules', {})
    terms = {}
    for name, info in t.transformations.items():
        rule = info['rule']
        rule_text = ' & '.join(f'"{k}" → "{v}"' for k, v in original_rules.get(rule, {}).items()) if rule else ''
        terms[name] = {'mother': info['mother'], 'rule': rule, 'rule_text': rule_text}
    return {
        'term': term,
        'start': f' {term} ',
        'final': final,
        'all': list(t.transformations),
        'terms': terms,
        # every change applied, as [step, rule, from, to, entries, pieces]: unlike `terms`, keeps all paths when branches meet;
        # `entries` are the positions of the rule's entries that changed the word, `pieces` what they replaced
        'edges': [[e['step'], e['rule'], e['from'], e['to'], e['entries'], _pieces(t, e)] for e in t.edges],
    }


def _word(t, raw):
    """One word of a request: its result, or {'term', 'error'} when the word itself is not acceptable."""
    term = _normalize(raw).lower()
    if not term.strip() or any(ord(c) < 32 for c in term):
        return {'term': raw, 'error': 'bad_term'}
    if len(term) > MAX_TERM_CHARS:
        return {'term': raw, 'error': 'term_too_long'}
    return _apply(t, term)


def _rules_source(body):
    """(preset, rules_text, problem): a bundled preset or the rules text from a request body.
    `problem` is None or an (error code, HTTP status) pair."""
    preset = body.get('preset')
    if preset is not None:
        if preset not in PRESETS:
            return None, None, ('not_found', 404)
        return preset, None, None
    rules_text = body.get('rules')
    if not isinstance(rules_text, str):
        return None, None, ('invalid_json', 400)
    return None, rules_text, None


# ---------- routes ----------

def _version():
    """Short hash of the page files, used to refresh browser caches after a deploy."""
    h = hashlib.sha1()
    for folder, dirs, files in os.walk(WEB):
        dirs[:] = sorted(d for d in dirs if d != 'fonts')       # fonts are cached by their file names
        for name in sorted(files):
            if name == 'index.html' or name.startswith('.'):
                continue
            with open(os.path.join(folder, name), 'rb') as f:
                h.update(name.encode() + f.read())
    return h.hexdigest()[:10]


@app.get('/')
def index():
    with open(os.path.join(WEB, 'index.html'), encoding='utf-8') as f:
        page = f.read().replace('{{VERSION}}', _version())
    resp = app.response_class(page, mimetype='text/html')
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.get('/static/<path:name>')
def static_file(name):
    resp = send_from_directory(WEB, name)
    if name.startswith('fonts/'):
        resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp


@app.get('/healthz')
def healthz():
    return 'ok'


@app.get('/api/strings')
def api_strings():
    return jsonify(STRINGS)


@app.get('/api/about')
def api_about():
    lang = request.args.get('lang', 'en')
    return jsonify({'lang': lang if lang in LANGS else 'en', 'html': ABOUT.get(lang, ABOUT['en'])})


@app.get('/api/presets')
def api_presets():
    return jsonify(list(PRESETS))


@app.get('/api/rules/<preset>')
def api_rules(preset):
    if preset not in PRESETS:
        return jsonify({'error': 'not_found'}), 404
    return send_from_directory(TRANSFORMATIONS, PRESETS[preset], mimetype='application/json')


@app.post('/api/transform')
def api_transform():
    """Evolve one word ({"term": ...}: the answer is that word's result) or many
    ({"terms": [...]}: {"results": [...], "truncated": bool}), with a bundled preset or rules text."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({'error': 'invalid_json'}), 400

    batch = 'terms' in body
    if batch:
        words = body['terms']
        if not isinstance(words, list) or not words or not all(isinstance(w, str) for w in words):
            return jsonify({'error': 'bad_term'}), 400
        if len(words) > MAX_WORDS:
            return jsonify({'error': 'too_many_terms'}), 400
    else:
        if not isinstance(body.get('term'), str):
            return jsonify({'error': 'bad_term'}), 400
        words = [body['term']]

    preset, rules_text, problem = _rules_source(body)
    if problem:
        return jsonify({'error': problem[0]}), problem[1]

    try:
        t = _build(preset, rules_text)
        started = time.monotonic()
        results, truncated = [], False
        for raw in words:
            if results and time.monotonic() - started > TIME_BUDGET:
                truncated = True
                break
            results.append(_word(t, raw))
    except RulesError as e:
        return jsonify({'error': e.code}), 400

    if not batch:
        if 'error' in results[0]:
            return jsonify({'error': results[0]['error']}), 400
        return jsonify(results[0])
    return jsonify({'results': results, 'truncated': truncated})


@app.post('/api/rulebook')
def api_rulebook():
    """The rules in reading order: steps (with their | alternatives), rules with their entries,
    and the members of every group (the first GROUP_MEMBERS_SHOWN of each)."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({'error': 'invalid_json'}), 400
    preset, rules_text, problem = _rules_source(body)
    if problem:
        return jsonify({'error': problem[0]}), problem[1]
    try:
        t = _build(preset, rules_text)
    except RulesError as e:
        return jsonify({'error': e.code}), 400
    original = t.json_dict_original
    return jsonify({
        'order': original['order'],
        'rules': {name: [[k, v] for k, v in entries.items()] for name, entries in original['rules'].items()},
        'groups': {name: {'members': values[:GROUP_MEMBERS_SHOWN], 'total': len(values)}
                   for name, values in t.groups_expanded.items()},
        # the file's own "description" as safe HTML, {language: [bullet, ...]} ('*': for every language), or null
        'description': description.to_html(original.get('description')),
    })


@app.post('/api/validate')
def api_validate():
    """Problems in a rules text, each with its line and column ({"ok", "issues"})."""
    body = request.get_json(silent=True)
    text = body.get('rules') if isinstance(body, dict) else None
    if not isinstance(text, str):
        return jsonify({'error': 'invalid_json'}), 400
    return jsonify(validate.check(text))


@app.errorhandler(413)
def too_large(_):
    return jsonify({'error': 'too_large'}), 413


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=8506, debug=False)
