# Third-party notices

The MIT license in [LICENSE](LICENSE) covers this repository's own code. It does not cover the material below,
which keeps its own terms.

## Fonts (vendored, SIL Open Font License 1.1)

`src/assets/fonts/` contains WOFF2 files that `src/lib/fonts.ts` loads with `next/font/local`. Each family's
directory holds its full license text (`LICENSE.txt`). Keep that file next to the fonts when you redistribute them.
Under the OFL, the fonts may be bundled with software under any license, but they may not be sold on their own.

| Family           | Copyright                                                                                            | Source                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Geist            | Copyright (c) 2023 Vercel, in collaboration with basement.studio                                     | npm `geist` 1.8.2                        |
| Inter            | Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)                             | npm `@fontsource/inter` 5.3.0            |
| Space Mono       | Copyright 2016 The Space Mono Project Authors (https://github.com/googlefonts/spacemono)             | npm `@fontsource/space-mono` 5.3.0       |
| Instrument Serif | Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif) | npm `@fontsource/instrument-serif` 5.3.0 |

## Provider logos (trademarks)

`public/logos/` holds the logos of GitHub, Gmail, Linear, Notion, PostgreSQL, Slack and Stripe. They are used only
to identify the service a connector talks to. Each is a trademark of its owner. The MIT license grants no rights to
them, and their use here implies no endorsement. If you fork the project, check each owner's brand guidelines, or
remove the logos. `public/logos/custom-api.svg`, `src/assets/authority-logo.png`, `src/app/icon.png` and `docs/assets/authority-logo.png` are this project's own.

## npm dependencies (installed, not vendored)

The dependencies are installed from npm and keep their own licenses. A review on 2026-10-23 (`docs/LICENSES.md`)
found only permissive licenses, except for two packages with obligations to note:

- **`@img/sharp-libvips-*`** (LGPL-3.0-or-later): the prebuilt libvips binary that `sharp` loads dynamically. If you
  distribute an image or bundle that contains it, include its LGPL notice and allow it to be replaced.
- **`caniuse-lite`** (CC-BY-4.0): browser-support data. Attribution: "Can I use" data by Alexis Deveria
  (https://caniuse.com), used under CC BY 4.0.

Repeat the dependency review before each release: run `npm ls --omit=dev --all --parseable`, then read each
package's `license` field.
