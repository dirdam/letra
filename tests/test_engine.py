"""The Transformer must keep producing exactly what it produced before the web move.
tests/golden.json was recorded from the unmodified engine (tests/record_golden.py)."""
import json
import os

import pytest

import src.letra as letra

HERE = os.path.dirname(__file__)
GOLDEN = json.load(open(os.path.join(HERE, 'golden.json'), encoding='utf-8'))
CASES = [(k, v) for k, v in GOLDEN.items() if not k.endswith('|init')]


@pytest.mark.parametrize('key,expected', CASES, ids=[k for k, _ in CASES])
def test_matches_recorded_output(key, expected):
    preset, allow_identity, term = key.split('|')
    t = letra.Transformer(json_path=preset)
    final = t.transform(term, allow_identity=(allow_identity == 'True'), verbose=False)
    assert final == expected['final']
    assert [[k, v['mother'], v['rule']] for k, v in t.transformations.items()] == expected['transformations']


def test_works_from_any_working_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    t = letra.Transformer(json_path='sample.json')
    assert t.transform('lítteram') == [' létra ', ' liétra ']


# ---------- edges (every change applied, including the paths `transformations` drops) ----------

@pytest.mark.parametrize('key,expected', CASES, ids=[k for k, _ in CASES])
def test_edges_include_every_recorded_step(key, expected):
    preset, allow_identity, term = key.split('|')
    t = letra.Transformer(json_path=preset)
    t.transform(term, allow_identity=(allow_identity == 'True'))
    edges = {(e['rule'], e['from'], e['to']) for e in t.edges}
    for name, mother, rule in expected['transformations']:
        if mother:                                       # every first-path step is also an edge
            assert (rule, mother, name) in edges
    assert all(e['from'] != e['to'] for e in t.edges)
    assert all(0 <= e['step'] < len(t.json_dict['order']) for e in t.edges)


def test_edges_keep_the_paths_the_tree_loses():
    # two alternative rules that give the same form: `transformations` keeps only the first path
    rules = '{"groups": {}, "rules": {"x": {"a": "b"}, "y": {"a": "b"}}, "order": ["x|y"]}'
    t = letra.Transformer(rules)
    assert t.transform('a') == [' b ']
    assert t.transformations[' b ']['rule'] == 'x'
    assert {(e['rule'], e['from'], e['to']) for e in t.edges} == {('x', ' a ', ' b '), ('y', ' a ', ' b ')}


def test_edges_are_a_tree_when_branches_do_not_meet():
    t = letra.Transformer(json_path='LA_ES.json')
    t.transform('quinquagínta')
    assert len(t.transformations) == len(t.edges) + 1      # every term but the start has one edge


def test_groups_are_kept_as_lists_of_values():
    t = letra.Transformer(json_path='sample.json')
    assert all(isinstance(v, list) and all(isinstance(x, str) for x in v) for v in t.groups_expanded.values())
    assert t.groups_expanded


@pytest.mark.parametrize('name', ['sample', 'LA_ES', 'ES_IPA', 'ES_Miquitrifi'])
def test_bundled_rule_files_are_already_nfc(name):
    import unicodedata
    text = open(os.path.join(HERE, '..', 'transformations', f'{name}.json'), encoding='utf-8').read()
    assert unicodedata.normalize('NFC', text) == text


# ---------- which entries of a rule changed the word ----------

def test_edges_name_the_entries_that_changed_the_word():
    t = letra.Transformer('{"groups": {}, "rules": {"r": {"a": "b", "x": "y", "c": "d"}}, "order": ["r"]}')
    t.transform('ac')
    assert [(e['rule'], e['entries']) for e in t.edges] == [('r', [0, 2])]


def test_halagueno_applies_only_one_entry_of_its_rule():
    t = letra.Transformer(json_path='ES_IPA.json')
    t.transform('halagüeño')
    original = t.json_dict_original['rules']
    for e in t.edges:
        entries = list(original[e['rule']].items())
        assert e['entries'] and all(0 <= n < len(entries) for n in e['entries'])
    g = [e for e in t.edges if e['rule'] == 'g']
    assert g and len(g[0]['entries']) == 1 and list(original['g'].items())[g[0]['entries'][0]][0].startswith('gü')


# ---------- comments: a // inside a "string" is not one ----------

def test_a_double_slash_inside_a_string_is_kept_and_a_comment_after_it_is_dropped():
    text = '{"a": "see https://example.org/x", // a comment with "quotes" and https://too.org\n "b": 1}'
    assert json.loads(letra.strip_comments(text)) == {'a': 'see https://example.org/x', 'b': 1}


def test_blanking_comments_keeps_lines_and_columns_and_the_strings():
    text = '{"a": "x//y", // c\n"b": "\\"//"} // end'
    blank = letra.strip_comments(text, keep_length=True)
    assert len(blank) == len(text) and blank.count('\n') == text.count('\n')
    assert '"x//y"' in blank and '"\\"//"' in blank and 'c' not in blank.split('\n')[0][10:] and blank.rstrip().endswith('}')


def test_rules_with_a_link_in_their_description_load():
    t = letra.Transformer('{"description": ["[x](https://example.org/a//b)"], "groups": {}, "rules": {"r": {"a": "b"}}, "order": ["r"]}')
    assert t.transform('a') == [' b ']
    assert t.json_dict_original['description'] == ['[x](https://example.org/a//b)']
