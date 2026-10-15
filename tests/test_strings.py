"""Every text the page asks for must exist in both languages, and both languages must match."""
import csv
import glob
import os
import re

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, '..')


def table():
    rows = list(csv.DictReader(open(os.path.join(ROOT, 'data', 'localizations.csv'), encoding='utf-8', newline='')))
    return {lang: {r['key']: r['value'] for r in rows if r['lang'] == lang} for lang in ('en', 'es')}


def keys_used_by_the_page():
    plain, counted = set(), set()
    files = glob.glob(os.path.join(ROOT, 'web', 'js', '*.js')) + [os.path.join(ROOT, 'web', 'index.html')]
    for f in files:
        s = open(f, encoding='utf-8').read()
        s = re.sub(r'/\*.*?\*/|<!--.*?-->', '', s, flags=re.S)           # comments mention keys as examples
        s = re.sub(r'(?m)^\s*//.*$', '', s)
        plain.update(re.findall(r"""\b(?:I\.t|I\.h|I\.fmt)\(\s*'([a-z_0-9]+)'""", s))
        plain.update(re.findall(r"""\bt\(\s*'([a-z_0-9]+)'""", s))
        counted.update(re.findall(r"""I\.count\(\s*'([a-z_0-9]+)'""", s))
        plain.update(re.findall(r'data-i18n(?:-html)?="([a-z_0-9]+)"', s))
        plain.update(re.findall(r"""'((?:set|empty|tab|view|deriv|export|ed|rb|issue|err|status|tree|words)_[a-z_0-9]+)'""", s))
    return plain, counted


def test_both_languages_have_the_same_keys():
    t = table()
    assert set(t['en']) == set(t['es'])
    assert all(v.strip() for lang in t.values() for k, v in lang.items() if not k.startswith('explain_ref'))


def test_every_key_the_page_uses_exists():
    t = table()
    plain, counted = keys_used_by_the_page()
    needed = {k for k in plain - counted if not k.endswith('_')} | {c + s for c in counted for s in ('_one', '_other')}
    missing = sorted(k for k in needed if k not in t['en'])
    assert not missing, missing


def test_dynamic_keys_exist():
    t = table()
    dynamic = ['explain_mine']          # (the other sets' descriptions are in their rule files)
    dynamic += [f'err_{c}' for c in ('invalid_json', 'missing_sections', 'too_large', 'invalid_rules', 'term_too_long', 'bad_term',
                                     'timeout', 'server', 'file_too_big', 'too_many_terms', 'not_found')]
    dynamic += [f'set_{x}' for x in ('sample', 'la_es', 'es_ipa', 'mine')]
    assert not [k for k in dynamic if k not in t['en']]


def test_every_validator_issue_code_has_a_translation():
    from src import validate
    t = table()
    source = open(os.path.join(ROOT, 'src', 'validate.py'), encoding='utf-8').read()
    codes = set(re.findall(r"add\('(?:error|warning)', '([a-z_]+)'", source))
    for code in codes:
        keys = ['issue_wrong_type_object', 'issue_wrong_type_list'] if code == 'wrong_type' else [f'issue_{code}']
        for k in keys:
            assert k in t['en'], k


def test_placeholders_match_between_languages():
    t = table()
    for key, en in t['en'].items():
        assert sorted(re.findall(r'\{[a-z]+\}', en)) == sorted(re.findall(r'\{[a-z]+\}', t['es'][key])), key
