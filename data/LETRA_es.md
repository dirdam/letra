## Objetivo

**LETRA** busca convertir cualquier escritura en otra a través de un conjunto de _reglas de transformación_.

La escritura **no** tiene por qué representar ortografía o fonética; lo que represente es decisión del usuario.

**LETRA** utiliza las reglas dadas/definidas y las aplica al término objetivo hasta que este aclance su forma final.

## Casos de uso

- Convertir ortografía en pronunciación.
- Evolucionar escrituras antiguas en modernas.
- Codificar/Decodificar escrituras a través de un conjunto de reglas.

## Reglas de transformación

El conjunto reglas que se usa para tranformar la escritura. Se dará como un archivo en formato _json_ que incluirá estas 3 categorías:

- **`groups`**: lista de `caracteres` que se comportan igual, por lo tanto conviene recogerlos como un grupo.
  - Un grupo puede ser definido usando grupos previamente definidos a través de `<nombre_de_grupo>`.
  - `!` puede usarse delante de un `caracter` o un `<nombre_de_grupo>` para excluirlo de la lista.
- **`rules`**: reglas de transformación; qué (_lado fuente_) se transforma en qué (_lado transformado_). 
  - Cada regla debe recibir un nombre.
  - Todas las transformaciones bajo la misma regla se aplican a la vez.
  - `caracteres` sencillos significan exactamente esos caracteres.
  - Se pueden llamar a grupos de `groups` usando el `<nombre_de_grupo>`.
    - El número de paréntesis (`<>`) usados a ambos lados de la definición ha de ser el mismo. Si un grupo desaparece en el _lado transformado_ se reprensentará con paréntesis vacíos `<>` .
    - Si se pueden esperar múltiples grupos en la misma posición se pueden incluir todos separándolos por `|`: `<grupo_1|grupo_2>`.
    - `<nombre_de_grupo*>` se usa para representar «_una sucesión de longitud indeterminada de elementos del grupo_».
    - `<nombre_de_grupo=>` se usa para representar «_una repetición del mismo elemento del grupo_». Para más repeticiones también se pueden usar `==` (mismo elemento 3 veces), `===` (mismo elemento 4 veces), etc.
  - Para representar el principio de un término se usa un espacio blanco inicial: `␣abc`.
  - Para representar el final de un término se usa un espacion blanco final: `xyz␣`.
- **`order`**: lista especificando el orden en que las reglas (`rules`) se aplican.
  - Si sólo una de múltiples reglas ha de aplicarse en cierto paso las alternativas se separan con `|`: `<regla_1|regla_2|regla_3>`.

A diferencia de los archivos _json_ tradicionales, el archivo acepta comentarios que comiencen con dos barras (`//`).

_Ejemplo_:
```json
{
	"groups": {
		// Vocales
		"voc_átonas": ["a", "e", "i", "o", "u"],
		"voc_tónicas": ["á", "é", "í", "ó", "ú"],
		"voc": ["<voc_átonas>", "<voc_tónicas>"], // todas las vocales
		"cons": ["b", "c", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p", "q", "r", "s", "t", "v", "w", "x", "y", "z"],
		"cons_dobles": ["<cons>", "!l", "!n", "!r"] // <cons> menos l, n, r
	},
	"rules": {
		"identidad": {
			"": "" // identidad
		},
		"eliminar_m": {
			"m ": " " // elimina la m final
		},
		"simplificar_dobles": {
			"<cons_dobles=>": "<cons_dobles>" // simplifica las consonantes dobles excepto l, n, r
		},
		"eliminar_átonas": {
			"<voc_tónicas><cons*><voc_átonasw><cons>": "<voc_tónicas><cons*><><cons>" // elimina la vocal entre consonantes después de una sílaba tónica
		},
		"cambiar_vocal": {
			"<cons>í<cons>": "<cons>é<cons>" // cambia i tónica a e tónica
		},
		"diptongar": {
			"<cons>é<cons>": "<cons>ié<cons>" // diptonga la e tónica
		}
	},
	"order": [
		"eliminar_m", 
		"simplificar_dobles", 
		"eliminar_átonas", 
		"cambiar_vocal", 
		"identidad|diptongar" // sólo se aplicará una de las dos
	]
}
```

Usando el _json_ de arriba podríamos transformar la palabra **`lítteram`** (usamos la tilde para denotar la sílaba tónica) como sigue:

- `lítteram` > `lítera` > `lítra` > `létra` > `létra | liétra`

El resultado significa que después de aplicar todas las reglas según el orden `order` podríamos obtener dos posibles resultados de la transformación: `létra` o `liétra`.

El detalle de la transformación se da a continuación:

||Nombre de la regla|Regla|Entrada|Salida|
|-|-|-|-|-|
|1|`eliminar_m`|"`m `" → "` `"|**`lítteram`**|`líttera`|
|2|`simplificar_dobles`|"`<cons_dobles=>`" → "`<cons_dobles>`"|`líttera`|`lítera`|
|3|`eliminar_átonas`|"`<voc_tónicas><cons*><voc_átonasw><cons>`" → "`<voc_tónicas><cons*><><cons>`"|`lítera`|`lítra`|
|4|`cambiar_vocal`|"`<cons>í<cons>`" → "`<cons>é<cons>`"|`lítra`|`létra`|
|5|`identidad\|diptongar`|"" → "" \| "`<cons>é<cons>`" → "`<cons>ié<cons>`"|`létra`|**`létra \| liétra`**|