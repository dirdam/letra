"""The optional "description" of a rules file: bullets of Markdown shown under the rule set's name."""
import json

import pytest

from src import description, validate


def test_a_list_is_for_every_language_and_an_object_has_one_list_per_language():
    assert description.to_html(['A **b**']) == {'*': ['A <strong>b</strong>']}
    assert description.to_html({'en': ['One'], 'es': ['Uno', 'Dos']}) == {'en': ['One'], 'es': ['Uno', 'Dos']}


@pytest.mark.parametrize('value', [None, 'text', 5, [1], {'en': 'x'}, {'en': [1]}, [], [' '], {'en': []}])
def test_anything_else_is_no_description(value):
    assert description.to_html(value) is None


def test_markdown_is_rendered_and_angle_brackets_in_code_stay_text():
    html = description.to_html(['Use `<cons>` & *more*'])['*'][0]
    assert html == 'Use <code>&lt;cons&gt;</code> &amp; <em>more</em>'


def test_raw_html_images_and_unsafe_links_are_neutralised():
    html = description.to_html(['<script>alert(1)</script> <b onclick="x()">b</b> ![i](http://x/y.png) <img src=x onerror=y> '
                               '[ok](https://example.org/a?b=1&c=2) [bad](javascript:alert(1))'])['*'][0]
    assert '<script' not in html and '<b ' not in html and '<img' not in html and 'onerror' not in html      # (an image is dropped, not shown)
    assert '&lt;script&gt;' in html
    assert 'href="https://example.org/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer"' in html
    assert 'javascript' not in html.split('[bad]')[0] and '<a>bad</a>' in html


def test_the_validator_warns_about_a_description_of_the_wrong_shape_and_not_about_a_good_one():
    base = '{"description": %s, "groups": {}, "rules": {"r": {"a": "b"}}, "order": ["r"]}'
    for good in ('["a"]', '{"en": ["a"], "es": ["b"]}'):
        assert validate.check(base % good) == {'ok': True, 'issues': []}
    for bad in ('"text"', '[1]', '{"en": "x"}'):
        r = validate.check(base % bad)
        assert r['ok'] and [(i['severity'], i['code']) for i in r['issues']] == [('warning', 'description_type')]


@pytest.mark.parametrize('name', ['sample', 'LA_ES', 'ES_IPA'])
def test_every_bundled_set_describes_itself_in_both_languages(name):
    import os, re
    text = open(os.path.join(os.path.dirname(__file__), '..', 'transformations', f'{name}.json'), encoding='utf-8').read()
    data = json.loads(re.sub(r'(?://[^\n]*)', '', text))
    html = description.to_html(data['description'])
    assert set(html) == {'en', 'es'} and all(html[lang] for lang in html)
