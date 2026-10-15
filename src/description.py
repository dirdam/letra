"""The optional "description" of a rules file: a list of Markdown texts, shown as bullets under the rule set's name.

It is either a list of texts (for every language) or an object with such a list per language code:

    "description": ["Based on **general rules**.", "Allophones are included."]
    "description": {"en": ["Based on **general rules**."], "es": ["Basado en **reglas generales**."]}

A rules file can come from anyone, so the Markdown is turned into HTML with only a few tags kept: raw HTML is shown as text,
images are dropped, and links must be http(s), mailto or "#".
"""
import html
import re
from html.parser import HTMLParser

import markdown

ALLOWED_TAGS = {'p', 'strong', 'em', 'code', 'a', 'br', 'ul', 'ol', 'li'}
ALLOWED_LINKS = ('http://', 'https://', 'mailto:', '#')


class _Clean(HTMLParser):
    """Keeps the allowed tags (a link keeps only a safe href) and writes everything else out as text."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.out = []

    def handle_starttag(self, tag, attrs):
        if tag == 'img':
            return
        if tag not in ALLOWED_TAGS:
            self.out.append(html.escape(self.get_starttag_text()))
        elif tag == 'a':
            href = dict(attrs).get('href') or ''
            if href.lower().startswith(ALLOWED_LINKS):
                self.out.append(f'<a href="{html.escape(href, quote=True)}" target="_blank" rel="noopener noreferrer">')
            else:
                self.out.append('<a>')
        else:
            self.out.append(f'<{tag}>')

    def handle_startendtag(self, tag, attrs):
        if tag == 'br':
            self.out.append('<br>')
        elif tag != 'img':
            self.out.append(html.escape(self.get_starttag_text()))

    def handle_endtag(self, tag):
        if tag in ALLOWED_TAGS:
            self.out.append(f'</{tag}>')
        elif tag != 'img':
            self.out.append(html.escape(f'</{tag}>'))

    def handle_data(self, data):
        self.out.append(html.escape(data, quote=False))

    def handle_entityref(self, name):
        self.out.append(f'&{name};')

    def handle_charref(self, name):
        self.out.append(f'&#{name};')


def _render(text):
    """One bullet's Markdown as safe HTML (a single paragraph is returned without its <p>)."""
    cleaner = _Clean()
    cleaner.feed(markdown.markdown(text))
    cleaner.close()
    out = ''.join(cleaner.out)
    m = re.fullmatch(r'<p>(.*)</p>', out, re.S)
    return m.group(1) if m and '<p>' not in m.group(1) else out


def _texts(value):
    return isinstance(value, list) and all(isinstance(v, str) for v in value)


def is_valid(value):
    """A list of texts, or an object with a list of texts per language code."""
    return _texts(value) or (isinstance(value, dict) and all(_texts(v) for v in value.values()))


def to_html(value):
    """The description as {language: [html, ...]} ('*' for a plain list, valid in every language), or None when there is none."""
    if not is_valid(value):
        return None
    texts = {'*': value} if isinstance(value, list) else value
    out = {lang: [_render(t) for t in items if t.strip()] for lang, items in texts.items()}
    out = {lang: items for lang, items in out.items() if items}
    return out or None
