"""Checks a LETRA rules file and reports each problem with its position.

`check(text)` never raises: it returns {'ok': bool, 'issues': [...]} where every issue is
{severity: 'error'|'warning', code, message, path, line, col}. Lines and columns are 1-based
and point at the offending key or value in the text as the user wrote it.

The engine strips `// comments` with a regular expression before parsing. Here the comments
are blanked with spaces of the same length instead, so the JSON parser reports positions that
match the original text.
"""
import bisect
import copy
import json
import re

from src import description, letra

MAX_ITEMS = 1000            # entries in each of groups / rules / order
MAX_GROUP_VALUES = 20000    # expanded size of any one group

_COMMENT = re.compile(r'//[^\n]*')
_PLACEHOLDER = re.compile(r'<([^<>]*)>')
_BALANCED = re.compile(r'^[^<>]*(?:<[^<>]*>[^<>]*)*$')
_LITERAL = re.compile(r'-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null')


def blank_comments(text):
    """Replace every // comment by spaces of the same length (newlines are kept)."""
    return _COMMENT.sub(lambda m: ' ' * len(m.group(0)), text)


def group_sizes(groups):
    """Expanded size of every group, worked out without building the lists.

    Groups can reference other groups, so a few definitions can expand to billions of values.
    Same reading of the entries as the engine's `expand_groups`. Returns {name: size}.
    """
    alias = {part: name for name in groups if '|' in name for part in name.split('|')}
    sizes = {}
    for name, values in groups.items():
        total = 0
        for v in values:
            if '!' in v:            # negation: only removes values
                continue
            if '<' not in v:        # fixed value
                total += 1
            else:                   # call to another group
                key = v[1:-1]
                total += sizes.get(alias.get(key, key), 0)
        sizes[name] = total
    return sizes


# ---------- positions ----------

class _Scanner:
    """A small JSON reader that remembers where every key and array item starts."""

    def __init__(self, text):
        self.t = text
        self.n = len(text)
        self.i = 0
        self.starts = [0] + [m.end() for m in re.finditer('\n', text)]
        self.pos = {}           # path tuple -> (line, col)
        self.duplicates = []    # (path, line, col)

    def where(self, index):
        line = bisect.bisect_right(self.starts, index)
        return line, index - self.starts[line - 1] + 1

    def ws(self):
        while self.i < self.n and self.t[self.i] in ' \t\r\n':
            self.i += 1

    def string(self):
        start = self.i
        self.i += 1
        while self.i < self.n:
            c = self.t[self.i]
            if c == '\\':
                self.i += 2
                continue
            self.i += 1
            if c == '"':
                return json.loads(self.t[start:self.i])
        raise ValueError('unterminated string')

    def value(self, path):
        self.ws()
        c = self.t[self.i]
        if c == '{':
            self.i += 1
            seen = set()
            while True:
                self.ws()
                if self.t[self.i] == '}':
                    self.i += 1
                    return
                key_at = self.i
                key = self.string()
                if key in seen:
                    self.duplicates.append((path + (key,),) + self.where(key_at))
                seen.add(key)
                self.pos[path + (key,)] = self.where(key_at)
                self.ws()
                self.i += 1                         # ':'
                self.value(path + (key,))
                self.ws()
                if self.t[self.i] == ',':
                    self.i += 1
        elif c == '[':
            self.i += 1
            index = 0
            while True:
                self.ws()
                if self.t[self.i] == ']':
                    self.i += 1
                    return
                self.pos[path + (index,)] = self.where(self.i)
                self.value(path + (index,))
                index += 1
                self.ws()
                if self.t[self.i] == ',':
                    self.i += 1
        elif c == '"':
            self.string()
        else:
            m = _LITERAL.match(self.t, self.i)
            self.i = m.end()


def locate(text):
    """(positions, duplicate keys) of valid JSON `text`; positions maps path tuples to (line, col)."""
    sc = _Scanner(text)
    sc.value(())
    return sc.pos, sc.duplicates


def _path_text(path):
    out = ''
    for p in path:
        out += f'[{p}]' if isinstance(p, int) else (('.' if out else '') + p)
    return out


# ---------- checks ----------

