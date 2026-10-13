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


@pytest.mark.parametrize('name', ['sample', 'LA_ES', 'ES_IPA'])
def test_bundled_rule_files_are_already_nfc(name):
    import unicodedata
    text = open(os.path.join(HERE, '..', 'transformations', f'{name}.json'), encoding='utf-8').read()
    assert unicodedata.normalize('NFC', text) == text
