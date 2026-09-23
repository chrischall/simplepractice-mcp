# Changelog

## [1.1.4](https://github.com/chrischall/simplepractice-mcp/compare/v1.1.3...v1.1.4) (2026-09-23)


### Bug Fixes

* **session:** stop a second server process resurrecting signed-out sessions ([#64](https://github.com/chrischall/simplepractice-mcp/issues/64)) ([613ec36](https://github.com/chrischall/simplepractice-mcp/commit/613ec363cf17a6d2bc7ce1b4352b84855fcfdbbb))

## [1.1.3](https://github.com/chrischall/simplepractice-mcp/compare/v1.1.2...v1.1.3) (2026-09-23)


### Bug Fixes

* **deps:** require zod ^4.6.5 to match @chrischall/mcp-utils 2.4.0 ([#63](https://github.com/chrischall/simplepractice-mcp/issues/63)) ([d683ec5](https://github.com/chrischall/simplepractice-mcp/commit/d683ec5a51114839f173b986e74983e55c32d4d7))
* **deps:** upgrade @chrischall/mcp-utils to 2.4.0 and @fetchproxy/* to 3.2.0 ([#61](https://github.com/chrischall/simplepractice-mcp/issues/61)) ([bb7fdf2](https://github.com/chrischall/simplepractice-mcp/commit/bb7fdf2f56a303074e4f0a45d052b865e9830c82))

## [1.1.2](https://github.com/chrischall/simplepractice-mcp/compare/v1.1.1...v1.1.2) (2026-09-21)


### Bug Fixes

* **deps:** bump dotenv from 17.4.2 to 18.0.0 ([#59](https://github.com/chrischall/simplepractice-mcp/issues/59)) ([e3450d2](https://github.com/chrischall/simplepractice-mcp/commit/e3450d240a441b8e6e9ee13953ab90a043ffcac6))

## [1.1.1](https://github.com/chrischall/simplepractice-mcp/compare/v1.1.0...v1.1.1) (2026-09-21)


### Bug Fixes

* **tools:** say which writes are destructive ([#54](https://github.com/chrischall/simplepractice-mcp/issues/54)) ([c6fe0ae](https://github.com/chrischall/simplepractice-mcp/commit/c6fe0aeed81878d9efbd803e3ca644e9a7b94c26))

## [1.1.0](https://github.com/chrischall/simplepractice-mcp/compare/v1.0.0...v1.1.0) (2026-09-19)


### Features

* **deps:** take mcp-utils 1.0.0 so the server boots through serveStdio ([#53](https://github.com/chrischall/simplepractice-mcp/issues/53)) ([a939a02](https://github.com/chrischall/simplepractice-mcp/commit/a939a027473f3e525d9386f0ce14cc5c4feed9fd))


### Performance

* **bundle:** drop the zod/v4 esbuild alias, halving dist/bundle.js ([#51](https://github.com/chrischall/simplepractice-mcp/issues/51)) ([334e2fb](https://github.com/chrischall/simplepractice-mcp/commit/334e2fb2de500a117ca2a75f494e7ff35ab2a6f3))

## [1.0.0](https://github.com/chrischall/simplepractice-mcp/compare/v0.4.2...v1.0.0) (2026-09-19)


### ⚠ BREAKING CHANGES

* **mcp:** migrate server to SDK v2 ([#47](https://github.com/chrischall/simplepractice-mcp/issues/47))

### Features

* **mcp:** migrate server to SDK v2 ([#47](https://github.com/chrischall/simplepractice-mcp/issues/47)) ([670699c](https://github.com/chrischall/simplepractice-mcp/commit/670699cf33a579f7b824500dd0bc8ee34bb99eb7))

## [0.4.2](https://github.com/chrischall/simplepractice-mcp/compare/v0.4.1...v0.4.2) (2026-09-10)


### Bug Fixes

* **deps:** @chrischall/mcp-utils 0.26.1 ([#42](https://github.com/chrischall/simplepractice-mcp/issues/42)) ([f151ce0](https://github.com/chrischall/simplepractice-mcp/commit/f151ce04c0a43ba2480b45a51be9c242bcd0584e))
* **deps:** bump hono from 4.13.4 to 4.13.7 ([#40](https://github.com/chrischall/simplepractice-mcp/issues/40)) ([d433b52](https://github.com/chrischall/simplepractice-mcp/commit/d433b52cb250693402d91f6d9dee43fd4f3a83e4))
* **deps:** declare the peer floors mcp-utils 0.26.1 requires ([#43](https://github.com/chrischall/simplepractice-mcp/issues/43)) ([76db2fe](https://github.com/chrischall/simplepractice-mcp/commit/76db2febb00f6fcfe74a05aee37abda5e7f11c10))

## [0.4.1](https://github.com/chrischall/simplepractice-mcp/compare/v0.4.0...v0.4.1) (2026-09-04)


### Documentation

* **skill:** document the `view` response-shape parameter ([#29](https://github.com/chrischall/simplepractice-mcp/issues/29)) ([10f4f2d](https://github.com/chrischall/simplepractice-mcp/commit/10f4f2d7b1e84bb4502bebfc96ea60659dac6f38))

## [0.4.0](https://github.com/chrischall/simplepractice-mcp/compare/v0.3.0...v0.4.0) (2026-09-04)


### Features

* **tools:** compact by default, on the projection this repo already had ([#23](https://github.com/chrischall/simplepractice-mcp/issues/23)) ([753158b](https://github.com/chrischall/simplepractice-mcp/commit/753158b9a34fc42ffabf87503bf877c4d2ac7085))


### Bug Fixes

* **deps:** pick up @chrischall/mcp-utils 0.23.2 ([#28](https://github.com/chrischall/simplepractice-mcp/issues/28)) ([ae683fe](https://github.com/chrischall/simplepractice-mcp/commit/ae683fea40cdd61fc971720f10169162520cb12f))

## [0.3.0](https://github.com/chrischall/simplepractice-mcp/compare/v0.2.0...v0.3.0) (2026-09-01)


### Features

* **auth:** take the practice from the emailed sign-in link ([#15](https://github.com/chrischall/simplepractice-mcp/issues/15)) ([fcd18e7](https://github.com/chrischall/simplepractice-mcp/commit/fcd18e75e15ce1713fb6156e805a87d37f418ff8))
* **health:** add simplepractice_healthcheck ([#13](https://github.com/chrischall/simplepractice-mcp/issues/13)) ([b37dbf2](https://github.com/chrischall/simplepractice-mcp/commit/b37dbf29f97b3f691e07e2fc7c6554e586a96391))


### Bug Fixes

* **auth:** stop a dry-run sign-in request from repointing the practice ([#19](https://github.com/chrischall/simplepractice-mcp/issues/19)) ([82f69ce](https://github.com/chrischall/simplepractice-mcp/commit/82f69cef4933b56df4ffb4efdd7d7e92fa05c50d))


### Documentation

* **health:** list simplepractice_healthcheck in manifest.json and the tool docs ([#17](https://github.com/chrischall/simplepractice-mcp/issues/17)) ([3e82128](https://github.com/chrischall/simplepractice-mcp/commit/3e8212892e594b387a90ba11994abfb57f30edd9))

## [0.2.0](https://github.com/chrischall/simplepractice-mcp/compare/v0.1.0...v0.2.0) (2026-08-25)


### Features

* declare how this MCP wants to be hosted, in mint.yaml ([#4](https://github.com/chrischall/simplepractice-mcp/issues/4)) ([97bbed1](https://github.com/chrischall/simplepractice-mcp/commit/97bbed16dcc6642dee048f4d20d854697abd0089))


### Bug Fixes

* correct the sign-in link shape and 401 diagnosis, now verified live ([#2](https://github.com/chrischall/simplepractice-mcp/issues/2)) ([ff7e567](https://github.com/chrischall/simplepractice-mcp/commit/ff7e567e5554f6ad7ad5648a9733f5c3a2ec5148))

## 0.1.0 (2026-08-24)


### Features

* SimplePractice Client Portal MCP server and fpx skill ([cc06b15](https://github.com/chrischall/simplepractice-mcp/commit/cc06b158fd6d6f9e59b581e6199e0bf2c8c7e820))