def check(text):
    issues = []
    pos = {}

    def add(severity, code, message, path=(), at=None, **params):
        if at:
            line, col = at
        else:
            line, col = 1, 1
            for k in range(len(path), 0, -1):       # the nearest ancestor whose position is known
                if path[:k] in pos:
                    line, col = pos[path[:k]]
                    break
        issues.append({'severity': severity, 'code': code, 'message': message, 'params': params,
                       'path': _path_text(path), 'line': line, 'col': col})

    try:
        _check(text, add, pos, issues)
    except Exception as e:  # the checker itself must never take the request down
        add('error', 'internal', f'Could not finish checking this file ({type(e).__name__}).', error=type(e).__name__)
    issues.sort(key=lambda i: (i['line'], i['col']))
    return {'ok': not _has_errors(issues), 'issues': issues}


def _has_errors(issues):
    return any(i['severity'] == 'error' for i in issues)


def _check(text, add, pos, issues):
    blanked = blank_comments(text)
    try:
        data = json.loads(blanked)
    except json.JSONDecodeError as e:
        add('error', 'json_syntax', f'Not valid JSON: {e.msg}.', at=(e.lineno, e.colno), detail=e.msg)
        return
    found, duplicates = locate(blanked)
    pos.update(found)
    for path, line, col in duplicates:
        add('warning', 'duplicate_key', f'"{path[-1]}" appears twice here; only the last one is used.', path, (line, col), key=str(path[-1]))

    if not isinstance(data, dict):
        add('error', 'not_object', 'The file must be a JSON object with "groups", "rules" and "order".')
        return
    for section, kind in (('groups', dict), ('rules', dict), ('order', list)):
        if section not in data:
            add('error', 'missing_section', f'The "{section}" section is missing.', section=section)
        elif not isinstance(data[section], kind):
            add('error', 'wrong_type', f'"{section}" must be {"an object" if kind is dict else "a list"}.', (section,), section=section, kind='object' if kind is dict else 'list')
    if _has_errors(issues):
        return
    groups, rules, order = data['groups'], data['rules'], data['order']

    for section in ('groups', 'rules', 'order'):
        if len(data[section]) > MAX_ITEMS:
            add('error', 'too_large', f'"{section}" has more than {MAX_ITEMS} entries.', (section,), section=section, limit=MAX_ITEMS)
            return

    # types inside the sections
    for name, values in groups.items():
        if not isinstance(values, list) or not all(isinstance(v, str) for v in values):
            add('error', 'group_values', f'Group "{name}" must be a list of strings.', ('groups', name), name=name)
    for name, entries in rules.items():
        if not isinstance(entries, dict) or not all(isinstance(v, str) for v in entries.values()):
            add('error', 'rule_values', f'Rule "{name}" must map text to replacement text (strings).', ('rules', name), name=name)
    for i, step in enumerate(order):
        if not isinstance(step, str):
            add('error', 'order_items', 'Every entry in "order" must be a string (a rule name, or names joined by |).', ('order', i), n=i + 1)
    if _has_errors(issues):
        return

    if 'description' in data and not description.is_valid(data['description']):
        add('warning', 'description_type', 'The "description" must be a list of texts (or an object with one list per language); it is ignored.', ('description',))

    # group references: must be defined, and before they are used (the engine reads groups in order)
    defined = set()
    all_names = set()
    for name in groups:
        all_names.add(name)
        all_names.update(name.split('|'))
    for name, values in groups.items():
        for j, v in enumerate(values):
            path = ('groups', name, j)
            if not _BALANCED.match(v.lstrip('!')):
                add('error', 'unbalanced_brackets', f'"{v}" has an unmatched < or >.', path, text=v)
                continue
            for ref in _refs(v):
                if ref not in all_names:
                    add('error', 'unknown_group', f'Group "{ref}" is not defined.', path, name=ref)
                elif ref not in defined and ref not in name.split('|'):
                    add('error', 'group_defined_later', f'Group "{ref}" is used here but defined further down; define it first.', path, name=ref)
                elif ref in name.split('|'):
                    add('error', 'group_self_reference', f'Group "{name}" refers to itself.', path, name=name)
        defined.add(name)
        defined.update(name.split('|'))

    # rules: brackets, group names, placeholder counts
    for rule, entries in rules.items():
        for key, value in entries.items():
            path = ('rules', rule, key)
            if not _BALANCED.match(key) or not _BALANCED.match(value):
                add('error', 'unbalanced_brackets', f'"{key}" → "{value}" has an unmatched < or >.', path, text=f'{key} → {value}')
                continue
            for ref in _refs(key):
                if ref not in all_names:
                    add('error', 'unknown_group', f'Group "{ref}" is not defined.', path, name=ref)
            # Every <...> of the pattern pairs with the <...> in the same position of the replacement: the same name keeps
            # it, an empty <> drops it. So both sides need the same number (a plain-text replacement is no exception).
            na, nb = len(_PLACEHOLDER.findall(key)), len(_PLACEHOLDER.findall(value))
            if nb != na:
                add('warning', 'placeholder_count',
                    f'"{key}" has {len(_PLACEHOLDER.findall(key))} <…> but its replacement has {len(_PLACEHOLDER.findall(value))}; '
                    'each one needs a counterpart (use an empty <> where a group disappears).', path, key=key, a=len(_PLACEHOLDER.findall(key)), b=len(_PLACEHOLDER.findall(value)))

    # order: every named rule must exist
    for i, step in enumerate(order):
        for name in step.split('|'):
            if name != 'iden' and name not in rules:
                add('error', 'unknown_rule_in_order', f'Step {i + 1} names rule "{name}", which is not defined.', ('order', i), step=i + 1, name=name)
    if not order:
        add('warning', 'order_empty', '"order" is empty, so nothing will be applied.', ('order',))
    used = {n for step in order for n in step.split('|')}
    for rule in rules:
        if rule not in used:
            add('warning', 'rule_unused', f'Rule "{rule}" is never used in "order".', ('rules', rule), name=rule)

    # groups nothing uses: a group counts as used when a rule's pattern names it (under any of its `a|b` names),
    # or when a group that is itself used includes it
    owner = {part: name for name in groups for part in name.split('|')}
    used_groups = set()
    pending = [owner[ref] for entries in rules.values() for key in entries for ref in _refs(key) if ref in owner]
    while pending:
        group = pending.pop()
        if group not in used_groups:
            used_groups.add(group)
            pending.extend(owner[ref] for v in groups[group] for ref in _refs(v) if ref in owner)
    for name in groups:
        if name not in used_groups:
            add('warning', 'group_unused', f'Group "{name}" is defined but never used.', ('groups', name), name=name)

    if _has_errors(issues):
        return

    # group sizes (a few groups can expand to billions of values)
    sizes = group_sizes(groups)
    for name, size in sizes.items():
        if size > MAX_GROUP_VALUES:
            add('error', 'group_too_large', f'Group "{name}" expands to more than {MAX_GROUP_VALUES} values.', ('groups', name), name=name, limit=MAX_GROUP_VALUES)
            return

    # compile every entry, as the engine does, to find the one that fails
    _compile_entries(data, add)


