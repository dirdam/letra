"""Which pieces of a word a rule really replaced, for showing "was → now" with only the replaced letters marked.

The engine applies a rule's entries one after another, each as a regex replacement over the whole word. Here the same
entries are replayed on the word while keeping track of what every replacement wrote over, so the marks follow what the
rule did and not a guess from comparing the two words. A match is trimmed to what really differs: "gü" → "gui" replaces
"ü" by "ui" (the "g" is not touched), and "i" → "i" replaces nothing.
"""
import re
import unicodedata


def _core(old, new):
    """The start and end of what differs between `old` and `new`: (start, end of old, end of new).
    The letters they share at the start and at the end are left out; a letter is never split from its combining marks."""
    start = 0
    while start < min(len(old), len(new)) and old[start] == new[start]:
        start += 1
    while start > 0 and ((start < len(old) and unicodedata.combining(old[start])) or (start < len(new) and unicodedata.combining(new[start]))):
        start -= 1
    tail = 0
    while tail < min(len(old), len(new)) - start and old[-1 - tail] == new[-1 - tail]:
        tail += 1
    while tail > 0 and (unicodedata.combining(old[len(old) - tail]) or unicodedata.combining(new[len(new) - tail])):
        tail -= 1
    return start, len(old) - tail, len(new) - tail


def _replace(cells, start, end, new):
    """Writes `new` over the letters from `start` to `end` of the current text. A cell is [letters of the original word it
    stands for, its letter in the current text ('' once deleted)]."""
    chosen = []                                                 # the cells whose letter is in start..end
    position = 0
    for index, (_, now) in enumerate(cells):
        if now and start <= position < end:
            chosen.append(index)
        position += len(now)
    if not chosen:                                              # nothing to write over: an insertion at `start`
        index, position = 0, 0
        while index < len(cells) and position < start:
            position += len(cells[index][1])
            index += 1
        cells[index:index] = [['', letter] for letter in new]
        return
    first, last = chosen[0], chosen[-1]
    was = ''.join(cell[0] for cell in cells[first:last + 1])
    written = [[was if k == 0 else '', letter] for k, letter in enumerate(new)]
    cells[first:last + 1] = written or ([[was, '']] if was else [])


def replaced(entries, word):
    """The cells of `word` after the entries of a rule ({regex: replacement}), applied in order as the engine does."""
    cells = [[letter, letter] for letter in word]
    for search, change in entries.items():
        text = ''.join(now for _, now in cells)
        spans = []
        for match in re.finditer(search, text):
            old, new = match.group(0), match.expand(change)
            start, old_end, new_end = _core(old, new)
            if start < old_end or start < new_end:
                spans.append((match.start() + start, match.start() + old_end, new[start:new_end]))
        for start, end, new in reversed(spans):                 # from the end, so the offsets still hold
            _replace(cells, start, end, new)
    return cells


def pieces(entries, word):
    """[[was, now], ...] in order: the word before and after the rule, cut into stretches that are the same on both sides
    (was == now) and stretches the rule replaced (was != now)."""
    out = []
    for was, now in replaced(entries, word):
        same = was == now
        if out and out[-1][2] == same:
            out[-1][0] += was
            out[-1][1] += now
        else:
            out.append([was, now, same])
    return [[was, now] for was, now, _ in out]
