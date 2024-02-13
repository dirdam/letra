## Purpose

**LETRA** converts any given script into an different one through a set of _transformation rules_.

The script does **not** need to represent orthography or phonetics; what it represents is decision of the user.

**LETRA** makes use of the given/defined rules and applies them to the target term until it reaches its final form.

## Use cases

- Convert orthography into pronunciation.
- Evolve ancient script into modern.
- Encode/Decode scripts through a set of rules.

## Transformation rules

The set of rules used to transform the script. It will be given as a _json_ file including these 3 categories:

- **`groups`**: list of `characters` that behave the same, thus it is more convenient to pack them as a group.
  - A group can be defined using previously defined groups through `<group_name>`.
  - `!` can be used in front of a `character` or a `<group_name>` to exclude it from the list.
- **`rules`**: transformation rules; what (_source side_) transforms into what (_transformed side_). 
  - Each rule must be given a name.
  - All transformations included under the same rule apply at the same time.
  - Plain `characters` mean those exact characters.
  - `groups` can be called using `<group_name>`.
    - The number of brackets (`<>`) used on both sides of the definition must be the same. If a group disappears on the _transformed side_ it should still be represented by the empty brackets `<>` .
    - If multiple groups can be expected in the same position, they can all be included using `|` as separator: `<group_1|group_2>`.
    - `<group_name*>` is used to represent "_a sequence of undetermined length of elements of the group_."
    - `<group_name=>` is used to represent "_a repetition of the same element of the group_." For further repetitions `==` (same element 3 times), `===` (same element 4 times), etc. can also be used.
  - To represent the begining of a term use a leading white space: `␣abc`.
  - To represent the end of a term use a tailing white space: `xyz␣`.
- **`order`**: list specifying the order in which the `rules` are applied.
  - If only one out of multiple rules may be applied at a certain step, the alternatives are separated by `|`: `<rule_1|rule_2|rule_3>`.

Unlike traditional _json_ files, the file accepts comments begining with two slashes (`//`).

_Example_:
```json
{
	"groups": {
		// Vowels
		"unstressed_vow": ["a", "e", "i", "o", "u"],
		"stressed_vow": ["á", "é", "í", "ó", "ú"],
		"vow": ["<unstressed_vow>", "<stressed_vow>"], // all vowels
		"cons": ["b", "c", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p", "q", "r", "s", "t", "v", "w", "x", "y", "z"],
		"double_cons": ["<cons>", "!l", "!n", "!r"] // <cons> without l, n, r
	},
	"rules": {
		"identity": {
			"": "" // identity
		},
		"remove_m": {
			"m ": " " // remove final m
		},
		"simplify_double": {
			"<double_cons=>": "<double_cons>" // simplify double consonants except for l, n, r
		},
		"remove_unstressed": {
			"<stressed_vow><cons*><unstressed_vow><cons>": "<stressed_vow><cons*><><cons>" // remove unstressed vowel between consonants after stressed syllable
		},
		"vowel_shift": {
			"<cons>í<cons>": "<cons>é<cons>" // change stressed i to stressed e
		},
		"diphthong": {
			"<cons>é<cons>": "<cons>ié<cons>" // diphthong stressed e
		}
	},
	"order": [
		"remove_m", 
		"simplify_double", 
		"remove_unstressed", 
		"vowel_shift", 
		"identity|diphthong" // only one of the two will be applied
	]
}
```

Using the upper _json_ we could transform the word **`lítteram`** (we use the accent to mark the stressed syllable) as follows:

- `lítteram` > `lítera` > `lítra` > `létra` > `létra | liétra`

The result means that after applying all the rules as in `order` we could potentially get two results for the transformation: `létra` or `liétra`.

The detail of the transformation is given below:

||Rule name|Rule|Input|Output|
|-|-|-|-|-|
|1|`remove_m`|"`m `" → "` `"|**`lítteram`**|`líttera`|
|2|`simplify_double`|"`<double_cons=>`" → "`<double_cons>`"|`líttera`|`lítera`|
|3|`remove_unstressed`|"`<stressed_vow><cons*><unstressed_vow><cons>`" → "`<stressed_vow><cons*><><cons>`"|`lítera`|`lítra`|
|4|`vowel_shift`|"`<cons>í<cons>`" → "`<cons>é<cons>`"|`lítra`|`létra`|
|5|`identity\|diphthong`|"" → "" \| "`<cons>é<cons>`" → "`<cons>ié<cons>`"|`létra`|**`létra \| liétra`**|