def _refs(text):
    """Group names used in the <...> placeholders of `text` (modifiers * and = removed, | split)."""
    out = []
    for inner in _PLACEHOLDER.findall(text):
        for alt in inner.split('|'):
            name = alt.replace('*', '').replace('=', '')
            if name:
                out.append(name)
    return out


def _compile_entries(data, add):
    t = letra.Transformer.__new__(letra.Transformer)
    t.json_dict = copy.deepcopy(data)
    t.json_dict_original = copy.deepcopy(data)
    try:
        t.add_rules_groups()
        t.expand_groups()
        t.rename_groups()
    except Exception as e:
        add('error', 'groups_error', f'The groups could not be expanded ({type(e).__name__}: {e}).', ('groups',), detail=f'{type(e).__name__}: {e}')
        return
    regex_groups = {g: '(' + '|'.join(re.escape(v) for v in values) + ')' for g, values in t.json_dict['groups'].items()}
    for rule, entries in data['rules'].items():
        for key, value in entries.items():
            path = ('rules', rule, key)
            try:
                change = t.replace_same({key: value})[key]
                pattern = t.convert_to_regex(key, regex_groups)
                re.compile(pattern).sub(change, '')
            except re.error as e:
                add('error', 'regex_error', f'This entry is not a valid pattern: {e}.', path, detail=str(e))
            except Exception as e:
                add('error', 'rule_error', f'This entry could not be read ({type(e).__name__}).', path, detail=type(e).__name__)
