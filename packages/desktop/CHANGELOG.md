# Changelog

## [0.20.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.19.0...desktop-v0.20.0) (2026-10-23)


### Features

* **desktop:** add a player-unqueue message ([d500d8b](https://github.com/Viren070/AIOStreams/commit/d500d8b4ca1db18338d1c77536bec1cc217e8ec6))
* **desktop:** replace a loaded server subtitle when it is added again ([fbdcb1f](https://github.com/Viren070/AIOStreams/commit/fbdcb1fc38c443274be2ed491135b19e67a1ab04))
* **web:** add playlists ([1669db0](https://github.com/Viren070/AIOStreams/commit/1669db0006379561b550913d1651b0eb31a969b2))
* **web:** clear the launched player's queue when nothing plays next ([1669db0](https://github.com/Viren070/AIOStreams/commit/1669db0006379561b550913d1651b0eb31a969b2))
* **web:** connect to a config's server from its manifest URL ([1669db0](https://github.com/Viren070/AIOStreams/commit/1669db0006379561b550913d1651b0eb31a969b2))
* **web:** fetch a server subtitle again each time it is picked ([1669db0](https://github.com/Viren070/AIOStreams/commit/1669db0006379561b550913d1651b0eb31a969b2))
* **web:** offer the Android app's download folder choice ([1669db0](https://github.com/Viren070/AIOStreams/commit/1669db0006379561b550913d1651b0eb31a969b2))
* **web:** show the seek-bar picture for arrow-key seeks only on TVs ([1669db0](https://github.com/Viren070/AIOStreams/commit/1669db0006379561b550913d1651b0eb31a969b2))
* **web:** take a party's next titles from its queue ([1669db0](https://github.com/Viren070/AIOStreams/commit/1669db0006379561b550913d1651b0eb31a969b2))


### Bug Fixes

* **web:** close the open player menu when another opens ([1669db0](https://github.com/Viren070/AIOStreams/commit/1669db0006379561b550913d1651b0eb31a969b2))
* **web:** give the About page's Credits title its own context ([1669db0](https://github.com/Viren070/AIOStreams/commit/1669db0006379561b550913d1651b0eb31a969b2))
* **web:** hold a skip's seek-bar picture for a second ([1669db0](https://github.com/Viren070/AIOStreams/commit/1669db0006379561b550913d1651b0eb31a969b2))
* **web:** memoise the playback info query helpers ([1669db0](https://github.com/Viren070/AIOStreams/commit/1669db0006379561b550913d1651b0eb31a969b2))
* **web:** read buffered ranges from one snapshot ([1669db0](https://github.com/Viren070/AIOStreams/commit/1669db0006379561b550913d1651b0eb31a969b2))
* **web:** remember the subtitle type picked for a show ([1669db0](https://github.com/Viren070/AIOStreams/commit/1669db0006379561b550913d1651b0eb31a969b2))
* **web:** return nothing from the calendar agenda's scroll ([1669db0](https://github.com/Viren070/AIOStreams/commit/1669db0006379561b550913d1651b0eb31a969b2))
* **web:** reword the audio help for remembering picks per show ([1669db0](https://github.com/Viren070/AIOStreams/commit/1669db0006379561b550913d1651b0eb31a969b2))

## [0.19.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.18.0...desktop-v0.19.0) (2026-10-22)


### Features

* **desktop:** send mpv's seekable cache ranges as buffered ([72b627d](https://github.com/Viren070/AIOStreams/commit/72b627d2601c51dd9ad5294dea426a6f65c44352))
* **desktop:** size mpv's cache from the cache size setting ([78243fa](https://github.com/Viren070/AIOStreams/commit/78243fa627389de48af52517124e51c65e050688))
* **web:** add a random pick for a show's episodes and your favourites ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** add a setting for the reactions sent in a party ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** add a time-left toggle and an end time above the player's seek bar ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** allow a negative subtitle height ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** ask for a second Back before leaving the Android app from Home ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** draw each buffered range on the seek bar ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** leave the thumbnail out of double-tap seek previews ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** put the profile first in the TV rail and corner menu ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** reorder the player's option buttons by purpose ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** select tabs as a remote or keyboard moves onto them ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** send continue watching to the Android TV app's Watch Next row ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** send X-AIOStreams-* headers to servers listing clientHints ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** show cover immediately on auto play first ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** show party reactions beside the open party sheet ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** show the cache size setting in the desktop app ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** show the cache's time behind in Exo stats ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** sort the merged Continue watching row by watch time ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))


### Bug Fixes

* **web:** abort item and image fetches nothing waits on ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** dont gate party settings on party feature ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** drop the focus ring from body and #root ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** focus the custom CSS toast's Keep when applied from keys ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** keep the TV rail's fading layers composited with will-change ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** move along the player menu's stepper rows with left and right ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** paint the page's scrollbar in the page colour ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** send a pending settings save before reading them back ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** send a segment already skipped as offered ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** size the shut TV rail's buttons to its icons ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** skip the navigation when a key press starts focus on a page ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** take Back in the profile PIN prompt ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))


### Performance Improvements

* **web:** fade cards and artwork in only when on screen ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** find glide layers among a box's children ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))
* **web:** save a query's answer once it stops changing ([6943c04](https://github.com/Viren070/AIOStreams/commit/6943c04a6326d5a4fa5c64f8c2bae98043683f19))

## [0.18.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.17.0...desktop-v0.18.0) (2026-10-20)


### Features

* **desktop:** answer player-subtitle-index with every own subtitle's lines ([efac820](https://github.com/Viren070/AIOStreams/commit/efac8207538672d9ed8c2278cd6a38b7d60d5cc0))
* **desktop:** fetch FFmpeg's decoder DLLs from aiostreams-libs on Windows ([dc5c348](https://github.com/Viren070/AIOStreams/commit/dc5c348048fa19dfc7f03a7b5c8f642de7ab8ccb))
* **desktop:** make seek-bar thumbnails for player-thumbnail requests ([1f20a19](https://github.com/Viren070/AIOStreams/commit/1f20a1989f66acf1f38af0efbc7dc6b66c2ad6b2))
* **desktop:** play HDR on macOS with a choice of video output ([#1563](https://github.com/Viren070/AIOStreams/issues/1563)) ([3f88359](https://github.com/Viren070/AIOStreams/commit/3f88359dc527e91a8b4b14677562522b5db5aa03))
* **desktop:** read picture subtitles' lines from the index alone ([f6c92ab](https://github.com/Viren070/AIOStreams/commit/f6c92abf7c5283e1b69e7454b6ee314fe861e6bd))
* **desktop:** report a file's own subtitle lines to the page ([348c3df](https://github.com/Viren070/AIOStreams/commit/348c3dfaf455f3831af4992dddac3cf459bc4673))
* **desktop:** report whether the sound passes through ([27fb0cd](https://github.com/Viren070/AIOStreams/commit/27fb0cdc7d3354a65dc4f51cb4224d22fa2b61d5))
* **desktop:** send the reference subtitle's lines from the file's index ([cb248ee](https://github.com/Viren070/AIOStreams/commit/cb248ee1145c684e5eceb88a7373ca30160e53a7))
* **ui:** let a carousel keep a focused slide where the first one starts ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** add CSS hooks to party members, messages and the player cover ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** add data-favourite and data-type to poster cards ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** add tooltips to the player buttons and the show download menu ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** give subtitle timing, subtitle style and sound their own menu pages ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** keep key focus at a row's start ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** line added subtitles up with the file's own subtitles ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** match added subtitles against a PGS track when a file has no text one ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** offer favourite only on movies and shows ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** open titles from aiostreams:// item and play links ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** play titles on and control other devices ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** raise the player controls' idle delay to 5 seconds ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** scroll the calendar agenda to today on a new visit ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** send and show avatars in watch parties ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** settle unsure subtitle syncs on when lines start and end ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** show a retimed copy of subtitles made for another frame rate ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** show keyframe thumbnails over the seek bar ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** show notices at their index among the versions ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** skip a file's own subtitle its other subtitles don't back ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** skip row titles and the hero's dots in arrow navigation everywhere ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** take remote commands from the session socket ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** title a report of a page restart as one ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))


### Bug Fixes

* **desktop:** copy packages/native into the Flatpak build ([7828295](https://github.com/Viren070/AIOStreams/commit/7828295efbb9fea8886214dc15669272d7be07f3))
* **desktop:** ignore new-window requests for the app's own pages ([c318fb0](https://github.com/Viren070/AIOStreams/commit/c318fb09baf62603f6b6ba19082c8d3964e835c5))
* **desktop:** set only the subtitle style properties that changed ([18ea761](https://github.com/Viren070/AIOStreams/commit/18ea761e91a95e29e5c9f356865846c8deea0205))
* **web:** change party playback speed only for a drift that lasts ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** check downloads before finding the next episode's version ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** enter a row lying between focus and the card in line with it ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** keep a skip's seek-bar thumbnail up after the skip lands ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** leave room for the focus ring in desktop rows ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** let up and down leave a text box from its first and last line ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** open the version list with nothing focused on touch screens ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** paint the Android app's root in the page colour outside the player ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))
* **web:** take a party player's position from its soonest report ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))


### Performance Improvements

* **web:** reuse the subtitle matcher's curves ([68b2e84](https://github.com/Viren070/AIOStreams/commit/68b2e84d59a6d5aaa17827221858f2044ad408aa))

## [0.17.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.16.0...desktop-v0.17.0) (2026-10-18)


### Features

* **web:** add a people row to search ([c685a11](https://github.com/Viren070/AIOStreams/commit/c685a1105e798c14220a579b9a59ac9119f70eef))


### Bug Fixes

* **web:** accept a slash after the host in party app links ([c685a11](https://github.com/Viren070/AIOStreams/commit/c685a1105e798c14220a579b9a59ac9119f70eef))
* **web:** pick the following hero's card on pointer moves, not enters ([c685a11](https://github.com/Viren070/AIOStreams/commit/c685a1105e798c14220a579b9a59ac9119f70eef))

## [0.16.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.15.0...desktop-v0.16.0) (2026-10-18)


### Features

* **desktop:** send a download file's headers with every request ([9149c28](https://github.com/Viren070/AIOStreams/commit/9149c289fb4da9471a62f4ac823ee4e013c40f90))
* **desktop:** send a loadfile's headers as http-header-fields ([c1f365c](https://github.com/Viren070/AIOStreams/commit/c1f365c07bd0c01eb479862f4e90a37afa566d72))
* **desktop:** set the subtitle font and shadow from player-style ([3bc1913](https://github.com/Viren070/AIOStreams/commit/3bc19136d2edb4bf36440f2ed3e03fc5b55b897f))
* **ui:** add a replaceable table of the kit's own words ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **ui:** add swatches and an optional picker to the colour input ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **ui:** mark a drawer's side ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **ui:** ring the whole row of a right-side switch when focused ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **ui:** support right-to-left layouts ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **ui:** write sizes in a chosen locale ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** add a cache size setting ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** add quick filters and badges to the version list ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** add subtitle font and shadow settings ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** add translations with Lingui and a language setting ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** add watch parties ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** apply the server's CSS under the user's own ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** cover the player until its first frame ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** keep a user with a PIN unlocked until they switch away ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** keep the app language per user ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** keep the subtitle look on the user's account ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** offer colour swatches, without the picker on TVs ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** open the user switcher from the avatar ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** pass a version's required headers to app downloads ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** play a card's animatedPoster while it is hovered or focused ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** play trailers with the user's track preferences ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** play versions that need headers or YouTube in the app's player ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** send a report from troubleshooting or after a crash ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** send the party offset when it changes ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** send the player the segments it skips ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** show home's Activity and Calendar buttons only with the bottom bar ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** suggest aiostreams.viren070.me's relay to servers without party info ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** support right-to-left layouts ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** wrap every message in Lingui ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))


### Bug Fixes

* **desktop:** default GSK_RENDERER to OpenGL on Linux ([d9f7856](https://github.com/Viren070/AIOStreams/commit/d9f7856680769708dbef4dfa9c8d655ea6484424))
* **desktop:** report mpv's track picks before the file-loaded event ([a9de4ce](https://github.com/Viren070/AIOStreams/commit/a9de4ce2d00d529c01b654add95f9b746290ac7f)), closes [#1544](https://github.com/Viren070/AIOStreams/issues/1544)
* **desktop:** turn off WebKitGTK's Skia compositing and partial redraws on Linux ([#1534](https://github.com/Viren070/AIOStreams/issues/1534)) ([c8d6f8b](https://github.com/Viren070/AIOStreams/commit/c8d6f8b2743b5ad42383753ea9a48ce6d22e5790))
* **web:** draw card focus rings outside the picture ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** fill landscape cards from landscapePoster before the poster ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** keep a replaced artwork copy until it ages out ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** match track languages by the addon's language names ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** move focus through a scrolled box before leaving it ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** name the badge summary's plural counts ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** offer version fields only on servers that send them ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** open drawers below the desktop app's window buttons ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** play a version's own address rather than the stream route ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** return focus to a card after a dialog its menu opened ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** start Favourites on its first poster ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** start on Home after switching users or signing out ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** stop rejoining the last party when the app opens ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** tie the item backdrop's fade to the image that loaded ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** treat a dialog holding focus itself as nothing focused for key moves ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))
* **web:** write single watched counts as whole plural messages ([b9ce99e](https://github.com/Viren070/AIOStreams/commit/b9ce99e032ee9e8f17b853290ff30cb1c11434e6))

## [0.15.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.14.1...desktop-v0.15.0) (2026-10-14)


### Features

* **desktop:** add audio filters for dialogue boost, night mode and AC-3 encoding ([31c16c9](https://github.com/Viren070/AIOStreams/commit/31c16c95607aee1211dc92a98d974fba0a9cd935))
* **web:** add sound and output settings for the apps ([69023d4](https://github.com/Viren070/AIOStreams/commit/69023d45cb7b41c149214fdbde9e4be9c2d06765))
* **web:** honour "play the version's default track first" when re-picking audio ([69023d4](https://github.com/Viren070/AIOStreams/commit/69023d45cb7b41c149214fdbde9e4be9c2d06765))
* **web:** re-pick the audio track by the user's audio types ([69023d4](https://github.com/Viren070/AIOStreams/commit/69023d45cb7b41c149214fdbde9e4be9c2d06765))
* **web:** show the audio output and memory in ExoPlayer's stats ([69023d4](https://github.com/Viren070/AIOStreams/commit/69023d45cb7b41c149214fdbde9e4be9c2d06765))
* **web:** show the channel setting in the Android app ([69023d4](https://github.com/Viren070/AIOStreams/commit/69023d45cb7b41c149214fdbde9e4be9c2d06765))


### Bug Fixes

* **ui:** measure a slider's thumb as the whole slider for key navigation ([69023d4](https://github.com/Viren070/AIOStreams/commit/69023d45cb7b41c149214fdbde9e4be9c2d06765))
* **web:** compile dependencies to the build's browser targets ([69023d4](https://github.com/Viren070/AIOStreams/commit/69023d45cb7b41c149214fdbde9e4be9c2d06765))

## [0.14.1](https://github.com/Viren070/AIOStreams/compare/desktop-v0.14.0...desktop-v0.14.1) (2026-10-12)


### Bug Fixes

* **web:** hide pages kept beneath others with visibility as well ([4437cd1](https://github.com/Viren070/AIOStreams/commit/4437cd1996243d2aecc580ef0b7575ed3c2dbca8))

## [0.14.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.13.0...desktop-v0.14.0) (2026-10-12)


### Features

* **android:** pass surround audio through by what the output reports ([61c0515](https://github.com/Viren070/AIOStreams/commit/61c0515aec20cb853dd9d056fc633022578c2ea4))
* **jellyfin:** rank subtitle tracks by type ([61c0515](https://github.com/Viren070/AIOStreams/commit/61c0515aec20cb853dd9d056fc633022578c2ea4))
* **web:** add a Dolby Vision switch that plays the HDR10 picture instead ([e27353e](https://github.com/Viren070/AIOStreams/commit/e27353e9883eb8ff5ef62fa11e821bfbe30c489b))
* **web:** add a trailer player and a sheet of named trailers ([b1c84c1](https://github.com/Viren070/AIOStreams/commit/b1c84c17ab15cdd371e0dc1a29dacc3a0fee4714))
* **web:** add data-ui hooks to the parts that had none ([61c0515](https://github.com/Viren070/AIOStreams/commit/61c0515aec20cb853dd9d056fc633022578c2ea4))
* **web:** list only the user's subtitle languages in the subtitle menu ([61c0515](https://github.com/Viren070/AIOStreams/commit/61c0515aec20cb853dd9d056fc633022578c2ea4))
* **web:** reuse the server's kept version list in the player ([61c0515](https://github.com/Viren070/AIOStreams/commit/61c0515aec20cb853dd9d056fc633022578c2ea4))
* **web:** suggest titles from search hints while typing ([61c0515](https://github.com/Viren070/AIOStreams/commit/61c0515aec20cb853dd9d056fc633022578c2ea4))


### Bug Fixes

* **desktop:** read streams with curl again ([d877bd1](https://github.com/Viren070/AIOStreams/commit/d877bd10281ef95061fd3a633685d4b5beedbb2f))
* **desktop:** read streams with FFmpeg's reader and reconnect options ([3c4fff3](https://github.com/Viren070/AIOStreams/commit/3c4fff3ddd770cbde3a95c67dc7220bc7962c4d8))
* **web:** fill the player controls' focus with an inset shadow ([61c0515](https://github.com/Viren070/AIOStreams/commit/61c0515aec20cb853dd9d056fc633022578c2ea4))
* **web:** show an early end of file as a failure with a resume button ([61c0515](https://github.com/Viren070/AIOStreams/commit/61c0515aec20cb853dd9d056fc633022578c2ea4))
* **web:** stack keyed glides on layers again, easing held repeats in and out ([61c0515](https://github.com/Viren070/AIOStreams/commit/61c0515aec20cb853dd9d056fc633022578c2ea4))

## [0.13.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.12.1...desktop-v0.13.0) (2026-10-12)


### Features

* **android:** run voice search in the app ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** add an episode list to the player ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** ask who's watching when the app opens ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** crossfade the home hero's titles with a swipe ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** offer a ready update in a dialog on TVs ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** press a showing skip button on Select ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** show where a run of skips is headed on the seek bar ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** step through the TV hero's titles with Left and Right ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** toggle playback with Enter on the seek bar ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))


### Bug Fixes

* **web:** draw the watched mark on episode images on TVs ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** hold focus at a loading episode row ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** ignore player swipes from the top and bottom edges ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** keep presses that move the desktop window from the page ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** measure in-view targets on each scroll, without the glide's offset ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))


### Performance Improvements

* **web:** ask for a title before reading its saved copy ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** ask for the show's poster for a season that carries it ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** chase keyed jumps on one layer at an even speed ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** give the apps' build an empty page icon ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** hold an unfetched row's place with one placeholder ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** keep the layout and Home mounted under the player ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** measure in-view targets once a scroll settles ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** measure in-view targets once after a navigation ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** memoise the Home page kept under other pages ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** memoise the item header's toggles, overview, rating and links ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** memoise the season posters row ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** scroll rows natively on touch screens ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))
* **web:** step along a row's cards without measuring the others ([f609796](https://github.com/Viren070/AIOStreams/commit/f609796ac6a69fac863f86b500cf8def2e71c216))

## [0.12.1](https://github.com/Viren070/AIOStreams/compare/desktop-v0.12.0...desktop-v0.12.1) (2026-10-11)


### Bug Fixes

* send alang and slang lists to mpv as -append options ([fc10515](https://github.com/Viren070/AIOStreams/commit/fc10515af600dd9d667035830435bcd5d95d6823))
* **web:** drop a show's picked language from the rest of its list ([1ced0e6](https://github.com/Viren070/AIOStreams/commit/1ced0e68f43035e665db34bc00ef3c3f301a217b))

## [0.12.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.11.0...desktop-v0.12.0) (2026-10-10)


### Features

* **desktop:** download what the page hands over ([6e73d39](https://github.com/Viren070/AIOStreams/commit/6e73d390a4ae16073aceba9791b73ee64118770a))
* **desktop:** let the page play the files it downloaded ([744d386](https://github.com/Viren070/AIOStreams/commit/744d386bec92863d2c0ceb60c9bc2219bf641f62))
* **jellyfin-web:** add a Cache settings tab ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **jellyfin-web:** download movies, episodes and seasons ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **jellyfin-web:** hand downloads to the Jellyfin Android app ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **jellyfin-web:** play finished downloads from their files ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **jellyfin-web:** save pages and artwork on the device ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **jellyfin:** keep a user separate, on a sign-in address of their own ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **ui:** add a right-side sheet to the modal ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **ui:** leave a zero decimal off formatBytes ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** add a follow hero that keeps its artwork in the top corner ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** add a frame-rate matching setting on Android TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** add a solid navigation bar background and put navigation settings in one card ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** add a tooltip to the rating button ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** add a touch rail for wide touch screens ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** add a tunneled playback setting on Android TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** add a TV layout ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** add a voice search button on Android TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** add an Android app section to the settings ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** add an Automatic player engine and make it the default ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** add an only-on-Wi-Fi download setting for the Android app ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** add data-nav-exit focus boxes ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** add floating and corner side rails ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** add picture-in-picture and background playback settings for the Android app ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** allow the following hero on TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** blur liquid glass without its bend while it resizes ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** bring the page to its top for focus in the item header ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** choose the Android app's player engine ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** draw ExoPlayer's statistics over the player ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** drop copying stream links on TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** drop downloads on Android TV ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** drop the follow hero's buttons on TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** drop the Shortcuts settings tab on TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** drop the versions filter on TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** enter a focus group from outside at the start of its row ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** export the watch history through the Android app ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** fill focused list rows instead of outlining them ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** fit the sign-in pickers to a remote ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** float a TV's top bar over the page on glass ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** focus an item page's Play when keys open it ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** focus the first item on Select with nothing focused ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** give liquid glass a wider, stronger rim and edge highlights ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** give the Android and Android TV apps their own client names ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** glide keyed scrolls on a spring of our own ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** hear back from external players in the Android app ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** hide an episode's buttons on TVs and add Details to its menu ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** hide external links and skip the hero's dots on TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** hide scrollbars on TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** hide the player's controls on Back before leaving on a TV ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** keep a show's Play button in place while its next episode loads ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** keep subtitles above the player's controls while they show ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** land focus where it last was in rows, grids and lists ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** leave volume out of the player on TVs and touch screens ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** let a held key's action run until the key is let go ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** list versions in a drawer over the player and on short screens ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** list versions in a side sheet over the player ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** mark a focused settings tab on its sliding marker ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** mark webOS and Tizen as TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** offer the other engine on the Android app's error screen ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** open a TV's keyboard on Select rather than on focus ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** open a user's own address on their sign-in ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** play full screen in landscape in the Android app ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** play full screen on tablets in the app ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** put a TV's keyboard away on its own Enter ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** remove a recent search from its context menu ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** rework the player's controls ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** run a button's hold action on a held Select ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** say which picture fit the button picked ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** scroll to the top when the rotating hero takes focus ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** seek with a double tap and swipe for brightness and volume on touch ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** send Back into a TV's navigation from the pages it leads to ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** send the backdrop as now-playing artwork ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** show the display's HDR types and the Dolby Vision route in ExoPlayer's statistics ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** show the passthrough switch in the Android app ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** show the picture-in-picture setting only where the device has it ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** show the player's controls on Up and Down on TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** skip row headers and hide minor buttons on TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** slide a TV's top bar away while focus is in the following hero's rows ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** start Discover's focus on its first card ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** start the version picker on the first version for keys ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** take ordered audio and subtitle language lists ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** take the Android app's Back ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** thicken card focus rings on TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** toggle the player's controls with a tap ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** wrap focus across card grid rows ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))


### Bug Fixes

* **jellyfin-web:** keep the picked season in the item page's address ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **ui:** base the carousel arrows on the scroll position ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **ui:** focus a combobox's list when keys open it ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **ui:** ignore a loading button's presses instead of disabling it ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **ui:** keep a modal's overlay and content on their own layers ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **ui:** show a controlled Select's value again after a pick it didn't take ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **ui:** size a modal's column to its box rather than its widest text ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **ui:** transition a tab's colours rather than all its properties ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **ui:** update the Radix packages ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** bring a focused field into view when the Android app's keyboard opens ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** copy mpv's decoded frames back on TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** drop a page's focus spot only when the pointer leaves it ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** fade each hero backdrop in as a layer over the last ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** fade the backdrop's left edge in landscape ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** fade the item page's backdrop out at its bottom edge ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** fall back to the title when the hero's logo fails to load ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** fix TV focus around the rail, page starts, grids and rows ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** give focus back to what opened the version picker ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** go up or down to the nearest row when nothing is in line ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** hand a remote's Back in a list to the back action ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** hide the volume step on TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** jump rather than restart a smooth scroll that's still going ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** keep every arrow key on a TV ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** keep fading hero backdrops on their own layers ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** keep keyed scroll steps off the page behind a dialog ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** keep Left and Right on focus's own line ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** keep the page still for focus in a dialog or bar ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** keep the player's controls awake while keys move in them ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** keep the player's TV layout on TVs that report a touch pointer ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** leave row posters room only for the caption lines shown ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** list ExoPlayer before mpv in the player engine setting ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** make the next episode card opaque and lower it while the controls hide ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** mark a focused episode on its thumbnail in rows and its row in lists ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** measure an episode's title as its whole card for focus moves ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** measure focus moves from where scrolls under way end ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** move focus sideways into the nearest bar ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** narrow row cards to the height left under the following hero ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** press Enter in a field on a gamepad's A ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** retry rate-limited download version searches after Retry-After ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** reveal the outermost nav box and make rows nav boxes ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** rework the download rows for phones ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** ring a focused season poster inside its image ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** ring a focused version inside its card ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** ring focused menu items and options inside their edges ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** scroll a focused episode's whole card into view ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** scroll the player menu's list and footer together on short screens ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** set the item menu's width on phones and clamp where it opens ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** skip inert elements when returning focus to a page ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** skip rows scrolled out of their own scroller when moving focus ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** take a held key's quick presses as repeats ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** treat sticky bars like fixed ones in arrow navigation ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))


### Performance Improvements

* **jellyfin-web:** mount only the hero backdrops in use ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **jellyfin-web:** send an image Accept header with artwork fetches ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **ui:** glide a carousel to focus with a CSS transition ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** ask for a show's next episode, seasons and opening episodes as its page starts to draw ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** ask the Android app's mpv for direct MediaCodec decoding ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** check a row's end in a frame rather than in its effect ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** count saved bytes so a prune reads every entry only near the limit ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** draw a home library row's cards only once it nears the screen ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** draw a title's page from a loaded list's copy of it while it loads ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** draw only the cards near a long row's view ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** ease keyed page and hero row scrolls on the compositor on TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** fade card overlays rather than colouring them in ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** fade cards in with the Web Animations API ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** give focus transitions on cards the keyed glide's duration ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** hold placeholders still in rows not loading yet ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** keep React from listening for transition and animation events ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** keep saved artwork as Blobs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** keep the home page while others are open ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** keep the playhead out of the player's React state ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** leave the touch navigation bar out on TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** make form-less buttons submit buttons on Android ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** measure nearness by hand and keep link addresses in data-href on TVs ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** measure only cards near the screen when moving focus ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** open a settings tab once focus rests on it ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** open item menus without blocking the page ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** open the docked TV rail with a fade rather than a widening ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** pace a held key's repeats to the screen ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** pause the rotating hero while it is out of sight ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** put a submit button before the page's first control on Android ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** read fewer layouts when moving focus ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** save the small copies of shrunk artwork ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** scale artwork at rest and look for open dialogs only in portals ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** scale focused artwork in 200 ms ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** scroll TV rows natively with a compositor glide ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** share intersection observers between elements ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** share one item menu between all cards ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** show artwork as images kept in memory ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** shrink artwork in a pool of workers ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** start gamepad support in the Android app only with a controller attached ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))
* **web:** start the artwork workers with the page and make blob addresses in them ([b6ed7ae](https://github.com/Viren070/AIOStreams/commit/b6ed7ae15210c7fb356ec7ae3994fa3d5fded89f))

## [0.11.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.10.1...desktop-v0.11.0) (2026-10-06)


### Features

* **desktop:** add mpv's first http error to mpv-ended ([701eed8](https://github.com/Viren070/AIOStreams/commit/701eed82974c70802a2462b7f229fbd0a54a2bf5))
* **desktop:** load subtitle files the page sends ([eb4fc05](https://github.com/Viren070/AIOStreams/commit/eb4fc05792fffff7dc65359e41844d5ec754b0ef))
* **desktop:** start the user's own mpv and drive it over its IPC ([2aa49ee](https://github.com/Viren070/AIOStreams/commit/2aa49ee6efc2b98dec94cc7737af1b25b50dcb5e)), closes [#1425](https://github.com/Viren070/AIOStreams/issues/1425)
* **jellyfin-web:** add Android players to the player choice ([29be572](https://github.com/Viren070/AIOStreams/commit/29be572e18bcd96886c7016030840789e182f536))
* **jellyfin-web:** ask whether anyone is still watching before playing on ([29be572](https://github.com/Viren070/AIOStreams/commit/29be572e18bcd96886c7016030840789e182f536))
* **jellyfin-web:** block the webOS screensaver while the video plays ([29be572](https://github.com/Viren070/AIOStreams/commit/29be572e18bcd96886c7016030840789e182f536))
* **jellyfin-web:** hand the Android app's player the episodes that follow ([29be572](https://github.com/Viren070/AIOStreams/commit/29be572e18bcd96886c7016030840789e182f536))
* **jellyfin-web:** look up the next episode's versions before its prompt ([29be572](https://github.com/Viren070/AIOStreams/commit/29be572e18bcd96886c7016030840789e182f536))
* **jellyfin-web:** play through AVPlay on Samsung TVs ([29be572](https://github.com/Viren070/AIOStreams/commit/29be572e18bcd96886c7016030840789e182f536))
* **jellyfin-web:** redesign server picker ([29be572](https://github.com/Viren070/AIOStreams/commit/29be572e18bcd96886c7016030840789e182f536))
* **jellyfin-web:** refresh watch state on the server socket's pushes ([29be572](https://github.com/Viren070/AIOStreams/commit/29be572e18bcd96886c7016030840789e182f536))
* **jellyfin-web:** remember audio and subtitle picks per show ([29be572](https://github.com/Viren070/AIOStreams/commit/29be572e18bcd96886c7016030840789e182f536))
* **jellyfin-web:** show filler and recap marks and skip them when playing on ([29be572](https://github.com/Viren070/AIOStreams/commit/29be572e18bcd96886c7016030840789e182f536))
* **jellyfin-web:** switch audio tracks the video element lists ([29be572](https://github.com/Viren070/AIOStreams/commit/29be572e18bcd96886c7016030840789e182f536))


### Bug Fixes

* **jellyfin-web:** hold Play to list the versions of a resume ([29be572](https://github.com/Viren070/AIOStreams/commit/29be572e18bcd96886c7016030840789e182f536))

## [0.10.1](https://github.com/Viren070/AIOStreams/compare/desktop-v0.10.0...desktop-v0.10.1) (2026-10-03)


### Bug Fixes

* **desktop:** load a bundled vulkan-1.dll when Windows has none ([30ddeb0](https://github.com/Viren070/AIOStreams/commit/30ddeb0d8506179319bda82486ad8c2f9a672de9))
* **jellyfin-web:** avoid GamepadList array methods and AbortSignal.timeout ([4033c64](https://github.com/Viren070/AIOStreams/commit/4033c6482289f89c09d199a61931f748696738fd))
* **jellyfin-web:** keep the artwork crop inside the image ([4033c64](https://github.com/Viren070/AIOStreams/commit/4033c6482289f89c09d199a61931f748696738fd))

## [0.10.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.9.3...desktop-v0.10.0) (2026-10-02)


### Features

* **jellyfin-web:** change subtitle size and height from the player ([ed6981d](https://github.com/Viren070/AIOStreams/commit/ed6981d9e97601e1cdcb14c987c5b25874d95dc3))
* **jellyfin-web:** drop hold to play from rows ([ed6981d](https://github.com/Viren070/AIOStreams/commit/ed6981d9e97601e1cdcb14c987c5b25874d95dc3))
* **jellyfin-web:** guess intro and credits segments from chapter lengths ([ed6981d](https://github.com/Viren070/AIOStreams/commit/ed6981d9e97601e1cdcb14c987c5b25874d95dc3))
* **jellyfin-web:** play next up and resume items from their page ([ed6981d](https://github.com/Viren070/AIOStreams/commit/ed6981d9e97601e1cdcb14c987c5b25874d95dc3))
* **jellyfin-web:** pulse the episode a page opened on instead of ringing it ([ed6981d](https://github.com/Viren070/AIOStreams/commit/ed6981d9e97601e1cdcb14c987c5b25874d95dc3))
* **jellyfin-web:** request images at their drawn width times the pixel ratio ([ed6981d](https://github.com/Viren070/AIOStreams/commit/ed6981d9e97601e1cdcb14c987c5b25874d95dc3))
* **jellyfin-web:** resize card artwork to its device size in a worker ([ed6981d](https://github.com/Viren070/AIOStreams/commit/ed6981d9e97601e1cdcb14c987c5b25874d95dc3))
* **jellyfin-web:** restore keyboard focus on pages returned to ([ed6981d](https://github.com/Viren070/AIOStreams/commit/ed6981d9e97601e1cdcb14c987c5b25874d95dc3))
* **jellyfin-web:** rewrite shortcuts as remappable actions and add spatial navigation ([ed6981d](https://github.com/Viren070/AIOStreams/commit/ed6981d9e97601e1cdcb14c987c5b25874d95dc3))


### Bug Fixes

* **desktop:** enable wry's devtools feature ([6af4025](https://github.com/Viren070/AIOStreams/commit/6af402532c73dc0b1f10a68676bf7b6b55936a8a))
* **jellyfin-web:** leave genre-required libraries off home ([ed6981d](https://github.com/Viren070/AIOStreams/commit/ed6981d9e97601e1cdcb14c987c5b25874d95dc3))
* **jellyfin-web:** show one continue watching card per show ([ed6981d](https://github.com/Viren070/AIOStreams/commit/ed6981d9e97601e1cdcb14c987c5b25874d95dc3))

## [0.9.3](https://github.com/Viren070/AIOStreams/compare/desktop-v0.9.2...desktop-v0.9.3) (2026-10-01)


### Bug Fixes

* **desktop:** only look for Snap and Flatpak Discord sockets on Linux ([52a0a9f](https://github.com/Viren070/AIOStreams/commit/52a0a9f317f18243f240d858628405ab7e0966bc))

## [0.9.2](https://github.com/Viren070/AIOStreams/compare/desktop-v0.9.1...desktop-v0.9.2) (2026-10-01)


### Features

* **frontend:** open the desktop app from the install card ([e7ca6b2](https://github.com/Viren070/AIOStreams/commit/e7ca6b229332158683b593bab86a1219b55db34e))
* **jellyfin-web:** send skip actions to the Android app's player ([e7ca6b2](https://github.com/Viren070/AIOStreams/commit/e7ca6b229332158683b593bab86a1219b55db34e))

## [0.9.1](https://github.com/Viren070/AIOStreams/compare/desktop-v0.9.0...desktop-v0.9.1) (2026-09-30)


### Features

* **jellyfin-web:** show a message for no libraries ([2ba1032](https://github.com/Viren070/AIOStreams/commit/2ba10321059e9517363d9e6b6a20c8201087df50))

## [0.9.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.8.0...desktop-v0.9.0) (2026-09-30)


### Features

* **desktop:** drive the system's media controls from a shared now-playing state ([89f4671](https://github.com/Viren070/AIOStreams/commit/89f4671a7e376d2b688b3fa41dfbd31313b72902))
* flag libraries that need a genre ([85c2df2](https://github.com/Viren070/AIOStreams/commit/85c2df2fc6c02fcf84460a9263ed2cc6c6a0a3f0))
* **jellyfin-web:** add a subtitle height setting ([85c2df2](https://github.com/Viren070/AIOStreams/commit/85c2df2fc6c02fcf84460a9263ed2cc6c6a0a3f0))
* **jellyfin-web:** link the custom CSS guide from the theme settings ([85c2df2](https://github.com/Viren070/AIOStreams/commit/85c2df2fc6c02fcf84460a9263ed2cc6c6a0a3f0))
* **jellyfin-web:** link the source code and documentation from About ([85c2df2](https://github.com/Viren070/AIOStreams/commit/85c2df2fc6c02fcf84460a9263ed2cc6c6a0a3f0))
* **jellyfin-web:** rate movies, shows and seasons from their page ([85c2df2](https://github.com/Viren070/AIOStreams/commit/85c2df2fc6c02fcf84460a9263ed2cc6c6a0a3f0))
* **jellyfin-web:** replace the player's volume range with a bar that marks the boost ([85c2df2](https://github.com/Viren070/AIOStreams/commit/85c2df2fc6c02fcf84460a9263ed2cc6c6a0a3f0))
* **jellyfin-web:** send now-playing to the desktop app and set the browser's media session ([85c2df2](https://github.com/Viren070/AIOStreams/commit/85c2df2fc6c02fcf84460a9263ed2cc6c6a0a3f0))
* **jellyfin-web:** take the player's top volume from mpv's volume-max ([e99ce70](https://github.com/Viren070/AIOStreams/commit/e99ce707dd77d4810904ab2b687e89ddf283a036))


### Bug Fixes

* **desktop:** inhibit display sleep while a file plays on macOS and Linux ([d19594a](https://github.com/Viren070/AIOStreams/commit/d19594a6892f11110b1ea011176a469726a391f6))
* **jellyfin-web:** send None for featured catalogs that need a genre ([85c2df2](https://github.com/Viren070/AIOStreams/commit/85c2df2fc6c02fcf84460a9263ed2cc6c6a0a3f0))
* **jellyfin-web:** size and place browser subtitle cues ([85c2df2](https://github.com/Viren070/AIOStreams/commit/85c2df2fc6c02fcf84460a9263ed2cc6c6a0a3f0))

## [0.8.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.7.0...desktop-v0.8.0) (2026-09-29)


### Features

* **desktop:** add an aiostreams:// link scheme ([8f243fc](https://github.com/Viren070/AIOStreams/commit/8f243fc6bc1a3afd71d7f0e97ff0c9ae29105751))
* **jellyfin-web:** open aiostreams:// links ([72c70fe](https://github.com/Viren070/AIOStreams/commit/72c70fe37208b002e2de0b8d9df2efc2fedf877f))


### Bug Fixes

* **desktop:** don't scale disc subtitles, keep styled ones in the crop ([907867d](https://github.com/Viren070/AIOStreams/commit/907867d81bbd53b16b8bb9ebbf85905de2a124e7))
* **ui:** pan carousel rows with a trackpad or mouse wheel ([#1394](https://github.com/Viren070/AIOStreams/issues/1394)) ([72c70fe](https://github.com/Viren070/AIOStreams/commit/72c70fe37208b002e2de0b8d9df2efc2fedf877f))

## [0.7.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.6.0...desktop-v0.7.0) (2026-09-28)


### Features

* adjust jellyfin wording/install options, update docs, readme ([d461cd7](https://github.com/Viren070/AIOStreams/commit/d461cd76ef43c34f270d8a93a6f721f42071b528))
* **desktop:** add Discord events for browsing and a connection status ([eb193b4](https://github.com/Viren070/AIOStreams/commit/eb193b47ff45fe30604c3ed66b0829509ccc7cf5))


### Bug Fixes

* **desktop:** send the Discord logo by address ([39d447f](https://github.com/Viren070/AIOStreams/commit/39d447f390ce2db0f1d97cf56450477862a8351a))

## [0.6.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.5.0...desktop-v0.6.0) (2026-09-28)


### Features

* add a show on home modifier for catalogs that require a genre ([22fc51f](https://github.com/Viren070/AIOStreams/commit/22fc51fe02e21401a808a3e89517e21148bc32e7))
* **jellyfin-web:** add a per-segment skip setting ([22fc51f](https://github.com/Viren070/AIOStreams/commit/22fc51fe02e21401a808a3e89517e21148bc32e7))


### Bug Fixes

* **desktop:** create the window hidden on Windows and show it after the web view ([2955154](https://github.com/Viren070/AIOStreams/commit/2955154fa97209032bf945a6d7dc73ca905c1814))
* **ui:** declare the dark color scheme before the app loads ([22fc51f](https://github.com/Viren070/AIOStreams/commit/22fc51fe02e21401a808a3e89517e21148bc32e7))

## [0.5.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.4.0...desktop-v0.5.0) (2026-09-27)


### Features

* **desktop:** save and restore the window's size, position and maximized state ([589d069](https://github.com/Viren070/AIOStreams/commit/589d06935c9ccb630de795e461b6836dd20aec23))
* **jellyfin-web:** add hooks for custom CSS and an apply step ([70df21d](https://github.com/Viren070/AIOStreams/commit/70df21d9088b5cbf6840d3b77d8d4cf24c2c4d4a))


### Bug Fixes

* **jellyfin-web:** brighten the calendar's episode art ([70df21d](https://github.com/Viren070/AIOStreams/commit/70df21d9088b5cbf6840d3b77d8d4cf24c2c4d4a))
* **ui:** keep a modal open when a press closes a dialog above it ([70df21d](https://github.com/Viren070/AIOStreams/commit/70df21d9088b5cbf6840d3b77d8d4cf24c2c4d4a))

## [0.4.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.3.1...desktop-v0.4.0) (2026-09-27)


### Features

* **desktop:** show what plays as Discord rich presence ([36f5602](https://github.com/Viren070/AIOStreams/commit/36f5602591a16f14206c51634783b0e8b192ffed))
* **jellyfin-web:** add {filename} and {subtitles} to the external player link ([333b356](https://github.com/Viren070/AIOStreams/commit/333b3561df7026680d65c96ff41a89a371c85426))
* **jellyfin-web:** add {position} and {returnUrl} to the external player link ([333b356](https://github.com/Viren070/AIOStreams/commit/333b3561df7026680d65c96ff41a89a371c85426))
* **jellyfin-web:** add a calendar page ([333b356](https://github.com/Viren070/AIOStreams/commit/333b3561df7026680d65c96ff41a89a371c85426))
* **jellyfin-web:** add a donate button under the settings tabs ([333b356](https://github.com/Viren070/AIOStreams/commit/333b3561df7026680d65c96ff41a89a371c85426))
* **jellyfin-web:** add a favourites page ([333b356](https://github.com/Viren070/AIOStreams/commit/333b3561df7026680d65c96ff41a89a371c85426))
* **jellyfin-web:** add a setting to share what plays on Discord ([333b356](https://github.com/Viren070/AIOStreams/commit/333b3561df7026680d65c96ff41a89a371c85426))
* **jellyfin-web:** add a setting to skip the version list, with hold to do the other ([333b356](https://github.com/Viren070/AIOStreams/commit/333b3561df7026680d65c96ff41a89a371c85426))
* **jellyfin-web:** add back and forward buttons to the sidebar in apps ([333b356](https://github.com/Viren070/AIOStreams/commit/333b3561df7026680d65c96ff41a89a371c85426))
* **jellyfin-web:** keep the window buttons in full screen, with one to leave it ([333b356](https://github.com/Viren070/AIOStreams/commit/333b3561df7026680d65c96ff41a89a371c85426))
* **jellyfin-web:** move Activity and Calendar into the phone's account menu ([333b356](https://github.com/Viren070/AIOStreams/commit/333b3561df7026680d65c96ff41a89a371c85426))
* **jellyfin-web:** open the player full screen in landscape on phones ([333b356](https://github.com/Viren070/AIOStreams/commit/333b3561df7026680d65c96ff41a89a371c85426))


### Bug Fixes

* **jellyfin-web:** count an Intro chapter as the intro only when none is named the opening ([333b356](https://github.com/Viren070/AIOStreams/commit/333b3561df7026680d65c96ff41a89a371c85426))
* **jellyfin-web:** show any server's placeholder sources as notices ([333b356](https://github.com/Viren070/AIOStreams/commit/333b3561df7026680d65c96ff41a89a371c85426))
* **jellyfin-web:** slide pages in by top instead of a transform ([333b356](https://github.com/Viren070/AIOStreams/commit/333b3561df7026680d65c96ff41a89a371c85426))
* **jellyfin:** round every tick value to a whole number ([333b356](https://github.com/Viren070/AIOStreams/commit/333b3561df7026680d65c96ff41a89a371c85426))

## [0.3.1](https://github.com/Viren070/AIOStreams/compare/desktop-v0.3.0...desktop-v0.3.1) (2026-09-26)


### Bug Fixes

* **jellyfin-web:** credit the projects the app builds on under About ([acd8956](https://github.com/Viren070/AIOStreams/commit/acd8956f0b5f1bbcfface3109e8a594a163e200c))

## [0.3.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.2.0...desktop-v0.3.0) (2026-09-26)


### Features

* **jellyfin-web:** split search results into movie and show rows ([a9bf501](https://github.com/Viren070/AIOStreams/commit/a9bf501542add926bf8a6233893d98da025de75a))

## [0.2.0](https://github.com/Viren070/AIOStreams/compare/desktop-v0.1.0...desktop-v0.2.0) (2026-09-26)


### Features

* **desktop:** add a Windows shell with mpv under WebView2 ([d084d89](https://github.com/Viren070/AIOStreams/commit/d084d8984416a4c16b270b1b4e5799382006c637))
* **desktop:** add the app icon ([5794e44](https://github.com/Viren070/AIOStreams/commit/5794e4429d55686928e0e2ab167be267b4dc61aa))
* **desktop:** draw the window's title bar in the page ([be6bb14](https://github.com/Viren070/AIOStreams/commit/be6bb141633e4f6fca8f6ebe8ba5a39930eb6b15))
* **desktop:** fill the Flatpak's releases from the changelog ([7a20615](https://github.com/Viren070/AIOStreams/commit/7a2061517812652d4a049934274d13aefe31e29c))
* **desktop:** give the page the computer's name ([f8fb4aa](https://github.com/Viren070/AIOStreams/commit/f8fb4aace8e9c7a729768d64d58d0271bed36108))
* **desktop:** keep to one copy per data folder ([f053f6a](https://github.com/Viren070/AIOStreams/commit/f053f6a4ba5db6242ad566440742ae21743af6ce))
* **desktop:** let the page set playback options and read versions ([991e738](https://github.com/Viren070/AIOStreams/commit/991e738aa2f4e0c843fb1d42ef1fd619e85f7ee4))
* **desktop:** log the video's colour and what mpv sends the display ([72d3a2b](https://github.com/Viren070/AIOStreams/commit/72d3a2b34d6812df7aaa7459d3e6b23d1d5861ac))
* **desktop:** package the Linux app as a Flatpak ([0a1c8cd](https://github.com/Viren070/AIOStreams/commit/0a1c8cd76fde502da604f63701b6660ed6180836))
* **desktop:** pin libmpv and fetch it per architecture ([95d39f5](https://github.com/Viren070/AIOStreams/commit/95d39f5641d101403a13b99774cbe5ec47cc8871))
* **desktop:** put the app icon on a near-black tile ([ac900ae](https://github.com/Viren070/AIOStreams/commit/ac900ae994d10e7a8c38a74b588d60295747adbe))
* **desktop:** release the desktop app when its web app changes ([36fc7ff](https://github.com/Viren070/AIOStreams/commit/36fc7ff80839b23073c91560032b4c046fe6a45b))
* **desktop:** round the window's corners on Linux ([d85c442](https://github.com/Viren070/AIOStreams/commit/d85c4427085c971ef1d4cde83ed915ac87336694))
* **desktop:** run on Linux ([59af946](https://github.com/Viren070/AIOStreams/commit/59af946fc88e669ef4065c5656af3a2b686f524c))
* **desktop:** run on macOS ([fae9f8d](https://github.com/Viren070/AIOStreams/commit/fae9f8df8ea3339f361502e6c5b540ef75aa063e))
* **desktop:** send the page mpv's chapter list ([226406d](https://github.com/Viren070/AIOStreams/commit/226406daf2761183d4acf6742c8786e8bd0fcf6f))
* **desktop:** serve the standalone web app ([bde9066](https://github.com/Viren070/AIOStreams/commit/bde9066a2cf2a4ed8fa31956cdbc458eccd33a51))
* **desktop:** show mpv's statistics overlay from the player ([9b7c4a8](https://github.com/Viren070/AIOStreams/commit/9b7c4a819914750452de16e0d530a30d8c32e684))
* **desktop:** turn on the render API's advanced control on Linux ([e4405d3](https://github.com/Viren070/AIOStreams/commit/e4405d31422cb9d0f08967039e4d453b20dd808e))
* **desktop:** turn on the render API's advanced control on macOS ([dc8730e](https://github.com/Viren070/AIOStreams/commit/dc8730e3451d248a73d308eda5b89c78838e4c62))
* **desktop:** update from the release feeds with Velopack ([9cb23af](https://github.com/Viren070/AIOStreams/commit/9cb23af23b19d519e86b6296e4ec48198bd7fb9a))
* **desktop:** write a daily log file ([ff592c5](https://github.com/Viren070/AIOStreams/commit/ff592c53638e4ed996c640c15d7968614442cd80))
* **jellyfin-web:** fit, crop or stretch the picture ([df8838f](https://github.com/Viren070/AIOStreams/commit/df8838f29182b5a03e50ee134c1aea38bd8db6a1))
* **jellyfin-web:** offer the next episode near the end ([75342eb](https://github.com/Viren070/AIOStreams/commit/75342eb5b749fff7ef44c5183368c51608e5c029))
* show the server's build in About and diagnostics ([c08e496](https://github.com/Viren070/AIOStreams/commit/c08e49601204640b5c870cec8c18b6e250d79c71))


### Bug Fixes

* **desktop:** fetch uchardet for the Flatpak with git ([00a3a27](https://github.com/Viren070/AIOStreams/commit/00a3a27983c715597e9d83b218dcf2c838a36ccf))
* **desktop:** focus the page when the window is focused ([1ec00cc](https://github.com/Viren070/AIOStreams/commit/1ec00ccb117feeacbaf58048ec3a2000f433570a))
* **desktop:** follow the mouse's back and forward buttons on Linux ([38afea5](https://github.com/Viren070/AIOStreams/commit/38afea547dc4582aeb8d367a7cba1027227124cb))
* **desktop:** give the Linux window the app's own id ([c3d495c](https://github.com/Viren070/AIOStreams/commit/c3d495cf7d24d0b5fa3f122ab9682d74a15e5f23))
* **desktop:** go fullscreen from a maximized window on Windows ([521616f](https://github.com/Viren070/AIOStreams/commit/521616f857be99c1e18feca92997f6f2e65bf1e6))
* **desktop:** log the OpenGL context the Linux video draws with ([2fe90a2](https://github.com/Viren070/AIOStreams/commit/2fe90a2c90fc7521202450a0957fe6bf1f294437))
* **desktop:** redraw the Linux video area when playback stops ([89d8d69](https://github.com/Viren070/AIOStreams/commit/89d8d69553495307a57df8240c2767efd574b41c))
* **desktop:** skip mpv's frames on macOS while the window can't show them ([cf497d6](https://github.com/Viren070/AIOStreams/commit/cf497d6e77dd525f10cfc0c15ce0111d3c5d16eb))
* **desktop:** start mpv on Linux under any locale ([94d5063](https://github.com/Viren070/AIOStreams/commit/94d506389c95f616ef67daeffb6ae3ebb1f74e81))


### Performance Improvements

* **desktop:** draw Linux video frames when due instead of in mpv's wait ([bb8539a](https://github.com/Viren070/AIOStreams/commit/bb8539a93d5e771bb0428bdf7b9ae211f45da358))
* **desktop:** make the page's mpv calls on a thread of their own ([2e5db88](https://github.com/Viren070/AIOStreams/commit/2e5db88fa1e82aef436e4e991f55fa7b1ba0fcbf))
* **desktop:** stop macOS video draws waiting on the main thread ([d3b9f0a](https://github.com/Viren070/AIOStreams/commit/d3b9f0a56859dbfdf1912dee8168e078619d698f))
