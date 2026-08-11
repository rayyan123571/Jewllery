# Bundled typefaces

Two variable font files, committed to the repository and loaded with `@font-face`
from a relative path. **Nothing here touches the network at runtime.** The files
are resolved by Vite at build time and shipped inside the application, which is
what an offline product requires — a `@import` from a font CDN would make the
shop's typography depend on the shop having internet, and it does not.

| File | Family | Used for |
|---|---|---|
| `Inter-Variable.ttf` | Inter | Every label, button, menu item and body line, and — with `tnum` — every figure |
| `CormorantGaramond-Variable.ttf` | Cormorant Garamond | The wordmark, module titles and the invoice header. Nothing else. |

Both are **variable** fonts: one file carries the whole weight axis, so the
400/500/600/700 the interface uses cost one download each rather than eight.

## Licence

Both are licensed under the SIL Open Font License 1.1, which permits bundling and
redistribution inside an application. The full licence text for each is beside it:

- `Inter-OFL.txt`
- `CormorantGaramond-OFL.txt`

Under the OFL these licence files must travel with the fonts. Do not delete them,
and do not rename the font files to something that could be read as the reserved
font name of a modified version.

Source: <https://github.com/google/fonts> (`ofl/inter`, `ofl/cormorantgaramond`).
