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
