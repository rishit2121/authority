# License and dependency review

## Project license: MIT, pending ownership confirmation

The intended license is MIT. It is proposed in the `release/mit-license` pull request (`LICENSE`, the `license` field
in every package, and `THIRD_PARTY_NOTICES.md`). That pull request stays unmerged until the maintainer confirms who
owns the copyright and fills in the holder. Until it merges, the code is not licensed for reuse.
`THIRD_PARTY_NOTICES.md` lists what MIT does not cover: the vendored fonts, the provider logos (trademarks) and
the dependencies that carry notice obligations.

## Production dependencies (reviewed 2026-10-23)

`npm ls --omit=dev --all`: 158 packages, all permissive or weak-copyleft:

| License                            | Packages                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| MIT                                | 129                                                                                                                    |
| ISC                                | 11                                                                                                                     |
| Apache-2.0                         | 7                                                                                                                      |
| BSD-3-Clause / BSD-2-Clause / 0BSD | 5                                                                                                                      |
| CC-BY-4.0                          | 1 (`caniuse-lite`, browser-support data; attribution)                                                                  |
| LGPL-3.0-or-later                  | `@img/sharp-libvips-*` (prebuilt libvips binary used by `sharp`, installed from npm, dynamically loaded; not vendored) |

Nothing found is incompatible with either a permissive or an AGPL project license. If you distribute a container
image or binary bundle that includes `sharp`'s libvips build, carry its LGPL notice and allow it to be replaced.

The fonts (Geist, Inter, Instrument Serif, Space Mono; SIL Open Font License 1.1) are vendored in
`src/assets/fonts/`, each next to its license text, and loaded with `next/font/local`. A build makes no network
request for fonts. Development dependencies are not distributed.

Re-run before each release: `npm ls --omit=dev --all --parseable`, then read each package's `license` field.
