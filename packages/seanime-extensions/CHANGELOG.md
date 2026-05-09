# Changelog

## [0.8.2](https://github.com/Viren070/AIOStreams/compare/seanime-extensions-v0.8.1...seanime-extensions-v0.8.2) (2026-05-09)


### Bug Fixes

* **seanime-extensions/aiostreams-plugin:** adjust overview/details card styling to match stream cards ([0de2a55](https://github.com/Viren070/AIOStreams/commit/0de2a55443f8d240994cfcc350291615e50275df))
* **seanime-extensions/aiostreams-plugin:** prefer meta type for mediaType from stremio custom source ([b28201b](https://github.com/Viren070/AIOStreams/commit/b28201bc8943b96252228cb33c5ff362e7fb215c))
* **seanime-extensions/stremio-custom-source:** handle non-series videos (e.g. movie collections) ([b28201b](https://github.com/Viren070/AIOStreams/commit/b28201bc8943b96252228cb33c5ff362e7fb215c)), closes [#930](https://github.com/Viren070/AIOStreams/issues/930)

## [0.8.1](https://github.com/Viren070/AIOStreams/compare/seanime-extensions-v0.8.0...seanime-extensions-v0.8.1) (2026-04-26)


### Bug Fixes

* **seanime-extensions/aiostreams-plugin:** add version check ([db6e5e4](https://github.com/Viren070/AIOStreams/commit/db6e5e4fd91fc761d7692b37978d4d0dac6934ff))

## [0.8.0](https://github.com/Viren070/AIOStreams/compare/seanime-extensions-v0.7.0...seanime-extensions-v0.8.0) (2026-04-23)


### Features

* **seanime-extensions/aiostreams-plugin:** register entry episode tab ([9109cf1](https://github.com/Viren070/AIOStreams/commit/9109cf1af6fb022d1a817663219032e365e87515))
* **seanime-extensions/aiostreams-plugin:** use torrent stream APIs for P2P streams ([9109cf1](https://github.com/Viren070/AIOStreams/commit/9109cf1af6fb022d1a817663219032e365e87515))


### Bug Fixes

* **seanime-extensions/aiostreams-plugin:** assume no prefix is tracker when building magnet ([65e6d78](https://github.com/Viren070/AIOStreams/commit/65e6d78089d264bd367b7c54d12af4f98b3cb033))
* **seanime-extensions/aiostreams-plugin:** handle tracker: prefix in sources when building magnet ([9109cf1](https://github.com/Viren070/AIOStreams/commit/9109cf1af6fb022d1a817663219032e365e87515))
* **seanime-extensions/aiostreams-plugin:** open externalUrl links in browser ([9109cf1](https://github.com/Viren070/AIOStreams/commit/9109cf1af6fb022d1a817663219032e365e87515))

## [0.7.0](https://github.com/Viren070/AIOStreams/compare/seanime-extension-v0.6.0...seanime-extension-v0.7.0) (2026-04-22)


### Features

* **seanime-extension/aiostreams-plugin:** add refresh icon button to results view ([1fe0a4c](https://github.com/Viren070/AIOStreams/commit/1fe0a4c07782b7a3643ad4455bd48de8bee05cfd))
* **seanime-extension/aiostreams-plugin:** add retry button on failure ([1fe0a4c](https://github.com/Viren070/AIOStreams/commit/1fe0a4c07782b7a3643ad4455bd48de8bee05cfd))
* **seanime-extension/aiostreams-plugin:** allow managing downloads from tray ([1fe0a4c](https://github.com/Viren070/AIOStreams/commit/1fe0a4c07782b7a3643ad4455bd48de8bee05cfd))
* **seanime-extension/aiostreams-plugin:** clean up details overlay ([56435c1](https://github.com/Viren070/AIOStreams/commit/56435c1d5006faa3b77133dc7755316de7611491))
* **seanime-extension/aiostreams-plugin:** esc key closes results view ([1fe0a4c](https://github.com/Viren070/AIOStreams/commit/1fe0a4c07782b7a3643ad4455bd48de8bee05cfd))
* **seanime-extension/aiostreams-plugin:** remove results badge and move to bottom text ([1fe0a4c](https://github.com/Viren070/AIOStreams/commit/1fe0a4c07782b7a3643ad4455bd48de8bee05cfd))
* **seanime-extension:** add Stremio custom source extension ([d3a040b](https://github.com/Viren070/AIOStreams/commit/d3a040bfe29f632a90e9959d74591470dca5d1b4))
* **seanime-extension:** add support for stremio custom sources to plugin and torrent provider ([6bca3fd](https://github.com/Viren070/AIOStreams/commit/6bca3fd91461ce8041996753366f3a02ebb8da81))


### Bug Fixes

* **seanime-extension/aiostreams-plugin:** fix media type detection for movies ([70e64eb](https://github.com/Viren070/AIOStreams/commit/70e64eb15daf45fa199c9d872f964bba215c3948))
* **seanime-extensions/stremio-custom-source:** ignore duplicates ([2fb691b](https://github.com/Viren070/AIOStreams/commit/2fb691b4d71009e81092838ae33bd474fb3b0cb4))
* **seanime-extensions:** use consistent requiresConfig value ([d9d100c](https://github.com/Viren070/AIOStreams/commit/d9d100c2a3aca75697eda4652b9f9783fbdf0127))

## [0.6.0](https://github.com/Viren070/AIOStreams/compare/seanime-extension-v0.5.0...seanime-extension-v0.6.0) (2026-04-18)


### Features

* **seanime-extension:** add built-in player support, make default ([fe850b5](https://github.com/Viren070/AIOStreams/commit/fe850b5bdd06045bedf36ec39e4d9cfdc109890f))
* **seanime-extension:** add files and update scripts, configs, and dockerfiles ([74395c8](https://github.com/Viren070/AIOStreams/commit/74395c85e7da2e30df100c2c2377bd23931e35fa))
* **seanime-extension:** auto close on click outside results webview ([fe850b5](https://github.com/Viren070/AIOStreams/commit/fe850b5bdd06045bedf36ec39e4d9cfdc109890f))
* **seanime-extension:** improve mobile view of results view ([fe850b5](https://github.com/Viren070/AIOStreams/commit/fe850b5bdd06045bedf36ec39e4d9cfdc109890f))


### Bug Fixes

* **seanime-extension:** dont auto play on manual panel re-open ([b8aabf3](https://github.com/Viren070/AIOStreams/commit/b8aabf33e6c1c92d04d8c777cdc5b84cd6a8d7e5))

## [0.5.0](https://github.com/Viren070/AIOStreams/compare/seanime-extension-v0.4.0...seanime-extension-v0.5.0) (2026-04-18)


### Features

* **seanime-extension:** add built-in player support, make default ([fe850b5](https://github.com/Viren070/AIOStreams/commit/fe850b5bdd06045bedf36ec39e4d9cfdc109890f))
* **seanime-extension:** add files and update scripts, configs, and dockerfiles ([74395c8](https://github.com/Viren070/AIOStreams/commit/74395c85e7da2e30df100c2c2377bd23931e35fa))
* **seanime-extension:** auto close on click outside results webview ([fe850b5](https://github.com/Viren070/AIOStreams/commit/fe850b5bdd06045bedf36ec39e4d9cfdc109890f))
* **seanime-extension:** improve mobile view of results view ([fe850b5](https://github.com/Viren070/AIOStreams/commit/fe850b5bdd06045bedf36ec39e4d9cfdc109890f))


### Bug Fixes

* **seanime-extension:** dont auto play on manual panel re-open ([b8aabf3](https://github.com/Viren070/AIOStreams/commit/b8aabf33e6c1c92d04d8c777cdc5b84cd6a8d7e5))

## [0.4.0](https://github.com/Viren070/AIOStreams/compare/seanime-extension-v0.3.0...seanime-extension-v0.4.0) (2026-04-17)


### Features

* **seanime-extension:** add files and update scripts, configs, and dockerfiles ([74395c8](https://github.com/Viren070/AIOStreams/commit/74395c85e7da2e30df100c2c2377bd23931e35fa))
