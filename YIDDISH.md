# Steady website notes

## Yiddish (`/yi/`)

Homepage Yiddish uses **Hasidic / American vernacular orthography**, not university YIVO spelling.

- Converter: `scripts/hasidic_yiddish.py` (same rules as Rental Management — port of [ibleaman/hasidifier](https://github.com/ibleaman/hasidifier))
- Regenerator: `scripts/convert_yiddish_hasidic.py` (rewrites `website/yi/index.html` and converts `app/.../values-yi/strings.xml`)
- YIVO backup of app strings: `app/src/main/res/values-yi/strings.yivo.xml`

Latin product words (`Steady`, `Focus`, `APK`, …) are wrapped with `dir="ltr"` inside RTL pages so browser bidi doesn’t scramble them.

A fluent Hasidic reader should still review the homepage (and app strings) when possible — the converter fixes register/spelling; it is not a substitute for a human pass on tone.
