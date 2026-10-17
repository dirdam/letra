"""The files the editor's New button writes (transformations/template_en.json, template_es.json): small rules files that work."""
import os

import pytest

import server
from src import letra, validate

ROOT = os.path.join(os.path.dirname(__file__), '..', 'transformations')


@pytest.fixture()
def client():
    server.app.config['TESTING'] = True
    return server.app.test_client()


@pytest.mark.parametrize('lang', ['en', 'es'])
def test_the_template_is_valid_without_a_single_warning(lang):
    text = open(os.path.join(ROOT, server.TEMPLATES[lang]), encoding='utf-8').read()
    assert validate.check(text) == {'ok': True, 'issues': []}


@pytest.mark.parametrize('lang', ['en', 'es'])
def test_the_template_does_what_its_comment_says(lang):
    path = server.TEMPLATES[lang]
    text = open(os.path.join(ROOT, path), encoding='utf-8').read()
    assert 'Run test with word "xabxyz". It should become "xabyyz"' in text or 'Prueba con la palabra "xabxyz". Debería convertirse en "xabyyz"' in text
    assert letra.Transformer(text).transform('xabxyz') == [' xabyyz ']


def test_the_spanish_template_has_spanish_names_and_the_english_one_english_names():
    en = open(os.path.join(ROOT, server.TEMPLATES['en']), encoding='utf-8').read()
    es = open(os.path.join(ROOT, server.TEMPLATES['es']), encoding='utf-8').read()
    assert 'group_ab' in en and 'rule_abx' in en and 'grupo_ab' not in en
    assert 'grupo_ab' in es and 'regla_abx' in es and 'group_ab' not in es


def test_the_template_is_served_in_the_requested_language_and_falls_back_to_english(client):
    es = client.get('/api/template?lang=es').get_data(as_text=True)
    en = client.get('/api/template?lang=en').get_data(as_text=True)
    assert 'regla_abx' in es and 'rule_abx' in en
    assert client.get('/api/template').get_data(as_text=True) == en
    assert client.get('/api/template?lang=xx').get_data(as_text=True) == en


def test_the_template_files_are_not_rule_sets_of_the_page(client):
    assert client.get('/api/presets').get_json() == ['sample', 'LA_ES', 'ES_IPA', 'ES_Miquitrifi']
    assert client.get('/api/rules/template_en').status_code == 404
