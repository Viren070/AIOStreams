# Changelog

## [2.22.0](https://github.com/Viren070/AIOStreams/compare/v2.21.4...v2.22.0) (2026-01-22)


### Features

* add 'Original' option in language filters ([72e37ea](https://github.com/Viren070/AIOStreams/commit/72e37eaa105a0392093902f8233117c54dc77c66)), closes [#526](https://github.com/Viren070/AIOStreams/issues/526) [#468](https://github.com/Viren070/AIOStreams/issues/468)
* add bitrate to filters, sorting, formatter, and SEL ([#631](https://github.com/Viren070/AIOStreams/issues/631)) ([073724f](https://github.com/Viren070/AIOStreams/commit/073724ff74dd6d0b2143d05b1cf1f5efb69e6cf1))
* allow configuring max sel / formatter length ([384ccda](https://github.com/Viren070/AIOStreams/commit/384ccdabcbc2a9d8a604768f39a4e31a6d947a76))
* allow customising cache TTLs per preset/hostname ([47eabef](https://github.com/Viren070/AIOStreams/commit/47eabefd64308ea45955311325a187d734cc6b9e)), closes [#581](https://github.com/Viren070/AIOStreams/issues/581) [#580](https://github.com/Viren070/AIOStreams/issues/580)
* **anime-database:** add new source and other improvements ([f47a441](https://github.com/Viren070/AIOStreams/commit/f47a441b6db3afe366e3b3af77ecafbe330dae1a))
* **build/docker:** switch to debian based distroless image ([74653a3](https://github.com/Viren070/AIOStreams/commit/74653a323a295db7840b6accbe35b179fa8a934e))
* **builtins/newznab:** add `BUILTIN_NAB_HTTP_PROXY` ([28eaafa](https://github.com/Viren070/AIOStreams/commit/28eaafa9be94b07ae77c09ee184169904b598963))
* enable seadex integration by default ([1af1932](https://github.com/Viren070/AIOStreams/commit/1af1932c02d81d4fef394422c84a2533bee9d7d9))
* fallback to cached manifest on save/refresh if available ([df39400](https://github.com/Viren070/AIOStreams/commit/df394007812e124477dae1b2a2e1ef4b93337778))
* **formatter:** add `smallcaps` string modifier ([0e186dc](https://github.com/Viren070/AIOStreams/commit/0e186dc25147c1a9b11622028f7b071b2402538c))
* improve seasonPack detection and add folderSeasons, formattedFolderSeasons, folderEpisodes, formattedFolderEpisodes to formatter ([47ea735](https://github.com/Viren070/AIOStreams/commit/47ea735d0d93c4aee05cc1bfc4c5723b92b9268c))
* **sel:** add `values` &`avg`, functions; custom `min` & `max` functions; enable `random` function. ([60d3445](https://github.com/Viren070/AIOStreams/commit/60d34458a87ab04a30220a9c43a3f7b8707f597b))
* **sel:** add median, sum, variance ([267c75d](https://github.com/Viren070/AIOStreams/commit/267c75d1d464df1ac21088be638398accf8a7e15))
* **sel:** add metadata constants to expression filters ([e0ae160](https://github.com/Viren070/AIOStreams/commit/e0ae16004531352ae0eddfaed72cda97f66bcef4))
* **sel:** add percentile, range, iqr, stddev, mode, skewness, kurtosis functions ([9513378](https://github.com/Viren070/AIOStreams/commit/951337806a6ee391084fa8278082cb655ca20c9d))
* **sel:** enable sqrt ([267c75d](https://github.com/Viren070/AIOStreams/commit/267c75d1d464df1ac21088be638398accf8a7e15))
* update predefined formatters ([f4bfb31](https://github.com/Viren070/AIOStreams/commit/f4bfb31f1bfc3ecea049992bb132393208d9ca90))


### Bug Fixes

* **anime-database:** dont use tmdb episode offset ([3ebfc9b](https://github.com/Viren070/AIOStreams/commit/3ebfc9ba99343e2a7466c8389dbc68a9078be12e))
* **build/docker:** add /bin/sh for backwards compatability ([1568296](https://github.com/Viren070/AIOStreams/commit/1568296cfdb628fff73cc3538f76b5fa49a5e9e3))
* **builtins/newznab:** always set user agent by default ([dc031ea](https://github.com/Viren070/AIOStreams/commit/dc031ea5ff918d9e59b378912cc1261ba88bb600))
* **builtins/newznab:** prefer usenetdate for age and fallback to enclosure length for size ([2ac54d6](https://github.com/Viren070/AIOStreams/commit/2ac54d668dcdaf65fca367850ccaf47378a04c05))
* **builtins/znab:** append search params from apiPath to params ([9bb7099](https://github.com/Viren070/AIOStreams/commit/9bb7099037708e159ab8683b094c9fbf98255217))
* **cache:** flush stale entrie on write when necessary and add separate size variable ([6cabe65](https://github.com/Viren070/AIOStreams/commit/6cabe6520c485cf2fd91e751e6ba361c1287af3a))
* **debrid:** handle TOO_MANY_REQUESTS with specific error video ([b893191](https://github.com/Viren070/AIOStreams/commit/b8931915a964abdffa9bee005a4129e01484c186))
* **debrid:** improve error handling for file info and store auth parsing ([5656af4](https://github.com/Viren070/AIOStreams/commit/5656af4e1638d197ade14fdb7ebc6f344800da57))
* **debrid:** pass zod error through, and use 307 status code. ([5ced1a5](https://github.com/Viren070/AIOStreams/commit/5ced1a5b4975a9eebf7314695de7021487417cde))
* divide by episode count for episode packs during bitrate calculation ([58111dc](https://github.com/Viren070/AIOStreams/commit/58111dc62e046ead537fd1d7ae6bdd21457ef295))
* dont calculate bitrate using runtime for season packs ([14e5b60](https://github.com/Viren070/AIOStreams/commit/14e5b60e1e7b7a6f0edbd2c5cbd05db53aee30ef))
* **env:** update regex for user agent mappings to allow wildcard characters ([d29c0a3](https://github.com/Viren070/AIOStreams/commit/d29c0a3820d701cb0e9064bf1721ac87c740ee36))
* estimate bitrate for season packs using season data from metadata ([6b84fbc](https://github.com/Viren070/AIOStreams/commit/6b84fbcc9fc1987bf1231e0a0ef07f003f629bb1))
* fallback to volumes for season ([93ee286](https://github.com/Viren070/AIOStreams/commit/93ee2861b87d1042f0920f7cdee28ff197bc4232))
* **healthcheck:** use status endpoint ([d8d1f06](https://github.com/Viren070/AIOStreams/commit/d8d1f0638d9f8b2c13ce2415c01e4e80eeb6bfeb))
* ignore usenet types for seeder range ([fdbca21](https://github.com/Viren070/AIOStreams/commit/fdbca21757bfe335b4b02527a3a1812f46f003f3))
* **presets/nzbhydra:** pass through pagination and add initial limit option ([a67ff08](https://github.com/Viren070/AIOStreams/commit/a67ff085566bb79c6d1c28fc92ff52965e67c525))
* **presets/orion:** increase max constraint to 500 ([dba96f1](https://github.com/Viren070/AIOStreams/commit/dba96f14431f67a4a191377d0959b6f822c2396d))
* reduce filter log noise ([e11649d](https://github.com/Viren070/AIOStreams/commit/e11649d5cf9da41777fa428599996c68a30352a1))
* **usenet-stream-base:** cache resolve errors ([abe8dbc](https://github.com/Viren070/AIOStreams/commit/abe8dbca167de6494aa2b568a0061fd222ea2282))


### Miscellaneous Chores

* **Dockerfile:** add opencontainer labels ([d1e288f](https://github.com/Viren070/AIOStreams/commit/d1e288fd01a90cbf9dd38e55fee4dc199cf7f619))

## [2.21.4](https://github.com/Viren070/AIOStreams/compare/v2.21.3...v2.21.4) (2026-01-16)


### Bug Fixes

* handle undefined user agent and ensure only added when valid ([6ad1aba](https://github.com/Viren070/AIOStreams/commit/6ad1aba842eb8be2a1da0f40fd035bbea10acf3b))

## [2.21.3](https://github.com/Viren070/AIOStreams/compare/v2.21.2...v2.21.3) (2026-01-15)


### Bug Fixes

* **presets/sootio:** ensure httpProviders only added if defined, remove scraper options ([73894a4](https://github.com/Viren070/AIOStreams/commit/73894a46c0dbbb92d546dadb9fcc3fdad5516710))

## [2.21.2](https://github.com/Viren070/AIOStreams/compare/v2.21.1...v2.21.2) (2026-01-15)


### Bug Fixes

* allow setting user agent to false to disable it, disable by default for newznab ([9f88bc6](https://github.com/Viren070/AIOStreams/commit/9f88bc6875c35105688054e637ea309c75f61ed1))
* **presets/sootio:** add indexer option, easynews support, and correctly handle multiple services ([afc4523](https://github.com/Viren070/AIOStreams/commit/afc4523b02a202097333a921373783264e858407))
* **presets/sootio:** update HTTP stream provider options ([#626](https://github.com/Viren070/AIOStreams/issues/626)) ([e0bd36e](https://github.com/Viren070/AIOStreams/commit/e0bd36e631303a31b2c8c6add7e0b9f7a5d1cf90))
* use correct timeout ([df4160c](https://github.com/Viren070/AIOStreams/commit/df4160c387ecde867cd2146f8aa46c9b3a8b75a3))

## [2.21.1](https://github.com/Viren070/AIOStreams/compare/v2.21.0...v2.21.1) (2026-01-11)


### Bug Fixes

* **anime-database:** enrich mappings where possible ([f31b701](https://github.com/Viren070/AIOStreams/commit/f31b7019612fa5867c35ab1eb6c8375ced13c48b))
* **builtins:** prefer size from debrid ([b3470d6](https://github.com/Viren070/AIOStreams/commit/b3470d6816949772c5f92c227acc91dedc9d490f))
* **env:** handle commas within user agent in hostname mapping ([b20c226](https://github.com/Viren070/AIOStreams/commit/b20c2260c0e56c075299b17412f64ea69f3347a2)), closes [#623](https://github.com/Viren070/AIOStreams/issues/623)
* handle many entries for one id, fallback to synonym matching ([2feed67](https://github.com/Viren070/AIOStreams/commit/2feed6791908ec6e1a652e43c21cd30ae802f3be))
* prefer exact episode matches to batches ([86b771f](https://github.com/Viren070/AIOStreams/commit/86b771f8787cf21f647163519f24401413f1de14))
* **seadex:** pass season/episode to get correct mapping ([9cc333a](https://github.com/Viren070/AIOStreams/commit/9cc333a0c1763db47a4787a00ed5dac1b068374b))
* **usenet-stream:** add nzb url to lock key ([a1dcd52](https://github.com/Viren070/AIOStreams/commit/a1dcd52592d15423a42703cd629327007d68a4b2))

## [2.21.0](https://github.com/Viren070/AIOStreams/compare/v2.20.1...v2.21.0) (2026-01-09)


### Features

* **builtins/seadex:** add addon ([fe6ce9d](https://github.com/Viren070/AIOStreams/commit/fe6ce9d210dd7382e6e8ef8d03ff4417d4e516a4))
* **builtins:** add auto remove downloads option ([#605](https://github.com/Viren070/AIOStreams/issues/605)) ([2cf73eb](https://github.com/Viren070/AIOStreams/commit/2cf73eb562a50625a4e13c0c554aa1242372078e))


### Bug Fixes

* adjust poster service option ([616838a](https://github.com/Viren070/AIOStreams/commit/616838a51e13f270819aaf57717b9895dc662204))
* allow 'removing' presets, handle disabled presets explicitly., handle initialisation errors in catalog route ([e8c961a](https://github.com/Viren070/AIOStreams/commit/e8c961ae1a1ab41b78e5836442cce7dd5a331cae))
* **builtins/seadex:** add torrent sources for Nyaa ([83259b7](https://github.com/Viren070/AIOStreams/commit/83259b75ad295dd7b951edd010e49cf761a00fd8))
* **builtins:** pass release group through ([f1e3096](https://github.com/Viren070/AIOStreams/commit/f1e309608cd72aaa8d2bdea1a61735fc58944c66))
* filter out top poster api key ([4ebf159](https://github.com/Viren070/AIOStreams/commit/4ebf159ff3c595a5105e74612cea1dc848cefb9f))
* fix digital release ([#600](https://github.com/Viren070/AIOStreams/issues/600)) ([de956de](https://github.com/Viren070/AIOStreams/commit/de956deb9472f5a85be660030199d6fac72b36de))
* handle sub client redis errors ([2fee58d](https://github.com/Viren070/AIOStreams/commit/2fee58d82ff591b31dd771d9f5ab1a848f4cc723))
* make domain user agent env var consistent ([80a244b](https://github.com/Viren070/AIOStreams/commit/80a244b7a2a55b5e5c56e924d6f3878e4feaea6d))
* **parser/regex:** handle optional 'a' after ddp for audio channel patterns ([#601](https://github.com/Viren070/AIOStreams/issues/601)) ([60ca210](https://github.com/Viren070/AIOStreams/commit/60ca210d7eaeffea4d4cbadd0a65460711492407))
* pass folder size in builtins, add folderName support ([e2b9a19](https://github.com/Viren070/AIOStreams/commit/e2b9a19638b3053a72e52bf15d0fb22ee162eb6a))
* **presets/comet:** change Comet default url to developers' own instance ([#619](https://github.com/Viren070/AIOStreams/issues/619)) ([20d3c40](https://github.com/Viren070/AIOStreams/commit/20d3c40b48990918a7b88c0b589a7263dbbc42a4))
* **presets/comet:** update logo url ([438b0cd](https://github.com/Viren070/AIOStreams/commit/438b0cd125704c33963160a46a8a0eb287a23328))
* **presets/debridio-ic4a:** mark preset as removed ([65cfcf6](https://github.com/Viren070/AIOStreams/commit/65cfcf669299eec369d9b593dd67536540060bc2))
* **presets/sootio:** update default url to developers' own instance ([#618](https://github.com/Viren070/AIOStreams/issues/618)) ([533eb61](https://github.com/Viren070/AIOStreams/commit/533eb61144b3b5cbbb534149d515f799e26d2141))
* **templates:** Apply migrations before parsing the config ([#604](https://github.com/Viren070/AIOStreams/issues/604)) ([21fec28](https://github.com/Viren070/AIOStreams/commit/21fec287dbe432d74dc646d0177930c62855ac6c))
* update default zilean URL ([67f9062](https://github.com/Viren070/AIOStreams/commit/67f906289a09e947946f02cf3aab8ed55ab2e208))
* use logical OR for public webdav URL fallback ([1dd01c4](https://github.com/Viren070/AIOStreams/commit/1dd01c49e7dffa44f1f46e109208d91167737092))

## [2.20.1](https://github.com/Viren070/AIOStreams/compare/v2.20.0...v2.20.1) (2026-01-03)


### Bug Fixes

* allow only on discover modification application when no extras are present ([694ca3f](https://github.com/Viren070/AIOStreams/commit/694ca3f137b89dcbfc917384825afbce74dc4ecf))

## [2.20.0](https://github.com/Viren070/AIOStreams/compare/v2.19.0...v2.20.0) (2026-01-02)


### Features

* add 'Use Poster Service for Library/Continue Watching' option ([bbe9ed8](https://github.com/Viren070/AIOStreams/commit/bbe9ed86d79e4d803f3cb8fe3f55a659416a0b25)), closes [#566](https://github.com/Viren070/AIOStreams/issues/566)
* add DTS-X audio tag support which was previously being misclassified  ([#523](https://github.com/Viren070/AIOStreams/issues/523)) ([8c4485a](https://github.com/Viren070/AIOStreams/commit/8c4485a019f37f863230147f863ba298c404e6f3))
* add HLG visual tag support ([#562](https://github.com/Viren070/AIOStreams/issues/562)) ([ac3bba7](https://github.com/Viren070/AIOStreams/commit/ac3bba7bf457e996c1fa9c5d8d733a0e2827cd9c))
* add merged catalogs ([#520](https://github.com/Viren070/AIOStreams/issues/520)) ([8dc730a](https://github.com/Viren070/AIOStreams/commit/8dc730a7467c4ed9e78096a758f1f3e697f60214))
* add only on searh catalog modifier ([ab4691d](https://github.com/Viren070/AIOStreams/commit/ab4691dafde47758c7fc58f6c4807d53da805564))
* add passthrough() SEL function ([#522](https://github.com/Viren070/AIOStreams/issues/522)) ([7ea0cbb](https://github.com/Viren070/AIOStreams/commit/7ea0cbb4192e1bfeb4289694d88146987c74da63))
* adjustments to merged catalogs ([47d2ba4](https://github.com/Viren070/AIOStreams/commit/47d2ba48dcc75875bbdb0e214cc98e3a7c2caac3))
* allow removing catalogs from merged catalogs via quick access close icon ([ab4691d](https://github.com/Viren070/AIOStreams/commit/ab4691dafde47758c7fc58f6c4807d53da805564))
* apply digital release filter to series, add more filtering options ([#590](https://github.com/Viren070/AIOStreams/issues/590)) ([22ec202](https://github.com/Viren070/AIOStreams/commit/22ec202068389bef59575a5208a171741c80f06d))
* **builtins/nab:** add specific env var for user agent ([c3c3184](https://github.com/Viren070/AIOStreams/commit/c3c31843911a3c82aa44e4aa84c7292db985e478))
* **chilllink:** initial protocol support ([#586](https://github.com/Viren070/AIOStreams/issues/586)) ([cba790c](https://github.com/Viren070/AIOStreams/commit/cba790cfaf22c41e07b61157a97d72ae7bdafda8))
* **frontend:** make sign out / log in always visible ([6a3aaa9](https://github.com/Viren070/AIOStreams/commit/6a3aaa91883293578a3090382e220d62c0decb1d))
* implement top poster api option ([#583](https://github.com/Viren070/AIOStreams/issues/583)) ([fd62d9b](https://github.com/Viren070/AIOStreams/commit/fd62d9b23873b8d5f47f274b9f4c7bb7b3c94fe0))
* **newznab:** Add crowdsourced health check support via Zyclops ([#552](https://github.com/Viren070/AIOStreams/issues/552)) ([285cf11](https://github.com/Viren070/AIOStreams/commit/285cf110de833724da029c9b8a7f6efe4e48901c))
* **presets/debridio-ic4a:** add initial preset ([#591](https://github.com/Viren070/AIOStreams/issues/591)) ([4c5bc93](https://github.com/Viren070/AIOStreams/commit/4c5bc93bb784de74543de418f8344cfd533658d9))
* support sub section template option ([99090fe](https://github.com/Viren070/AIOStreams/commit/99090feeaffce540c4e1d70231f52ddbaed4d3a6))
* use logo without background ([81cc5ee](https://github.com/Viren070/AIOStreams/commit/81cc5ee37e280cd72ad98e56e05b03f4e686f675))


### Bug Fixes

* add missing NextFunction type to request handler ([3374950](https://github.com/Viren070/AIOStreams/commit/337495002fe547f1fd0985fd7116190e721a9aee))
* add Teaser as valid type for trailer ([094d029](https://github.com/Viren070/AIOStreams/commit/094d02999c26129167f3b469d4cc6d61ea1324aa))
* always provide stream data in meta endpoint ([1d317a0](https://github.com/Viren070/AIOStreams/commit/1d317a05b5297dd1d1d48c63119ab227f6f6b072))
* **anime-db:** add error handling for data source refresh in AnimeDatabase ([6eab1ca](https://github.com/Viren070/AIOStreams/commit/6eab1ca3e0a5dc39ceba00ff8c90f6a5fc149b4c))
* **anime-db:** allow undefined year ([e4b591d](https://github.com/Viren070/AIOStreams/commit/e4b591df228ecf42f272fee2f8619dabee754f8f))
* **anime-db:** update manami db url ([68e2755](https://github.com/Viren070/AIOStreams/commit/68e27555cb1c7a70a98527d9ca4185c9c9c79de0))
* avoid re-parsing extras causing double encoding ([d7ee994](https://github.com/Viren070/AIOStreams/commit/d7ee9947c287766a3b299149a2c208d978591d21))
* Change included SEL behaviour so it respects passthrough flags ([#577](https://github.com/Viren070/AIOStreams/issues/577)) ([29d2fa9](https://github.com/Viren070/AIOStreams/commit/29d2fa912159bf4fd210b62ad4e1bd7ce523c1d2))
* check imdb_id when deduplicating merged catalogs and refactor ([878254c](https://github.com/Viren070/AIOStreams/commit/878254c12e7ef01a3fff75191b2e76e57c569b45))
* **constants:** update default auto play attributes ([689b8a2](https://github.com/Viren070/AIOStreams/commit/689b8a2dc3d40faaab2c113305c31d5c335dd6f2))
* **frontend:** add pading ([dae366c](https://github.com/Viren070/AIOStreams/commit/dae366c11ce0f87e2cd8387590965e5fb3d169f0))
* **frontend:** disable strict if yearMatching is disabled, improve descriptions ([#589](https://github.com/Viren070/AIOStreams/issues/589)) ([7bdfa82](https://github.com/Viren070/AIOStreams/commit/7bdfa82f8d4f2dac52c69cc321c18cadec6b21a2))
* **frontend:** provide textinput with manifest URL ([b0b5515](https://github.com/Viren070/AIOStreams/commit/b0b5515297d15c84e7d561c4068da001ca7f66a3)), closes [#517](https://github.com/Viren070/AIOStreams/issues/517)
* only set length requirement when cred is required ([7ee8342](https://github.com/Viren070/AIOStreams/commit/7ee834221d46cd6219d62a95b09f00d773c3c6d9))
* **parser/regex:** handle optional `a` after ddp for atmos([#561](https://github.com/Viren070/AIOStreams/issues/561)) ([a501b13](https://github.com/Viren070/AIOStreams/commit/a501b13d17389eba2f4a39e14bf5e30af6ab3b20))
* **parser:** dont use country handler ([304b032](https://github.com/Viren070/AIOStreams/commit/304b032de9e35c35e1a7980b26f14ff8dc89626c))
* **presets/comet:** update logo URL ([6b6f747](https://github.com/Viren070/AIOStreams/commit/6b6f747538b438fd83cfba8f9171111bf19817ae))
* **presets/nuviostreams:** correct label casing and add VixSrc entry to nuivo streams ([#592](https://github.com/Viren070/AIOStreams/issues/592)) ([395d65f](https://github.com/Viren070/AIOStreams/commit/395d65fa5fa93df77907c718a8061ed2231b28a8))
* **presets/stremthru-torz:** use correct default timeout env variable ([#579](https://github.com/Viren070/AIOStreams/issues/579)) ([56dc39f](https://github.com/Viren070/AIOStreams/commit/56dc39f42021b0b904ee18d5f25fe0fe8f6230de))
* **proxy:** handle errors safely ([dec001e](https://github.com/Viren070/AIOStreams/commit/dec001edeb5af72499b244f4e2f4369e173df4e0))
* skip catalog if requires extra that is not available ([403ca3e](https://github.com/Viren070/AIOStreams/commit/403ca3e1b57e043de923f685ceeef5a50d3be20e))

## [2.19.0](https://github.com/Viren070/AIOStreams/compare/v2.18.1...v2.19.0) (2025-12-17)


### Features

* add easynews search built-in addon ([7c5ea8a](https://github.com/Viren070/AIOStreams/commit/7c5ea8a58c61dd8cc5f80031cb2769e8c9ede728))
* add SeaDex preference support for anime streams ([#512](https://github.com/Viren070/AIOStreams/issues/512)) ([b4b6929](https://github.com/Viren070/AIOStreams/commit/b4b69291e601452799393fa57ced497bbe133ecc))
* add separate size filter for anime content ([#483](https://github.com/Viren070/AIOStreams/issues/483)) ([ff168cf](https://github.com/Viren070/AIOStreams/commit/ff168cf25594a5729a12b72583d8aebb033bc9fd))
* **metadata:** add FETCH_TRAKT_ALIASES env var to toggle Trakt alias fetching ([#543](https://github.com/Viren070/AIOStreams/issues/543)) ([a40bcc5](https://github.com/Viren070/AIOStreams/commit/a40bcc5844f56f810848f1da569ee0caad13dd36))
* **presets/stremthru-store:** add usenet option ([7c5ea8a](https://github.com/Viren070/AIOStreams/commit/7c5ea8a58c61dd8cc5f80031cb2769e8c9ede728))
* **proxy:** add connections limit, closes [#457](https://github.com/Viren070/AIOStreams/issues/457) ([7c5ea8a](https://github.com/Viren070/AIOStreams/commit/7c5ea8a58c61dd8cc5f80031cb2769e8c9ede728))
* **seadex:** add release group fallback matching ([#521](https://github.com/Viren070/AIOStreams/issues/521)) ([7ed51bc](https://github.com/Viren070/AIOStreams/commit/7ed51bc6f08c6f3cf7395f3a53c60ae39d441ada))


### Bug Fixes

* Avoid expensive user count when not exposing users anyway ([#547](https://github.com/Viren070/AIOStreams/issues/547)) ([1165371](https://github.com/Viren070/AIOStreams/commit/11653713c29b414383b5d16fecadc18c220eaf96))
* **builtins/easnews-search:** validate aiostreamsAuth if provided ([309928d](https://github.com/Viren070/AIOStreams/commit/309928de2cbdf07f4485f49d98421ac8ccf6cd9f))
* **builtins/easynews-search:** update nzb route to include filename ([c0a222f](https://github.com/Viren070/AIOStreams/commit/c0a222f19a5ab709b54e4726343ea5e17638f863))
* **builtins/newznab:** use available filename for proxied urls ([9e14ab2](https://github.com/Viren070/AIOStreams/commit/9e14ab27b94933ddf3c8a5acba6dbab68e82654b))
* **builtins:** add year only for movies in debrid addons search ([#539](https://github.com/Viren070/AIOStreams/issues/539)) ([36b5358](https://github.com/Viren070/AIOStreams/commit/36b5358623b3efaffd5dfaf0e5756ca102f7c059))
* **debrid:** capitalize TV category name for Usenet streams ([#538](https://github.com/Viren070/AIOStreams/issues/538)) ([d5f5611](https://github.com/Viren070/AIOStreams/commit/d5f561123f048f5161373df55a6fef1e85a4adac))
* force include season/ep in params for certain indexers ([1137195](https://github.com/Viren070/AIOStreams/commit/11371958f2ececa4103cd5947e901026154d3021))
* **frontend:** added missing space to proxy url ([#515](https://github.com/Viren070/AIOStreams/issues/515)) ([1e06ad9](https://github.com/Viren070/AIOStreams/commit/1e06ad987af8a9cd656fdea62560c9be7f81c743))
* improve logging for fetch failed errors ([b0950fe](https://github.com/Viren070/AIOStreams/commit/b0950fe9e04f009d69a029a553582507e4111723))
* optimise getUserCount by only using count, cherry picked from [#548](https://github.com/Viren070/AIOStreams/issues/548) ([7c5ea8a](https://github.com/Viren070/AIOStreams/commit/7c5ea8a58c61dd8cc5f80031cb2769e8c9ede728))
* **parser:** remove ind from filename before lang parsing if group, closes [#530](https://github.com/Viren070/AIOStreams/issues/530) ([7c5ea8a](https://github.com/Viren070/AIOStreams/commit/7c5ea8a58c61dd8cc5f80031cb2769e8c9ede728))
* **parser:** replace German umlauts with ASCII equivalents in normaliseTitle ([#525](https://github.com/Viren070/AIOStreams/issues/525)) ([f7c1124](https://github.com/Viren070/AIOStreams/commit/f7c1124ebccef46e70ea63c7c430e359604ad63f))
* passthrough precomputed seadex and stream expression matched from wrapped aiostreams ([eb704a4](https://github.com/Viren070/AIOStreams/commit/eb704a42c86af9705359f099d4c50ca54933225d))
* **seadex:** prevent matching by release group when there are streams matched by hash ([#534](https://github.com/Viren070/AIOStreams/issues/534)) ([3b3ec2b](https://github.com/Viren070/AIOStreams/commit/3b3ec2ba1e716d173244e4b30e6c160a7b2fa07f))

## [2.18.1](https://github.com/Viren070/AIOStreams/compare/v2.18.0...v2.18.1) (2025-11-29)


### Bug Fixes

* **presets/usenet-streamer:** correctly identify type and service ([58caf63](https://github.com/Viren070/AIOStreams/commit/58caf63d134feddb15e0c0fe2d350be66da652b1))
* remove length requirement on addonName ([2e7622e](https://github.com/Viren070/AIOStreams/commit/2e7622e1b24f88194445e470850d5416d82b3a08))

## [2.18.0](https://github.com/Viren070/AIOStreams/compare/v2.17.6...v2.18.0) (2025-11-28)


### Features

* add check owned option ([5434da5](https://github.com/Viren070/AIOStreams/commit/5434da5777c45a7c06e77ea3d9d70d6bd4da0bdc))
* allow excluding addons from deduplication ([44be565](https://github.com/Viren070/AIOStreams/commit/44be5657cb35f56e28ecf19c53a2566149adeb1a))
* allow providing nntp servers in stremio nntp service ([e92d68e](https://github.com/Viren070/AIOStreams/commit/e92d68e92528c28ab9997667328fefe7752222ef))
* **api/search:** add format param for name/description fields ([c0a6921](https://github.com/Viren070/AIOStreams/commit/c0a69215b1ba0d147ced321eaeb081c41a54a79a))
* **builtins:** search with background refresh ([ece56a2](https://github.com/Viren070/AIOStreams/commit/ece56a2da8647c362a1f3de6fe1792eede183c8e))
* **presets/aiostreams:** add custom addon options (library, passthrough etc.) ([c6d79c4](https://github.com/Viren070/AIOStreams/commit/c6d79c4898d08b1afc895d1c49a468467ff78ac4))
* **presets/nekoBt:** add preset ([e96fb95](https://github.com/Viren070/AIOStreams/commit/e96fb95151676aae073c77d2c34901dea88c37bc))
* **sel:** add message function ([6cd7fb5](https://github.com/Viren070/AIOStreams/commit/6cd7fb58aaa35521702d132456e44ab3b30e3693))
* **sel:** enable division and multiplication ([550d8d7](https://github.com/Viren070/AIOStreams/commit/550d8d77fbe129171695795fb29879cf55879947))
* support nzbUrl and archive url fields ([e92d68e](https://github.com/Viren070/AIOStreams/commit/e92d68e92528c28ab9997667328fefe7752222ef))
* update builtin addons to support stremio nntp ([e92d68e](https://github.com/Viren070/AIOStreams/commit/e92d68e92528c28ab9997667328fefe7752222ef))


### Bug Fixes

* add | as separator ([dd89372](https://github.com/Viren070/AIOStreams/commit/dd893725f1672b45b460c98d2182c02da83844a2))
* add CORS middleware to static file route ([5e6e134](https://github.com/Viren070/AIOStreams/commit/5e6e1340ad6a920ae3958f6591d71b1f41fe8c8d))
* **builtins/nab:** handle no title and empty channel ([7b77640](https://github.com/Viren070/AIOStreams/commit/7b776405e17cce39313cbdcf7253db504286ad2b))
* **debrid/usenet-stream:** use transformed params and dont set default start or limit ([d74c840](https://github.com/Viren070/AIOStreams/commit/d74c840a7753490b261bf1304280bd5071d3528d))
* filter out nzbs with failed status ([174e813](https://github.com/Viren070/AIOStreams/commit/174e81312769fd9dbd6ffe0b47ea64c282e4e5ef))
* **frontend:** filter out stremio-usenet and archive stream type in type select ([3c535ed](https://github.com/Viren070/AIOStreams/commit/3c535ed4f60c5421b8467711b4fb5f3ec4d7c6fe))
* pass intent field in service credentials ([47d7eb0](https://github.com/Viren070/AIOStreams/commit/47d7eb097f16e970750be23056e010d43b1f1cda))
* **presets/nzbhydra:** use value of checkOwned option ([c1b5c3c](https://github.com/Viren070/AIOStreams/commit/c1b5c3c4e71d9aad06503f5facc1282b7b0e4033))
* **presets/prowlarr:** add stremio nntp as supported service ([96e7c56](https://github.com/Viren070/AIOStreams/commit/96e7c566b629a5a15a9fda227a1a9d6211b640c7))
* remove min character requirement in addon name in catalog modification ([fd7c6d1](https://github.com/Viren070/AIOStreams/commit/fd7c6d1b673d08b88235fff50f8f8697dfb625a6))
* **sel:** add stremio_nntp as valid service ([0ba11b1](https://github.com/Viren070/AIOStreams/commit/0ba11b17dd8f37bede8670c7cbabd8e1b090c8d2))
* **sel:** correct filter function syntax for stream message comparison ([86ae86a](https://github.com/Viren070/AIOStreams/commit/86ae86a2728c0c134539716aaf1050e72fddffde))

## [2.17.6](https://github.com/Viren070/AIOStreams/compare/v2.17.5...v2.17.6) (2025-11-23)


### Features

* add `private` sort criterion ([f04072b](https://github.com/Viren070/AIOStreams/commit/f04072b33903ed42af3941e066430a388941d803))
* add private torrent detection for stremthru torz  ([#499](https://github.com/Viren070/AIOStreams/issues/499)) ([32d2119](https://github.com/Viren070/AIOStreams/commit/32d21193b1d35a5fb31504cf45a706b4d620029d))
* **frontend/formatter:** add private switch to preview ([4bc2a88](https://github.com/Viren070/AIOStreams/commit/4bc2a88f9bc4971b3d60e9efe6ddc0b693e94106))
* **nab:** add pagination handling ([af79a18](https://github.com/Viren070/AIOStreams/commit/af79a18c6ae384d3e882ab96f27365c2f6500497)), closes [#489](https://github.com/Viren070/AIOStreams/issues/489)
* **parser:** use parsed languages from parse-torrent-title ([24d36a8](https://github.com/Viren070/AIOStreams/commit/24d36a8ae3e9876563f9eac6e8ef6fe5df899811))


### Bug Fixes

* add file store to handle long nzb urls ([4961014](https://github.com/Viren070/AIOStreams/commit/49610148cade3b69112a154d481ac266f8cdec1a))
* **frontend/services:** store modal values in local state ([abd802c](https://github.com/Viren070/AIOStreams/commit/abd802cc7449fbf7c9e4cf2cac4a28a13e86df81)), closes [#503](https://github.com/Viren070/AIOStreams/issues/503)
* **frontend:** make switch size responsive ([78eb16c](https://github.com/Viren070/AIOStreams/commit/78eb16c50ee389cb552cb0c4940db1d46d6ae29c))
* **frontend:** move addon modal outside of animate presence ([b925e04](https://github.com/Viren070/AIOStreams/commit/b925e04650ee156fe44738dc1954824d9adf1daf))
* **metadata:** add placeholder promise when imdbId is missing ([f607131](https://github.com/Viren070/AIOStreams/commit/f607131d339382091c64b534a108748c6a7ae05c)), closes [#497](https://github.com/Viren070/AIOStreams/issues/497)
* only allow absolute episode match when seasons has 1 or is empty ([3be5261](https://github.com/Viren070/AIOStreams/commit/3be526172d68a6bb8d04875bb711f1bd1a2345c0))
* only block proxying of nzbdav/altmount streams via built-in addons ([57bded3](https://github.com/Viren070/AIOStreams/commit/57bded3414ee1bbc1493060471c2b36f2870d3a1))
* only infer proxied attribute for nzbdav/altmount with built-in addons ([cf43d7f](https://github.com/Viren070/AIOStreams/commit/cf43d7f0a607284d364688c0e22d1167cc44176a))
* only use file info store when length exceeds certain amount ([6a5d38a](https://github.com/Viren070/AIOStreams/commit/6a5d38a797bf067002f2996c1d5f31330b73ce05))
* **presets/aiostreams:** allow leaving name empty ([c00ad25](https://github.com/Viren070/AIOStreams/commit/c00ad259fc1fd3953070f369f9649a2663f161cd)), closes [#491](https://github.com/Viren070/AIOStreams/issues/491)
* **presets/usenet-streamer:** add elf emoji to nzb status regex ([#504](https://github.com/Viren070/AIOStreams/issues/504)) ([dbe86ed](https://github.com/Viren070/AIOStreams/commit/dbe86edc92fc057536d2ef1e0c72707827eda72b))
* use shared normaliseTitle in filterer ([2e739bc](https://github.com/Viren070/AIOStreams/commit/2e739bc2775ef0db073484b58013c0b89ad04ea3))

## [2.17.5](https://github.com/Viren070/AIOStreams/compare/v2.17.4...v2.17.5) (2025-11-19)


### Bug Fixes

* **presets/newznab:** remove trailing space in Tabula Rasa URL ([#494](https://github.com/Viren070/AIOStreams/issues/494)) ([394b76b](https://github.com/Viren070/AIOStreams/commit/394b76b5b275fa23c45f8f043854a2c7bac70609))

## [2.17.4](https://github.com/Viren070/AIOStreams/compare/v2.17.3...v2.17.4) (2025-11-18)


### Bug Fixes

* **presets/newznab:** use correct url for usenet crawler ([04e7554](https://github.com/Viren070/AIOStreams/commit/04e7554349bbc0462cc11ef370908f019bd1dfcc))

## [2.17.3](https://github.com/Viren070/AIOStreams/compare/v2.17.2...v2.17.3) (2025-11-18)


### Features

* add memory lock ([e1a24dc](https://github.com/Viren070/AIOStreams/commit/e1a24dc392a87dcd4d7361fae4bb1f5cd370fa63))
* **frontend:** redesign marketplace ([94e747d](https://github.com/Viren070/AIOStreams/commit/94e747d0a78f16d4db30be1c12fc59236ff8a0d8))
* **metadata:** fetch from imdb suggestion data ([98c398b](https://github.com/Viren070/AIOStreams/commit/98c398ba4673e8ab9158ee825b48221c13fedf0a))
* **presets/*znab:** add search mode option with Both and remove force query search. ([78124bd](https://github.com/Viren070/AIOStreams/commit/78124bd802f101fa6dc16d9db8372c1a6d386ba6))


### Bug Fixes

* **frontend:** adjust layout for StaticTabs to fix issues on smaller screens ([90a83ed](https://github.com/Viren070/AIOStreams/commit/90a83ed06c374e6c6aa03b746315bd475cdc037d))
* **frontend:** adjust logo for installed addon card ([7cd5f11](https://github.com/Viren070/AIOStreams/commit/7cd5f116b8297b2d540660f125e30efc2adcfb10))
* **frontend:** ensure description is always rendered with MarkdownLite ([b4de155](https://github.com/Viren070/AIOStreams/commit/b4de1559820a22a3c92f48faa6fceb8f7d5e2a97))
* **frontend:** marketplace adjustments ([ca7c49b](https://github.com/Viren070/AIOStreams/commit/ca7c49b3b1f3aee084af1cc0e9fc24c2bb7e0c46))
* **frontend:** update label from 'Meta & Catalogues' to 'Metadata & Catalogs' ([da4d282](https://github.com/Viren070/AIOStreams/commit/da4d282dd38d728a3eda19b31b18e34be3923107))
* lower timeout for imdb data ([6b47487](https://github.com/Viren070/AIOStreams/commit/6b47487636ea18b7cd77be244ff8d889317cbc0c))
* **metadata/tmdb:** always check title and name in translation data ([c8af6c6](https://github.com/Viren070/AIOStreams/commit/c8af6c682f49e804d63dc58a03effcec8f2ad13e))
* parse fileIdx to prevent deduplication of different files within same torrent ([bec118c](https://github.com/Viren070/AIOStreams/commit/bec118c8c66bb54060b4bb89e354d1a27e6d27b6))
* **presets/usenet-streamer:** parse instant and triage status info ([1b4835d](https://github.com/Viren070/AIOStreams/commit/1b4835d25a7d1170cb30deec036a8f1e803ca6ad))
* **presets:** add missing constraints to timeout options ([a22bc9d](https://github.com/Viren070/AIOStreams/commit/a22bc9d836552b6d955d9427af75cef9de10e8e7))
* prevent duration being incorrectly parsed for builtin addons ([14fc584](https://github.com/Viren070/AIOStreams/commit/14fc584b2b88b852885e26632b936770e4409a81))
* replace umlaut characters with ASCII equivalents in cleanTitle ([#481](https://github.com/Viren070/AIOStreams/issues/481)) ([2b33aba](https://github.com/Viren070/AIOStreams/commit/2b33abab2612028b216ceb96f68e0bf09c60ef4f))
* update newznab url list ([e10702e](https://github.com/Viren070/AIOStreams/commit/e10702e9f8e5060866b7f8e931e3c4173e7b8b9e))
* use memory lock for metadata ([97f61ea](https://github.com/Viren070/AIOStreams/commit/97f61ea3224f4550e17b669e1565ca93d3b326e0))
* use select-with-custom for newznab url and hide some options in simple mode ([b01f135](https://github.com/Viren070/AIOStreams/commit/b01f135cff406227569af7bd2d3e5304a65882e5))

## [2.17.2](https://github.com/Viren070/AIOStreams/compare/v2.17.1...v2.17.2) (2025-11-11)


### Bug Fixes

* adjust scoring for file selection and add .iso as a valid video file extension ([2d918bc](https://github.com/Viren070/AIOStreams/commit/2d918bcf781115d174b758454cf034eb33f4059c))
* **builtins/prowlarr:** set limit value ([fc5674d](https://github.com/Viren070/AIOStreams/commit/fc5674d6b64061478ada8a2792cc281bf3ca604d))

## [2.17.1](https://github.com/Viren070/AIOStreams/compare/v2.17.0...v2.17.1) (2025-11-10)


### Features

* **builtin:** provide age in hours ([ed9a3f1](https://github.com/Viren070/AIOStreams/commit/ed9a3f14a69759a0465a9d044efcc872384ce9c6))
* **core/formatter:** add `ageHours` attribute to `stream` variable ([c590e91](https://github.com/Viren070/AIOStreams/commit/c590e918a865a8eddac6320577ed824438e4c4d0))
* **core/formatter:** implement short circuit for comparators ([5b16957](https://github.com/Viren070/AIOStreams/commit/5b16957411e232ce05e71bf014807f8c4788580d))
* make webdav credentials optional for nzbdav ([2ba2677](https://github.com/Viren070/AIOStreams/commit/2ba267746614f5dc750d2775f7eae991aeedcab9)), closes [#480](https://github.com/Viren070/AIOStreams/issues/480)


### Bug Fixes

* **builtins/torbox-search:** handle when age is string obtained via cache ([285d14f](https://github.com/Viren070/AIOStreams/commit/285d14ff212cada30ffa0bc738867122a9cbe2ad))
* **core/formatter:** ensure boolean attributes in stream variable ([dc9c7da](https://github.com/Viren070/AIOStreams/commit/dc9c7dae3612dbf4b67038915eb00ce383e73461))
* **core/formatter:** handle null property when getting error message ([32bbbd4](https://github.com/Viren070/AIOStreams/commit/32bbbd4bbc13b8694d6b0e92945b006d9423461d))
* **core/formatter:** only short-circuit when remaining operators are the same ([8184442](https://github.com/Viren070/AIOStreams/commit/8184442cce38319e52998480a7aa33cdea87a336))
* **debrid:** validate aiostreamsAuth during nzb check ([8f29d01](https://github.com/Viren070/AIOStreams/commit/8f29d017ba81cfd0ef60cb71e34767eea21cccaa))
* immediately throw if error during stat check is a 401 ([40e2893](https://github.com/Viren070/AIOStreams/commit/40e2893df502b84c2c663598a15deec97a32e3a1))
* **presets/usenet-streamer:** add bmc link ([daa31b7](https://github.com/Viren070/AIOStreams/commit/daa31b76d70fff0466c80a969f475c9628ca3904))
* **sel:** allow nzbdav and altmount in service function ([06c0f33](https://github.com/Viren070/AIOStreams/commit/06c0f33365b19a9e4cb2660bed5a419a3b126501))

## [2.17.0](https://github.com/Viren070/AIOStreams/compare/v2.16.7...v2.17.0) (2025-11-08)


### Features

* add age as filter menu, SEL function, and sort criteria ([1be0a5d](https://github.com/Viren070/AIOStreams/commit/1be0a5d9df473536a9d935b1c0ab941f643eaaa6))
* add previous type as suffix to queryType e.g. `anime.series` and migrate existing SEL ([a034bea](https://github.com/Viren070/AIOStreams/commit/a034bea2d9fa6b627e2ba39ecc154ac48fdd287d))
* allow logging in with aliases ([0eb7de4](https://github.com/Viren070/AIOStreams/commit/0eb7de41f30b94f286f943c146cbbf3531584514))
* **altmount:** add integration ([9ba07ae](https://github.com/Viren070/AIOStreams/commit/9ba07aef449bcd3e2bef17fd1d8ccd7dfc956391))
* **core/formatter:** add `seasonPack` attribute to `stream` ([b45e03c](https://github.com/Viren070/AIOStreams/commit/b45e03c3e25258a27dc4474006314a0a83b7dbb0))
* **core/formatter:** Add truncate(N) modifier ([#470](https://github.com/Viren070/AIOStreams/issues/470)) ([a951b9f](https://github.com/Viren070/AIOStreams/commit/a951b9f1590eb343b8f95af94582590fd581ef78))
* **debrid:** don't make proxy required and add public URL field for nzbdav/altmount ([d71d53c](https://github.com/Viren070/AIOStreams/commit/d71d53cc273a29c449edcc63b470f1ac991652fc))
* make exclude season packs option hidden ([8c39421](https://github.com/Viren070/AIOStreams/commit/8c394216765ae2bfbcd506d882d2f1881ed077b7))
* **nzbdav:** add initial integration ([1afc44a](https://github.com/Viren070/AIOStreams/commit/1afc44a752a0d0cb9314d78ca9e172b47d883a69))
* **presets/usenet-streamer:** add preset ([344c902](https://github.com/Viren070/AIOStreams/commit/344c902b38c4e0a9ed03f8803edcde5974b06d9e))
* **prowlarr:** add usenet support ([ffcff0c](https://github.com/Viren070/AIOStreams/commit/ffcff0c0f72d2048baeaaa735e4c88b0acafa660))


### Bug Fixes

* add back auth to nzbdav/altmount urls and restrict to built-in proxy ([b106cfd](https://github.com/Viren070/AIOStreams/commit/b106cfdc003566139be938cb7f3563ec5b665a7d))
* add CORS middleware to debrid and proxy routes ([ff8593c](https://github.com/Viren070/AIOStreams/commit/ff8593c8856b273b8bcd5cda6c2a965985bb56bc))
* allow redirects and remove auth from webdav url ([d4fcc50](https://github.com/Viren070/AIOStreams/commit/d4fcc501edf4719996e884789972b0b14b80fecb))
* **builtins:** ensure hash is in lowercase ([078ef3c](https://github.com/Viren070/AIOStreams/commit/078ef3c49d3769d155f2c9c8c41bb082b7e14fd2))
* **core/formatter:** handle semi-colons in english_name when converting to code ([5d2aef8](https://github.com/Viren070/AIOStreams/commit/5d2aef8cace6b677165489be75d201547de98b3a))
* **core/formatter:** remove trailing whitespace before truncating ([#476](https://github.com/Viren070/AIOStreams/issues/476)) ([dd7b723](https://github.com/Viren070/AIOStreams/commit/dd7b723aac9b0f4eeb1d8120c9d332cd2dcdff42))
* **debrid:** add auth for nzbdav/altmount via proxyHeaders ([b94ad20](https://github.com/Viren070/AIOStreams/commit/b94ad204d7b9d8c8ac995b6d0a5ee07a3c6b3e82))
* **debrid:** allow null value for storage in slot schema ([2c4ea05](https://github.com/Viren070/AIOStreams/commit/2c4ea0510e94ac0db4dc12565929bbb309c12d60))
* **debrid:** ensure cache is committed before returning playback link ([71b5d34](https://github.com/Viren070/AIOStreams/commit/71b5d34a255d5925237f4b3fd3c2ea650accb5e4))
* **debrid:** handle missing appropriate service for result type ([9693da8](https://github.com/Viren070/AIOStreams/commit/9693da8bc5265a8d3eb325d99f7d1751150df0bd))
* **frontend:** only show string based credential inputs in template loader ([a43fbec](https://github.com/Viren070/AIOStreams/commit/a43fbec0d95137a465dc3895586ea11b7fc8d99a))
* **metadata:** adjust schemas ([4a4aa40](https://github.com/Viren070/AIOStreams/commit/4a4aa403403abb0438ca556426a61807c8e66973))
* normalise headers to lowercase when proxifying streams ([15f3a9f](https://github.com/Viren070/AIOStreams/commit/15f3a9fde0126fd379f50707e5051220da91ed88))
* **nzbdav:** gracefully handle invalid proxy auth / other proxy errors ([ea9c4b9](https://github.com/Viren070/AIOStreams/commit/ea9c4b934053d0ac6fe0e2b69e68f9765821b4c7))
* **nzbdav:** improve error handling for NzbDAV API responses ([115fb45](https://github.com/Viren070/AIOStreams/commit/115fb45dbb4f57ce35a0e1efdcf93f4601abcaa6))
* **presets/usenet-streamer:** parse indexer ([88f14f5](https://github.com/Viren070/AIOStreams/commit/88f14f52fe24c98a36a39c998042622291e5f163))
* **prowlarr:** consolidate supported services in ProwlarrPreset ([3084e1f](https://github.com/Viren070/AIOStreams/commit/3084e1fd2e740095a509d2985328049745afb057))
* **proxifier:** remove auth in URLs when proxying ([b40c448](https://github.com/Viren070/AIOStreams/commit/b40c448b5c1bf288fe64a36feb45f9e2725ed06b))
* **proxy:** convert auth in URL to basic auth header ([45a3c00](https://github.com/Viren070/AIOStreams/commit/45a3c00db0e4722b252414fcec1ec2f5dce17bb9))
* update credential validation to respect required status ([9f16926](https://github.com/Viren070/AIOStreams/commit/9f16926850ca977169dd639cc3600da3a7b3f57a))
* update import path for CORS middleware ([7e84a49](https://github.com/Viren070/AIOStreams/commit/7e84a4909ed6b0d59f80d323d57833c0af223910))
* **wrapper:** pass through query params for resource requests ([ca1a825](https://github.com/Viren070/AIOStreams/commit/ca1a8252efcd2ce79be43cac2b64e2b4ed8555b8))

## [2.16.7](https://github.com/Viren070/AIOStreams/compare/v2.16.6...v2.16.7) (2025-11-02)


### Features

* add `episodes` to formatter ([a3c7288](https://github.com/Viren070/AIOStreams/commit/a3c7288b982b5196ec68b6640e30f067d7958c14))
* add `extension` attribute ([551a46f](https://github.com/Viren070/AIOStreams/commit/551a46f07134abcb32476522c3ef738e8581c51b))
* add `network`, `container`, `edition`, `remastered`, `repack`, `uncensored`, `unrated`, `upscaled`,  attributes to formatter ([b1dba0d](https://github.com/Viren070/AIOStreams/commit/b1dba0d24be9c28c3c1598fd2497689c795b2b9a))
* assume season is 1 in strict mode for season/episode matching when episode is present ([e464f7d](https://github.com/Viren070/AIOStreams/commit/e464f7d3e437476ffd44ac010e5b728be3131f59))
* **formatter:** add `formattedSeason` and `formattedEpisode` attributes ([e464f7d](https://github.com/Viren070/AIOStreams/commit/e464f7d3e437476ffd44ac010e5b728be3131f59))
* handle multi-season/episode files in season/episode matching ([e464f7d](https://github.com/Viren070/AIOStreams/commit/e464f7d3e437476ffd44ac010e5b728be3131f59))


### Bug Fixes

* always use tcp ([87667f1](https://github.com/Viren070/AIOStreams/commit/87667f16dbf44b374fc19198b03761b8ce7455c3))
* correctly handle empty languages for key value in sorter ([3989dde](https://github.com/Viren070/AIOStreams/commit/3989dde254be32f207d9ec9a9bdd00f9e5a66bcf))
* **debrid:** handle undefined files from stremthru in addMagnet ([cc243ed](https://github.com/Viren070/AIOStreams/commit/cc243edb1296f1a497c59e33c9f7331d152b7182))
* **formatter:** update light gdrive and prism formats to correctly display multi-season / episode files ([f1b8a7b](https://github.com/Viren070/AIOStreams/commit/f1b8a7b2fa75d78388da06f9543a379d4b803ba7))
* **parser/regex:** correctly escape slashes, and match bd for bluray ([c50611d](https://github.com/Viren070/AIOStreams/commit/c50611d88e25db20923b2b4db3a9ffdfb58747f7))
* **presets/streamfusion:** simplify config and allow disabling torrent providers ([76ddf4a](https://github.com/Viren070/AIOStreams/commit/76ddf4a725c2bad4f3d5709a15c322d739bb1169))
* **proxy:** filter out old connections ([950c3d0](https://github.com/Viren070/AIOStreams/commit/950c3d0680764f8e5c50396a354d56e0d8c39a2d))
* update deps ([a7cf7d1](https://github.com/Viren070/AIOStreams/commit/a7cf7d1e6f2f57e213a4cf96757e72d99b006e10))

## [2.16.6](https://github.com/Viren070/AIOStreams/compare/v2.16.5...v2.16.6) (2025-10-31)


### Bug Fixes

* increase timeout on tmdb validation and improve error messages ([5e34d55](https://github.com/Viren070/AIOStreams/commit/5e34d551a5fe737e125b49ad26ebf8058b119c33))

## [2.16.5](https://github.com/Viren070/AIOStreams/compare/v2.16.4...v2.16.5) (2025-10-29)


### Bug Fixes

* **presets/streamasia:** update version ([141771c](https://github.com/Viren070/AIOStreams/commit/141771c305dd348de546d6db1b5c4eef22b25520))

## [2.16.4](https://github.com/Viren070/AIOStreams/compare/v2.16.3...v2.16.4) (2025-10-27)


### Features

* add dynamic checkpoint extraction for exit conditions ([8ce12cd](https://github.com/Viren070/AIOStreams/commit/8ce12cd94cfd610c1758d878a26acdabfedbd082))


### Bug Fixes

* add parsedFile in search api result ([373286b](https://github.com/Viren070/AIOStreams/commit/373286be67a536304e76017f636e38998faf3a8c))
* improve IP handling in user data via schema and middleware ([#461](https://github.com/Viren070/AIOStreams/issues/461)) ([deb6b58](https://github.com/Viren070/AIOStreams/commit/deb6b58a131d7a4203eeeecdb2d4ddf0474278f6))
* invalidate stream cache entry if search only produces errors ([5083b06](https://github.com/Viren070/AIOStreams/commit/5083b0607dc352ce034fbde8b427dc7f5387f282))
* **presets/streamasia:** default to 0 hidden kisskh catalogues & update version to 1.3.4 ([e9a9cc2](https://github.com/Viren070/AIOStreams/commit/e9a9cc275a226ac8a4c751d97c997819011f2878))
* remove .iso from non video files list ([a2a1946](https://github.com/Viren070/AIOStreams/commit/a2a19463ed19b718329f21d4cb739908463b9feb))

## [2.16.3](https://github.com/Viren070/AIOStreams/compare/v2.16.2...v2.16.3) (2025-10-26)


### Features

* remove background processing ([26d1181](https://github.com/Viren070/AIOStreams/commit/26d1181627060f3b704427a7fe4cbd6ff015c376))


### Bug Fixes

* **builtins:** processing adjustments ([e435f1c](https://github.com/Viren070/AIOStreams/commit/e435f1c7bdd6189ae8ebb4c57d53a0325a241674))
* improve processing of torrents and nzbs ([099cd62](https://github.com/Viren070/AIOStreams/commit/099cd62ca82ef2468e524685509845cce93f3055))

## [2.16.2](https://github.com/Viren070/AIOStreams/compare/v2.16.1...v2.16.2) (2025-10-25)


### Bug Fixes

* **frontend:** provide initialUuid, adjust start setup button text when logged in ([852ba9c](https://github.com/Viren070/AIOStreams/commit/852ba9c485e16091501bcccf93f8df6d2464eace))
* improve patterns for detecting 2 titles ([5812346](https://github.com/Viren070/AIOStreams/commit/5812346da5a6e72fe4537db84bdd8448934a7973))
* normalise redirect url when extracting infohash ([c8cce41](https://github.com/Viren070/AIOStreams/commit/c8cce4176a0eb09a44edc8dc1a6db84c5fff6c13))
* parse size strings using bytes library for accurate size conversion ([108099b](https://github.com/Viren070/AIOStreams/commit/108099b30da62c01e90d985db870937471266337))
* **presets/sootio:** update for http providers ([297c4c0](https://github.com/Viren070/AIOStreams/commit/297c4c068bd1ea79a1b877eea4d3f6774e0bfaf1))
* update ip fields to accept any string ([4a25c1a](https://github.com/Viren070/AIOStreams/commit/4a25c1aee10477895486cfb55b06e211bc43a961)), closes [#453](https://github.com/Viren070/AIOStreams/issues/453)

## [2.16.1](https://github.com/Viren070/AIOStreams/compare/v2.16.0...v2.16.1) (2025-10-23)


### Features

* add strict filtering option for year matching ([9818513](https://github.com/Viren070/AIOStreams/commit/98185137bae95676d1a8da2f15bcfdbfe2ff42c9))
* add strict mode to season/episode matching ([703e284](https://github.com/Viren070/AIOStreams/commit/703e284e0a21e8fc43292a8524ff202f27c25a29))
* **metadata/tmdb:** use original titles from response and refactor alternative title fetching ([3f97c6f](https://github.com/Viren070/AIOStreams/commit/3f97c6f1e81e46dd4ba42cca57475f52d6ecbf35)), closes [#442](https://github.com/Viren070/AIOStreams/issues/442)
* **templates:** add auto updating of external templates, allow overriding builtin/custom templates through imports, caching ([d6b9657](https://github.com/Viren070/AIOStreams/commit/d6b965738755ab8fa91c3e487ca473f7cc58970f))


### Bug Fixes

* **builtins/newznab:** update url hash after proxying ([236935d](https://github.com/Viren070/AIOStreams/commit/236935d923e856212e5283ca20e8e8f8fff1b69b))
* correctly handle fallback of seasonEpisode ([6a5e26d](https://github.com/Viren070/AIOStreams/commit/6a5e26dc29af5b5c9ea4c65f55078b586f5126f2))
* handle & in title normalisation/cleaning ([e91307b](https://github.com/Viren070/AIOStreams/commit/e91307b39d6cf7c38c8f2f22b0ca24feb535af23))
* improve detection of separators in title preprocessing ([90bbe8b](https://github.com/Viren070/AIOStreams/commit/90bbe8b5977487367f93d01810b5fc76f858ae16))
* improve handling of title matching ([3fa7bc7](https://github.com/Viren070/AIOStreams/commit/3fa7bc757dd1f68c93a33da8298a5f7450570920)), closes [#441](https://github.com/Viren070/AIOStreams/issues/441)
* improve logging of errors during public ip retrieval ([d29d268](https://github.com/Viren070/AIOStreams/commit/d29d268b869aaf9d8a2b7f03e12fc95ca18a5314))
* improve tmdb validation behaviour ([cb3c143](https://github.com/Viren070/AIOStreams/commit/cb3c14348af894118c9b1b2a17f201aa69d6e43c))
* **metadata:** don't use tvdb id mapping for movies and only use cinemetaData.released when necessary ([86e65e7](https://github.com/Viren070/AIOStreams/commit/86e65e71ae5f1427a81d8d030440c22bf5ee0920))
* **metadata:** parse and format release date from cinemetaData if available ([d8b6460](https://github.com/Viren070/AIOStreams/commit/d8b6460dccffa92d78174c1f4119c215193f7810))
* only apply excludeSeasonPacks option to series type ([d9730a0](https://github.com/Viren070/AIOStreams/commit/d9730a0f330ffeab057d021cb430d3e04f86fb94))
* replace certain characters with spaces ([533e477](https://github.com/Viren070/AIOStreams/commit/533e477da99113bf67b0c1777cb625e5fa8ba7e8))

## [2.16.0](https://github.com/Viren070/AIOStreams/compare/v2.15.4...v2.16.0) (2025-10-20)


### Features

* add "Are You Still there?" workaround ([#431](https://github.com/Viren070/AIOStreams/issues/431)) ([5ddd111](https://github.com/Viren070/AIOStreams/commit/5ddd111ec04238f9b97a695252d406aee8214e36))
* add debrid-starter template ([a3d00e0](https://github.com/Viren070/AIOStreams/commit/a3d00e0be7465f4724eca2fd461fbcb80d35b850))
* add digital release filter to miscellaneous filter tab ([2bd98ea](https://github.com/Viren070/AIOStreams/commit/2bd98ea6f95f8b95f9481610131d7d4b2a2f0429)), closes [#280](https://github.com/Viren070/AIOStreams/issues/280)
* add exclude season packs option ([4c7b28d](https://github.com/Viren070/AIOStreams/commit/4c7b28d7448f3f129cd8eecd9b0f677f0f60d87a))
* add regexes from custom/built-in templates to trusted regexes. ([feddab6](https://github.com/Viren070/AIOStreams/commit/feddab63a235b6faaa48dcacf0168c27bf07be95))
* add template system ([#438](https://github.com/Viren070/AIOStreams/issues/438)) ([481338a](https://github.com/Viren070/AIOStreams/commit/481338afa3f3b3d633950838f0382133c43aa2b2))
* **core/formatters:** add `rbytes`, `rbytes10`, `rbytes2` number modifiers for rounded bytes formatting ([edc771c](https://github.com/Viren070/AIOStreams/commit/edc771c0ec1fd9fabb7813b9d7841ebc462c1393))
* filter out movie results with season/episode info ([d475ae6](https://github.com/Viren070/AIOStreams/commit/d475ae6ea22d019380ec0adc2e61f72d8c7bb369))
* **frontend:** allow importing templates in install menu ([6ef0ae1](https://github.com/Viren070/AIOStreams/commit/6ef0ae10e0004de8164e507a1d29a26c18e44067))
* **frontend:** allow more extensive markdown (bold, itallics, bullet points, new lines) ([21458ca](https://github.com/Viren070/AIOStreams/commit/21458ca447a198f94fa4cd7bbb886f06d6211808))
* **templates:** add setToSaveInstallMenu option set to true by default ([924a85a](https://github.com/Viren070/AIOStreams/commit/924a85ae78ac31f73ca49a1f18084e9e36d1df68))
* **templates:** add version field to templates ([21458ca](https://github.com/Viren070/AIOStreams/commit/21458ca447a198f94fa4cd7bbb886f06d6211808))
* **templates:** allow importing several templates at once. ([21458ca](https://github.com/Viren070/AIOStreams/commit/21458ca447a198f94fa4cd7bbb886f06d6211808))
* **templates:** allow specifying ID and handle overwriting existing templates during import ([e43e9ad](https://github.com/Viren070/AIOStreams/commit/e43e9adad84dea0615de8404d097cf7fe4fee107))
* **templates:** improve ui and fix ID generation ([4fb44be](https://github.com/Viren070/AIOStreams/commit/4fb44be97ff8f7302db60f113e92be4515b791cf))
* **templates:** load existing user data values when loading templates ([21458ca](https://github.com/Viren070/AIOStreams/commit/21458ca447a198f94fa4cd7bbb886f06d6211808))
* **templates:** store imported templates in local storage and show in list with confirmation dialog showing metadata ([21458ca](https://github.com/Viren070/AIOStreams/commit/21458ca447a198f94fa4cd7bbb886f06d6211808))
* **templates:** use PasswordInput for password inputs. ([21458ca](https://github.com/Viren070/AIOStreams/commit/21458ca447a198f94fa4cd7bbb886f06d6211808))


### Bug Fixes

* **anime-database:** force refresh on failure during load ([bc23628](https://github.com/Viren070/AIOStreams/commit/bc23628890ba6d5aa77d93e4e738de27b3fc3fdf))
* **builtins/torbox-search:** handle null title ([e0bae60](https://github.com/Viren070/AIOStreams/commit/e0bae60a817737c2da2a7c3e4e9745a88a9b8163))
* **debrid:** update error message for missing file link ([413bb59](https://github.com/Viren070/AIOStreams/commit/413bb5953a7d5146f653686162de359bfdb856c8))
* **debrid:** use toUrlSafeBase64 for encoding fileInfo in playback URL ([69d24f2](https://github.com/Viren070/AIOStreams/commit/69d24f287655f5f9bbbdd9176a2bf014ba4d268c)), closes [#433](https://github.com/Viren070/AIOStreams/issues/433)
* **frontend/templates:** enable selected services ([bda2c61](https://github.com/Viren070/AIOStreams/commit/bda2c61792752a54ba310fcc79a91e78d14099a0))
* **frontend/templates:** handle optional input values ([56a02f9](https://github.com/Viren070/AIOStreams/commit/56a02f97ce3d495438fc8f279765c4f6b1b20dc0))
* **frontend/templates:** improve validation and warning tooltip ([b273402](https://github.com/Viren070/AIOStreams/commit/b273402efa78f51d618f1de646026a2b8cffcf0a))
* **frontend:** automatically filter out unavailable/disabled presets in templates ([18807bd](https://github.com/Viren070/AIOStreams/commit/18807bd10534f7662fe342cfce9645e928707744))
* **frontend:** set addonDescription to undefined when falsy ([af67ca8](https://github.com/Viren070/AIOStreams/commit/af67ca8f87a14c59a814e4f8205bfd5ebefeb98b))
* **frontend:** throw error when importing template through config import ([78662c8](https://github.com/Viren070/AIOStreams/commit/78662c8dc949ddb350cd94f8250f73a9cbdcdb23))
* **frontend:** validate template schema with zod ([3e4f23a](https://github.com/Viren070/AIOStreams/commit/3e4f23a443660e060bd4cbfa4f2d0500f5192e0a))
* increase timeout for rpdb ([2ce87e4](https://github.com/Viren070/AIOStreams/commit/2ce87e40c505c0a70fccb1b955277e01ae390165))
* **metadata/tvdb:** handle season result ([c6f92ab](https://github.com/Viren070/AIOStreams/commit/c6f92ab6b4a2df4726883f45d0b4ad7b59e7e732))
* **presets/streamfusion:** add option to disable public torrent cache server ([982567f](https://github.com/Viren070/AIOStreams/commit/982567f28d4475d0fd00898af466456bd4c57d3a))
* **proxy:** make proxied nzb URLs static ([f8847bf](https://github.com/Viren070/AIOStreams/commit/f8847bfd195a679a03b31ae36f04693de64ac23f))
* update default timeout value from 5000ms to 7000ms ([58fbbf1](https://github.com/Viren070/AIOStreams/commit/58fbbf1c56ba923d6f9168a6d84c88a9022f4f39))
* use esm import paths ([a2f46a6](https://github.com/Viren070/AIOStreams/commit/a2f46a6c6e9dec7b49f45d47af00d6b4b3900f45))
* use zod prettifyError function to format Zod errors ([3e4f23a](https://github.com/Viren070/AIOStreams/commit/3e4f23a443660e060bd4cbfa4f2d0500f5192e0a))

## [2.15.4](https://github.com/Viren070/AIOStreams/compare/v2.15.3...v2.15.4) (2025-10-13)


### Bug Fixes

* **builtins/prowlarr:** make guid optional ([b85b8ad](https://github.com/Viren070/AIOStreams/commit/b85b8adb7966f56b91b5055b5fc10db6ee843d64))

## [2.15.3](https://github.com/Viren070/AIOStreams/compare/v2.15.2...v2.15.3) (2025-10-13)


### Bug Fixes

* **debrid:** adjust scoring logic for file selection based on season and episode presence ([7f3faf7](https://github.com/Viren070/AIOStreams/commit/7f3faf70232e6f425de8a0e40acd31b433c45541))
* **presets/newznab:** use correct env var name in proxyAuth description ([0790cf3](https://github.com/Viren070/AIOStreams/commit/0790cf327df641da6f0be485004bb978745f758c))
* remove length requirement on addonPassword ([9cb2202](https://github.com/Viren070/AIOStreams/commit/9cb2202804028a3cce03a234fd940e7ed3db2086))

## [2.15.2](https://github.com/Viren070/AIOStreams/compare/v2.15.1...v2.15.2) (2025-10-12)


### Bug Fixes

* add logging of headers ([65de9c6](https://github.com/Viren070/AIOStreams/commit/65de9c6089b04c71c8a7400cc7069ab2078cf345))
* **presets/subsource:** use password type for api key ([27ab37b](https://github.com/Viren070/AIOStreams/commit/27ab37b0441ee0958a258caf82b4a8fcfaf065fa))
* **proxy:** remove all hop-by-hop headers ([3d6f36c](https://github.com/Viren070/AIOStreams/commit/3d6f36cfcc57ba8c60d3d26bd2cdfed2992003e0))
* **proxy:** remove certain headers ([bdb79ae](https://github.com/Viren070/AIOStreams/commit/bdb79aec000807468f4154c6299f9fc5819331de))
* **proxy:** remove public url field for built-in proxy ([2569f70](https://github.com/Viren070/AIOStreams/commit/2569f70960149798acf7251c62bc0548431e3e9f))

## [2.15.1](https://github.com/Viren070/AIOStreams/compare/v2.15.0...v2.15.1) (2025-10-12)


### Bug Fixes

* **frontend:** clear uuid and password on log out ([ed840bd](https://github.com/Viren070/AIOStreams/commit/ed840bd541bc6225ec12a3ff13a6f1dd8aedc84b))
* improve zod error handling during stream selection ([98f3d02](https://github.com/Viren070/AIOStreams/commit/98f3d0203d559072ce5f55e3b7b50caeea1dbaf3))
* **proxy:** improve auth validation during validity check ([29dd38d](https://github.com/Viren070/AIOStreams/commit/29dd38d4820004a49e8af47c68b131beafca9fb4))
* **proxy:** trim ip response ([ba97977](https://github.com/Viren070/AIOStreams/commit/ba979778d284e07d735339f64dec26fac30630d6))
* validate public IP response ([3d08959](https://github.com/Viren070/AIOStreams/commit/3d089591215c5c62132fd74f15b7c9106d23a52a))

## [2.15.0](https://github.com/Viren070/AIOStreams/compare/v2.14.3...v2.15.0) (2025-10-12)


### Features

* add built-in proxy ([4fdc691](https://github.com/Viren070/AIOStreams/commit/4fdc691362d9629307452153e0c8aaf3399fe2ba))
* add cache and play ([c11583e](https://github.com/Viren070/AIOStreams/commit/c11583e14aefc9c77b20fe86497985132e258186))
* add similarity threshold setting for title matching ([c5c10c1](https://github.com/Viren070/AIOStreams/commit/c5c10c12fff09adf16a89d9324300e8908495487))
* adjust default sort order ([c820ff5](https://github.com/Viren070/AIOStreams/commit/c820ff5bfa1ef0fb006da629eec85be135f05813))
* allow built-in addons to bypass title matching when needed ([19c4ca1](https://github.com/Viren070/AIOStreams/commit/19c4ca10aa5b4b004a38f72b7cabf19a9cd636cf))
* **frontend:** redesign about menu ([750ebc1](https://github.com/Viren070/AIOStreams/commit/750ebc1f42c03e4bbbfc3f4f7e1dca20e55ad06c))
* **frontend:** show proxy menu in simple mode but remove proxy controls ([01f1c4f](https://github.com/Viren070/AIOStreams/commit/01f1c4f6d90bde7dfbfc4eba124acbc18df38b20))
* **prowlarr:** add indexer env var to limit indexer options and only use torrent protocol indexers ([cc37356](https://github.com/Viren070/AIOStreams/commit/cc37356683e8d3b6735406e79aa5d06bba363dfe))
* **prowlarr:** allow customising indexers in config, remove indexer env var ([6c4c87b](https://github.com/Viren070/AIOStreams/commit/6c4c87ba81da76108d5aa8ceee9fe326b6427ff3))
* **proxy:** cache public IP and improve connection tracking accuracy ([0f575fb](https://github.com/Viren070/AIOStreams/commit/0f575fbc53c2a310941124b49561dd199029fdb5))
* **proxy:** improve user connection tracking with active and historical stats and encryption ([e3dfa23](https://github.com/Viren070/AIOStreams/commit/e3dfa23cccd409a250b3be6604080ab9a138ef8d))
* show unconfigured addons in marketplace with a disabled flag. ([079240b](https://github.com/Viren070/AIOStreams/commit/079240bb18eeed72c98940422b9fe746379a456c))
* use lock during debrid resolve ([c038492](https://github.com/Viren070/AIOStreams/commit/c038492733fa757d383c7caac08af361f6f82f18))


### Bug Fixes

* add confirmed property to BaseFile ([4fc8475](https://github.com/Viren070/AIOStreams/commit/4fc8475722cdf8b120eaf1acd55d25594ace5005))
* adjust timeouts for metadata ([8cc6399](https://github.com/Viren070/AIOStreams/commit/8cc639983bc4797c74d074d5bf843284cd85eb8c))
* always use year from tmdb or tvdb ([b9a2f3c](https://github.com/Viren070/AIOStreams/commit/b9a2f3cd1473c4b10aa7e1a47ef1c11f0f7a1984))
* **builtins/newznab:** make proxy auth optional ([3fb3014](https://github.com/Viren070/AIOStreams/commit/3fb301445a7eadbe2f1b1b8c8ad49d98092bb150))
* **builtins/prowlarr:** add params to cache key ([a796a6c](https://github.com/Viren070/AIOStreams/commit/a796a6c8dc054b4235c2fac0d067984ded14c7d0))
* **builtins/prowlarr:** use prefetched indexers for preconfigured instance ([8c12644](https://github.com/Viren070/AIOStreams/commit/8c12644e07220a18fed737797e4ec30f2929ddca))
* change default timeout to 5000 ([d7e364a](https://github.com/Viren070/AIOStreams/commit/d7e364a09872c233a2e205b0cd2b8291f31e90d8))
* handle empty seederRangeTypes ([727e42d](https://github.com/Viren070/AIOStreams/commit/727e42d873682d37eba92a9c0d919143d6fdb264))
* **presets/debridio-tv:** add 24/7 to channel list ([3eae246](https://github.com/Viren070/AIOStreams/commit/3eae246e4121d45faad237149dbb9000b079e9c2))
* **presets/jackett:** hide Jackett URL and API Key fields in simple mode when preconfigured ([8c2ffbd](https://github.com/Viren070/AIOStreams/commit/8c2ffbd69c0aa70f536354d1e3cd4755c4f23642))
* **presets/newznab:** add series and anime to media types option and pass mediaTypes to Addon ([406d113](https://github.com/Viren070/AIOStreams/commit/406d1130d90022e5d6f55eca5ba77484265a7fd2))
* **presets/opensubtitles-v3-plus:** update languages array to match upstream ([84dbede](https://github.com/Viren070/AIOStreams/commit/84dbede718ff4d79b76097d15a4c54c7e7a54382)), closes [#427](https://github.com/Viren070/AIOStreams/issues/427)
* **presets/prowlarr:** hide custom url fields when preconfigured in simple mode ([f7abf12](https://github.com/Viren070/AIOStreams/commit/f7abf125bd2af770561e7bde0172d811ca159657))
* **presets/prowlarr:** only use indexer option when its an array for preconfigured prowlarr instance ([ed852dd](https://github.com/Viren070/AIOStreams/commit/ed852dd925bbbf42d619011f6864fe82b88e48b6))
* **presets/sootio:** update config generation with multi-service support, update supported services ([b2dbb84](https://github.com/Viren070/AIOStreams/commit/b2dbb8484e4beb7bfeef6066913c9de839edbcab))
* **presets/sootio:** use undefined serviceIds for overriden URLs ([b9aa6f3](https://github.com/Viren070/AIOStreams/commit/b9aa6f39768065848a0987d97382857fef65aab0))
* **presets/subsource:** add apiKey and types to config and manifest generation ([678fe5c](https://github.com/Viren070/AIOStreams/commit/678fe5c2ac30c1c4e0a5e03b13b5db0792fc26d1))
* **presets/torbox:** improve parsing of your media catalogue streams ([a7c7012](https://github.com/Viren070/AIOStreams/commit/a7c701264948aadcb8119daf86a794a51e8d3bf2))
* **presets/zilean:** hide url field in simple mode ([c74b56b](https://github.com/Viren070/AIOStreams/commit/c74b56b8daa948af8233243521d45b5167613338))
* **prowlarr:** add debug logs and fetch after db init ([ef20218](https://github.com/Viren070/AIOStreams/commit/ef20218cd591436624323440fe5b2ae2d207f1aa))
* **prowlarr:** use enum for protocol and add debug log ([cf767af](https://github.com/Viren070/AIOStreams/commit/cf767af645acced2428fe9a306cacd97fa6510e2))
* **proxy:** follow redirects ([95b5201](https://github.com/Viren070/AIOStreams/commit/95b5201eb443cbb6d8914f031e7b669676b53457))
* **proxy:** sanitise upstream headers ([078b41c](https://github.com/Viren070/AIOStreams/commit/078b41caaf4e989a57507cea2d4f81bb617d8536))
* **proxy:** use correct url and improve logs ([7ae0ed6](https://github.com/Viren070/AIOStreams/commit/7ae0ed65d42da1bde0857afad30662f0f44eeb48))
* rename showInNoobMode to showInSimpleMode ([8251171](https://github.com/Viren070/AIOStreams/commit/825117108072e357a8c918210ab0abd0c4ad5533))
* update timeout field names to include units (ms) ([97da7c0](https://github.com/Viren070/AIOStreams/commit/97da7c00db0f47e79c70889797eb4761023cbcc6))
* use partial_ratio scorer in builtin addon title matching ([1957def](https://github.com/Viren070/AIOStreams/commit/1957def81942c0c345db38b36d38e8e797b85717))

## [2.14.3](https://github.com/Viren070/AIOStreams/compare/v2.14.2...v2.14.3) (2025-10-04)


### Bug Fixes

* improve regex parser ([#419](https://github.com/Viren070/AIOStreams/issues/419)) ([e67d286](https://github.com/Viren070/AIOStreams/commit/e67d2866ffbe56a97434bc4877553ce0191224d9))
* set default value of store to undefined ([2d488c1](https://github.com/Viren070/AIOStreams/commit/2d488c15994b3ed6708deb9b7fa391e53bcebee2))


### Performance Improvements

* improve playback link generation and cache writes ([7770bb1](https://github.com/Viren070/AIOStreams/commit/7770bb18d51bd9840ea34d60891536bfd878d43f))

## [2.14.2](https://github.com/Viren070/AIOStreams/compare/v2.14.1...v2.14.2) (2025-10-02)


### Bug Fixes

* add mediaTypes to more stream addons ([2aa2886](https://github.com/Viren070/AIOStreams/commit/2aa2886ba5692f71f2be938e46cbb5207635fd27))
* **debrid:** improve error handling and file selection ([9b84e89](https://github.com/Viren070/AIOStreams/commit/9b84e89cc1e90424b3e445cce214a1cedc347c3c))
* increase Redis timeout ([b8ad764](https://github.com/Viren070/AIOStreams/commit/b8ad7641b0a4bfabf9ca869c6c62793987273cba))
* **presets/torbox:** adjust extraction of cache status and infohash ([309e655](https://github.com/Viren070/AIOStreams/commit/309e6556dd50a6d5d95fc90c901c3dbc0c6f150c))

## [2.14.1](https://github.com/Viren070/AIOStreams/compare/v2.14.0...v2.14.1) (2025-09-30)


### Features

* add debug logs to ip middleware ([36d0464](https://github.com/Viren070/AIOStreams/commit/36d04644efaa1f808bcebd9735b97dcdae8e3b2b))
* add use multiple instances option to built-in addons ([d400db8](https://github.com/Viren070/AIOStreams/commit/d400db8c40a42b77fdb62ddc1bf9444ccc5b3a24))
* allow customising playback link validity and store ([a31c160](https://github.com/Viren070/AIOStreams/commit/a31c1600049d3f99d29d148108b8953b4eb40100))

## [2.14.0](https://github.com/Viren070/AIOStreams/compare/v2.13.3...v2.14.0) (2025-09-29)


### Features

* add `allAddons` variable to dynamic exit condition and add placeholder exit conditions ([b7280a9](https://github.com/Viren070/AIOStreams/commit/b7280a97eb34fb0ea6660f563f263885a53e3244))
* add `queriedAddons` and `queryType` to exit conditions and improve descriptions ([a09a03c](https://github.com/Viren070/AIOStreams/commit/a09a03c1ef7ff022a04510088d3ccefb52b5cfa0))
* add dynamic fetching strategy with redesigned strategy card and fix parallel groups ([48dbadd](https://github.com/Viren070/AIOStreams/commit/48dbaddf67acd3c028f0218e7e61ba74ffcb71c7)), closes [#410](https://github.com/Viren070/AIOStreams/issues/410)
* allow limiting certain addons to specific media types ([59e611a](https://github.com/Viren070/AIOStreams/commit/59e611aebbac7e3ac5b8f5773b74f208598d9c09))
* **builtins:** add support for using alternative titles in scraping ([4f4b044](https://github.com/Viren070/AIOStreams/commit/4f4b04495b0d31b9292efe8598465356b160c8ad))
* make redis store optional for rate limiting ([b47c293](https://github.com/Viren070/AIOStreams/commit/b47c293fd3e8a715277a2b8876a60de6a5c116ee))
* **sel:** enable the `in` operator ([6a10f7c](https://github.com/Viren070/AIOStreams/commit/6a10f7c623b527e6c7dc9aff8927e002e6a504f8))
* use urlsafe encoded configs, add requiredFields, adjust playback URL handling, and sql cache store. ([9a9d3d2](https://github.com/Viren070/AIOStreams/commit/9a9d3d2775965dca6854d98c78fb25ca2d622e12))


### Bug Fixes

* add debug logs to redirect handling and follow additional redirects ([5e3f6fb](https://github.com/Viren070/AIOStreams/commit/5e3f6fb188b65d8ecd536252baaf2377f5aaa0e7))
* add error handling for URL parsing in Proxifier class ([6e0e6f5](https://github.com/Viren070/AIOStreams/commit/6e0e6f587bc2bebb865bf7b33608a1e5efd20304))
* adjust key for metadata lock ([028e772](https://github.com/Viren070/AIOStreams/commit/028e77288b6e9c09e0d95941d29ee512473fe86d))
* adjust lock, refactor retry operations, remove minimum length requirement for condition, increase max length for conditions to 3000 ([136ca58](https://github.com/Viren070/AIOStreams/commit/136ca58cea4cfea70811c41698e9ef610feb1087))
* always validate dynamic addon fetching condition when enabled ([778bbf7](https://github.com/Viren070/AIOStreams/commit/778bbf7cc8d8e7acb338c876e9dfd113541116e4))
* cache adjustments ([8772ab7](https://github.com/Viren070/AIOStreams/commit/8772ab706e5d15dc067db70bf2c622559e2952c6))
* default catalogs to empty array to allow manifests without catalogs ([d5f4c93](https://github.com/Viren070/AIOStreams/commit/d5f4c9352183d547e84ff7dc95b7d4fc7adc3ec3))
* fix filtering of null/undefined attributes ([5313969](https://github.com/Viren070/AIOStreams/commit/53139697f9ffd2593928fef1d0cf7eb0701d43b1))
* handle unknown resolution in prism formatter ([97bd672](https://github.com/Viren070/AIOStreams/commit/97bd6728a8c1dda548e6dc50ed772cffc981e393))
* handle zod errors gracefully ([60fd28c](https://github.com/Viren070/AIOStreams/commit/60fd28cd72804a3398fe38ae93721d8c0af6aa54))
* improve error message for expression evaluation error ([37a9de3](https://github.com/Viren070/AIOStreams/commit/37a9de365743d1a4f7c2a847a3e69e50d3a2ee80))
* improve releaseGroup regex ([#403](https://github.com/Viren070/AIOStreams/issues/403)) ([2c9c887](https://github.com/Viren070/AIOStreams/commit/2c9c887fae4662189e3bce8b07cbf5ef3158e280))
* increase max length of group and dynamic addon fetching condition to 1500 ([f965b44](https://github.com/Viren070/AIOStreams/commit/f965b448d0d8fa420724aa09c2e4fc0d916a0973))
* increase ttl in metadata lock ([b30810a](https://github.com/Viren070/AIOStreams/commit/b30810a5e08d6e886bb0e694a5ae2bad568e14b1))
* **presets/mediafusion:** clean filename ([820a5e0](https://github.com/Viren070/AIOStreams/commit/820a5e0b064db1a0603467920b85cb5e2b3b5511))
* **presets/more-like-this:** update manifest generation ([1ca7f55](https://github.com/Viren070/AIOStreams/commit/1ca7f55eae1a12b614cd9550b8f23f7ccaf800e5))
* **presets/stremthru-store:** add Usenet stream type handling and info hash extraction ([aa3ae24](https://github.com/Viren070/AIOStreams/commit/aa3ae2478aa3ce632cb5bb782cd94c7ee5965d47))
* **presets/torbox:** handle Usenet stream type in hash extraction ([967cff2](https://github.com/Viren070/AIOStreams/commit/967cff29ac5ffd5cc71b1ca94c9c61e940cf237a))
* use correct cache key for tvdb token ([63aacd1](https://github.com/Viren070/AIOStreams/commit/63aacd1874c214bbb1e89220875745fb0136ab27))
* use fetchAndProcessAddons instead of fetchFromAddon in dynamic fetch strategy ([b0cddfc](https://github.com/Viren070/AIOStreams/commit/b0cddfcc8f9ebad1ef39812deda7bdf3eae9807e))

## [2.13.3](https://github.com/Viren070/AIOStreams/compare/v2.13.2...v2.13.3) (2025-09-26)


### Bug Fixes

* **debrid/utils:** allow season 1 with correct absolute episode to pass validation ([bd05313](https://github.com/Viren070/AIOStreams/commit/bd0531388897767507fad9265b2a8a9f0b059554))
* **metadata:** adjust timeouts ([7ec4774](https://github.com/Viren070/AIOStreams/commit/7ec4774151ee2aa6ca4fe2c1e1c3c864bebc9053))
* **presets/nzbhydra:** add force query search option to nzbhydra preset ([ab38242](https://github.com/Viren070/AIOStreams/commit/ab38242812124bda6004829accdd5d6b0c3f0166))

## [2.13.2](https://github.com/Viren070/AIOStreams/compare/v2.13.1...v2.13.2) (2025-09-26)


### Bug Fixes

* **builtins/znab:** make link field optional item schemas ([af4ce46](https://github.com/Viren070/AIOStreams/commit/af4ce46bbe4899e0841d71f45d15f46571e7397c))
* correct default value of STREMTHRU_STORE URL ([b5e1538](https://github.com/Viren070/AIOStreams/commit/b5e1538c466bcee16a98f132a86ce950d4330b3e))
* **debrid/stremthru:** add error handling and logging for no data response ([4b48fef](https://github.com/Viren070/AIOStreams/commit/4b48fef27b014b6fe49c3bff6e57a0efc252228e))
* don't filter out result with season of 1 if absolute episode matches ([85d1a14](https://github.com/Viren070/AIOStreams/commit/85d1a149986885b17688a67d5a594c06ec69c513))
* improve lock mechanism ([f6d5425](https://github.com/Viren070/AIOStreams/commit/f6d54254d13d4a7b848ace882793eefb6f7960dd))
* update English name for Romanian language entry ([a745ff2](https://github.com/Viren070/AIOStreams/commit/a745ff25da498412ca4f1c521cfa252002e7e166))

## [2.13.1](https://github.com/Viren070/AIOStreams/compare/v2.13.0...v2.13.1) (2025-09-26)


### Bug Fixes

* **debrid/stremthru:** handle undefined data ([9aa2303](https://github.com/Viren070/AIOStreams/commit/9aa230397f4a147efcb035a6d4263fa12349d65a))
* **http:** ensure proxyIndex defaults to 0 when no config is defined ([68196ae](https://github.com/Viren070/AIOStreams/commit/68196ae321d7e8fab9bf2893d77c59ed832330b1))
* **metadata/tvdb:** handle episode result in remote id search and choose first correct media type ([51878ce](https://github.com/Viren070/AIOStreams/commit/51878cec35a1c45644582456a4692049785ee9a2))
* only add stats when enabled ([36c07f0](https://github.com/Viren070/AIOStreams/commit/36c07f08b872c3d8a841338c6d8611345ca9f5dd))
* prefix magnet check cache key with service name ([4a6ab81](https://github.com/Viren070/AIOStreams/commit/4a6ab81ff310fa8ed31cc816132df997df36ece8))

## [2.13.0](https://github.com/Viren070/AIOStreams/compare/v2.12.2...v2.13.0) (2025-09-26)


### Features

* add `ALTERNATE_DESIGN` env var ([8f0bfc5](https://github.com/Viren070/AIOStreams/commit/8f0bfc50049349aa6304e51664fee3d8758ec096))
* add ability to customise group behaviour ([8dc85ba](https://github.com/Viren070/AIOStreams/commit/8dc85ba5941fcd36b0206987009bba2527a5000f))
* add bigmagnet preset and adjust envs and startup logs ([1c6d8a1](https://github.com/Viren070/AIOStreams/commit/1c6d8a12a9b2c4e169172c13896884d07c226d59))
* add filter statistics ([26713aa](https://github.com/Viren070/AIOStreams/commit/26713aa38d177bfc86fc8b809bb0c79411f9eede))
* add knaben builtin addon ([2790f45](https://github.com/Viren070/AIOStreams/commit/2790f4554193b3de24eaa8943388cab4cf1f6f24))
* add new logo assets and manifest for frontend ([c11690c](https://github.com/Viren070/AIOStreams/commit/c11690c22bf69c2a2a15bb1f846deb0f17463e45))
* add presets for jackett and nzbhydra ([4739d17](https://github.com/Viren070/AIOStreams/commit/4739d17bdd930c9858a21aa8819d9139a3e9b7b8))
* add PTT_PORT and PTT_SOCKET environment variables for PTT server configuration ([7d79322](https://github.com/Viren070/AIOStreams/commit/7d79322f01b4fd4fa607ba31604d4a5f9f514d5d))
* add queryType to SEL filters ([26713aa](https://github.com/Viren070/AIOStreams/commit/26713aa38d177bfc86fc8b809bb0c79411f9eede))
* add sootio preset ([36ed320](https://github.com/Viren070/AIOStreams/commit/36ed320a2dc3a80aeb49c046752d9550424fd56c))
* add torrent galaxy builtin addon ([5f537af](https://github.com/Viren070/AIOStreams/commit/5f537af30a620de4ae3bbda71475e86c0d8a2e9f))
* adjust querying for knaben ([c39ed44](https://github.com/Viren070/AIOStreams/commit/c39ed44ba46a05f5d6bbb82429feef919cc0d6fd))
* allow custom prowlarr/jackett/nzhydra instances ([4739d17](https://github.com/Viren070/AIOStreams/commit/4739d17bdd930c9858a21aa8819d9139a3e9b7b8))
* allow customising level of detail for anime db ([0046dfd](https://github.com/Viren070/AIOStreams/commit/0046dfdcde1af6b39ae03deb525be68892da4eb9))
* allow customising which stats are shown ([f84fb25](https://github.com/Viren070/AIOStreams/commit/f84fb25de11acb9c6b019a02249e789a6445537e))
* **builtins/knaben:** add blacklisted categories and filter search results accordingly ([c74654a](https://github.com/Viren070/AIOStreams/commit/c74654adaab8bd72fd937250d23e02805b4407ea))
* **builtins/prowlarr:** allow specifying custom tags ([e451e96](https://github.com/Viren070/AIOStreams/commit/e451e96e52a89c48ea16f24118bc1f952aa65f0a))
* **builtins:** refactor query building for debrid addons to use a shared method ([6306c7c](https://github.com/Viren070/AIOStreams/commit/6306c7c33aee6b185940f37a0c929c40ddd19c94))
* **core/formatters:** add ::&lt;comparator&gt;:: to formatter for Advanced Custom Formatting Logic! ([#381](https://github.com/Viren070/AIOStreams/issues/381)) ([bc2e065](https://github.com/Viren070/AIOStreams/commit/bc2e065645efebad267e61a2bcb8c7ed30cd6b12))
* **core/formatters:** add replace("needle", "replaceValue") modifier for strings ([#386](https://github.com/Viren070/AIOStreams/issues/386)) ([cc26bf9](https://github.com/Viren070/AIOStreams/commit/cc26bf92950b228ee9b239cd1bdc3945317fba79))
* **core/formatters:** allow multiple sequential modifiers ([#368](https://github.com/Viren070/AIOStreams/issues/368)) ([ab5de5c](https://github.com/Viren070/AIOStreams/commit/ab5de5ce04b2c267dd4be41cf442874a46260012))
* **core/formatters:** improve and refactor base formatter ([224810d](https://github.com/Viren070/AIOStreams/commit/224810dcc3854363d053eee1b712e7c0ee5b4e4c))
* extract jackett indexer in torznab implementation ([ef10cf0](https://github.com/Viren070/AIOStreams/commit/ef10cf0becd3763e976b7265a62db0c6028c502c))
* fetch torrent metadata lazily in background ([a6fc147](https://github.com/Viren070/AIOStreams/commit/a6fc1474f38e8b70d2ec537becb259744d2f7aa8))
* **formatters:** add prism predefined format ([5dadd98](https://github.com/Viren070/AIOStreams/commit/5dadd98f00e14bbf90baf18b642bf1ea5feea876))
* **frontend:** add reset configuration button into new danger zone card ([039081b](https://github.com/Viren070/AIOStreams/commit/039081b9da59ddd457381ac2c7542b435c012f77))
* **frontend:** implement formatter import/export functionality with refactored ImportModal component ([edbcc27](https://github.com/Viren070/AIOStreams/commit/edbcc272e7cfa8fa307bc23e7cf8fed17d565448))
* **frontend:** persist user data to local storage ([#353](https://github.com/Viren070/AIOStreams/issues/353)) ([213d3cf](https://github.com/Viren070/AIOStreams/commit/213d3cf700c8a201caeca624b6679bfb28da5290))
* handle downloadUrls for torrents. ([4739d17](https://github.com/Viren070/AIOStreams/commit/4739d17bdd930c9858a21aa8819d9139a3e9b7b8))
* handle saga and years in titles ([b3a09bf](https://github.com/Viren070/AIOStreams/commit/b3a09bf56cd2e5fd1ae1bec7cef1b7538a287308))
* **http:** re-use proxy agents ([#379](https://github.com/Viren070/AIOStreams/issues/379)) ([427efa9](https://github.com/Viren070/AIOStreams/commit/427efa9b0320faef7406eec85ac97a79c71c2e79))
* increase manifest cache and allow bypassing cache/longer timeouts when necessary ([f37249c](https://github.com/Viren070/AIOStreams/commit/f37249c4d4947b4b1bef80b0d08e9ca7dc54125a))
* log transformation duration for streams in StremioTransformer ([075b816](https://github.com/Viren070/AIOStreams/commit/075b8162d4b1ee8a9e0a16712348270842001edd))
* **metadata/tmdb:** add support for fetching movie and TV translations alongside alternative titles ([14de859](https://github.com/Viren070/AIOStreams/commit/14de859527ceb94e3f5ceb706d75404d3e61ebd8)), closes [#370](https://github.com/Viren070/AIOStreams/issues/370)
* move H-OU and H-SBS to visualTags ([b5e6d72](https://github.com/Viren070/AIOStreams/commit/b5e6d722f388fb8ce6feb5bb3301b4b182a667ee))
* perform title matching, improve season/episode handling ([b365108](https://github.com/Viren070/AIOStreams/commit/b365108189e3ab8a77205006fd044fd2bf6b5c9f))
* simplify anime db data source refresh logic ([62163fe](https://github.com/Viren070/AIOStreams/commit/62163fe381f50ff25e5b71f66b4ae0a90b323580))
* sort statistics streams by time ascending ([6e82a00](https://github.com/Viren070/AIOStreams/commit/6e82a004d206e30d92cfec7f476bf686cdc48654))
* stuff ([54573b5](https://github.com/Viren070/AIOStreams/commit/54573b571bf4901a7f3e373cca01fc0425656e01))
* support encrypted password in search API ([69963fa](https://github.com/Viren070/AIOStreams/commit/69963fa581cf63ccf4d41d9a17a95513d7a2bde5))
* support getting metadata from tvdb ([ca407f3](https://github.com/Viren070/AIOStreams/commit/ca407f36ce8bfb0a8a7965fd4d7e8cf444a46cd9))
* use anime entry title as primary title when using kitsu/mal IDs ([203236c](https://github.com/Viren070/AIOStreams/commit/203236c1ccce8bbea81169a0f9a146493fe33604))
* use minimal validation in anime database ([8f8b25d](https://github.com/Viren070/AIOStreams/commit/8f8b25d400085895c2d8dbcb12ec945cb085e8b6))
* use user-friendly labels for resource options ([34384a4](https://github.com/Viren070/AIOStreams/commit/34384a4b96b04e6aff12f925d4896eb55eb4f30c))


### Bug Fixes

* . ([7cdd7c0](https://github.com/Viren070/AIOStreams/commit/7cdd7c0b8e516bdd0910d4543b47a831e1010abb))
* adjust absolute episode calculation for non-IMDB episodes ([079a0a3](https://github.com/Viren070/AIOStreams/commit/079a0a38cc4d22357d13c1ef95484151062fcbc9))
* adjust bluray remux regex ([b3549cd](https://github.com/Viren070/AIOStreams/commit/b3549cd989a9f32c42fec7bdc39254cbc68a6451))
* adjust episode number using imdb episode offset for kitsu/mal ids ([c923cf2](https://github.com/Viren070/AIOStreams/commit/c923cf295f820ce40168563e7e55ee8585b6aa18))
* adjust private IP regex ([8d3e4f9](https://github.com/Viren070/AIOStreams/commit/8d3e4f9356d6ba693d13ae0742286ef3e63793f9))
* allow any string for URL ([c77dcd8](https://github.com/Viren070/AIOStreams/commit/c77dcd82f533b3eceb229b0d47f6bdd54ecda847))
* avoid importing other paths ([0266adb](https://github.com/Viren070/AIOStreams/commit/0266adb7afec9fe8368a8c94e971341495e73b9e))
* await parse torrent ([48aaca2](https://github.com/Viren070/AIOStreams/commit/48aaca255fdf52cf38901c3710ce1293ffec8e56))
* **builtins/knaben:** allow null values for URL and correct default value of searchType ([3ef62c2](https://github.com/Viren070/AIOStreams/commit/3ef62c2e2bb2c29461f8cebefea533278c95df7d))
* **builtins/prowlarr:** update indexerFlags type to string array ([b3cac30](https://github.com/Viren070/AIOStreams/commit/b3cac302f106355f46112971a972e389faaf0f90))
* **builtins/torbox-search:** get metadata from cache ([5246c2a](https://github.com/Viren070/AIOStreams/commit/5246c2adb4334a362528f3f5eecc3d7245bc41df))
* **builtins/torznab:** extract size from torznab attribute too ([d7c8e3f](https://github.com/Viren070/AIOStreams/commit/d7c8e3fc15a6252d7ab1d2d9d45a3ce85b91a31e))
* **builtins/torznab:** support infohash extraction from magnet URLs in enclosure ([ac3791b](https://github.com/Viren070/AIOStreams/commit/ac3791b34ef1e1bb24592ac8d47e857d6ae2ad7d))
* **builtins/znab:** improve error handling ([2d13747](https://github.com/Viren070/AIOStreams/commit/2d137473e61654e6a0df7aebc4127bd3bb08c7b0))
* clean title in base debrid addon ([3b23022](https://github.com/Viren070/AIOStreams/commit/3b2302226f6326f0180206c8dd444779259a7f84))
* **core/formatters:** correctly handle post-processing of strings ([#389](https://github.com/Viren070/AIOStreams/issues/389)) ([9fb21c7](https://github.com/Viren070/AIOStreams/commit/9fb21c7ba609dc6b2f8b7fa079372f420c7e290b))
* **core/formatters:** ensure null values trigger the false check case in conditional modifiers ([#348](https://github.com/Viren070/AIOStreams/issues/348)) ([dae054f](https://github.com/Viren070/AIOStreams/commit/dae054fd6b58e673b7814271acc01ceced983cac))
* **core/formatters:** fix ordering of parsed variables ([#386](https://github.com/Viren070/AIOStreams/issues/386)) ([cc26bf9](https://github.com/Viren070/AIOStreams/commit/cc26bf92950b228ee9b239cd1bdc3945317fba79))
* **core/formatters:** update Conditional check to properly typecheck ([#361](https://github.com/Viren070/AIOStreams/issues/361)) ([9a305ea](https://github.com/Viren070/AIOStreams/commit/9a305ea6ee9486949e1ac594c39db4efc685e831))
* **core/formatters:** Update Multiple Modifiers Feature to properly parse modifiers, check_tf, etc... ([#369](https://github.com/Viren070/AIOStreams/issues/369)) ([36fdeb4](https://github.com/Viren070/AIOStreams/commit/36fdeb467287408f292dc91d06f7fda009666386))
* correctly count statistics for stream expression filters ([ef28f41](https://github.com/Viren070/AIOStreams/commit/ef28f41f827bc1baf97b7857a5063ed2316d0c65))
* correctly format IMDb ID value when using anime mappings for RPDB ([f65dea3](https://github.com/Viren070/AIOStreams/commit/f65dea3a3a5ff5a16ebea9c47a2c893f8d85376e))
* **debrid:** cache non-downloaded status temporarily ([50ac3b5](https://github.com/Viren070/AIOStreams/commit/50ac3b5c5803f32f0d8eab0b453ea3c49e6e106c))
* decrease timeout for stremthru ([dada10f](https://github.com/Viren070/AIOStreams/commit/dada10f675e9bdaffd7bc1f00fd40892a7086946))
* default skip failed addons to true by explicitly checking for false ([4b06825](https://github.com/Viren070/AIOStreams/commit/4b068255c95e6d0fc60219eac62d1f868a9fc4c8))
* **Dockerfile:** add patches folder to image ([4739d17](https://github.com/Viren070/AIOStreams/commit/4739d17bdd930c9858a21aa8819d9139a3e9b7b8))
* don't use anime title as primary title ([9d570a8](https://github.com/Viren070/AIOStreams/commit/9d570a8e85a7a9d8625c7fb6b281774b9f8a9b39))
* ensure existing statistic settings remain during migration ([f494a1c](https://github.com/Viren070/AIOStreams/commit/f494a1c4c979a4edfe0f8e59770ac9156ac7fced))
* ensure missing tmdb credentials don't throw errors in metadata service ([2fddf90](https://github.com/Viren070/AIOStreams/commit/2fddf902827d23a2bc24ad5dd6fcb3cb2624d7ed))
* ensure remaining groups are skipped when condition evaluates to false in parallel behaviour (regression) ([0574ea3](https://github.com/Viren070/AIOStreams/commit/0574ea359942984f96ad651e5334ce5296c40f9f))
* ensure remaining rules are always checked ([6873eba](https://github.com/Viren070/AIOStreams/commit/6873eba62b1c39a30ceea11e21d1592f03f2778d))
* ensure responses are still cached with bypassCache ([2591835](https://github.com/Viren070/AIOStreams/commit/2591835eb8cffb5a0a9abe56d264b3b8876a51be))
* ensure to exit attempt loop if data source successfully loads ([3d706ea](https://github.com/Viren070/AIOStreams/commit/3d706ea48427eac7891a6a886f1547ace1cd684f))
* format bytes in removal reason detail ([7860546](https://github.com/Viren070/AIOStreams/commit/78605468949016b3140e53eb582e9da0184d24d3))
* **frontend:** add new-password autoComplete attribute to RPDB API Key input ([86f88fd](https://github.com/Viren070/AIOStreams/commit/86f88fd7357f40f87e745e956ba0268ea817670d))
* **frontend:** ensure migrations are applied when loading user data from local storage ([e182609](https://github.com/Viren070/AIOStreams/commit/e1826095e2e0cab66e97428b26e5508e6a9ff760))
* **frontend:** filter out tvdb api key in exports ([e562fc1](https://github.com/Viren070/AIOStreams/commit/e562fc10a42dab6b81cba86305bd688207d1d000))
* **frontend:** fully reset user data when set to null ([242b870](https://github.com/Viren070/AIOStreams/commit/242b87055180f5d69c6fd7f0e19b33848a05932d))
* **frontend:** set a default value for statistics to show ([5ad2909](https://github.com/Viren070/AIOStreams/commit/5ad290978771d23f459634107896d260bb8895d3))
* handle errors during addon generation without throwing when necessary ([e0ce580](https://github.com/Viren070/AIOStreams/commit/e0ce5807a2b6ede70faa59a097686b583fcc348f))
* handle errors when fetching search metadata in BaseDebridAddon ([862ea36](https://github.com/Viren070/AIOStreams/commit/862ea364eac680b4978a99f7c9da6eccdfb189b2))
* improve error handling for search metadata and processing errors in BaseDebridAddon ([6ba433e](https://github.com/Viren070/AIOStreams/commit/6ba433e4243a72987a1c0c44716a6dd43e2dfa29))
* improve filename extraction ([512fe62](https://github.com/Viren070/AIOStreams/commit/512fe6282e8fbd734795f161063903cb1db5c71f))
* improve pattern fetching with retry logic and increased timeout ([f190a87](https://github.com/Viren070/AIOStreams/commit/f190a87f2a6efa9fd4d18ae68f6a32cc10c47b73))
* increase timeout for IMDB metadata ([3f1ef8b](https://github.com/Viren070/AIOStreams/commit/3f1ef8b66b4819b9d74f9f23fe784ae36f350ff4))
* make bluray regex more robust ([#396](https://github.com/Viren070/AIOStreams/issues/396)) ([2e9c270](https://github.com/Viren070/AIOStreams/commit/2e9c2703c0b1bf04d3fdf914ab8e1567232b7d5b))
* parse uncached titles during nzb processing ([4739d17](https://github.com/Viren070/AIOStreams/commit/4739d17bdd930c9858a21aa8819d9139a3e9b7b8))
* **parser:** add more edge cases to saga handling ([cfa854d](https://github.com/Viren070/AIOStreams/commit/cfa854d2427dac7784a3a6c2383cb36d3dd56167))
* prefer tvdb id for series media type in newznab. ([4739d17](https://github.com/Viren070/AIOStreams/commit/4739d17bdd930c9858a21aa8819d9139a3e9b7b8))
* **presets/ai-search:** use correct structure for body in manifest generation ([93bb543](https://github.com/Viren070/AIOStreams/commit/93bb5434a4db9d78dff090f10ac7462cb9930ab6))
* **presets/debridio-tv:** update url and channels list ([4650233](https://github.com/Viren070/AIOStreams/commit/465023336f65e8afedf35f19fafd220c28eedb78))
* **presets/debridio-watchtower:** handle no streams found message stream ([33090a4](https://github.com/Viren070/AIOStreams/commit/33090a45ebcd0d7638b93046075293f7d66843fc))
* **presets/jackett:** use correct torznab endpoint ([89f3c63](https://github.com/Viren070/AIOStreams/commit/89f3c637875bea01af7256ef913a71c6ca85eaf2))
* **presets/sootio:** add torbox to supported services ([93ecb87](https://github.com/Viren070/AIOStreams/commit/93ecb8716a80da0ca80c05bb6288d29cb487f901))
* **presets/stremthru:** add filename regex ([39ab86d](https://github.com/Viren070/AIOStreams/commit/39ab86dccfe75516cbe5632e4d3af12de71398ae))
* reduce false positives for 2.0 regex ([cd4f1c3](https://github.com/Viren070/AIOStreams/commit/cd4f1c32076abc09b6246515dd57f1dd659eaa48))
* remove length requirement from stream attributes ([9651eea](https://github.com/Viren070/AIOStreams/commit/9651eeacb3b9406c645ba71efc0445c0011645b4))
* rename script to cjs extension ([46fe7fd](https://github.com/Viren070/AIOStreams/commit/46fe7fd8a1a8e842099fd66ec04bda24b9b47615))
* rethrow errors during manifest generation when skip failed addons is false ([7dc865d](https://github.com/Viren070/AIOStreams/commit/7dc865d4c4834989d14cffc8f65fb64b2bd4fcb3))
* set forceInUi to false for all timeout options ([8d2bbf4](https://github.com/Viren070/AIOStreams/commit/8d2bbf4899e3095d1e8438099607f4cb08636d81))
* store correct type for expires_at ([684cd5e](https://github.com/Viren070/AIOStreams/commit/684cd5e843274eb0af57042271f7f92228427d66))
* **torznab:** add filter to exclude magnet links from download URLs ([73f6658](https://github.com/Viren070/AIOStreams/commit/73f6658e25af74a982599584de971bf935a342c3))
* update season number extraction for anime entries in BaseDebridAddon ([29b935a](https://github.com/Viren070/AIOStreams/commit/29b935ad606d2acebd530ff6669bef0d74c99088))
* update year handling in metadata processing ([be2728f](https://github.com/Viren070/AIOStreams/commit/be2728f33b38f9180763234888fb1fa54da274fe))
* use copy of applyMigrations function to avoid go-ptt import path ([ee79578](https://github.com/Viren070/AIOStreams/commit/ee79578730b6d25a50e2f77ede7736ccac69d8cc))
* validate infohashes ([0e54ae5](https://github.com/Viren070/AIOStreams/commit/0e54ae59f4579dd9143d93b6f937e993dbbf2d0e))

## [2.12.2](https://github.com/Viren070/AIOStreams/compare/v2.12.1...v2.12.2) (2025-09-02)


### Bug Fixes

* await regexAllowed check in validateRegexes function ([be1a257](https://github.com/Viren070/AIOStreams/commit/be1a257477f8a8f82a49b06e1cc35dc526c79f6e))
* **debridio-scraper:** add debrider to supported services ([24d0974](https://github.com/Viren070/AIOStreams/commit/24d097464c3a09f65dec5a16726786cc61d85e66))
* move cache hit message into debug level ([c515e19](https://github.com/Viren070/AIOStreams/commit/c515e19f196ce3b8c42604bf6c1f0c36f3f615c1))

## [2.12.1](https://github.com/Viren070/AIOStreams/compare/v2.12.0...v2.12.1) (2025-08-31)


### Bug Fixes

* add groups to pro mode ([cc51cc0](https://github.com/Viren070/AIOStreams/commit/cc51cc006c4fe19897219b1280a88d30e3f05c55))
* assign trusted and ip in userdata for search api ([78c94df](https://github.com/Viren070/AIOStreams/commit/78c94dfec3d56757f77aeb4ddc1435f282972c80))
* handle default undefined value of select-with-custom during validation ([6acc26f](https://github.com/Viren070/AIOStreams/commit/6acc26f9879874fbbfc3cc4e4420280e464a0a2c))
* make global size filter optional to allow only resolution-specific ([735bba5](https://github.com/Viren070/AIOStreams/commit/735bba5e33436753eea630a7079ece6be67fb14a))
* remove debug logging in year matching ([408a288](https://github.com/Viren070/AIOStreams/commit/408a28825942186bdc94001658cb537b8f62d845))
* remove size and type from default auto play attributes ([1968a1c](https://github.com/Viren070/AIOStreams/commit/1968a1c7e18be78064d94bceb64eb9c17eef234f))
* remove trailing slashes in presetUrls validator ([f613772](https://github.com/Viren070/AIOStreams/commit/f6137721adf7316dc077e9c46eaccfc1be1742ba))
* support year ranges during year matching ([a39a85b](https://github.com/Viren070/AIOStreams/commit/a39a85b97ba0f28aa927bee3fb8232b34ad6d502))
* update alias route to handle requested path correctly with express 5 ([bd88d3d](https://github.com/Viren070/AIOStreams/commit/bd88d3de8b534fba227881b68d4dfdf93081f0cb))
* use partial record instead of record in schemas ([61cd2bc](https://github.com/Viren070/AIOStreams/commit/61cd2bc29e1e1c53b4add011b8352be24b49c574))
* use slice instead of splice to avoid modifying value of environment variable ([ee2ea41](https://github.com/Viren070/AIOStreams/commit/ee2ea419ba3c8d03403b0d02540c4d324d496a24))

## [2.12.0](https://github.com/Viren070/AIOStreams/compare/v2.11.6...v2.12.0) (2025-08-30)


### Features

* add pro/noob mode ([571ea7f](https://github.com/Viren070/AIOStreams/commit/571ea7fbc30f5216cbe439be7333b310eafbb2c1))
* add search API ([571ea7f](https://github.com/Viren070/AIOStreams/commit/571ea7fbc30f5216cbe439be7333b310eafbb2c1))
* add stream type as auto play attribute ([571ea7f](https://github.com/Viren070/AIOStreams/commit/571ea7fbc30f5216cbe439be7333b310eafbb2c1))
* allow specifying multiple URLs for comet and mediafusion in .env ([571ea7f](https://github.com/Viren070/AIOStreams/commit/571ea7fbc30f5216cbe439be7333b310eafbb2c1))
* **frontend:** move more stuff into pro only mode ([c68bb0e](https://github.com/Viren070/AIOStreams/commit/c68bb0e60ecf421f1f59a7b7edebb52a5cd15266))
* move more stuff into pro only ([73ccd15](https://github.com/Viren070/AIOStreams/commit/73ccd15f7e11351ae7b13acf15405b7330b10b2b))
* remove `ALLOW_UNAUTHENTICATED_SEARCH_API` env var ([df97bde](https://github.com/Viren070/AIOStreams/commit/df97bde45cd058e3c6e68645e495bb054ef557a0))
* use redis store in rate limiter when possible ([571ea7f](https://github.com/Viren070/AIOStreams/commit/571ea7fbc30f5216cbe439be7333b310eafbb2c1))


### Bug Fixes

* add rate limit to legacy endpoint ([0702d4f](https://github.com/Viren070/AIOStreams/commit/0702d4fb932a8cd601d8cac329ecef06be0dd76f))
* allow empty credential value in schema and add min length constraint for config validation ([4962465](https://github.com/Viren070/AIOStreams/commit/49624654b6f5be852e455df23683f6edbdafa336))
* behaviorHint passthrough in meta response ([571ea7f](https://github.com/Viren070/AIOStreams/commit/571ea7fbc30f5216cbe439be7333b310eafbb2c1))
* ensure catalog resource has correct types ([9a5339e](https://github.com/Viren070/AIOStreams/commit/9a5339e1385e853daf6432acb7df41a5ee16b2a6))
* **frontend:** dynamically determine menus based on mode ([5e969ff](https://github.com/Viren070/AIOStreams/commit/5e969ff2dc46d0d0897b86b7df0452e80da84f20))
* give priority to URL/service over infoHash ([085d394](https://github.com/Viren070/AIOStreams/commit/085d394c03c33cee6b30ba26026a19e5e0fdfd10))
* remove required attribute from service credential fields, ([571ea7f](https://github.com/Viren070/AIOStreams/commit/571ea7fbc30f5216cbe439be7333b310eafbb2c1))
* set value of default URL to undefined so updates to env apply for all users when using multiple URLs ([a3007e6](https://github.com/Viren070/AIOStreams/commit/a3007e659f57ea61edfba2e8066f67853d58eeec))

## [2.11.6](https://github.com/Viren070/AIOStreams/compare/v2.11.5...v2.11.6) (2025-08-28)


### Bug Fixes

* correctly extract json error for error metas ([5ddab33](https://github.com/Viren070/AIOStreams/commit/5ddab3308219aa17c0f89b3d522d3408f20e2ebf))
* **presets/aiostreams:** passthrough the proxied attribute ([62bf6de](https://github.com/Viren070/AIOStreams/commit/62bf6de6d9087ee5cd74942585b286fd2eda8296)), closes [#321](https://github.com/Viren070/AIOStreams/issues/321)

## [2.11.5](https://github.com/Viren070/AIOStreams/compare/v2.11.4...v2.11.5) (2025-08-26)


### Bug Fixes

* **parser:** improve BluRay REMUX regex ([4a658a1](https://github.com/Viren070/AIOStreams/commit/4a658a11159cfd9e15198b8f4f0dfa53e5e0b56e))
* **presets/webstreamr:** return original parsed file when no resolution matched ([07db3d9](https://github.com/Viren070/AIOStreams/commit/07db3d9d542d51c15f5364a1be543c6c8578c9c4))

## [2.11.4](https://github.com/Viren070/AIOStreams/compare/v2.11.3...v2.11.4) (2025-08-26)


### Bug Fixes

* fallback to undefined when name is null ([757138e](https://github.com/Viren070/AIOStreams/commit/757138ee4073cc1badec96cb0208d483ddf94df9))
* only define bingeGroup when auto play is enabled ([de47fff](https://github.com/Viren070/AIOStreams/commit/de47fffdee081669c82808c7986f2aabd833b49d))
* **presets/webstreamr:** update provider list, add show error option, parse error streams, only use resolution from stream name, ([1fd6730](https://github.com/Viren070/AIOStreams/commit/1fd67309b0306058f04f31502d49045524d004d8))

## [2.11.3](https://github.com/Viren070/AIOStreams/compare/v2.11.2...v2.11.3) (2025-08-25)


### Features

* add alternate `u` prefixed formatter language variables and sort language variables based on language settings ([271c183](https://github.com/Viren070/AIOStreams/commit/271c1836a81a352466158a44629be991277bf9ea)), closes [#323](https://github.com/Viren070/AIOStreams/issues/323)


### Bug Fixes

* add helper function for adding usenet download ([34075d5](https://github.com/Viren070/AIOStreams/commit/34075d58865cdf7d51abf8eb41338d372c67956d))
* **frontend:** improve clarity of descriptions and add alerts for auto play and exporting ([4855cf9](https://github.com/Viren070/AIOStreams/commit/4855cf97d7e1d348454ebe334bcf466939035896))
* **presets/mediafusion:** include encoded user data hash in manifest url ([200d1b7](https://github.com/Viren070/AIOStreams/commit/200d1b7b44bb0d0f1d5066923ff8e64bf4b716db))

## [2.11.2](https://github.com/Viren070/AIOStreams/compare/v2.11.1...v2.11.2) (2025-08-24)


### Bug Fixes

* add 'DB' to known names for debrider ([8ac29e0](https://github.com/Viren070/AIOStreams/commit/8ac29e0d19bcf583da9fdf2bc6fd31a02445400d))
* add rpdb api key to cache key ([d81206f](https://github.com/Viren070/AIOStreams/commit/d81206ff200f484bc7dbd8eee6b5422ec2b3b4dc))

## [2.11.1](https://github.com/Viren070/AIOStreams/compare/v2.11.0...v2.11.1) (2025-08-24)


### Bug Fixes

* add handling for RATE_LIMIT_EXCEEDED errors in middleware ([3af18db](https://github.com/Viren070/AIOStreams/commit/3af18db213f787baca55a5fa5e5293040815a660))
* determine useProxy after mapping ([9effbf8](https://github.com/Viren070/AIOStreams/commit/9effbf84b03b291c850667b7307461bd59981277))
* make description optional in manifest ([7bcbccb](https://github.com/Viren070/AIOStreams/commit/7bcbccb573fcff8935d6e2d45f9e76fa51c4c7f4))
* **presets/ai-companion:** adjust validation schema ([8f9f68b](https://github.com/Viren070/AIOStreams/commit/8f9f68bdf8c27a24adbdf152fb76a3122fd51c1b)), closes [#319](https://github.com/Viren070/AIOStreams/issues/319)
* **presets/comet:** add debrider to supported services ([a30419d](https://github.com/Viren070/AIOStreams/commit/a30419da0051fe80c1f4eec6f98917b9aa162576))
* **redis:** prevent setting cache with zero TTL ([69e76e1](https://github.com/Viren070/AIOStreams/commit/69e76e1a3054f4d54a570f2e552e2083fb34a889))

## [2.11.0](https://github.com/Viren070/AIOStreams/compare/v2.10.0...v2.11.0) (2025-08-24)


### Features

* add reverse order option for catalogs ([#310](https://github.com/Viren070/AIOStreams/issues/310)) ([1d941f0](https://github.com/Viren070/AIOStreams/commit/1d941f0707b4780fadcc782ec8e36035a76cb8ab)), closes [#299](https://github.com/Viren070/AIOStreams/issues/299)
* add size as auto play attribute ([dbe629a](https://github.com/Viren070/AIOStreams/commit/dbe629a0384422a3b9890056c19f83e541cf4088)), closes [#312](https://github.com/Viren070/AIOStreams/issues/312)
* **core/formatter:** add `stream.languageCodes` property ([ea724a6](https://github.com/Viren070/AIOStreams/commit/ea724a635fae90dd89887fd996c87c8ca5dfb907))
* **core/formatter:** add `stream.smallLanguageCodes` and fix for Latino ([4197fa5](https://github.com/Viren070/AIOStreams/commit/4197fa543876bfff666ec7e505748ba2a5b9f0de))
* enable deduplicator by default ([3366919](https://github.com/Viren070/AIOStreams/commit/336691954f7974a277897a63c9f353142a80927f))
* merge shuffle and reverse into one modifier button and make them mutually exclusive ([5b3aba1](https://github.com/Viren070/AIOStreams/commit/5b3aba1008939b19aeb8d6968cb3382c4460e94d))


### Bug Fixes

* **builtins/torbox-search:** correctly handle search user engine when caching ([d17da3d](https://github.com/Viren070/AIOStreams/commit/d17da3d7b27d993fdc3b7afb30f97a1f43e4ef1e))
* **builtins/torbox-search:** handle timeout errors and log errors in torrent handler ([4757db0](https://github.com/Viren070/AIOStreams/commit/4757db06992f20f26ce86a26a9cb327ff7b36bcf))
* **builtins/torbox-search:** move log for results above early exit in usenet handler ([72005a5](https://github.com/Viren070/AIOStreams/commit/72005a5c50acddc80e193d336bb2d99d265441f8))
* check if poster is from RPDB before converting ([3067ac3](https://github.com/Viren070/AIOStreams/commit/3067ac3cc36a9c4d826f12abea55c17cac1437ef))
* check URL path when using stremthru for proxy check ([db003db](https://github.com/Viren070/AIOStreams/commit/db003db7d59ad104b9cd53cf509e474b073ae5f3))
* **core/formatters:** convert language code fallback to uppercase ([4903114](https://github.com/Viren070/AIOStreams/commit/4903114f05995a804d2f77efa555880e3bf57ad3))
* **core/formatters:** convert to uppercase before mapping ([c32039d](https://github.com/Viren070/AIOStreams/commit/c32039d862c7dfcebb7eebee1b1978c370435e38))
* **Dockerfile:** add static files to image ([7edf671](https://github.com/Viren070/AIOStreams/commit/7edf671aa00b3bc15a53de0f42e99dfc2b0fb9aa))
* **frontend:** wrap regex pattern alert buttons ([955fe97](https://github.com/Viren070/AIOStreams/commit/955fe977367b42489d4d311b178302def87c0fd6))
* handle errors on status route and improve error messages ([90f0097](https://github.com/Viren070/AIOStreams/commit/90f00977b49026849101903b1b14bd8076dd0e1f))
* handle forced/default values for preset options in frontend and config validation ([766ff02](https://github.com/Viren070/AIOStreams/commit/766ff021679cef8fb80c774b3fbc655566ecf0ee))
* improve season extraction logic from metadata ([28775fa](https://github.com/Viren070/AIOStreams/commit/28775fab6617f14d0d683094f2d6549fc5ca8be3))
* mention addon in timeout error ([49a0413](https://github.com/Viren070/AIOStreams/commit/49a04137c0a194172676605c40155b336a07650f))
* validate TMDB API Key during config validation ([4c50f35](https://github.com/Viren070/AIOStreams/commit/4c50f3578ad8dad5528dc003da2ab175685572a8))

## [2.10.0](https://github.com/Viren070/AIOStreams/compare/v2.9.0...v2.10.0) (2025-08-21)


### Features

* add customisable auto play settings ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))
* add debrider as service and update mediafusion preset ([#305](https://github.com/Viren070/AIOStreams/issues/305)) ([5d27944](https://github.com/Viren070/AIOStreams/commit/5d279442b62fc13d25ae09f506a52a4ecda2bfa8))
* add first file auto play method ([a7d0650](https://github.com/Viren070/AIOStreams/commit/a7d06504f05ded2f524a1833756da42b057e2f23))
* add redis support ([bc9dd5c](https://github.com/Viren070/AIOStreams/commit/bc9dd5c85902872a9e8b8ca5647bcff341304819))
* add separate URL mappings option for stream URLs and outgoing request URLs ([a09f1f2](https://github.com/Viren070/AIOStreams/commit/a09f1f2347c70d83b59baaf9bce89cca46dc9425))
* add URL mappings configuration for outgoing requests ([a996624](https://github.com/Viren070/AIOStreams/commit/a996624875e6c220ed9b28b355ceff8d828f6589))
* allow filtering files with undefined size with SEL ([7d5911e](https://github.com/Viren070/AIOStreams/commit/7d5911e4079af54d121b18c21b3c18aabd81d214))
* allow setting allowed regexes through URLs ([1af4175](https://github.com/Viren070/AIOStreams/commit/1af4175fbe256c7f342c785a1957b1b6d49979d9))
* **builtins/torbox-search:** add debrider support ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))
* **builtins/torbox-search:** check instant availability for cached usenet searches ([beeb07d](https://github.com/Viren070/AIOStreams/commit/beeb07d182ac04aadf373086ba742464aab73f5b))
* **builtins/torbox-search:** mark items in torbox library as your media ([00a4187](https://github.com/Viren070/AIOStreams/commit/00a41877c129daad37874ed6e1edc723225518b0))
* **frontend:** show allowed import URLs in UI ([f4a9c5d](https://github.com/Viren070/AIOStreams/commit/f4a9c5dad83b332a16f128a6bb90210467317ab7))
* **frontend:** show configure button for marketplace addons with overriden URLs ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))
* process addon resource requests in background after initial timeout ([c31e7fc](https://github.com/Viren070/AIOStreams/commit/c31e7fca42ac47fc5d3ad4f7d55f95450117a776))
* refresh regex patterns from URLs in intervals ([0cd2afb](https://github.com/Viren070/AIOStreams/commit/0cd2afb577e79d69b790dc393cf3639e908d04c0))
* remove p2p streams when necessary during deduplication and update deduplicator multi group option values ([054781a](https://github.com/Viren070/AIOStreams/commit/054781a695f4387be4d43e6a097ff400edd98b04))
* update ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))


### Bug Fixes

* add DER to knownNames for Debrider ([b22c5c2](https://github.com/Viren070/AIOStreams/commit/b22c5c209215c72e6c055eaf4e157153946df388))
* always prefix bingeGroup with addon id, ([a7d0650](https://github.com/Viren070/AIOStreams/commit/a7d06504f05ded2f524a1833756da42b057e2f23))
* always prefix redis keys with aiostreams ([95f2c12](https://github.com/Viren070/AIOStreams/commit/95f2c12748c1ba469966dd608a19c16f8c674a03))
* **builtins/torbox-search:** continue if metadata can't be fetched ([2159cd3](https://github.com/Viren070/AIOStreams/commit/2159cd36c3a171a7afa62dc25dd330b4d59123af))
* **builtins/torbox-search:** don't cache empty search results ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))
* convert requests to BASE_URL to INTERNAL_URL to avoid hairpinning issues ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))
* correct parsing of error ID to ensure proper error metadata generation ([048bc02](https://github.com/Viren070/AIOStreams/commit/048bc02b3366f7ddfd36d44e0804c696d33a7036))
* correctly handle undefined/0 year tolerance during year matching ([967af82](https://github.com/Viren070/AIOStreams/commit/967af824489333965a3c3f1e833df69f578ff80e))
* correctly sanitise keywords to create a valid regex pattern ([88a071e](https://github.com/Viren070/AIOStreams/commit/88a071e9dd877157b65c9596bac90097bfe2aa62)), closes [#307](https://github.com/Viren070/AIOStreams/issues/307)
* don't cache empty stream results ([7b833ed](https://github.com/Viren070/AIOStreams/commit/7b833ed36d261f25548ef5b907e02efdd268b7c2))
* fetch metadata if year matching is enabled too and apply request types and addon ([98fd9d3](https://github.com/Viren070/AIOStreams/commit/98fd9d3fae3417da002c7e77df71850a299fde38))
* filter out references to non-existent presets during validation ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))
* fix debug log for uncached usenet download detection ([d1eb04d](https://github.com/Viren070/AIOStreams/commit/d1eb04d5d68f247b086f651ea246987570916461))
* force memory cache for regexes ([3145734](https://github.com/Viren070/AIOStreams/commit/314573480d550be07a8c230ef1858cb0d7e631c0))
* **frontend:** ensure services array is updated with missing services when it changes ([751e411](https://github.com/Viren070/AIOStreams/commit/751e411d63d62c1867cfc810af00a501ead1a512))
* **frontend:** filter out addonPassword and tmdbApiKey in export when exclude credentials is true ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))
* **frontend:** return null for non-existent services and improve type saftey ([ea2c692](https://github.com/Viren070/AIOStreams/commit/ea2c692d9790502ce06265475f9f47e5e4123a78))
* only log cache stats for memory cache ([5ddf430](https://github.com/Viren070/AIOStreams/commit/5ddf4309308a3da2332b6e0a8f332a8e1e7fe4a5))
* **presets/comet:** add scraping in progress to error messages ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))
* **presets/debridio:** update logo and create constants for common options ([86f17e8](https://github.com/Viren070/AIOStreams/commit/86f17e80dbb2945b417eeca47fcdda535edc1172))
* **presets/mediafusion:** append user data hash to manifest URL to have unique cache entries ([6e30b7b](https://github.com/Viren070/AIOStreams/commit/6e30b7b4ce768000f1b80f151ba22c7f7c5dd049))
* **presets/more-like-this:** update manifest generation logic ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))
* **presets/nuviostreams:** add new providers and fix title parsing ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))
* **presets/nuviostreams:** allow leaving providers blank to use default ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))
* **presets/streaming-catalogs:** add new catalogues ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))
* **presets/stremthru:** add debrider to supported services ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))
* **presets/subdl:** use correct option type for subdl api key and link to panel ([74b16f2](https://github.com/Viren070/AIOStreams/commit/74b16f24e8e3e933b4bd576d852209d9d1fc6e7b))
* **presets/torbox-search:** enforce minimum source and fix description ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))
* **presets/torrentio:** leave providers blank by default ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))
* **presets/torrentsdb:** add debrider to supported services ([6159789](https://github.com/Viren070/AIOStreams/commit/6159789a9566c8bf6d61d32cd0f5cf0bde9357d9))
* return modified stream URL after applying mappings ([3b25701](https://github.com/Viren070/AIOStreams/commit/3b257011e758f70b93e140e8ed2f78099423a714))
* support pattern only exports for allowed import URLs ([bb90592](https://github.com/Viren070/AIOStreams/commit/bb905923acbfbecf079c018e5e8559caa2f82d66))

## [2.9.0](https://github.com/Viren070/AIOStreams/compare/v2.8.2...v2.9.0) (2025-08-15)


### Features

* add 'DV Only' and 'HDR Only' visual tags ([01d4ecf](https://github.com/Viren070/AIOStreams/commit/01d4ecf76d96935e531cd2f9e33ac2e78e01d83b))
* add AI Companion ([93fd611](https://github.com/Viren070/AIOStreams/commit/93fd61169f84846ac30135e02c27e95124d547a7))
* add AStream ([5fc4cea](https://github.com/Viren070/AIOStreams/commit/5fc4cea2ea61835ea24ed8644b226796af4ee012)), closes [#298](https://github.com/Viren070/AIOStreams/issues/298)
* add configurable year tolerance during year matching ([05d3cac](https://github.com/Viren070/AIOStreams/commit/05d3cac778b896c5f596f4cdd5ef33c24712487c))
* add content deep dive to marketplace, closes [#284](https://github.com/Viren070/AIOStreams/issues/284) ([c48d37c](https://github.com/Viren070/AIOStreams/commit/c48d37c389404ae47de236a4a971e718f4143e5f))
* add forceInUi option to min/max constraints for better UX ([6308f8f](https://github.com/Viren070/AIOStreams/commit/6308f8fb45034aeb7cb9d4bccd87a9e32564ef88))
* add gdrive builtin addon ([05d3cac](https://github.com/Viren070/AIOStreams/commit/05d3cac778b896c5f596f4cdd5ef33c24712487c))
* add modal for viewing allowed regex patterns in regex filter menu ([5b31f0c](https://github.com/Viren070/AIOStreams/commit/5b31f0cb784b7f00ea21675c94237431f1500934))
* add multi group behaviour option for deduplicator ([a564e02](https://github.com/Viren070/AIOStreams/commit/a564e02d196e15732d12be9f50ac069e23eaefb8))
* add torbox search builtin addon ([05d3cac](https://github.com/Viren070/AIOStreams/commit/05d3cac778b896c5f596f4cdd5ef33c24712487c))
* allow deleting user ([05d3cac](https://github.com/Viren070/AIOStreams/commit/05d3cac778b896c5f596f4cdd5ef33c24712487c))
* allow setting allowed regexes for all users ([05d3cac](https://github.com/Viren070/AIOStreams/commit/05d3cac778b896c5f596f4cdd5ef33c24712487c)), closes [#244](https://github.com/Viren070/AIOStreams/issues/244)
* assign unassigned addons to the first group in StreamFetcher ([11c52cb](https://github.com/Viren070/AIOStreams/commit/11c52cb1f96bfb76278596bff7fea907ddf62dd0))
* **builtins/torbox-search:** add caching option for user-specific search engines in TorBox Search ([3c2b5b7](https://github.com/Viren070/AIOStreams/commit/3c2b5b778b725baab762201dbcf527b594831878))
* **builtins/torbox-search:** add only show user search results option ([eef55af](https://github.com/Viren070/AIOStreams/commit/eef55afbe0395e89740a98681221a2d4076bcef4))
* **builtins/torbox-search:** general improvements ([c48d37c](https://github.com/Viren070/AIOStreams/commit/c48d37c389404ae47de236a4a971e718f4143e5f))
* centralise TMDB credentials and automatically provide to addons when needed ([ed5893e](https://github.com/Viren070/AIOStreams/commit/ed5893ea50e6580879fea6be21857614d003eb1d))
* **frontend:** show logo from manifest for custom addons ([604ab02](https://github.com/Viren070/AIOStreams/commit/604ab023a85bcdfc21e62574d35d367a94510e44))
* handle streams provided in meta responses ([8014790](https://github.com/Viren070/AIOStreams/commit/8014790821c74cb3c3f7b1e03bd90f38a1261238))
* make `BASE_URL` required ([05d3cac](https://github.com/Viren070/AIOStreams/commit/05d3cac778b896c5f596f4cdd5ef33c24712487c))
* separate year matching into independent option, closes [#292](https://github.com/Viren070/AIOStreams/issues/292) ([c48d37c](https://github.com/Viren070/AIOStreams/commit/c48d37c389404ae47de236a4a971e718f4143e5f))
* support multiple `ADDON_PASSWORD`s ([1413075](https://github.com/Viren070/AIOStreams/commit/14130752a4116454f302f68964e672840dd9c615))
* update ([c48d37c](https://github.com/Viren070/AIOStreams/commit/c48d37c389404ae47de236a4a971e718f4143e5f))
* update ([05d3cac](https://github.com/Viren070/AIOStreams/commit/05d3cac778b896c5f596f4cdd5ef33c24712487c))


### Bug Fixes

* adjust error logging for metadata fetching ([1187f1a](https://github.com/Viren070/AIOStreams/commit/1187f1a8572e7353d185e367b5f2565a563857fc))
* **ai-search:** correctly check for tmdb api key ([a27a308](https://github.com/Viren070/AIOStreams/commit/a27a308ce584e934bab806f3c2652f686f6e107c))
* **astream:** add github link ([24124c4](https://github.com/Viren070/AIOStreams/commit/24124c43698c924168e10f583a1790bc0dd08117))
* block head requests on debrid resolve and add missing return ([c643cbb](https://github.com/Viren070/AIOStreams/commit/c643cbb3e764ec19a2c7bf0bae8dd61cd7ad6c67))
* **builtins/gdrive:** improve logging ([bba4e56](https://github.com/Viren070/AIOStreams/commit/bba4e5614e8b0a2c436ea6be9c3f8178cb00fb0a))
* **builtins/torbox-search:** adjust validation schemas for api ([6d8ea42](https://github.com/Viren070/AIOStreams/commit/6d8ea4274d07f2c257ce2dce0da7d6e68c420671))
* **builtins/torbox-search:** cache playback links for usenet ([7ae6127](https://github.com/Viren070/AIOStreams/commit/7ae612732f10a2898664bc01e1742e7e663e1c95))
* **builtins/torbox-search:** ensure errors are logged during usenet fetch ([4147ea3](https://github.com/Viren070/AIOStreams/commit/4147ea3c7e735f804dae63c6eadf86985bdc7534))
* **builtins/torbox-search:** ensure files are always added during scrape ([23b8aa1](https://github.com/Viren070/AIOStreams/commit/23b8aa1c18daccb43dd78441251fc82c5c682bd0))
* **builtins/torbox:** set type property at root to workaround https://github.com/colinhacks/zod/issues/2655 ([c66ef9e](https://github.com/Viren070/AIOStreams/commit/c66ef9e2f45606c495fc90be272617ad29b936c4))
* check for allowed regexes during filtering ([7b0b98f](https://github.com/Viren070/AIOStreams/commit/7b0b98f135cf7b68be309ff4c2ac313efef67b7c))
* correctly handle server side forcing of deprecated public proxy URLs ([1cdb0f3](https://github.com/Viren070/AIOStreams/commit/1cdb0f376efc72cf49d0842fd2f7725e353468a9))
* **debrid:** correctly handle request download link response ([91772fe](https://github.com/Viren070/AIOStreams/commit/91772fe0d3e045de90066075ea9266c56dd9ba85))
* don't allow empty URLs in environment variables ([53ca896](https://github.com/Viren070/AIOStreams/commit/53ca8969c717fa47e45d564b50a6d7e7e300356c))
* don't show errors during catalog pagination to avoid repeated requests ([d623305](https://github.com/Viren070/AIOStreams/commit/d62330531d4ae4cde716655a1bc474a3fa9dbbb8))
* don't validate config on get and adjust error handling ([063446e](https://github.com/Viren070/AIOStreams/commit/063446eedd2479b4b08f5e33c93d40e0d08304a3))
* ensure forced proxy information is always checked/used when provided ([05d3cac](https://github.com/Viren070/AIOStreams/commit/05d3cac778b896c5f596f4cdd5ef33c24712487c))
* ensure items are always removed from cache when TTL expires ([5325e50](https://github.com/Viren070/AIOStreams/commit/5325e5048c5a6b3ddd68e508a423d7ed18b3697d))
* fallback to stream addon name when stream name is not provided when stream passthrough is enabled ([c48d37c](https://github.com/Viren070/AIOStreams/commit/c48d37c389404ae47de236a4a971e718f4143e5f))
* **frontend:** add spacing between alerts in regex tab ([682c187](https://github.com/Viren070/AIOStreams/commit/682c18786b2a4b602bd7b7fafdf936a7250897e0))
* **frontend:** fix css issues in filter menu ([5e99e7a](https://github.com/Viren070/AIOStreams/commit/5e99e7adf7274b0992ca90dafa7d82c606a5be68))
* **frontend:** only break-all on code ([8e97599](https://github.com/Viren070/AIOStreams/commit/8e97599639a433385546e329b889ca503ed8c72a))
* improve error messages ([633f2d2](https://github.com/Viren070/AIOStreams/commit/633f2d24bbea0ad1b41204319d715dcd529567b1))
* log full error for unexpected errors during stream retrieval ([043de07](https://github.com/Viren070/AIOStreams/commit/043de074bdb3488ab7ab511cdc186aed4886ec43))
* match HDR10P for HDR10+ ([0d7c8d9](https://github.com/Viren070/AIOStreams/commit/0d7c8d92b19b89893daeaa254bd4767d60d9c127))
* only add access token header when present ([498282f](https://github.com/Viren070/AIOStreams/commit/498282fd8298df33a3d1e55d98cf37c01df48b18))
* override type to live for usa tv, argentina tv, and debridio tv ([05d3cac](https://github.com/Viren070/AIOStreams/commit/05d3cac778b896c5f596f4cdd5ef33c24712487c))
* pass name when creating usenet download ([9832f5e](https://github.com/Viren070/AIOStreams/commit/9832f5e60c5de8fe1d343f4bd86544d1a1ef207a))
* remove base when forming url object for addon validation ([40657bb](https://github.com/Viren070/AIOStreams/commit/40657bbc523840cded14cd639f3cff74111b32a2))
* remove debug logging and adjust builtin torbox search logs ([2a027ca](https://github.com/Viren070/AIOStreams/commit/2a027ca49b6fd48012eb614bfcd78ec9c96bbfb4))
* remove request headers from stream when proxied ([9dc718e](https://github.com/Viren070/AIOStreams/commit/9dc718e6b073c80514495d5af018b3a26023733d))
* set default year tolerance to 1 during migration and only if not already set ([3a3972b](https://github.com/Viren070/AIOStreams/commit/3a3972b76309bba9935fa7c0a0bc0cf6c72a4f63))
* simplify and fix bluray remux detection ([05d3cac](https://github.com/Viren070/AIOStreams/commit/05d3cac778b896c5f596f4cdd5ef33c24712487c))
* skip internal middleware in development environment ([8f4724e](https://github.com/Viren070/AIOStreams/commit/8f4724e5b3978378e297b2dcbdc9cb7020630b7c))
* skip mediafusion found but filtered message stream ([05d3cac](https://github.com/Viren070/AIOStreams/commit/05d3cac778b896c5f596f4cdd5ef33c24712487c))
* **stremthru-store:** ensure release groups don't get parsed as indexer ([05d3cac](https://github.com/Viren070/AIOStreams/commit/05d3cac778b896c5f596f4cdd5ef33c24712487c))
* **subhero:** add Portuguese (Brazil) option ([76801e2](https://github.com/Viren070/AIOStreams/commit/76801e2fe23e354b0d1c3fc0f1b8cf5e8b54417e))
* temporarily switch to fork for torbox api package ([c388ef3](https://github.com/Viren070/AIOStreams/commit/c388ef3fab264d54f866b43c3f86784c14a19eef))
* throw error on rate limit exceeded streams ([05d3cac](https://github.com/Viren070/AIOStreams/commit/05d3cac778b896c5f596f4cdd5ef33c24712487c))
* **webstreamr:** add missing emojis to message parser ([#294](https://github.com/Viren070/AIOStreams/issues/294)) ([3a53e35](https://github.com/Viren070/AIOStreams/commit/3a53e3575672a299c98e297b31d6f9bc692b7e6b))

## [2.8.2](https://github.com/Viren070/AIOStreams/compare/v2.8.1...v2.8.2) (2025-07-30)


### Bug Fixes

* allow all extra keys ([f8388ed](https://github.com/Viren070/AIOStreams/commit/f8388edfa04e7392c300742d44123f56dd32e1fc))
* assign encoded token to correct credential ID ([4963123](https://github.com/Viren070/AIOStreams/commit/49631231a1f2581b32f3deffc0584a369fb90326))
* **streamasia:** url encode mediaflow proxy password ([5bd55b5](https://github.com/Viren070/AIOStreams/commit/5bd55b5a58684fbb07293615a9118f06b5715ca3))
* url encode extra values ([2eea0a9](https://github.com/Viren070/AIOStreams/commit/2eea0a9ed5ea285d084973edfb4f63e9c5550525))

## [2.8.1](https://github.com/Viren070/AIOStreams/compare/v2.8.0...v2.8.1) (2025-07-30)


### Features

* support socks5 proxy for `ADDON_PROXY` ([de587bb](https://github.com/Viren070/AIOStreams/commit/de587bb2ff0c9f163453f9a67785dc6c3c440f50))


### Bug Fixes

* add explicit handling of passthrough type in deduplicator ([4797a33](https://github.com/Viren070/AIOStreams/commit/4797a33f7f4503298253489c00d32f56f88d73c4))
* adjust forced to top sort handling to avoid modifying sort criterias ([146cf16](https://github.com/Viren070/AIOStreams/commit/146cf16fbdcef338b352d6abb0506178ba8ba13a))
* correctly sanitise filename ([aa66213](https://github.com/Viren070/AIOStreams/commit/aa66213450739d3b5fdb0dc93551978a585b1311))
* enable result passthrough for tmdb collections ([2408109](https://github.com/Viren070/AIOStreams/commit/2408109bf2c17565c53a4dfc1f76e7521af3164c))

## [2.8.0](https://github.com/Viren070/AIOStreams/compare/v2.7.0...v2.8.0) (2025-07-29)


### Features

* add explicit redirect handling to avoid external requests and refactor precaching logic ([0e40299](https://github.com/Viren070/AIOStreams/commit/0e4029901bc3dd75570778ec937afa50fc2084f1))
* add force to top option for custom addons ([6a26e11](https://github.com/Viren070/AIOStreams/commit/6a26e11efcab5d96c4c96c8c79b06c44b42db2af))
* add more like this ([b1e46a2](https://github.com/Viren070/AIOStreams/commit/b1e46a2bd35a53c85c85ef568c68725a039a0940))
* add options to force streams to the top of the list in MoreLikeThis and TmdbCollections presets ([08adc25](https://github.com/Viren070/AIOStreams/commit/08adc25218549ab9f57a6511003b10d8bfeae54b))
* add result passthrough option ([86f7057](https://github.com/Viren070/AIOStreams/commit/86f7057a9fcc32ce2a603525719d49af4ed0b50d))
* add streamasia ([03afc6e](https://github.com/Viren070/AIOStreams/commit/03afc6e9aa1874b741c504bea1a32c0d73c7284b))
* **debridio-tv:** enable result passthrough by default and remove debug logs ([096751a](https://github.com/Viren070/AIOStreams/commit/096751a74ac7b7264ff58ba827ce19feb7817bbd))


### Bug Fixes

* allow empty id prefixes ([d39a301](https://github.com/Viren070/AIOStreams/commit/d39a301be60e8a3cf99d1cd1bfd795c333ee62d0))
* correctly handle encrypted public proxy url ([7c08137](https://github.com/Viren070/AIOStreams/commit/7c081377d12f36ac433541a2fe61e2a0d8f5cf5e))
* enable result passthrough for usa tv, argentina tv, and more like this ([74179aa](https://github.com/Viren070/AIOStreams/commit/74179aab4c929756a4ee178a0098df78cabc43ed))
* prevent streams from being proxied if urls match proxy or already have proxied set to true ([5320fcf](https://github.com/Viren070/AIOStreams/commit/5320fcf80f832955d7d4cefe9c6b1dca652293ae))

## [2.7.0](https://github.com/Viren070/AIOStreams/compare/v2.6.1...v2.7.0) (2025-07-28)


### Features

* add proxy public url option, deprecate `FORCE_PUBLIC_PROXY_` env vars and replace with `FORCE_PROXY_PUBLIC_URL` and `DEFAULT_PROXY_PUBLIC_URL` ([feb4651](https://github.com/Viren070/AIOStreams/commit/feb465176039e3cd5d2308dd8381775b7b1704f1))
* add RPDB redirect API with fallback support ([884b77e](https://github.com/Viren070/AIOStreams/commit/884b77ecd950962f0ee95c5540a7aeca6431bff8))
* allow customising addon description ([161a278](https://github.com/Viren070/AIOStreams/commit/161a2781668151ae04b8ac59fd871d65af08399d))
* allow disabling groups ([dddf80a](https://github.com/Viren070/AIOStreams/commit/dddf80ae438b742e254d6c7436a2bd5a394b7337))
* **frontend:** allow action prop in SettingsCard and use for catalogue and changelog card ([66d0823](https://github.com/Viren070/AIOStreams/commit/66d08234ac4fc9d9aac8daa1a81775d001159155))
* **frontend:** automatically refresh catalogs ([c5d6f06](https://github.com/Viren070/AIOStreams/commit/c5d6f064e8c75c0a0db62c50e9611fa855f57217))
* **frontend:** improve changelog card ([0bf3331](https://github.com/Viren070/AIOStreams/commit/0bf3331b6476db099c8e32771bbd2928b7b8b665))
* **frontend:** improve handling of old current versions and show available updates ([482ffc0](https://github.com/Viren070/AIOStreams/commit/482ffc04bdd6d99fa811b8051631213a72facee9))
* **frontend:** improve whats new card ([6508f70](https://github.com/Viren070/AIOStreams/commit/6508f7018a1335f05b99220e9bf01a79c87396c2))
* **frontend:** remove glowing effect ([0bcba95](https://github.com/Viren070/AIOStreams/commit/0bcba9599e0d7bbe7e967b5b2e4d935be390b9b1))
* **frontend:** update ui ([52179e1](https://github.com/Viren070/AIOStreams/commit/52179e1bd8bbcacf9a4880d6802b29d1ee51afb9))
* smarter caching for catalogs, meta, and manifests ([f259e4e](https://github.com/Viren070/AIOStreams/commit/f259e4ed7683ddf257cfa6c2887b84d60ab888aa))
* use separate cache instances per resource ([0a8e8e4](https://github.com/Viren070/AIOStreams/commit/0a8e8e4fe4ef9cbbe3a7e8a01b4c9698753cad0c))


### Bug Fixes

* add custom handlers for 3 digit season numbers ([31e1f34](https://github.com/Viren070/AIOStreams/commit/31e1f3422883c317dba3c07febfff97aa5e2a23c))
* add logs for parsing times and format time correctly ([a8bc9d1](https://github.com/Viren070/AIOStreams/commit/a8bc9d13a15fb83f0b45b43c21f59703ed961efa))
* add support for 'postgresql' scheme ([3065dfc](https://github.com/Viren070/AIOStreams/commit/3065dfcedd3c76cc0d7747eeef28523d736c2b9b))
* **core:** carry out deep link conversion on full meta responses too ([1d2699f](https://github.com/Viren070/AIOStreams/commit/1d2699f018fc2db4ab64bea9ef1c4908f184c0a1)), closes [#264](https://github.com/Viren070/AIOStreams/issues/264)
* **debridio-tmdb:** use exact language options ([762ce59](https://github.com/Viren070/AIOStreams/commit/762ce5968b96853ff1662512f231ca9b4caf037c))
* **debridio-tv:** correctly generate cache key ([4be707d](https://github.com/Viren070/AIOStreams/commit/4be707dbeeaf340511d28e7a8ed64506879cf1b9))
* **debridio-tvdb:** append preset ID to cache key ([1b3e8bf](https://github.com/Viren070/AIOStreams/commit/1b3e8bfee46130f3d45055bb9cc62682deb1d501))
* dont log errors when attempting to convert discover deep links ([f4c09c9](https://github.com/Viren070/AIOStreams/commit/f4c09c94220f46b5f9a6572cd9f21617fef4ebcf))
* encrypt default proxy public URL in status response if provided ([78229ee](https://github.com/Viren070/AIOStreams/commit/78229eea5bf0f23979e6b42dda0ac8ee9378ea67))
* ensure trusted is checked before validation on updateUser ([c805e49](https://github.com/Viren070/AIOStreams/commit/c805e49417b83540b9d699e1095ab5f089b02724))
* filter out unspecified resources from supported resources ([98c82c2](https://github.com/Viren070/AIOStreams/commit/98c82c27b4c8ec008d4c4161723e59f3438ed854)), closes [#277](https://github.com/Viren070/AIOStreams/issues/277)
* **frontend:** correctly set default channel ([c2a2541](https://github.com/Viren070/AIOStreams/commit/c2a2541fa0a70c26a96d65d52acada430ec67762))
* **frontend:** fix layout issues on changelog card on smaller screens ([ce2673e](https://github.com/Viren070/AIOStreams/commit/ce2673e39bf109db7514be70a80cbda296c389d1))
* **frontend:** wrap addon description in MarkdownLite in addon modal ([b7d4173](https://github.com/Viren070/AIOStreams/commit/b7d417367abea4c8aa1d0eec5ac35bf5593a40b3))
* handle edge cases for title during parsing ([913d591](https://github.com/Viren070/AIOStreams/commit/913d5913271670f5d9b5881b66be71197678386b))
* improve cache key generation ([4ae1370](https://github.com/Viren070/AIOStreams/commit/4ae13700c6e2a4a9eb693600d7f302a2fb845172))
* improve german regex pattern ([1da1e9e](https://github.com/Viren070/AIOStreams/commit/1da1e9e32263f6bf8c1846552ad00528192f872e))
* make 'end' parameter optional in slice function ([2d21435](https://github.com/Viren070/AIOStreams/commit/2d21435a45dba9fbd9d792ff490007e6a9c86d38))
* only add error and statistic streams to final list if condition allows processing ([b45a37d](https://github.com/Viren070/AIOStreams/commit/b45a37d7e4b95103e4d9df7ccf92b079c757bcff))
* **peerflix:** update default value of PEERFLIX_URL and update .env.sample ([5161c3c](https://github.com/Viren070/AIOStreams/commit/5161c3c6bf741ab8c4e7dcd273a756d0d683e35c))
* push error and statistic streams from first group results ([84976b6](https://github.com/Viren070/AIOStreams/commit/84976b63898e7ee9d0d0e95dd9d266197c2a78df))
* **tmdb-collections:** add stream parser to add collection name to stream.message and improve collection from movie option description ([b99fff0](https://github.com/Viren070/AIOStreams/commit/b99fff08b02fcb21ec9444ada26c022e40701232))
* **tmdb-collections:** use exact language options ([44ae0f6](https://github.com/Viren070/AIOStreams/commit/44ae0f68e6f97f26d3bfc821c6a9d4a44b7ae292))
* **tmdb:** use exact language options ([b72bbcc](https://github.com/Viren070/AIOStreams/commit/b72bbcc530a0e3dcf8af78051bee36bbd73be3eb))
* update German regex pattern for improved language detection ([01e9a99](https://github.com/Viren070/AIOStreams/commit/01e9a9979c4cac96728200a31b78e2920b8e677b))
* use correct warn method for logging for meta failure during precaching ([1514724](https://github.com/Viren070/AIOStreams/commit/15147249c0a2ed79a4d4e878bce2dbd79c05b920))

## [2.6.1](https://github.com/Viren070/AIOStreams/compare/v2.6.0...v2.6.1) (2025-07-16)


### Bug Fixes

* correctly extract extras for subtitle requests ([a1cbeb2](https://github.com/Viren070/AIOStreams/commit/a1cbeb2880a4abaf43f3c2fe9eabab8239e024df))
* **debridio-tv:** add new zealand option ([3dd2e7a](https://github.com/Viren070/AIOStreams/commit/3dd2e7a3c5189da1b31dbc6f3044477cd065dc91))
* **fkstream:** allow overriding services ([952dda8](https://github.com/Viren070/AIOStreams/commit/952dda8bd106a5176d12d554280e620219576d12)), closes [#268](https://github.com/Viren070/AIOStreams/issues/268)

## [2.6.0](https://github.com/Viren070/AIOStreams/compare/v2.5.4...v2.6.0) (2025-07-16)


### Features

* add ai search addon to marketplace ([c9c1bab](https://github.com/Viren070/AIOStreams/commit/c9c1babc2acaa5d92e3230382bf3dcfca2f874d5))
* add AIO Subtitle addon to marketplace ([db191fd](https://github.com/Viren070/AIOStreams/commit/db191fd430b17b8452fc6e4a0b2f776f9463f3b3))
* add fkstream to marketplace ([ee72f3a](https://github.com/Viren070/AIOStreams/commit/ee72f3a1ed4f137ba07a1e23c381b257acaa2bde)), closes [#260](https://github.com/Viren070/AIOStreams/issues/260)
* add statistics position option to control where statistic streams appear ([47656d0](https://github.com/Viren070/AIOStreams/commit/47656d0413996ae475b6c25d9503fb60595f8429))
* add subhero to the marketplace ([e70920a](https://github.com/Viren070/AIOStreams/commit/e70920a2701db19796146c486558a59939e616cd))
* extract episode count during precaching to automatically precache next season when necessary ([6f0e79a](https://github.com/Viren070/AIOStreams/commit/6f0e79a5d9a8951e882251dc7a48d7a70046a0d8))
* **frontend:** move tmdb access token setting to services menu ([9101acb](https://github.com/Viren070/AIOStreams/commit/9101acb72f02ec5d5573e41e138797040ef39c0a))
* **webstreamr:** update provider list and automatically provide mediaflow details if possible ([dbde122](https://github.com/Viren070/AIOStreams/commit/dbde1225e4b7c3505009b97e1454fd3f09840625))


### Bug Fixes

* add fkstream, subhero, aio subtitle to startup logs and sample .env ([130be7d](https://github.com/Viren070/AIOStreams/commit/130be7dc16ce2e4e37d59d7ff3c66afe5b08f5b6))
* add socials option to ai search ([28f7863](https://github.com/Viren070/AIOStreams/commit/28f786339e12b182856764d31605c76610a75335))
* adjust extras schema to allow more than 1 extra ([7ba880e](https://github.com/Viren070/AIOStreams/commit/7ba880e9a74b5f6e7b49b2bcff8dbda6b13a159d)), closes [#263](https://github.com/Viren070/AIOStreams/issues/263)
* **aiosubtitle:** rename language option to languages and use correct default timeout ([603af9a](https://github.com/Viren070/AIOStreams/commit/603af9a7e97226272300377f5ac6dc2bb62e816b))
* allow any string for thumbnail ([4652eb6](https://github.com/Viren070/AIOStreams/commit/4652eb650273f780cb77e42c8aaab34e63ce90a0))
* **core:** set groups to undefined during precaching ([02d4cf7](https://github.com/Viren070/AIOStreams/commit/02d4cf742b0d6be75b4cf281b47ef7dd75a9affb))
* **core:** use structuredClone for cache item values to ensure immutability ([465b7a4](https://github.com/Viren070/AIOStreams/commit/465b7a40a34909bc84290da37cefbe82f3131ea4))
* correct spelling of ALLEDEBRID_SERVICE to ALLDEBRID_SERVICE ([b67f38a](https://github.com/Viren070/AIOStreams/commit/b67f38ac85033f48efea412f90945f7f15802ee0))
* **debridio-tv:** update channel list ([67509a4](https://github.com/Viren070/AIOStreams/commit/67509a43def9e01250beaa62bddb6207d399b5be))
* ensure number types always have integer step of at least 1 ([ac4d209](https://github.com/Viren070/AIOStreams/commit/ac4d209879b64a64d7df600a2b01c8164fe726c5))
* ensure string validations are carried out against password type ([66d4a96](https://github.com/Viren070/AIOStreams/commit/66d4a96ad20cea105cc23c19945febdf4cf10e56))
* **frontend:** revert 3a82b796c56627d21ede53b91f47315cbb46c1e4 and clean options before processing ([880817a](https://github.com/Viren070/AIOStreams/commit/880817a1ad100799826dbde10e87c303b74b958e))
* **frontend:** show puzzle icon for addons without logo ([f74fbb2](https://github.com/Viren070/AIOStreams/commit/f74fbb289b208f1ea082e74675b7bd274153d5f4))
* **frontend:** strictly rely on value during selection ([3a82b79](https://github.com/Viren070/AIOStreams/commit/3a82b796c56627d21ede53b91f47315cbb46c1e4))
* improve parsing for debridio watchtower, nuviostreams, and webstreamr ([9febeeb](https://github.com/Viren070/AIOStreams/commit/9febeeb86af023fed32dc25dc89dfdad09406886))
* **nuviostreams:** add animepahe provider ([00862c0](https://github.com/Viren070/AIOStreams/commit/00862c05926a18766592bc3a177075b14ced90a4))
* only move to next season when it exists and correct logs ([3050b41](https://github.com/Viren070/AIOStreams/commit/3050b41e937fa24dcfb146a953862c4054cf4a0f))
* remove unnecessary debug logs ([0e24a6a](https://github.com/Viren070/AIOStreams/commit/0e24a6aa961c0dee200ea018caec06b23134d6cb))
* replace discover deep links where possible ([aa084d3](https://github.com/Viren070/AIOStreams/commit/aa084d35d646f05cc2dea7111ad34ba5d1a6d661)), closes [#264](https://github.com/Viren070/AIOStreams/issues/264)


### Performance Improvements

* always fetch from all groups in parallel ([0ce1338](https://github.com/Viren070/AIOStreams/commit/0ce13389a066a05184bc1aaea0b2806b22d01a1f))

## [2.5.4](https://github.com/Viren070/AIOStreams/compare/v2.5.3...v2.5.4) (2025-07-12)


### Bug Fixes

* ensure catalog.extra is initialised before pushing new genre options ([dc9c8a4](https://github.com/Viren070/AIOStreams/commit/dc9c8a40775ba13d66ff7a762147b50e4b414974))

## [2.5.3](https://github.com/Viren070/AIOStreams/compare/v2.5.2...v2.5.3) (2025-07-11)


### Bug Fixes

* only add aiostreamserror to idPrefixes if already defined ([ebe46d7](https://github.com/Viren070/AIOStreams/commit/ebe46d7c43acc70fdb52f7aeca41aeda27bf7df7))
* only log warning for missing idPrefixes when needed ([08ec779](https://github.com/Viren070/AIOStreams/commit/08ec779be3bd307e0fda9766301d80fdc39a8f3e))

## [2.5.2](https://github.com/Viren070/AIOStreams/compare/v2.5.1...v2.5.2) (2025-07-11)


### Features

* add statistic stream options to see statistics in stremio ([261b878](https://github.com/Viren070/AIOStreams/commit/261b87872a2882886ec26970614a504dc2f7cd97))


### Bug Fixes

* account for query parameters in manifest urls for custom addons during validation ([3ad1e7c](https://github.com/Viren070/AIOStreams/commit/3ad1e7c61f36d12dfb046c676a401b0e3f97604b))
* add skipReasons logging for seeder ranges ([a06ac34](https://github.com/Viren070/AIOStreams/commit/a06ac34061e571fe7599eeca5a0fce6d9607b37f))
* correct spelling of 'Crunchyroll' in streaming catalogs preset ([cb423d1](https://github.com/Viren070/AIOStreams/commit/cb423d152dc015b37b3d317c80907b357f7ee154))
* **debridio-watchtower:** ensure resolution is always parsed ([6a0bf09](https://github.com/Viren070/AIOStreams/commit/6a0bf09de660198cd317bcd97ec8777aa4723e74))
* **debridio-watchtower:** update stream parser ([542863e](https://github.com/Viren070/AIOStreams/commit/542863e2a807d18cd6d32c7ba8fa111a711ec37a))
* forward manifest parsing errors ([9748ecb](https://github.com/Viren070/AIOStreams/commit/9748ecb576320db85c3a5c81a9d67e8f80dd5a4c))
* **frontend:** remove menu query param on start/'about' menu ([275a2de](https://github.com/Viren070/AIOStreams/commit/275a2de9605c01911714574a040d27f2c3977c76))
* only log warning for missing idPrefixes for non 'catlaog' resources ([f8065c9](https://github.com/Viren070/AIOStreams/commit/f8065c9e9ad6959c51f664f377ee75a221a92c32))
* only standardise upon valdiation ([e980c1e](https://github.com/Viren070/AIOStreams/commit/e980c1e0b3a5026b5efdfd8bd812b6bfef90bc45))
* pass fileIdx through for p2p streams ([0076339](https://github.com/Viren070/AIOStreams/commit/00763397a1b2952f2a99c2e57e8c275863d5aa54))
* provide meta for catalog errors ([f4050d6](https://github.com/Viren070/AIOStreams/commit/f4050d6f388a774751412f89a1e1ff1210aa76c0))
* set customised logo to undefined when empty ([7d0b60e](https://github.com/Viren070/AIOStreams/commit/7d0b60efa1f4ec1fc2de6402ffe8b2f6b2c9d2ca))
* set loading to false in the case of an error upon fetching the new manifest URL ([707a1f3](https://github.com/Viren070/AIOStreams/commit/707a1f3fecb781650078d5c3ca7db3842c102869))
* standardise manifest URL during validation for custom addon updates ([8314cae](https://github.com/Viren070/AIOStreams/commit/8314cae4811d7e2307498dc0cda12b7822518708))
* update director to allow string ([2c924ba](https://github.com/Viren070/AIOStreams/commit/2c924bac56e2a3d81cc1fe6ae380286e7fe93b58))
* update publicIp schema to allow empty string in addition to valid IP ([0539fe4](https://github.com/Viren070/AIOStreams/commit/0539fe49a8cfe8d18525262256388a60691b8e23)), closes [#250](https://github.com/Viren070/AIOStreams/issues/250)
* use correct property in skipReasons for seeder ranges ([c54b2b6](https://github.com/Viren070/AIOStreams/commit/c54b2b66f050827b6e41db1bf486da3140683487))

## [2.5.1](https://github.com/Viren070/AIOStreams/compare/v2.5.0...v2.5.1) (2025-07-04)


### Bug Fixes

* ensure proxy IP is only used when enabled ([12434b2](https://github.com/Viren070/AIOStreams/commit/12434b29decb55deb6a99d99e727fc3750ab25f3))
* ensure searchable is false when no extras are defined ([ff5c9b2](https://github.com/Viren070/AIOStreams/commit/ff5c9b28cb19e89171254d832a53989d4474f6e9))
* support configuring custom addons with stremio:// protocol ([5040980](https://github.com/Viren070/AIOStreams/commit/5040980c82f019fa8543a7f74a1ac153430620b0))

## [2.5.0](https://github.com/Viren070/AIOStreams/compare/v2.4.2...v2.5.0) (2025-07-03)


### Features

* add 'donate' option to social icons ([bcbc793](https://github.com/Viren070/AIOStreams/commit/bcbc7936e5049fc7d42a183298b473c2bd324509))
* add configurable minimum interval for precaching same episode by same user ([dd9b476](https://github.com/Viren070/AIOStreams/commit/dd9b476fd1ec9210cb0f1566894b6af6faf39ee2))
* add configure button for custom addons ([4ebd110](https://github.com/Viren070/AIOStreams/commit/4ebd1107737080bbe561b7e7e5735c6fb7d58a00))
* add disable search catalog modifier ([7a824d0](https://github.com/Viren070/AIOStreams/commit/7a824d0d2d525ac7d10ca5f4efc8b47e9dbec754))
* add included stream expression filters ([102c71f](https://github.com/Viren070/AIOStreams/commit/102c71f53164b950bba03e30571f8a2432b8aafd))
* add OpenSubtitles V3 +/Pro ([64e0d4d](https://github.com/Viren070/AIOStreams/commit/64e0d4df39c2405d72a5c14fde93070e55b30708))
* add separate configurable timeouts for different resource requests ([be18508](https://github.com/Viren070/AIOStreams/commit/be18508174d416826e31dc50c434c3a6e283503f))
* add SubDL addon ([5245a7a](https://github.com/Viren070/AIOStreams/commit/5245a7a9b862b78104b616b2ae5fdb197d4a49c1))
* add subsource ([98d890b](https://github.com/Viren070/AIOStreams/commit/98d890bae81509f5eaa106e17841c4ba6cf5c26e))
* add validation for min/max constraints in multi-select options ([e9d74bd](https://github.com/Viren070/AIOStreams/commit/e9d74bd1177f8d8ecc1a1f89fd0a12419d2d3417))
* allow hiding all catalogs from home and preserve 'None' option ([a82edc0](https://github.com/Viren070/AIOStreams/commit/a82edc0911cdea46cca306ad97abc39ad48ac67f))
* allow setting headers for specific domains ([160d9a7](https://github.com/Viren070/AIOStreams/commit/160d9a72a9e734bb2bd209b281448eb2dab83873))
* expose value of LOG_SENSITIVE_INFO through status API ([e8183aa](https://github.com/Viren070/AIOStreams/commit/e8183aa7255c0f5baf2ec2929359a7782f90cb90))
* implement SkipStreamError to handle external download streams from wrapped AIOs ([3631ff6](https://github.com/Viren070/AIOStreams/commit/3631ff6ab55e1fdd5b8c574ac261d4cc1d54636b))
* improve ui consistency for type input in edit modal for catalgos ([e913bd7](https://github.com/Viren070/AIOStreams/commit/e913bd7ea6ca5eb0e0fc0f72a30b600e15868788))
* lower default timeout to 10000 ([4a2998e](https://github.com/Viren070/AIOStreams/commit/4a2998e30ad459d1a6434bfdc11d7eb340c1c112))
* **mediafusion:** add 'Contributor Streams' option and parsing ([838f031](https://github.com/Viren070/AIOStreams/commit/838f0318d49f150acee7f28c2032593d2325f19b))
* perform deduplication on each group fetch ([8d02554](https://github.com/Viren070/AIOStreams/commit/8d02554351ae34c2450bffbe90d72125cc7764f0))
* swap addon name and type position for each catalog ([efc99ab](https://github.com/Viren070/AIOStreams/commit/efc99abb9e02008eebc43f392509ae82197a60d8))
* update .env.sample and startup logging ([16c9958](https://github.com/Viren070/AIOStreams/commit/16c9958162ac897e31165e191790250ff6659f74))
* update OpenSubtitles V3 Pro description ([cfa9cfc](https://github.com/Viren070/AIOStreams/commit/cfa9cfcfefe65f735ea916d73f37ffe552d710a8))


### Bug Fixes

* add space after link in AddonGroupCard for improved readability ([b9ef30c](https://github.com/Viren070/AIOStreams/commit/b9ef30cc519d2c095f0019e72b406eacf3d646a8))
* add validation for all stream expression filters ([6039a57](https://github.com/Viren070/AIOStreams/commit/6039a57e90a11411649990d646b2bc96723ea8bf))
* correctly log headers ([5e2053a](https://github.com/Viren070/AIOStreams/commit/5e2053a73b5b8a60d81d56d1867cd45ad214c759))
* increase maximum length for stream expression filters ([e2d75b4](https://github.com/Viren070/AIOStreams/commit/e2d75b4d311b9ad72cfcf832ec346219489ac860))
* **mediafusion:** ensure contributor streams are only included for one instance ([0e5dd95](https://github.com/Viren070/AIOStreams/commit/0e5dd95980e0efc0bc903d1f7becfe7681540848))
* **nuviostreams:** update provider list ([2867d03](https://github.com/Viren070/AIOStreams/commit/2867d035370854d06ac1984e04685d9cc1285375))
* only allow hiding catalogs that don't have any extra requirement ([6997f1c](https://github.com/Viren070/AIOStreams/commit/6997f1c2eeea1fb63b86528b43b2ad58b920c35e))
* remove addon name and regex matched from external download links ([11e5fec](https://github.com/Viren070/AIOStreams/commit/11e5fecf9d524fe6f3cf7ecd613f83f1496fcb65))
* return an empty array when no included stream expressions are provided ([74c764c](https://github.com/Viren070/AIOStreams/commit/74c764cdac87e15982d0d395c7dc7fa40b2f8c59))
* support selecting unknown visual tags, audio tags, audio channels, and languages in SEL ([735a326](https://github.com/Viren070/AIOStreams/commit/735a326aa4a882667741f7b5773aaa0e54a67978))
* use correct env var name for stream expression limit in startup logs ([e7709e7](https://github.com/Viren070/AIOStreams/commit/e7709e73ab414c0325c9d055d648f9103aff9a05))
* use correct env var name in sample .env for ST Torz/Store URL adjustments ([322a5e1](https://github.com/Viren070/AIOStreams/commit/322a5e14ac1a26428ea12a351a30e12bc621a779))

## [2.4.2](https://github.com/Viren070/AIOStreams/compare/v2.4.1...v2.4.2) (2025-06-27)


### Bug Fixes

* **debridio:** add Italy option ([7774310](https://github.com/Viren070/AIOStreams/commit/77743105de53e5de76ef4f4224883d57cc559bee))

## [2.4.1](https://github.com/Viren070/AIOStreams/compare/v2.4.0...v2.4.1) (2025-06-27)


### Bug Fixes

* add 'Clip' as valid type for Trailer ([025f622](https://github.com/Viren070/AIOStreams/commit/025f622002c1409ed6d0e997ac4ee3d857bf10ba))
* adjust defaults ([78d4d60](https://github.com/Viren070/AIOStreams/commit/78d4d604ca732d4f96ba9927724c7935e9a956d8))

## [2.4.0](https://github.com/Viren070/AIOStreams/compare/v2.3.2...v2.4.0) (2025-06-27)


### Features

* add always precache option ([d4ff4a2](https://github.com/Viren070/AIOStreams/commit/d4ff4a2c0c913e7c6e3754ecb9fd72b45b1f864d))
* add slice function to stream expression ([321b325](https://github.com/Viren070/AIOStreams/commit/321b32584014d20d8e78f66b4cef313d0cd22f0c))
* add USA TV and Argentina TV ([e29800a](https://github.com/Viren070/AIOStreams/commit/e29800a0ab159940cafa11f0d69d4bc3f46c918c))
* allow disabling user agent ([305ebd8](https://github.com/Viren070/AIOStreams/commit/305ebd84c8040866fc45fe1879921e3a7bb93997))


### Bug Fixes

* apply filters and precomputation to streams after each group fetch ([78144d0](https://github.com/Viren070/AIOStreams/commit/78144d02135072681237eae8bd5b11bf8fc3f991))
* fix filtering ([32b1c3c](https://github.com/Viren070/AIOStreams/commit/32b1c3c3b384fad4109520c5730e8076cb2c6ebc))
* include headers in logs ([4b9f268](https://github.com/Viren070/AIOStreams/commit/4b9f268b8f399a30f47d2140ecd9afd2856f284a))
* pass specified services in DebridioPreset ([e264db6](https://github.com/Viren070/AIOStreams/commit/e264db6fc57ce58da476deadef5b3684228eba73))
* set excludeUncached to false during pre-caching ([62aed42](https://github.com/Viren070/AIOStreams/commit/62aed42b07adf24c42cd5ac6c3a43d323e210890))
* skip failed addons on manifest fetch ([cada0de](https://github.com/Viren070/AIOStreams/commit/cada0de63ac8602adabd2af2b04015f87697668e))
* **streamfusion:** remove service requirement, enable torrent providers, lower limits ([3d856a2](https://github.com/Viren070/AIOStreams/commit/3d856a252dd77d27c81d4539ad848af95f1ca0dd))

## [2.3.2](https://github.com/Viren070/AIOStreams/compare/v2.3.1...v2.3.2) (2025-06-24)


### Bug Fixes

* only show warning when no idPrefixes are given ([832deae](https://github.com/Viren070/AIOStreams/commit/832deaed64ea977d493d3815a58f7528aa7b03e1))
* remove folderSize from downloadable streams ([baf4c46](https://github.com/Viren070/AIOStreams/commit/baf4c461682fae5dd30e809897498f5d5a62482b))
* remove length requirement for string properties in ManifestSchema ([b009511](https://github.com/Viren070/AIOStreams/commit/b00951144925f174a30b0e2858f963c6cbee3837))

## [2.3.1](https://github.com/Viren070/AIOStreams/compare/v2.3.0...v2.3.1) (2025-06-24)


### Bug Fixes

* set idPrefixes to undefined for new resources too ([97894be](https://github.com/Viren070/AIOStreams/commit/97894be562ef28a4ddd3887093481f60d4e6b3f1))

## [2.3.0](https://github.com/Viren070/AIOStreams/compare/v2.2.1...v2.3.0) (2025-06-24)


### Features

* add `EXPOSE_USER_COUNT` set to false by default ([3e9820b](https://github.com/Viren070/AIOStreams/commit/3e9820bc3de6bca391259026523a07d63e8c90e7))
* add more fields to bingeGroup ([f53c8ca](https://github.com/Viren070/AIOStreams/commit/f53c8cab1f3465ebf639e035824b7b3c2e069203))
* add tmdb addon ([96bf1de](https://github.com/Viren070/AIOStreams/commit/96bf1de8bd5a44b10bc3ada6dd8e1cd5c11b1d2e))
* add torrentsdb ([aebef33](https://github.com/Viren070/AIOStreams/commit/aebef33432d9d21c5c90577da73fc21803432b83))
* improve parsing for debridio tv ([320dbb2](https://github.com/Viren070/AIOStreams/commit/320dbb29020cc499c4d806f904feb0f4d45730d3))


### Bug Fixes

* add discovery+ option to streaming catalogs ([3b47339](https://github.com/Viren070/AIOStreams/commit/3b473393e201c32afbe5301a1d5ff9026b1f5718))
* make sorting in deduplicator consistent ([b15efd5](https://github.com/Viren070/AIOStreams/commit/b15efd5529d1246e538b25797930bcbab874b73b))
* only extract folder size if difference is large enough ([3d7808b](https://github.com/Viren070/AIOStreams/commit/3d7808b92cde840dac242ad8f52fd671a02199fb))
* set idPrefixes to undefined when an addon for that resource doesn't provide it ([f3ff7c5](https://github.com/Viren070/AIOStreams/commit/f3ff7c53d2ad4d6c809c1f27d5be3177969f4841))

## [2.2.1](https://github.com/Viren070/AIOStreams/compare/v2.2.0...v2.2.1) (2025-06-22)


### Bug Fixes

* add catalog and meta resources to mediafusion preset ([ee492e2](https://github.com/Viren070/AIOStreams/commit/ee492e2b218bbad813426368ec7f30ecedc79e59))
* add min and max constraints validation for options in config ([675eaf0](https://github.com/Viren070/AIOStreams/commit/675eaf0b6340ed52b2d0267442a24448048b04cb))
* allow null values in options array for manifest extras ([99d66e8](https://github.com/Viren070/AIOStreams/commit/99d66e835c421af0ad6c86500dc38f93b8d85ca3))
* correct property name from 'seeders' to 'seeder' in includedReasons ([912fa49](https://github.com/Viren070/AIOStreams/commit/912fa4910e097c2ec1424ac360482d56b51e6022))
* **frontend:** add sensible steps and remove min max constraint in NumberInput for TemplateOption ([1119721](https://github.com/Viren070/AIOStreams/commit/1119721054d77cf7729ed27cf7b4593237bc3675))

## [2.2.0](https://github.com/Viren070/AIOStreams/compare/v2.1.0...v2.2.0) (2025-06-22)


### Features

* add 'not' function to BaseConditionParser for filtering streams ([44d2c4c](https://github.com/Viren070/AIOStreams/commit/44d2c4c8708dae8c07370b16d6ca5e7750369ddb))
* add logging for include details/reasons during filtering ([9de901d](https://github.com/Viren070/AIOStreams/commit/9de901d22b6e3c8ae515f41fccb63447283492b8))
* add merge function in BaseConditionParser ([f223368](https://github.com/Viren070/AIOStreams/commit/f22336800ae952b6f3e703006075b4360da94524))
* add regexMatchedInRange function to BaseConditionParser ([cc2f5f7](https://github.com/Viren070/AIOStreams/commit/cc2f5f7608f8dbd3f9d52031e0e6da377d9031b0))
* add support for required and preferred filter conditions ([d9281bd](https://github.com/Viren070/AIOStreams/commit/d9281bd978f186a50f04ead98c6fcca41bb32bfb))
* adjust wording and naming of expression/condition parser ([a06aea9](https://github.com/Viren070/AIOStreams/commit/a06aea923cdad1540d2edb858ce1de1412d5dd11))
* apply filter conditions last ([41d507a](https://github.com/Viren070/AIOStreams/commit/41d507a679af598fbfb4e9391688f1dc70613a5c))
* enable addition and subtraction in base Parser ([c4e65f8](https://github.com/Viren070/AIOStreams/commit/c4e65f83b3a0157ec87b775d8967017bfd425ee8))
* handle missing debridio api key for clear errors ([ad4a51c](https://github.com/Viren070/AIOStreams/commit/ad4a51caa11c4447cff59ce6f07cf2a870d8f297))
* improve condition parser functions to support multiple parameters ([110146c](https://github.com/Viren070/AIOStreams/commit/110146c088ceebc1472eb8f5442d966faabb0278))
* loop through optionMetas to ensure new options are validated too and ignore individual errors from presets when necessary ([2ffc82c](https://github.com/Viren070/AIOStreams/commit/2ffc82c864878e0d212bbfa6582044555ba6fc78))
* support multiple regex names in regexMatched function ([455f430](https://github.com/Viren070/AIOStreams/commit/455f4307fdee14098c9b3766322dd47682e7d270))
* use title modifier for title in light gdrive formatter ([e542989](https://github.com/Viren070/AIOStreams/commit/e542989038ad253a098cce41e9480a2927c7514a))


### Bug Fixes

* actually use the streams after applying filter conditions ([4bc0259](https://github.com/Viren070/AIOStreams/commit/4bc0259dad92d636f338aae4b0b4af0cb0666d2a))
* allow empty regex names in ParsedStreamSchema and AIOStream ([cf39cdf](https://github.com/Viren070/AIOStreams/commit/cf39cdfee14d41bb67e9a8bff2d720e7d33cffc5))
* **debridio:** update preset to support new version ([#213](https://github.com/Viren070/AIOStreams/issues/213)) ([23e8078](https://github.com/Viren070/AIOStreams/commit/23e8078b3f5aaa7554857e3fefd0a49ba4d2f6b7))
* ensure comparison checks for deduplications are carried out when needed ([c7bb0c8](https://github.com/Viren070/AIOStreams/commit/c7bb0c8bee69b82688f08e005985b3a8e6436048))
* extract streamExpressionMatched from AIOStream parser ([7e65738](https://github.com/Viren070/AIOStreams/commit/7e657380d7f0c2cfd01b3367e9bd876465a710d8))
* fallback to parent get filename method when filename not found in description for mediafusion ([cfb5977](https://github.com/Viren070/AIOStreams/commit/cfb59771fc9bc23b3b982bfbfce75436ca4f37fa))
* fallback to using parsed properties from folder when undefined in file and correctly merge array properties ([8eb9b7a](https://github.com/Viren070/AIOStreams/commit/8eb9b7a92efbbf76991d532b828ab48070f13b6d))
* filter out uuid in filtered export ([bd21b36](https://github.com/Viren070/AIOStreams/commit/bd21b364d27cbcc72a464c14eb372ffbd8e33a51))
* **formatters:** make title modifier return consistent cases with each word titled ([3e6b45a](https://github.com/Viren070/AIOStreams/commit/3e6b45a554bdc15c473e64bc22cee5d0b8c7de7f))
* handle invalid addon password error separately for catalog API to be more clear ([a2275cc](https://github.com/Viren070/AIOStreams/commit/a2275cce1bcdf37ba7dd65016a544b222e8ee3a4))
* ignore port in host check ([e73be92](https://github.com/Viren070/AIOStreams/commit/e73be9298d82dbb2a9b492cb636c5bd5d82fd1e0))
* normalize case sensitivity in condition parser filters for resolutions, qualities, encodes, types, visualTags, audioTags, audioChannels, and languages ([87d2ffb](https://github.com/Viren070/AIOStreams/commit/87d2ffba7f8b8fc3e7ce70372e4f4932aa86bbc5))
* only form keyword patterns when length of array is greater than 0 ([9136694](https://github.com/Viren070/AIOStreams/commit/91366943bb813fd99cd6c4775952c8bc5af9d54f))
* rename 'not' function to 'negate' to avoid conflicts ([8477584](https://github.com/Viren070/AIOStreams/commit/8477584f9e65aae796c7aa432ffdbc36212f3260))
* update credentials field to allow empty strings ([c006321](https://github.com/Viren070/AIOStreams/commit/c00632146d4980ec5a640b54eeb3bbd63f999189))

## [2.1.0](https://github.com/Viren070/AIOStreams/compare/v2.0.1...v2.1.0) (2025-06-20)


### Features

* allow disabling pruning and disable it by default ([85c0ec1](https://github.com/Viren070/AIOStreams/commit/85c0ec1b5436af1115f97149f87b41aba41fe3ff))
* allow specifying providers in torrentio ([8e5f4b5](https://github.com/Viren070/AIOStreams/commit/8e5f4b520cbcf472598a955039dc33bdda676bd5))
* enable conditional operators in parser, allowing ternary statements in filter conditions ([eb6edfc](https://github.com/Viren070/AIOStreams/commit/eb6edfc3f1cb1c6a79400d2311cbe8811f1d284c))
* extract folder size for stremthru torz ([e775562](https://github.com/Viren070/AIOStreams/commit/e775562e3c736fb4d652a161a7e29f3fcd28be1f))
* improve cache stats logging ([d47eee0](https://github.com/Viren070/AIOStreams/commit/d47eee002112f6330d1b74920199bface0105eed))
* improve save install page ([a115e59](https://github.com/Viren070/AIOStreams/commit/a115e5906f568b630425276cf321a931b37aadf1))
* only add foldername if different and parse info from both folder and filename ([6eed23f](https://github.com/Viren070/AIOStreams/commit/6eed23f445d017ae6d18e9874978a8874350d006))


### Bug Fixes

* add enableCollectionFromMovie option to TMDB Collections ([71d9fe0](https://github.com/Viren070/AIOStreams/commit/71d9fe093cad1566172206d0a87662358bd446a6)), closes [#194](https://github.com/Viren070/AIOStreams/issues/194)
* add stream as supported resource for TMDB Collections ([d2ef215](https://github.com/Viren070/AIOStreams/commit/d2ef2154fda902900751c47527ff52390506bd54))
* add validation to pruneUsers method to ensure negative maxDays input is not used ([6b597b3](https://github.com/Viren070/AIOStreams/commit/6b597b31306fbe42d4104a71f9f330db32d9cda5))
* adjust idPrefixes handling to improve compatibility in most cases ([7fa8ba7](https://github.com/Viren070/AIOStreams/commit/7fa8ba71fbb682d077fb5c8ccfbadfb0050bea80))
* change all debrid service name to AllDebrid ([a89cdca](https://github.com/Viren070/AIOStreams/commit/a89cdca583e50c3bf66432bbb721797954323ba6)), closes [#208](https://github.com/Viren070/AIOStreams/issues/208)
* convert live types to http for webstreamr ([64977ca](https://github.com/Viren070/AIOStreams/commit/64977caeffe2cb6b95714916c14bfa006502c386))
* don't pass encoded_user_data header if URL is overriden ([ed2c0f5](https://github.com/Viren070/AIOStreams/commit/ed2c0f5800592c6bf140dc1f9ea8bdb9057d1d55))
* exit auto prune when max days is less than 0 ([ee1ddc0](https://github.com/Viren070/AIOStreams/commit/ee1ddc07389d01b382f19fa46e434ca93f41d3e8))
* explicitly check for unknown in version and default to 0.0.0 for manifest response ([8664e00](https://github.com/Viren070/AIOStreams/commit/8664e004e2553ffb675131488a4c4eab70ede7b3)), closes [#198](https://github.com/Viren070/AIOStreams/issues/198)
* extract size for nuviostreams ([ebbd7ec](https://github.com/Viren070/AIOStreams/commit/ebbd7ec3b24d11abc2806e9edbd2aeaee45faa09))
* fix error handling in config modal ([5182a07](https://github.com/Viren070/AIOStreams/commit/5182a07ac49d1aa79f515d72c71c7494a27866dd))
* **frontend:** filter out proxy credentials and url in export when exclude credentials is true ([3c31939](https://github.com/Viren070/AIOStreams/commit/3c319391b86e6efa530aab5b8cd04ad9341867d1))
* handle empty addon name in stream results and update description for addon name field ([5612140](https://github.com/Viren070/AIOStreams/commit/5612140ffee8b8e8804d36efdfd22e6f110b32ef))
* handle pikpak credentials for mediafusion ([eee444f](https://github.com/Viren070/AIOStreams/commit/eee444f376136ed04257187c4bb1ddc05f05a3f5))
* include addon name in error messages for invalid manifest URLs ([abf99c1](https://github.com/Viren070/AIOStreams/commit/abf99c1768f3cf86d6f58ec256705ae235f9d8f9))
* make types optional in ManifestSchema ([5281756](https://github.com/Viren070/AIOStreams/commit/5281756c78e362d3c48cc4469c07c17df9350d9c))
* make types required and provide array based on resources object array ([01cf37f](https://github.com/Viren070/AIOStreams/commit/01cf37f8340a9fd130ecb19c93dc7a9863eab012))
* manually override type to http for watchtower and nuviostreams ([1fb00a4](https://github.com/Viren070/AIOStreams/commit/1fb00a4317605ee9a5d0da73a4b363bf08b9bf6f))
* map defaultProviders to their values in TorrentioPreset configuration ([9b04403](https://github.com/Viren070/AIOStreams/commit/9b044037d38b46270e23172914d1e35f72f51e1f))
* normalize version check ([#206](https://github.com/Viren070/AIOStreams/issues/206)) ([05cc116](https://github.com/Viren070/AIOStreams/commit/05cc116fafc9ba6d0f40b7e10938e2505085ea10))
* only add to idPrefixes if not null ([6fb5f7b](https://github.com/Viren070/AIOStreams/commit/6fb5f7b841872b0261023766c2472c7f5201be95))
* overlapping snippets modal ([#202](https://github.com/Viren070/AIOStreams/issues/202)) ([195da69](https://github.com/Viren070/AIOStreams/commit/195da69f19ca8e15acd000420c1187fd4116de1f))
* prevent title from being parsed for info ([f8b2e2d](https://github.com/Viren070/AIOStreams/commit/f8b2e2d66ce07ae4342db974ed6f169c0474d1d2))
* remove idPrefixes from top level manifest ([908b4ff](https://github.com/Viren070/AIOStreams/commit/908b4ffa399439ab3f9428357b30a6ae7bc0f29d))
* remove outdated decoding of credentials causing issues with some credentials ([609931e](https://github.com/Viren070/AIOStreams/commit/609931e5318c8b6d782cc04cf6a6691269bba287))
* remove timestamp from cache stats ([509e3bd](https://github.com/Viren070/AIOStreams/commit/509e3bd2098f10d041a2a776d9b4099567fe4370))
* remove unused method handler for unsupported HTTP methods ([7405d27](https://github.com/Viren070/AIOStreams/commit/7405d272ab79321d8b1e97ee4bcd1a2b2f8c12a5))
* rename web_dl to webdl in stremthru store ([3fb57c5](https://github.com/Viren070/AIOStreams/commit/3fb57c5d04e23585e71a5e9f0643735f675671c7))
* simplify and fix configuration generation for services and providers in TorrentioPreset ([cfafeec](https://github.com/Viren070/AIOStreams/commit/cfafeecda3591c342d5f2aeb756fde4adc536024))
* try explicitly setting idPrefixes to an empty array ([c16060f](https://github.com/Viren070/AIOStreams/commit/c16060f7a5ffa5b5142fe5a0753046748f682f0a))
* try removing types ([10c4e2d](https://github.com/Viren070/AIOStreams/commit/10c4e2d51f7a0ba05d6214da1c848b66ec9237ca))
* try setting idPrefixes to null ([a5f32df](https://github.com/Viren070/AIOStreams/commit/a5f32df451c7ba73438322c217ffa431e9a84125))
* update descriptions for filtering options in menu component to clarify behavior ([67bb204](https://github.com/Viren070/AIOStreams/commit/67bb204362951ef3998c690ba1c0055c1a4cc12b))
* use password type where necessary ([0a12d33](https://github.com/Viren070/AIOStreams/commit/0a12d335c34b8181c9ac849bed623ea77b43a84c))

## [2.0.1](https://github.com/Viren070/AIOStreams/compare/v2.0.0...v2.0.1) (2025-06-19)


### Bug Fixes

* add audio channel to skipReasons ([ef1763c](https://github.com/Viren070/AIOStreams/commit/ef1763cbe60fe5c279138a152e1a8d677f30f0ce))
* correctly handle overriding URL for mediafusion ([9bf3838](https://github.com/Viren070/AIOStreams/commit/9bf3838732542c5cac1ef189cd5afefc13fe0204))
* ensure instances is defined ([7e00e32](https://github.com/Viren070/AIOStreams/commit/7e00e32bbe93a5610d4f94bc3d78a78e48d32c6b))

## [2.0.0](https://github.com/Viren070/AIOStreams/compare/v1.22.0...v2.0.0) (2025-06-18)

### 🚀 The Big Upgrades in v2 🚀

- **Beyond Just Streams:** AIOStreams v2 now supports more than just stream addons! You can integrate **any supported Stremio addon type**, including **Catalog addons, Subtitle addons, and even Addon Catalog addons** into your single AIOStreams setup. Now it truly can do _everything_!
- **100% Addon Compatibility:** That's right! AIOStreams v2 is designed to work with **100% of existing Stremio addons** that adhere to the Stremio addon SDK.
- **Sleek New UI**: The entire interface has been redesigned for a more modern, intuitive, and frankly, beautiful configuration experience.

_This new configuration page was only possible thanks to [Seanime](https://seanime.rahim.app), a beautiful application for anime_

---

### ✨ Feature Deep Dive - Get Ready for Control! ✨

This rewrite has paved the way for a TON of new features and enhancements. Here’s a rundown:

**🛠️ Configuration Heaven & Built-in Marketplace:**

- The configuration page now features a **built-in marketplace for addons**. This makes it super easy to discover and add new addons, displaying their supported resources (streams, catalogs, subtitles, etc.), Debrid services they integrate with, and stream types (torrent, http, usenet, live etc.).
- You can now **quickly enable or disable individual addons** within your AIOStreams setup without fully removing them. This is particularly useful because tools like StremThru Sidekick wouldn't be able to detect or manage the individual addons _inside_ your AIOStreams bundle, but with AIOStreams' own UI, you have that fine-grained control.
- Remember, the marketplace is just there for convenience. You can still add any addon you want using the 'Custom' addon at the top of the marketplace and use an addons manifest URL to add it to AIOStreams.

**📚 Supercharged Catalog Management:**

- **Total Catalog Control:** Reorder your catalogs exactly how you want them, **regardless of which addon they originate from!** Mix and match to your heart's content.
- **Granular Management:** Enable/disable specific catalogs, apply **shuffling** to individual catalogs - and control how long a shuffle lasts, **rename catalogs** for a personalized touch, and you can even **disable certain catalogs from appearing on your Stremio home page**, having them only show up in the Discover section for a cleaner look!
- **Universal RPDB Posters:** Ever wanted those sleek posters with ratings on _any_ catalog? Now you can! Apply **RPDB posters (with ratings) to any addon that uses a supported ID type (like IMDB or TMDB ID), even if the original addon doesn't support RPDB itself.** Yes, this means you could add RPDB posters to Cinemeta if you wanted!
- **Why not just use other tools like StremThru Sidekick or the Addon Manager for catalogs?**
  - **Broader Compatibility:** Both StremThru Sidekick and Addon Manager are primarily limited to managing addons _for Stremio itself_. AIOStreams’ catalog features can be utilized by _any application_ that supports Stremio addons, not just Stremio.
  - **True Internal Reordering:** Neither of those tools supports reordering catalogs _within an addon itself_. Since AIOStreams presents all its combined catalogs as coming from _one addon_, those tools wouldn't be able to reorder the catalogs _inside_ your AIOStreams setup. AIOStreams gives you that crucial internal control.
  - **Safety:** AIOStreams does **not** make use of the Stremio API for its core functionality. This means it operates independently and **cannot break your Stremio account** or interfere with its settings.

**🌐 Expanded Addon Ecosystem:**

- The built-in marketplace comes packed with **many more addons than before**.
- Some notable new stream addons include: **StremThru Torz, Nuvio Streams, Debridio Watchtower, StreamFusion**, and even built-in support for **wrapping AIOStreams within AIOStreams** (AIOception!).

**💎 Revolutionary Grouping Feature:**

- This is a big one! I've implemented a **new grouping feature** that allows you to group your addons and apply highly customizable conditions.
- Streams from addons in Group 1 are always fetched. Then, you can set conditions for subsequent groups. For example, for Group 2, you could set a condition like `count(previousStreams) < 5`. This means addons in Group 2 will only be queried if the total number of streams found by Group 1 is less than 5. This means you can tell AIOStreams, for instance, to only tap into your backup/slower addon group if your main, preferred addons don't find enough streams first – super efficient!
- This allows for incredibly optimized and tailored stream fetching. (For more advanced setups and details, I highly recommend checking out the **[Wiki](https://github.com/Viren070/AIOStreams/wiki/Groups)**).

**🔎 Next-Level Filtering System:**

- The filtering system has been completely revamped. Previously, you could mainly exclude or prefer. Now, for _every_ filter criteria, you can set **four different filter types**:
  - **Include:** If matched, this item won't be excluded by other exclude/required filters for _any other exclude/required filter_.
  - **Required:** Exclude the stream if this criteria is _not_ detected.
  - **Exclude:** Exclude the stream if this criteria _is_ detected.
  - **Preferred:** This is used for ranking when you use that filter as a sort criteria.
- **New Filters Added:**
  - **Conditions Filter:** This incredibly flexible filter uses the same powerful condition parser as the "Groups" feature. You can now enter **multiple filter conditions**, and any stream that matches _any_ of the conditions you define will be filtered out. This allows for an almost infinite number of ways to combine and exclude streams with surgical precision! For example, a condition like `addon(type(streams, 'debrid'), 'TorBox')` would exclude all Debrid-type streams _only_ from the "TorBox" addon, leaving its Usenet streams untouched.
  - **Matching:** This powerful filter helps ensure you get the right content. It includes:
    - **Title Matching:** Filter out results that don't match the requested title. You can choose between an "exact match" mode or a "contains" mode for flexibility. **You can optionally also match the year too.**
    - **Season/Episode Matching:** Specifically for series, this mode filters out results with incorrect season or episode numbers, ensuring accuracy. This can be granularly applied to only specific addons or request types.
  - **Audio Channels:** This was previously part of the Audio Tag filter but is now its own dedicated filter for more precise control (e.g., filter for 5.1, 7.1).
  - **Seeders:** Define include/required/exclude ranges for seeders. Finally, you can set a **minimum seeder count** and automatically exclude results below that threshold!
- **Adjusted & Enhanced Filters:**
  - **Cache:** Get fine-grained control over cached/uncached content. You can now exclude uncached/cached content from specific Debrid services or addons, and even for specific stream types. For example, you could filter out all uncached _torrents_ but still allow uncached _Usenet_ results.
  - **Clean Results (now "Deduplicator"):** This is now far more customizable! You can modify what attributes are used to identify duplicates (e.g., infohash, filename) and how duplicates are removed for each stream type. For instance, for cached results, you might want one result from each of your Debrid services, while for uncached results, you might only want the single best result from your highest priority service.
  - **Size:** You can now set **individual file size ranges for each resolution** (e.g., 1-2GB for 720p, 3-5GB for 1080p, etc.).

**📺 Smarter Sorting & Display:**

- Define **different sorting priorities for cached vs. uncached media**, and also **different sorting for movies vs. series.**
- **New "Light GDrive" Formatter:** For those who prefer a cleaner look but still need key information from the filename, this formatter only shows the title, year, and season/episode info (e.g., "Movie Title (2023) S01E01"), making sure you don't potentially choose an incorrect result while still keeping the text to a minimal level.
  - And of course, you can always join our Discord server to discover custom display formats shared by the community and easily use them with AIOStreams' custom formatter feature!

**✨ Quality of Life Enhancements:**

- **Import/Export Configurations:** You can now easily **export your entire AIOStreams configuration into a file.** This file can then be imported into any AIOStreams instance at any time – perfect for backups or migrating to a new setup.
  - **Shareable Templates:** There's an "Exclude Credentials" option when exporting, making it easy to share template configurations with others!
  - **⚠️ Important Warning:** While the "Exclude Credentials" feature removes sensitive information you enter _directly_ into AIOStreams (like API keys), it **does not** modify or exclude URLs you provide for "Custom" addons or when you override an addon's default URL. These URLs can potentially contain sensitive tokens or identifiers, so please review them carefully before sharing a configuration file.
- **External Downloads:** For added convenience, AIOStreams v2 now adds an "External Download" link below each stream result. Clicking this will open the direct download link for that stream in your browser, making it easy to grab a copy of the content if needed.
- **Hide Errors:** Optionally hide error messages, and you can even specify this for particular resources (e.g., hide errors only for stream fetching, but show them for catalog fetching).
- **Precache Next Episode:** When you're watching a series, AIOStreams can automatically request results for the _next_ episode in the background. If it finds that all available results are uncached, it can **ping the first uncached result for your preferred Debrid service to start downloading it.** The goal? By the time you finish your current episode, the next one might already be cached and ready to stream instantly!

**A Note on Options:** AIOStreams v2 offers a vast array of configuration options, especially within the filtering system. While this provides incredible power and flexibility for advanced users, please remember that **most users won't need to dive deep into every setting.** The default configurations are designed to be sensible and provide a great experience out-of-the-box! For a detailed explanation of every option and how to fine-tune your setup, the **[AIOStreams v2 Configuration Guide](https://guides.viren070.me/stremio/addons/aiostreams)** has been fully updated and is your best resource.

---

### 💾 Under The Hood: The New Database Foundation 💾

- **Database-Driven:** AIOStreams is now database-based! This means your configurations are stored securely. When you create a configuration, it's assigned a **unique UUID** that you'll use to access it in Stremio.
- **Password Protected:** You'll protect your configurations with a **password**. Without it, no one else can access your configuration.
- **Seamless Updates (Mostly!):** A huge benefit of being database-driven is that for most setting changes, there’s **no longer a need to reinstall the addon in Stremio!** Just update your configuration, and the changes apply automatically.
  - **Note:** The only exception is if you make changes to your catalogs that affect their order or which addons provide them (e.g., reordering addons in the list, adding/removing catalog-providing addons). In this specific case, a reinstall of the AIOStreams addon in Stremio is needed for Stremio to pick up the new catalog structure.

---

### ⚠️ Important Notes & Caveats for v2 ⚠️

- **Migration Requires Reconfiguration:** Due to the extensive changes and the new database system, existing AIOStreams users will need to **reconfigure their setups for v2.** Think of it as a fresh start with a much more powerful system! The **[v1 to v2 Migration Guide](https://github.com/Viren070/AIOStreams/wiki/Migrate-to-V2)** on the Wiki can help. For a deep dive into all the new settings, refer to the comprehensive **[AIOStreams v2 Configuration Guide](https://guides.viren070.me/stremio/addons/aiostreams)**. **If you use custom formatters, you should also check the migration guide for minor syntax adjustments.**
- **Torrentio support (on public instance)?** Torrentio, the most popular addon, was disabled for most of v1's history due to the way it works (multiple requests appear to come from one IP, which is problematic for public instances). Torrentio remains **disabled on the public instance**, and this will not change. Self-hosted instances will have Torrentio enabled by default. The developer of Torrentio has personally stated that he does not want ElfHosted's public instances scraping Torrentio.
- **Cloudflare Worker Support Dropped:** Maintaining compatibility with Cloudflare Workers alongside the new database requirements and feature set became infeasible. It was essentially like writing and maintaining two different versions of the addon. As such, direct Cloudflare Worker support has been dropped.
- **Free Hosting Challenges:** AIOStreams v2 now **requires a database** for storing configurations. Many free hosting services do not provide persistent database storage (or have very limited free tiers), which can lead to your configurations being wiped when the instance restarts.
  - For example, **Hugging Face Spaces** requires a paid tier for persistent storage.
  - **Koyeb's** free tier does not offer persistent file storage for the SQLite database, however, Koyeb _does_ provide a free PostgreSQL database instance which AIOStreams v2 can use, offering a viable free hosting path if configured correctly.
    I recommend looking for hosting solutions that offer persistent storage or a compatible free database tier if you plan to self-host on a free platform.

---

### 🔧 Self-Hosting AIOStreams & Self-Hosting Guides 🔧

For those of you who like to have full control over your setup, **AIOStreams v2 is, of course, _still_ self-hostable!**

If you're migrating your instance from v1 to v2, read the [Migration](https://github.com/Viren070/AIOStreams/wiki/Migrate-to-V2) page on the Wiki to ensure nothing unexpected happens.

A few months back, I started out knowing very little about self-hosting (I was using Hugging Face to host my personal AIOStreams instance back then) and I've since decided to dive into self-hosting.

As a result, I've put together a **set of comprehensive self-hosting guides** that I'm excited to share with the community. My goal with these guides is to take you **from scratch to hosting all sorts of addons and applications**, including AIOStreams, without spending a dime or needing any hardware other than a laptop/computer. (Some of you may even be able to set this all up just using your phone/tablet)

The guides cover:

- Securing a **free Oracle Cloud VPS** (yes, free!).
- Installing **Docker** and getting comfortable with its basics.
- Utilizing my **highly flexible and detailed template compose project.** This Docker Compose setup is designed to be a launchpad for your self-hosting adventures and includes configurations for **countless apps, with AIOStreams v2 ready to go!**

If you've ever been curious about self-hosting but didn't know where to start, I believe these guides can help you get up and running with a powerful, remote, and secure setup.

- **https://guides.viren070.me/selfhosting**

---

### 💬 Join the AIOStreams Community on Discord! 💬

AIOStreams v2 wouldn't be where it is today without the feedback, bug reports, and ideas from our community. A Massive **THANK YOU** to everyone on Discord who took part in testing, shared suggestions, and patiently helped polish every feature. Your involvement genuinely shaped this release!

To celebrate the launch, I'm running a **1-year Real-Debrid giveaway (with 2 winners)** exclusively in the Discord server! Just join the server for your chance to win.

Outside of the giveaway, you can also join our server for:

- Questions about and support for AIOStreams
- Receive help with self hosting
- Discover setups shared by the community like formats, regexes, group filters, condition filters etc. (and possibly even share your own!)
- Staying updated on the latest AIOStreams developments

Join our server using the link below:

- **https://discord.viren070.me**

---

### ❤️ Support AIOStreams Development ❤️

AIOStreams is a passion project that I develop solo in my free time. Countless hours have gone into this v2 rewrite, and I'm committed to making it the best it can be.

If you find AIOStreams useful and want to support its continued development, please consider donating. Any amount is hugely appreciated and helps me dedicate more time to new features, bug fixes, and support.

- **[Sponsor me on GitHub](https://github.com/sponsors/Viren070)**
- **[Buy me a coffee on Ko-fi](https://ko-fi.com/viren070)**

---

### 🚀 Get Started with AIOStreams v2! 🚀

I'm incredibly excited for you all to try out AIOStreams v2! I believe it's a massive step forward. Please give it a go, explore the new features, and share your feedback.

Here’s how you can jump in:

**1. Try the Public Instance (Easiest Way!)**

- **ElfHosted (Official Public Instance):** Generously hosted and maintained.
  - **Link:** **https://aiostreams.elfhosted.com/**

**2. Self-Host AIOStreams v2**

- **For New Self-Hosters:** If you know what you're doing - follow the [Deployment Wiki](https://github.com/Viren070/AIOStreams/wiki/Deployment). Otherwise, check out my comprehensive **[Self-Hosting Guides](https://guides.viren070.me/selfhosting)** to get started from scratch.
- **Migrating from v1?** If you're currently self-hosting v1, ensure your setup supports persistent storage and then follow the **[v1 to v2 Migration Guide](https://github.com/Viren070/AIOStreams/wiki/Migrate-to-V2)**.

**3. Managed Private Instance via ElfHosted (Support AIOStreams Development!)**

- Want AIOStreams without the self-hosting hassle? ElfHosted offers private, managed instances.
- ✨ **Support My Work:** If you sign up using my referral link, **33% of your subscription fee directly supports AIOStreams development!**
  - **Get your ElfHosted AIOStreams Instance:** **https://store.elfhosted.com/product/aiostreams/elf/viren070**

This release marks a new chapter for AIOStreams, and I can't wait to see how you all use it to enhance your Stremio experience.

Cheers,

Viren.

See the commit breakdown below:

### Features

- add 'onlyOnDiscover' catalog modifier ([4024c01](https://github.com/Viren070/AIOStreams/commit/4024c01b0a55cdd18023cf4d9328f38d3b5c29d0))
- add alert and socials options to schema, implement SocialIcon component, and update TemplateOption to render new option types ([a0a3c82](https://github.com/Viren070/AIOStreams/commit/a0a3c8231ae77cd379eb39ba68ef437b15b0a4e5))
- add alert option to DebridioTmdbPreset and TmdbCollectionsPreset for language selector clarification ([093f90a](https://github.com/Viren070/AIOStreams/commit/093f90a3eeafb540aaf28638557ad75a8f1e44d9))
- add aliased configuration support ([5df60d7](https://github.com/Viren070/AIOStreams/commit/5df60d7085a0b5f938c8f135c93c29286aed566b))
- add anime catalogs ([5968685](https://github.com/Viren070/AIOStreams/commit/59686852d3b7c2e3f0f8e204bcf8b765aadb29f7))
- add anime specific sorting and add help box to sort menu ([77ee7b4](https://github.com/Viren070/AIOStreams/commit/77ee7b48c465d67e2e105d1c134d88cd96b27093))
- add api key field and handle encrypted values correctly. ([6a5759d](https://github.com/Viren070/AIOStreams/commit/6a5759d60e27ec83101a3f1b02284ad8242faea9))
- add asthetic startup logs ([fdbd282](https://github.com/Viren070/AIOStreams/commit/fdbd2821101bd8de0f9ffc4030a6b4938c43ec70))
- add audio channel filter and fix unknown filtering not working in some cases ([df546d3](https://github.com/Viren070/AIOStreams/commit/df546d3a0c9ca39e772a64980a6aa582a4e9c81a))
- add built-in torrentio format ([6fa1b2b](https://github.com/Viren070/AIOStreams/commit/6fa1b2b0c0cb45e9344163989009238d528d330b))
- add configurable URL modifications for Stremthru Store and Torz ([3ce9dd0](https://github.com/Viren070/AIOStreams/commit/3ce9dd0ff5e5b7e9298bef87b3c5abe12c96afc9))
- add delete icon to preferred list, only load valid values, fix password requirement check for new logins, fix spellings and add types ([d845c0c](https://github.com/Viren070/AIOStreams/commit/d845c0ce8bfb040c800355e97ea552758ad3c719))
- add doctor who universe ([048c612](https://github.com/Viren070/AIOStreams/commit/048c612896723acffe908459c381dd1ee6f63784))
- add donation modal button at top of about menu ([0170267](https://github.com/Viren070/AIOStreams/commit/01702671d59d7b924f4693e30b4f8fb1efaeaa15))
- add external download streams option ([952a050](https://github.com/Viren070/AIOStreams/commit/952a05057cfbd9446f19ea4e7c71e26ae8acee89)), closes [#191](https://github.com/Viren070/AIOStreams/issues/191)
- add folder size, add smart detect deduplicator, parse folder size for mediafusion, improve size parsing ([52fb3bb](https://github.com/Viren070/AIOStreams/commit/52fb3bb41c9b59433e00695c61fd643724c1bff4))
- add health check to dockerfile ([8c68051](https://github.com/Viren070/AIOStreams/commit/8c680511edb2c5936bebdab5931bd32a968bcc9e))
- add infohash extractor in base stream parser ([4b1f45d](https://github.com/Viren070/AIOStreams/commit/4b1f45da3a8c3eff9b9a2d675332267cbedf6722))
- add keepOpenOnSelect prop to Combobox for customizable popover behavior and set it to true by default ([f32a1a1](https://github.com/Viren070/AIOStreams/commit/f32a1a1002937023cb50a9b5d230950f9981aaba))
- add link to wiki in groups and link to predefined formatter definitions ([7f4405e](https://github.com/Viren070/AIOStreams/commit/7f4405e3574cdd230cc2112125163408738d2685))
- add more addons and fix stuff ([51f6bd6](https://github.com/Viren070/AIOStreams/commit/51f6bd606c1d4db184b7e9c497f8e63aaf3c03cc))
- add nuviostreams and anime kitsu ([34ed384](https://github.com/Viren070/AIOStreams/commit/34ed3846da218065ad89f840e739ec541109158a))
- add opensubtitles v3 ([b4f6927](https://github.com/Viren070/AIOStreams/commit/b4f69273a4de6572dafcd5b121910048da3cb3aa))
- add P2P option and enhance service handling in StremthruTorzPreset ([6390995](https://github.com/Viren070/AIOStreams/commit/6390995eebbd96ab524c3980b103500ecc8300ad))
- add predefined format definitions for torbox, gdrive, and light gdrive ([e3294eb](https://github.com/Viren070/AIOStreams/commit/e3294eb7e9403e457d622e848bbf81534e92c9e6))
- add public ip option and load forced/default value to proxy menu ([3c2c59e](https://github.com/Viren070/AIOStreams/commit/3c2c59e676144dba70ba9c3675f3767eab4991ea))
- add regex functions to condition parser ([731c1d0](https://github.com/Viren070/AIOStreams/commit/731c1d002cb2fa2bce79f7b20df27f4e6e726e2b))
- add season/episode matching ([4cd6522](https://github.com/Viren070/AIOStreams/commit/4cd6522417bb15eb37d23a39b6556ff8aa41838e))
- add seeders filters ([653b306](https://github.com/Viren070/AIOStreams/commit/653b30632154c31c1036b76bc84e013253539a47))
- add sensible built-in limits and configurable limits, remove unused variables from Env ([37259d9](https://github.com/Viren070/AIOStreams/commit/37259d90f133e57571a896929aa9c023027fad6e))
- add shuffle persistence setting and improve shuffling ([e6286bc](https://github.com/Viren070/AIOStreams/commit/e6286bcf9bdbf509722e68879803485cc7926c62))
- add size filters, allowing resolution specific limit ([fcec2b9](https://github.com/Viren070/AIOStreams/commit/fcec2b9ed850a852c4254306421c91b82c8a6c54))
- add social options to various presets ([ea02be9](https://github.com/Viren070/AIOStreams/commit/ea02be99a714e03687b603848f4157e1150aa817))
- add source addon name to catalog and improve ui/ux ([878cd7c](https://github.com/Viren070/AIOStreams/commit/878cd7c71fd648072dc9ec2c8de53428eb79a93c))
- add stream passthrough option, orion, jackettio, dmm cast, marvel, peerflix, ([0383671](https://github.com/Viren070/AIOStreams/commit/038367126eb4e9fa327101163a12b4ef6dc9b7e6))
- add stream type exclusions for cached and uncached results ([18e034f](https://github.com/Viren070/AIOStreams/commit/18e034f7bfb092c053405244a6f972aff44cf1d1))
- add StreamFusion ([8b34be3](https://github.com/Viren070/AIOStreams/commit/8b34be3845a86bddf0b95d9aab43607cf9223a92))
- add streaming catalogs ([4ce36f1](https://github.com/Viren070/AIOStreams/commit/4ce36f1ba0a8b3149cb9823b7499d625e0e285dd))
- add strict title matching ([c4991c6](https://github.com/Viren070/AIOStreams/commit/c4991c678db0333587e57a632e68f26a650ea24a))
- add support for converting ISO 639_2 to languages and prevent languages being detected as indexer in Easynews++ ([938323f](https://github.com/Viren070/AIOStreams/commit/938323f1dd5a4a333275c506afa1c85a8c9af361))
- add support for includes modifier for array ([90432ae](https://github.com/Viren070/AIOStreams/commit/90432ae9c8b93b7bc1ba4a7a677f7a576b946cd7))
- add webstreamr, improve parsing of nuviostream results, validate tmdb access token, always check for languages ([dc50c6c](https://github.com/Viren070/AIOStreams/commit/dc50c6c70b94df7cc0124bbc8b2f96df01011b38))
- adjust addons menu ([6d0a088](https://github.com/Viren070/AIOStreams/commit/6d0a088c395aacb7123a66c12d01df1547733f37))
- adjust default user data ([dea5950](https://github.com/Viren070/AIOStreams/commit/dea595055a1cb5ce07f26b64faa209bbaa71dd7a))
- adjust handling of meta requests by trying multiple supported addons until one succeeds ([9fab116](https://github.com/Viren070/AIOStreams/commit/9fab1162c004fa7c5f4b73b522527ec0ed142b8a))
- adjustments and proxy menu ([0c5479c](https://github.com/Viren070/AIOStreams/commit/0c5479c12997dc755b34897a4ed1814c2140dacb))
- allow editing catalog type ([d99a29f](https://github.com/Viren070/AIOStreams/commit/d99a29fd6e97b010d41047d61522ce49a7084ade))
- allow passing flags through ([bec91a8](https://github.com/Viren070/AIOStreams/commit/bec91a8a5835b340003381d99ebd5b02596dca4b))
- cache RPDB API Key validation ([63622e0](https://github.com/Viren070/AIOStreams/commit/63622e0a07c64b45a228a1f3f653449744ec96e4))
- changes ([e8c61a9](https://github.com/Viren070/AIOStreams/commit/e8c61a986066e1bdd06f00c5e3a4ff215ae5f968))
- changes ([13a20a7](https://github.com/Viren070/AIOStreams/commit/13a20a7b610da0f41b40ccaf454a31805b445e9e))
- clean up env vars and add rate limit to catalog api ([20fc37c](https://github.com/Viren070/AIOStreams/commit/20fc37cc123bacf729c57ae0718d6e85d02d4bb9))
- **conditions:** add support for multiple groupings, and add type constant ([2a525b2](https://github.com/Viren070/AIOStreams/commit/2a525b292ef98a8e5a6697f967474714d0ceec23))
- enhance language detection in MediaFusionStreamParser to parse languages from stream descriptions ([50db0e2](https://github.com/Viren070/AIOStreams/commit/50db0e2714f5f040660f47efa3012b41ae8da55d))
- enhance stream parsing to prefer folder titles when available ([4001fae](https://github.com/Viren070/AIOStreams/commit/4001faede127a5712c3112ea334726bd18717c7d))
- enhance strict title matching with configuration options for request types and addons ([3378851](https://github.com/Viren070/AIOStreams/commit/3378851ff8048216529a9d1a6715d3b9d1439d39))
- enhance title matching by adding year matching option and updating metadata handling ([62752ef](https://github.com/Viren070/AIOStreams/commit/62752ef98c75741e59e70a08ce811b1e032dc8a9))
- expand cache system and add rate limiting to all routes, attempt to block recursive requests ([c9356db](https://github.com/Viren070/AIOStreams/commit/c9356db83ab311261c001702ea5a31193a4b0432))
- filter out invalid items in wrapper repsponses, rather than failing whole request. add message parsing for torbox ([da7dc3a](https://github.com/Viren070/AIOStreams/commit/da7dc3a935d29ec66c9c7509313268c16c3e4f1a))
- fix condition parsing for unknown values and separate cached into cached and uncached function for simplicity ([3d26421](https://github.com/Viren070/AIOStreams/commit/3d26421b6878cf21edd6c648f5b61f125bf6cb4d))
- **frontend:** add customization options for addon name and logo in AboutMenu ([47cc8f6](https://github.com/Viren070/AIOStreams/commit/47cc8f6dd6287d214ba34b0413fee784adbc52a7))
- **frontend:** add descriptions to addons and catalog cards ([98c5b71](https://github.com/Viren070/AIOStreams/commit/98c5b71f1e364dc2eb9d97448c2cf5d2bf42b12a))
- **frontend:** add shuffle indicator to catalog item ([edd1e4f](https://github.com/Viren070/AIOStreams/commit/edd1e4f8093a9cbb24278f4470d05ff6732acd15))
- **frontend:** add tooltip for full service name in service tags for addon card ([5b8ec4d](https://github.com/Viren070/AIOStreams/commit/5b8ec4d9e75822d3ec39e55d5ae503d5f7c5a51f))
- **frontend:** add valid formatter snippets and add valid descriptions for proxy services ([12b3f42](https://github.com/Viren070/AIOStreams/commit/12b3f423c0fd1706b9014996978e737d246fcac1))
- **frontend:** enhance nightly version display with clickable commit link ([84d53cb](https://github.com/Viren070/AIOStreams/commit/84d53cbdcf835d797312245dc9377da71b0b54d7))
- **frontend:** hide menu control button text on smaller screens ([2361e5c](https://github.com/Viren070/AIOStreams/commit/2361e5c373253db928027c2da0ca0eaa54f35579))
- **frontend:** improve addons menu, preserve existing catalog settings ([2c5c642](https://github.com/Viren070/AIOStreams/commit/2c5c642b022601e3a41ed74934bd29538eec9d71))
- **frontend:** improve services page ([384bdc3](https://github.com/Viren070/AIOStreams/commit/384bdc3a52d67bc85b33f2338b0076d7bd165fc1))
- **frontend:** make catalog card title consistent with other cards ([5197331](https://github.com/Viren070/AIOStreams/commit/5197331a79093065f8de326f76bfb2add9c0050a))
- **frontend:** services page, parse markdown, toast when duplicate addon ([3bc2538](https://github.com/Viren070/AIOStreams/commit/3bc25387f521792d5a2455a600d459176767497e))
- **frontend:** update addon item layout for improved readability ([589e639](https://github.com/Viren070/AIOStreams/commit/589e639870fe9618dcee6e7e221750b1d8a9e17c))
- **frontend:** use NumberInput component ([77edb07](https://github.com/Viren070/AIOStreams/commit/77edb07831ac6c4daf628e044fd369534fb58fcc))
- **frontend:** use queue and default regex matched to undefined ([2c97ec0](https://github.com/Viren070/AIOStreams/commit/2c97ec04cde252ffdeafac25ecbe5c02148b4385))
- identify casted streams from DMM cast as library streams and include full message ([6fd5f5b](https://github.com/Viren070/AIOStreams/commit/6fd5f5b9c03e46667255c9949b3c98b176724ebd))
- implement advanced stream filtering with excluded conditions ([302b4cb](https://github.com/Viren070/AIOStreams/commit/302b4cb5c99fe00f21b5b775ef2187f4088717a9)), closes [#57](https://github.com/Viren070/AIOStreams/issues/57)
- implement cache statistics logging and configurable interval ([8594ca0](https://github.com/Viren070/AIOStreams/commit/8594ca0374be534cb89dbbee427805202cc08ce6))
- implement config validation and addon error handling ([f7b14cd](https://github.com/Viren070/AIOStreams/commit/f7b14cd1dbe54d714fe41881ff9993107746b895))
- implement detailed statistics tracking and reporting for stream deduplication process ([89eac41](https://github.com/Viren070/AIOStreams/commit/89eac415a422189d80a3c3c66cde26762bd7f437))
- implement disjoint set union (DSU) for stream deduplication, ensuring multiple detection methods are handled correctly ([b0cc718](https://github.com/Viren070/AIOStreams/commit/b0cc718a094f22b4c0cec870e5b06e2ec9e1e7e9))
- implement import functionality via modal for JSON files and URLs in TextInputs component ([32b5a5b](https://github.com/Viren070/AIOStreams/commit/32b5a5b7bdfc9b2b27e15eddf060555e6b9c0596))
- implement MAX_ADDONS and fix error returning ([ae74926](https://github.com/Viren070/AIOStreams/commit/ae74926ce2e04710771a7166e946f87166985188))
- implement pre-caching of the next episode ([980682c](https://github.com/Viren070/AIOStreams/commit/980682cd28e40f84caf1c8f1072fd79ec49ac62b))
- implement timeout constraints in preset options using MAX_TIMEOUT and MIN_TIMEOUT ([e415a70](https://github.com/Viren070/AIOStreams/commit/e415a70485fdd33bf5d9b1379d3ede633ea60475))
- implement user pruning functionality with configurable intervals and maximum inactivity days ([0bf6fcb](https://github.com/Viren070/AIOStreams/commit/0bf6fcbe9c484c4df6582d76d3bd8fd10567f34b))
- improve config handling, define all skip reasons, add env vars to disable addons/hosts/services, ([a301002](https://github.com/Viren070/AIOStreams/commit/a301002ba49fce87e40a28a650e411e5078f769b))
- improve formatting of zod errors when using unions ([9c2a970](https://github.com/Viren070/AIOStreams/commit/9c2a970c7d612c9432db70a011663f3f241072ca))
- improve French language regex to include common indicators ([163352a](https://github.com/Viren070/AIOStreams/commit/163352a1909faf4e4b45b56222ba08afa023fd7e))
- improve handling of unsupport meta id and type ([3779ea0](https://github.com/Viren070/AIOStreams/commit/3779ea09d392ffb3f14b7efcba989ec7cc44bf89))
- improve preset/parser system and add mediafusion, comet, stremthru torz, torbox, debridio, en, en+, en+ ([b70a763](https://github.com/Viren070/AIOStreams/commit/b70a763e8b6dc9cfbaf865c8526dd078e1965cb8))
- include preset id in formatter ([6053855](https://github.com/Viren070/AIOStreams/commit/6053855f9a3dc5b32bcd8296161ef8ac6df18df8))
- make `BASE_URL` required and disable self scraping by default ([d572c04](https://github.com/Viren070/AIOStreams/commit/d572c047e9da4d3cf5be645fd2125b3781b80898))
- make caching more configurable and add to sample .env ([1e65fd9](https://github.com/Viren070/AIOStreams/commit/1e65fd9e7dddfe3a0bb9bcf07d77d03fbadf846a))
- match years for series too, but don't filter out episode results without a year ([8394f09](https://github.com/Viren070/AIOStreams/commit/8394f0969da665b31074c8e6b9fc15bf9e731b2a))
- move 'custom' preset to the beginning ([0b85ff3](https://github.com/Viren070/AIOStreams/commit/0b85ff35e7eba5f62579e117621b212122fd8eca))
- **parser:** add support for additional video quality resolutions (144p, 180p, 240p, 360p, 576p) in regex parser ([59d86ff](https://github.com/Viren070/AIOStreams/commit/59d86ffcbfe4d576c49903cdeb8adf197b811963))
- prefer results with higher seeders when deduping ([aed775c](https://github.com/Viren070/AIOStreams/commit/aed775c6d5a2b983dc04adbd15b7409a8b11a3a0))
- proxy fixes and log adjustments ([091394b](https://github.com/Viren070/AIOStreams/commit/091394b837565f59815bb968dea13fdc356b6160))
- remove duplicated info from download streams ([4901745](https://github.com/Viren070/AIOStreams/commit/49017450b9958eabc5a04a098401f2a2561a8e26))
- remove useMultipleInstances and debridDownloader options for simplicity and force multiple instances. ([8c0622e](https://github.com/Viren070/AIOStreams/commit/8c0622ea984082dc8c8f678c12d8c962967a70c1))
- rename API Key to Addon Password and update related help text in save-install component ([b63813c](https://github.com/Viren070/AIOStreams/commit/b63813c29db53b5a3fbf83c6c042ee10fdda739d))
- rename cache to cached in condition parser ([db68a5c](https://github.com/Viren070/AIOStreams/commit/db68a5c0266a5aa05068c4bcbc0c0f0532cd6097))
- replace custom HTML div with SettingsCard component for consistent styling ([8611523](https://github.com/Viren070/AIOStreams/commit/86115230bfd5958374294896adc59c83f28d3fee))
- revert 89eac415a422189d80a3c3c66cde26762bd7f437 ([34b57c9](https://github.com/Viren070/AIOStreams/commit/34b57c9883901722736cb5d52e0911f6434ddfe3))
- service cred env vars, better validation, handling of encrypted values ([61e21cd](https://github.com/Viren070/AIOStreams/commit/61e21cd803981899b4e445c5058fb546db79096d))
- start ([3517218](https://github.com/Viren070/AIOStreams/commit/35172188081b688011031439ec26b11e428dd02d))
- stuff ([0c9c86c](https://github.com/Viren070/AIOStreams/commit/0c9c86c218c5754e62ff94c0d26d398f32da92a1))
- switch to different arrow icons and use built-in hideTextOnSmallScreen prop ([8d307a0](https://github.com/Viren070/AIOStreams/commit/8d307a0c2f755b16074e1a7262204e635853ddfd))
- ui improvements ([7e031e5](https://github.com/Viren070/AIOStreams/commit/7e031e51b12cd1fa09e1ed70b90467e8a6bd956e))
- ui improvements, check for anime type using kitsu id, loosen schema definitions ([9668a15](https://github.com/Viren070/AIOStreams/commit/9668a152fd116ed9fa9657e935b3b0ed711ce06d))
- ui improvments ([39b1e84](https://github.com/Viren070/AIOStreams/commit/39b1e84d87ea4422ebbdab2495d242aeee231562))
- update About component with new guide URLs and enhance Getting Started section ([5232e38](https://github.com/Viren070/AIOStreams/commit/5232e3847b4aeb812c44ad0e153b95189ceda607))
- update static file serving rate limiting and refactor file path handling ([010b63c](https://github.com/Viren070/AIOStreams/commit/010b63c8725bfb3968c6678b2615675b393fb449))
- update TMDB access token input to password type with placeholder ([2378869](https://github.com/Viren070/AIOStreams/commit/23788695e2cedad3a1491c78f17f7e900aa77aeb))
- use `API_KEY` as fallback for `ADDON_PASSWORD` to maintain backwards compatability ([5424490](https://github.com/Viren070/AIOStreams/commit/5424490a284aa74e98071a36f3848706f81f5033))
- use button for log in/out ([62911ad](https://github.com/Viren070/AIOStreams/commit/62911adfacde25c9f9e7b3551c277c4a7a6340db))
- use shorter function names in condition parser ([3bd2751](https://github.com/Viren070/AIOStreams/commit/3bd27519fdfa8cbf9435a48b49f3aeb2992aae42))
- use sliders for seeder ranges and fix some options not being multi-option ([915187a](https://github.com/Viren070/AIOStreams/commit/915187a6120dff969dcfe9d4bf9e473673f8ebf0))
- validate regexes on config validation ([dd0f45c](https://github.com/Viren070/AIOStreams/commit/dd0f45c731938c37575fb376a981d3c0d2c7a45a))

### Bug Fixes

- (mediafusion) increase max streams per resolution limit to 500 ([322b4f3](https://github.com/Viren070/AIOStreams/commit/322b4f375ebbd1047f3e457cf48d75ac9b610d15))
- adapt queries for PostgreSQL and SQLite ([e2834d5](https://github.com/Viren070/AIOStreams/commit/e2834d571c709cc9ca3db541da6c1374fb201490))
- adapt query for SQLite dialect in DB class ([a7bb898](https://github.com/Viren070/AIOStreams/commit/a7bb8983de03d5f1fb044636133c6f01aaeebf1f))
- add back library marker to LightGDriveFormatter ([871f54e](https://github.com/Viren070/AIOStreams/commit/871f54e896a4315f197e6a15b779d4b2a957e8a4))
- add back logo.png to v1 path for backwards compatability ([ce5a5b9](https://github.com/Viren070/AIOStreams/commit/ce5a5b99059cd2902d60c9e865503d995ed46df9))
- add back y flag ([0e0a18b](https://github.com/Viren070/AIOStreams/commit/0e0a18b9c1f7e65f84af762aab785aa7a79e1222))
- add block scope for array modifier handling in BaseFormatter ([02a2885](https://github.com/Viren070/AIOStreams/commit/02a2885d33dfbe355203d4f561408eb82355d939))
- add description for stremthru torz ([6e7c142](https://github.com/Viren070/AIOStreams/commit/6e7c14224e5fe90d56dbda7f6ac91d5b87091444))
- add extras to cache key for catalog shuffling ([1cdfc6e](https://github.com/Viren070/AIOStreams/commit/1cdfc6e0e3a44f983ac43f1c210257c63c0a78a9))
- add France option to DebridioTvPreset language selection ([bd19d01](https://github.com/Viren070/AIOStreams/commit/bd19d01b5434070384ac69278fbc8e21a65bafe9))
- add missing audio tags to constant ([fda5ffe](https://github.com/Viren070/AIOStreams/commit/fda5ffe2062f1e6953380c4904c174b81b3b07ef))
- add missing braces in parseConnectionURI function for sqlite and postgres cases ([807b681](https://github.com/Viren070/AIOStreams/commit/807b6810ea2b29900408a96e15f934d49b4407d9))
- add timeout to fetch requests in TMDBMetadata class to prevent hanging requests ([1a0d57a](https://github.com/Viren070/AIOStreams/commit/1a0d57af43efd68d41a623e2a81b23cb217011da))
- add validation for encrypted data format in decryptString function ([843b535](https://github.com/Viren070/AIOStreams/commit/843b535d7ca47c362e254669d0a3f149abe9ffc2))
- add verbose logging for resources and fix addon catalog support ([4daa644](https://github.com/Viren070/AIOStreams/commit/4daa6441eede8aa630108c21f8760fa7c19a3745))
- adjust cache stat logging behaviour ([d921070](https://github.com/Viren070/AIOStreams/commit/d921070192a4e07e3702b521a7b3819f42da3529))
- adjust default rate limit values ([aa98e7b](https://github.com/Viren070/AIOStreams/commit/aa98e7b491a1f7ab9360af8d69490c39bbfd8268))
- adjust grid layout in AddonFilterPopover ([632fbf9](https://github.com/Viren070/AIOStreams/commit/632fbf9206dcf5d9532557ca69df42683b5f7ffd))
- adjust grouping in season presence check logic ([d89e796](https://github.com/Viren070/AIOStreams/commit/d89e796cb07e534691401e307d28fc89f4176dad))
- adjust option name to keep backwards compatability with older configs ([eb651b5](https://github.com/Viren070/AIOStreams/commit/eb651b517db2bf8b91e3c60488f5336049a6bb69))
- adjust spacing in predefined formatters and add p2p marker to torbox format ([d8f5d1a](https://github.com/Viren070/AIOStreams/commit/d8f5d1a2d152d2930c0cb03c533748f81f742869))
- allow empty strings for formatter definitions ([dba54f5](https://github.com/Viren070/AIOStreams/commit/dba54f5c426e8b0391d3f2b2979b473574968036))
- allow null for released in MetaVideoSchema ([ca8d744](https://github.com/Viren070/AIOStreams/commit/ca8d74448ac2479c948a1cc8509cee8a76db0042))
- allow null value for description in MetaPreview ([0f16575](https://github.com/Viren070/AIOStreams/commit/0f165752db011c5d525c59bb915edda43afea718))
- allow null value in MetaVideoSchema ([73b4d0b](https://github.com/Viren070/AIOStreams/commit/73b4d0b99fc587f7f82515553d92bf7c69647157))
- always apply seeder ranges, defaulting seeders to 0 ([0f5dd76](https://github.com/Viren070/AIOStreams/commit/0f5dd764d9577944c587a75423db5256942b583b))
- apply negativity to all addon and encode sorting ([411ae7c](https://github.com/Viren070/AIOStreams/commit/411ae7cee234ec8fefe08bf3d844d4711dc37645))
- assign unique IDs to each stream to allow consistent comparison ([673ecb2](https://github.com/Viren070/AIOStreams/commit/673ecb2133d3dc5435db7be23cf116b2a6ad34c3))
- await precomputation of sort regexes ([56994ef](https://github.com/Viren070/AIOStreams/commit/56994ef9e83248d49e890af99181943c7715d9bb))
- call await on all compileRegex calls ([8e87004](https://github.com/Viren070/AIOStreams/commit/8e87004a07a8b5612356f5d346b4b1140a866b64))
- carry out regex check for new users too ([1555199](https://github.com/Viren070/AIOStreams/commit/155519951bd5422da9d9fc112e1eca89c4d1fb51))
- change image class from object-cover to object-contain in AddonCard component ([734bd88](https://github.com/Viren070/AIOStreams/commit/734bd88d34ba84267934862117a846c8c246e96e))
- check if title matching is enabled before attempting to fetch titles ([fd03112](https://github.com/Viren070/AIOStreams/commit/fd03112288bdf00504a6e614993a50170bd7fb43))
- coerce runtime to string type in MetaSchema for improved validation ([cc6eea7](https://github.com/Viren070/AIOStreams/commit/cc6eea7e52cc7604806f04459439c7256e1b5aee))
- coerce year field to string type in ParsedFileSchema for consistent data handling ([10bef68](https://github.com/Viren070/AIOStreams/commit/10bef68c3625b855a473406dbd9bc4e852fe3cb2))
- **comet:** don't make service required for comet ([826edae](https://github.com/Viren070/AIOStreams/commit/826edae8030627bb94591a07c6343ee64e0108f9))
- **constants:** add back Dual Audio, Dubbed, and Multi ([7c10930](https://github.com/Viren070/AIOStreams/commit/7c109304ffdf035532514284c021171e91c0fe93))
- **core:** actually apply exclude uncached/cached filters ([413a29d](https://github.com/Viren070/AIOStreams/commit/413a29d2d85b50b62042c26f9bed665c7822d11d))
- correct handling of year matching and improved normalisation ([bd53adc](https://github.com/Viren070/AIOStreams/commit/bd53adc8f7538243caf121c9b3583cd257dc9181))
- correct library marker usage in LightGDriveFormatter ([2470ae9](https://github.com/Viren070/AIOStreams/commit/2470ae94ec2f52f869e3c2edf904500095502b27))
- correct spelling of 'committed' in UserRepository class ([551335b](https://github.com/Viren070/AIOStreams/commit/551335bcbaef570a6c6b81d023c1985f6fd19cd2))
- correctly handle negate flag ([a65ef19](https://github.com/Viren070/AIOStreams/commit/a65ef19f555d34103cd68e8c021707a61e54cdde))
- correctly handle overriden URLs for mediafusion ([46e7e67](https://github.com/Viren070/AIOStreams/commit/46e7e6748e461ec77575efb5ebec4dc7ee50eba7))
- correctly handle required filters and remove HDR+DV as a tag after filtering/sorting ([113c150](https://github.com/Viren070/AIOStreams/commit/113c150e143b65eeea5dc2e5e1d74df6c096b8be))
- correctly handle undefined parsed file ([8b85a53](https://github.com/Viren070/AIOStreams/commit/8b85a5332d2b33fb6d79139fb6e771d6446b7957))
- correctly handle usenet results during deduping ([153366b](https://github.com/Viren070/AIOStreams/commit/153366b41a6b8a08cff8a4cd29ab10dfc1c7d3ac))
- correctly import/export FeatureControl ([654b1bc](https://github.com/Viren070/AIOStreams/commit/654b1bc0585d3403836159ac2efde495f4cd44d4))
- **custom:** replace 'stremio://' with 'https://' in manifest URL ([0a4a761](https://github.com/Viren070/AIOStreams/commit/0a4a76187d78e924222512f1ca971292463270b7))
- **custom:** update manifest URL option to use 'manifestUrl' ([6370ac7](https://github.com/Viren070/AIOStreams/commit/6370ac7d00a75bd626cad67fa448dcaaa9b0a6ba))
- decode data before attempting validation ([bdf9a91](https://github.com/Viren070/AIOStreams/commit/bdf9a9198f06e550e0fb3681936e6bfacf483731))
- decrypt values for catalog fetching ([6cf8436](https://github.com/Viren070/AIOStreams/commit/6cf843666f97dedc247e52cf6946842d66c50229))
- default seeders to 0 for included seeder range ([b0aea2d](https://github.com/Viren070/AIOStreams/commit/b0aea2ddec56da2428f515615251712313138cec))
- default seeders to 0 in condition parser too ([53123a3](https://github.com/Viren070/AIOStreams/commit/53123a314c45d39c9d482e5105f47de712fcc7fc))
- default value to mediaflow if neither forced or proxy is defined and remove fallback from select value ([61781b7](https://github.com/Viren070/AIOStreams/commit/61781b7e0650713777c7475416e1fc8b837c13fa))
- default version to 0.0.0 when not defined ([f031f1a](https://github.com/Viren070/AIOStreams/commit/f031f1a50eabad7d122021ce9b6556694c49af76))
- don't fail on invalid external api keys when skip errors is true ([c2db243](https://github.com/Viren070/AIOStreams/commit/c2db243b5798032b75843faf7254969d63ff14b6))
- don't make base_url required ([3d7b0da](https://github.com/Viren070/AIOStreams/commit/3d7b0da93fb1add0c6f1d4523411fc0e9512a2b9))
- don't make name required in MetaPreview schema ([062247a](https://github.com/Viren070/AIOStreams/commit/062247a89a38d3fad1129a8965a92b6245d5e08e))
- don't pass idPrefixes in manifest response ([35ceb87](https://github.com/Viren070/AIOStreams/commit/35ceb87ff325960fc035db735ac8009ab636e09d))
- don't validate user data on retrieval within UserRepository ([17873bb](https://github.com/Viren070/AIOStreams/commit/17873bb476d280e6f533cd7cabf8bb8e3e91d518))
- enable passthrough on all stremio response schemas ([377d215](https://github.com/Viren070/AIOStreams/commit/377d215c0f5801ff93ec1b0065d0c64ce1fd8217))
- encrypt forced proxy URL and credentials before assignment ([e741de3](https://github.com/Viren070/AIOStreams/commit/e741de378775baecd00ee9a8838f3f9fc6ca2bb1))
- enhance Japanese language regex to include 'jpn' as an abbreviation ([7a02f12](https://github.com/Viren070/AIOStreams/commit/7a02f12818f64971971bc49b3ec80de594c4a1fe))
- ensure debridDownloader defaults to an empty string when no serviceIds are present in StreamFusionPreset ([886a8cb](https://github.com/Viren070/AIOStreams/commit/886a8cb98190fb0e6b4b3d2358103485c9cc6f47))
- ensure early return on error handling in catalog route ([6cc20e1](https://github.com/Viren070/AIOStreams/commit/6cc20e124dfe751051f61a700eb4765e8083310e))
- ensure tmdb access token, rpdb api key, and password options are filtered out when exclude credentials is on ([299a6d5](https://github.com/Viren070/AIOStreams/commit/299a6d578cef763528095cb80b2337c44d1994e0))
- ensure transaction rollback only occurs if not committed in deleteUser method ([67b188e](https://github.com/Viren070/AIOStreams/commit/67b188e7d76b6d0a424f5b86360c2b8a20ddc3b9))
- ensure uniqueness of preset instanceIds and disallow dots in instanceId ([3a9be38](https://github.com/Viren070/AIOStreams/commit/3a9be38c77bb7a1b4b991c46902241a6e265b327))
- export formatZodError ([af90131](https://github.com/Viren070/AIOStreams/commit/af90131787616a091373e69bf6f8de67e06f1e78))
- fallback to undefined when both default and forced value are undefined for proxy id ([efb57bf](https://github.com/Viren070/AIOStreams/commit/efb57bfc3e1a2819712e54c03aee78f967427837))
- **formatters:** add message to light gdrive and remove unecessary spacing ([5cb1b0a](https://github.com/Viren070/AIOStreams/commit/5cb1b0a21ed6b29dccf1a56e59434c28da39d1be))
- **frontend:** encode password when loading config ([e8971df](https://github.com/Viren070/AIOStreams/commit/e8971df66d8ed79dec7d93bbc790c3de13f54a01))
- **frontend:** load existing overriden type in newType ([caeb282](https://github.com/Viren070/AIOStreams/commit/caeb282438edfa8c731b32775840cc5f71c3ec36))
- **frontend:** pass seeder info through to formatter ([2ec06a6](https://github.com/Viren070/AIOStreams/commit/2ec06a6f9905c7e1f9c32cc0a5ef56e96872933b))
- **frontend:** set default presetInstanceId to 'custom' to pass length check ([ec7a19a](https://github.com/Viren070/AIOStreams/commit/ec7a19a92d2ffc2b06046ab0176f02a4f5b2014e))
- **frontend:** try and make dnd better on touchscreen devices ([6aa1130](https://github.com/Viren070/AIOStreams/commit/6aa11301a5dc06eb8674cfb6a834bf181a41eeee))
- **frontend:** update filter options to use textValue to correctly show addon name when selected ([6a87480](https://github.com/Viren070/AIOStreams/commit/6a874806b893dbd6382082563f2c45c274e2650b))
- give more descriptive errors when no service is provded ([c0b6fd3](https://github.com/Viren070/AIOStreams/commit/c0b6fd3e7dac933b7fd0f10d999a48850c70244e))
- handle when drag ends outside drag context ([7a8655d](https://github.com/Viren070/AIOStreams/commit/7a8655dd4326821f2445b1055a819a87a2c3270b))
- handle when item doesn't exist in preferred list ([d728bb6](https://github.com/Viren070/AIOStreams/commit/d728bb67bdd872b2d812e3fa0ce1e5352860dff4))
- ignore language flags in Torrentio streams if Multi Subs is present ([6d08d7c](https://github.com/Viren070/AIOStreams/commit/6d08d7c0336366c185ad43a89657cbe94dc30278))
- ignore recursion checks for certain requests ([d266026](https://github.com/Viren070/AIOStreams/commit/d26602631e030f59ef0f0098633b7f4909db87bc))
- improve error handling in TMDBMetadata by including response status and status text ([2f37187](https://github.com/Viren070/AIOStreams/commit/2f371876c151a9b4b0b7db3a4cf1fa14868d4db6))
- improve filename sanitization in StreamParser by using Emoji_Presentation to keep numbers and removing identifiers ([714fedb](https://github.com/Viren070/AIOStreams/commit/714fedb2c318a115836faa939c5f888c7785b34c))
- include overrideType in catalog modification check ([db473f3](https://github.com/Viren070/AIOStreams/commit/db473f3a32788bb34ed9cede11a24be45979d040))
- increase recursion threshold limit and window for improved request handling ([cc2acde](https://github.com/Viren070/AIOStreams/commit/cc2acdeb7ab7dcfdaadc767450065dc8df520f57))
- log errors in more cases, correctly handle partial proxy configuration, correctly handle undefined value in tryDecrypt, only decrypt when defined ([56734f0](https://github.com/Viren070/AIOStreams/commit/56734f0956b38998ea802d23e312e0dda2379c88))
- make adjustments to how internal addon IDs are determined and fix some things ([a6515de](https://github.com/Viren070/AIOStreams/commit/a6515de2718138cefdad5c4c53617a745ff044c5))
- make behaviorHints optional in manifest schema ([313c6bc](https://github.com/Viren070/AIOStreams/commit/313c6bc14e119d62c65bd2cea61eca23af4f4463))
- make keyword pattern case insensitive ([795adb3](https://github.com/Viren070/AIOStreams/commit/795adb3e2521a766c92889cc0701e1a8b0d68d96))
- make object validation less strict for parsed streams ([e39e690](https://github.com/Viren070/AIOStreams/commit/e39e6900b452b565c6f4c6ed7de151eceb54d38d))
- **mediaflow:** add api_password query param when getting public IP ([00e305f](https://github.com/Viren070/AIOStreams/commit/00e305f4f31d9c78741fb0d8d2585b8478d732ea))
- **mediaflow:** include api_password in public IP endpoint URL only ([279ff00](https://github.com/Viren070/AIOStreams/commit/279ff003be87febed59ac6f8edb3f0d0d439659a))
- **mediafusion:** correctly return encoded user data, and fix parsing ([c6a6350](https://github.com/Viren070/AIOStreams/commit/c6a63502b6049fd403816114547be42e5f44b305))
- only add addons that support the type only when idPrefixes is undefined ([d7355cb](https://github.com/Viren070/AIOStreams/commit/d7355cb5983202d08c5d6f863cf5f2f742a6ad97))
- only allow p2p on its own addon in StremThruTorzPreset ([510c086](https://github.com/Viren070/AIOStreams/commit/510c086ab0dfbedd089e06ec063837f9e465695f))
- only carry out missing title check after checking addons and request types ([eff8d50](https://github.com/Viren070/AIOStreams/commit/eff8d50006d3814af7a4140b0ad9f599eea6bddc))
- only exclude a file with excludedLanguages if all its languages are excluded ([2dfb718](https://github.com/Viren070/AIOStreams/commit/2dfb718fa1bca8ae188c5ff55b2f7b1bf7fbbb10))
- only filter out resources using specified resources when length greater than 0 ([cd78ead](https://github.com/Viren070/AIOStreams/commit/cd78ead297b8641d4f45ca224d5455ec649ee429))
- only use the movie/series specific cached/uncached sort criteria if defined ([049f65b](https://github.com/Viren070/AIOStreams/commit/049f65b18069a0b8c8b8ae7d34e5981cfa34244e))
- override stream parser for torz to remove indexer ([f0a448b](https://github.com/Viren070/AIOStreams/commit/f0a448b489585e22af6bcfffbc3ff0a383e35085))
- **parser:** match against stream.description and apply fallback logic to stream.title ([a1d2fc9](https://github.com/Viren070/AIOStreams/commit/a1d2fc9981c967254dcb91d1779310c2fd1f8fba))
- **parser:** safely access parsedFile properties to handle potential undefined values ([e995f97](https://github.com/Viren070/AIOStreams/commit/e995f97e2f43063f7e69b179237279d5aaba51e8))
- pass user provided TMDB access token to TMDBMetadata ([d2f4dc1](https://github.com/Viren070/AIOStreams/commit/d2f4dc1b8dbe17c17e80ac4698398af5a3757cc9))
- potentially fix regex sorting ([9771c7b](https://github.com/Viren070/AIOStreams/commit/9771c7be7f8e19c25cebac4439c42a7ae6766459))
- potentially fix sorting ([887d285](https://github.com/Viren070/AIOStreams/commit/887d2850f23e883734f2b56d4545e546c07a5694))
- prefix addon instance ID to ensure uniquenes of stream id ([009d7d1](https://github.com/Viren070/AIOStreams/commit/009d7d1cf40a1e4041690d5c217b34003f7d51a2))
- prevent fetching from aiostreams instance of the same user ([963a3f7](https://github.com/Viren070/AIOStreams/commit/963a3f7064abf0387d0ce49ffb7773659ea88577))
- prevent mutating options object in OrionPreset ([f8b08b3](https://github.com/Viren070/AIOStreams/commit/f8b08b3093e49e50acd52aed439ed3e5c7a0674b))
- prevent pushing errors for general type support to avoid blocking requests to other addons ([b390534](https://github.com/Viren070/AIOStreams/commit/b390534dae906235836c3fc4a43b3db27dee8324))
- reduce timeout duration for resetting values in AddonModal to ensure new modals properly keep their initial values ([9213d78](https://github.com/Viren070/AIOStreams/commit/9213d781d176101f8e7826cc187e44188cf346c4))
- refine year matching logic in title filtering for movies ([21f1d3e](https://github.com/Viren070/AIOStreams/commit/21f1d3e0210c84936d2c06b238ede488715d0165))
- remove check of non-existent url option in OpenSubtitlesPreset ([dbd5dd6](https://github.com/Viren070/AIOStreams/commit/dbd5dd6bd73abf26ad4c408c17af653dae6ed949))
- remove debug logging in getServiceCredentialDefault ([27932a5](https://github.com/Viren070/AIOStreams/commit/27932a54ff683faa01052e5cec1cf450ec5d8603))
- remove emojis from filename ([b8bbb17](https://github.com/Viren070/AIOStreams/commit/b8bbb178a8c66eaad6fc5b1637492b1358f12645))
- remove log pollution ([5b72292](https://github.com/Viren070/AIOStreams/commit/5b7229299e0f0dfd80a57ed4367a554574b8a9d8))
- remove max connections limit from PostgreSQL pool configuration ([bff13dc](https://github.com/Viren070/AIOStreams/commit/bff13dc22c59bb358926867bceefceca1c36574d))
- remove unecessary formatBytes function and display actual max size ([5c9406f](https://github.com/Viren070/AIOStreams/commit/5c9406f88e13e538e3683b82c8045899498ec185))
- remove unnecessary UUID assignment in UserRepository class ([c8224bc](https://github.com/Viren070/AIOStreams/commit/c8224bc21e496686971e99176d48eb1c859d675e))
- remove unused regex environment variables from status route ([2fd0522](https://github.com/Viren070/AIOStreams/commit/2fd05220a480bd70fca5d383d7477be6e7eb5fb2))
- remove unused regex fields from StatusResponseSchema ([dfef789](https://github.com/Viren070/AIOStreams/commit/dfef7895b2ad0c2c0b879ad0ce7e1d4410431eeb))
- replace crypto random UUID generation with a simple counter for unique ID assignment in StreamParser ([11b2204](https://github.com/Viren070/AIOStreams/commit/11b220443c67c22de475ab22d32ced033e083740))
- replace hardcoded SUPPORTED_RESOURCES with supportedResources in NuvioStreamsPreset ([4eeeb59](https://github.com/Viren070/AIOStreams/commit/4eeeb59186668ad1b2d7975e21ea7b90b501bfa7))
- replace incorrect hardcoded SUPPORTED_RESOURCES with supportedResources in DebridioPreset ([ed73f5d](https://github.com/Viren070/AIOStreams/commit/ed73f5de6c66ef408f513f54cafee8d2a22e6965))
- restore TMDBMetadata import in main.ts and enable metadata export in index.ts ([2cd7d4d](https://github.com/Viren070/AIOStreams/commit/2cd7d4dfd1ada052dad8b21f79a2ffd24eafc178))
- return original URL when no modifications are made in CometStreamParser ([cbfb4b7](https://github.com/Viren070/AIOStreams/commit/cbfb4b7838f5a91a401ce7f4d5b5c1a566b222ee))
- return url when no modifications are needed in JackettioStreamParser ([4791f36](https://github.com/Viren070/AIOStreams/commit/4791f360da880758ab5d227d2ada8f27ad2f9c64))
- **rpdbCatalogs:** correct spelling of 'movies' to 'movie' ([9e1960a](https://github.com/Viren070/AIOStreams/commit/9e1960a6ddd19e6ad705cab30539d6f2c2107321))
- **rpdb:** improve id parsing logic and include type for tmdb ([18621ca](https://github.com/Viren070/AIOStreams/commit/18621ca646bb3765963849fd10e25866b253759d))
- safely access catalogs options and default to false for streamfusion ([9c48fad](https://github.com/Viren070/AIOStreams/commit/9c48fad6a620e30730b9da9a8074daf016e24105))
- save preferred values when adjusting from select menu ([2b329fe](https://github.com/Viren070/AIOStreams/commit/2b329fe6feabdcefcb4c4603a772ec8cf8791a0b))
- set default sizeK value to 1024 in StreamParser and remove overridden method in TorrentioParser ([a09dcea](https://github.com/Viren070/AIOStreams/commit/a09dcead9bc6107b25dd8829c66d0b49d1dc49e8))
- set public IP to undefined when empty ([32f90fb](https://github.com/Viren070/AIOStreams/commit/32f90fb0f3e5a067ba8f3486bfeb366387b28f01))
- simplify and improve validation checks ([dde5af0](https://github.com/Viren070/AIOStreams/commit/dde5af02d9dab1634a2c7cd9e9346b4707011848))
- simplify duration formatting in getTimeTakenSincePoint function ([f1afe5f](https://github.com/Viren070/AIOStreams/commit/f1afe5f5a26024b6fbc860abbba902da201996d7))
- truncate addon name and update modal value states to handle changes in props ([14f56d1](https://github.com/Viren070/AIOStreams/commit/14f56d12479580033123bbbd312b5bc4ff67f4df))
- update addon name formatting in AIOStreamsStreamParser to prefix aiostreams addon name ([eefa184](https://github.com/Viren070/AIOStreams/commit/eefa184b7c0e8e3a2f7779360da94254858f6e6f))
- update AIOStream schema export and enhance AIOStreamsStreamParser with validation ([edc310f](https://github.com/Viren070/AIOStreams/commit/edc310fe5f213b4e03976aeb815fd51c81be7976))
- update Bengali regex to not match ben the men ([90980c7](https://github.com/Viren070/AIOStreams/commit/90980c76363abdec3d1f53ad2b27eb4181bd8131))
- update cached sorting to prefer all streams that are not explicitly marked as uncached ([b16f36d](https://github.com/Viren070/AIOStreams/commit/b16f36d4ea80d4a842281814239aaa23430c5c65))
- update default apply mode for cached and uncached filters from 'and' to 'or' ([3fe5027](https://github.com/Viren070/AIOStreams/commit/3fe50274dcfdfaea68103f6477cbc30563327f65))
- update default value for ADDON_PASSWORD and SECRET_KEY ([65a4c91](https://github.com/Viren070/AIOStreams/commit/65a4c9177cc8da04990c82fbde939fa4c5452637))
- update Dockerfile to use default port fallback for healthcheck and expose ([0ffca95](https://github.com/Viren070/AIOStreams/commit/0ffca9560460a640b763c2a4cabdd3c4a420b6ca))
- update duration state to use milliseconds and adjust input handling ([3d43673](https://github.com/Viren070/AIOStreams/commit/3d43673a66f695a1a7547d95a1ef36cd45d27864))
- update error handling in OrionStreamParser to throw an error instead of returning an error stream for partial success ([bb30b4a](https://github.com/Viren070/AIOStreams/commit/bb30b4a19a66c6eb8c3b408e64eea33d927bd8ea))
- update error message for missing addons to suggest reinstallation ([78a0d7f](https://github.com/Viren070/AIOStreams/commit/78a0d7f788aaa4ea10e2e69ccbd5d79c72bb17d1))
- update formatter preview ([f3d84bc](https://github.com/Viren070/AIOStreams/commit/f3d84bc9778a345e837a698c68c2e28ea71752a4))
- update GDriveFormatter to use 'inLibrary' instead of 'personal' ([f6ef47f](https://github.com/Viren070/AIOStreams/commit/f6ef47f3a8f7c781a084ffb3d5ba26615edf77fa))
- update handling of default/forced values ([c60ef6f](https://github.com/Viren070/AIOStreams/commit/c60ef6fde9c0de6abc98f2cb2de2a7e981719f3e))
- update help text to include selected proxy name rather than mediaflow only ([af24d67](https://github.com/Viren070/AIOStreams/commit/af24d674d1c265f9fe9a37f4528548b25790638e))
- update MediaFlowProxy to conditionally include api_password in proxy URL for /proxy/ip endpoint ([d0faecc](https://github.com/Viren070/AIOStreams/commit/d0faecc563cd7d2c9ed52310ce658b13ee3fc076))
- update MediaFusion logo URL ([3648f94](https://github.com/Viren070/AIOStreams/commit/3648f94d0acdebfde842818335f473fb4564d0e7))
- update NameableRegex schema to allow empty name and remove useless regex check ([96d355f](https://github.com/Viren070/AIOStreams/commit/96d355ffdabeb4a308b0f99a9f9a198b8a7d8733))
- update Peerflix logo URL ([ab1c216](https://github.com/Viren070/AIOStreams/commit/ab1c21695e596d8fb482f299d31bf44f51ba78fa))
- update seeder condition in TorrentioFormatter to allow zero seeders ([c890671](https://github.com/Viren070/AIOStreams/commit/c890671a444f6d82e48d9fdce1308913779d7123))
- update service links ([fea2675](https://github.com/Viren070/AIOStreams/commit/fea26752ac521415bf8f23ae022d4ecad7b7e731))
- update size filter constraints to allow zero values ([4a8e9c3](https://github.com/Viren070/AIOStreams/commit/4a8e9c3f7d2d463c0e800e542ef63ad0dab813b7))
- update social link from Buy Me a Coffee to Ko-fi in DcUniversePreset ([671567c](https://github.com/Viren070/AIOStreams/commit/671567cb433a4912e472d02cf975a1f8037ff223))
- update table schema ([f3b4088](https://github.com/Viren070/AIOStreams/commit/f3b4088397a7a09bfc0199bcbf769262a0cb1f75))
- update user data merging logic in configuration import ([5ebb539](https://github.com/Viren070/AIOStreams/commit/5ebb539a3e2e5d623a3682dfeeb626781bb2dde0))
- update user data reset logic ([9bd9810](https://github.com/Viren070/AIOStreams/commit/9bd9810a7a11132c814024e5182229135e23b42f))
- use correct input change handlers ([6f3013c](https://github.com/Viren070/AIOStreams/commit/6f3013cdc2883ef9214538bb9cafba475f692604))
- use nullish coalescing for seeder info in formatter to allow values of 0 ([3e5d581](https://github.com/Viren070/AIOStreams/commit/3e5d581cb0861bfd09a26dbb4bfc318abb579d9a))
- use structuredClone for config decryption to ensure immutability ([a67603d](https://github.com/Viren070/AIOStreams/commit/a67603d669439465756809b3e1ee9c2637a7bcc5))
- wrap handling for join case in block ([85a7775](https://github.com/Viren070/AIOStreams/commit/85a777544593b9a76d7cb8930db8e0321e6511fa))
- wrap switch cases in blocks ([16b208b](https://github.com/Viren070/AIOStreams/commit/16b208b05b2450771834954cd54a193af79fdc2d))
- **wrapper:** allow empty arrays as valid input in wrapper class ([c64a4f4](https://github.com/Viren070/AIOStreams/commit/c64a4f43ceb1b1eb85658a919ce3759df81556a9))
- **wrapper:** enhance error logging for manifest and resource parsing by using formatZodError ([ffc974e](https://github.com/Viren070/AIOStreams/commit/ffc974ede622e970fc5f7396d4f1d1658726228a))

## [1.22.0](https://github.com/Viren070/AIOStreams/compare/v1.21.1...v1.22.0) (2025-05-22)

### Features

- pass `baseUrl` in Easynews++ config and add optional `EASYNEWS_PLUS_PLUS_PUBLIC_URL`. ([b41e210](https://github.com/Viren070/AIOStreams/commit/b41e210c04777b349629dc98f28982bfb2e54886))
- stremthru improvements ([#172](https://github.com/Viren070/AIOStreams/issues/172)) ([72b5ab6](https://github.com/Viren070/AIOStreams/commit/72b5ab648e511220d7ff8b4bf453db94bb952b30))
