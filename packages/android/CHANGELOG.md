# Changelog

## [0.10.0](https://github.com/Viren070/AIOStreams/compare/android-v0.9.0...android-v0.10.0) (2026-10-23)


### Features

* **android:** choose the storage downloads go to ([9ababea](https://github.com/Viren070/AIOStreams/commit/9ababea0f9c58fca25d4aab1c109605839d43b6d))
* **android:** replace a loaded server subtitle when it is added again ([2db364d](https://github.com/Viren070/AIOStreams/commit/2db364dc343c3cb75c2b4d43902b32302a5dd43e))
* **web:** add playlists ([13da70a](https://github.com/Viren070/AIOStreams/commit/13da70ae1fce77893f33d282c6e28538431be46b))
* **web:** clear the launched player's queue when nothing plays next ([13da70a](https://github.com/Viren070/AIOStreams/commit/13da70ae1fce77893f33d282c6e28538431be46b))
* **web:** connect to a config's server from its manifest URL ([13da70a](https://github.com/Viren070/AIOStreams/commit/13da70ae1fce77893f33d282c6e28538431be46b))
* **web:** fetch a server subtitle again each time it is picked ([13da70a](https://github.com/Viren070/AIOStreams/commit/13da70ae1fce77893f33d282c6e28538431be46b))
* **web:** offer the Android app's download folder choice ([13da70a](https://github.com/Viren070/AIOStreams/commit/13da70ae1fce77893f33d282c6e28538431be46b))
* **web:** show the seek-bar picture for arrow-key seeks only on TVs ([13da70a](https://github.com/Viren070/AIOStreams/commit/13da70ae1fce77893f33d282c6e28538431be46b))
* **web:** take a party's next titles from its queue ([13da70a](https://github.com/Viren070/AIOStreams/commit/13da70ae1fce77893f33d282c6e28538431be46b))


### Bug Fixes

* **web:** close the open player menu when another opens ([13da70a](https://github.com/Viren070/AIOStreams/commit/13da70ae1fce77893f33d282c6e28538431be46b))
* **web:** give the About page's Credits title its own context ([13da70a](https://github.com/Viren070/AIOStreams/commit/13da70ae1fce77893f33d282c6e28538431be46b))
* **web:** hold a skip's seek-bar picture for a second ([13da70a](https://github.com/Viren070/AIOStreams/commit/13da70ae1fce77893f33d282c6e28538431be46b))
* **web:** memoise the playback info query helpers ([13da70a](https://github.com/Viren070/AIOStreams/commit/13da70ae1fce77893f33d282c6e28538431be46b))
* **web:** read buffered ranges from one snapshot ([13da70a](https://github.com/Viren070/AIOStreams/commit/13da70ae1fce77893f33d282c6e28538431be46b))
* **web:** remember the subtitle type picked for a show ([13da70a](https://github.com/Viren070/AIOStreams/commit/13da70ae1fce77893f33d282c6e28538431be46b))
* **web:** return nothing from the calendar agenda's scroll ([13da70a](https://github.com/Viren070/AIOStreams/commit/13da70ae1fce77893f33d282c6e28538431be46b))
* **web:** reword the audio help for remembering picks per show ([13da70a](https://github.com/Viren070/AIOStreams/commit/13da70ae1fce77893f33d282c6e28538431be46b))

## [0.9.0](https://github.com/Viren070/AIOStreams/compare/android-v0.8.0...android-v0.9.0) (2026-10-22)


### Features

* **android:** add a watch-next message that fills the TV's Watch Next row ([2cc0a3e](https://github.com/Viren070/AIOStreams/commit/2cc0a3edfc36e288aa0accb2e736681c30ea261d))
* **android:** add cacheBehindMs to Exo stats ([ca0af6e](https://github.com/Viren070/AIOStreams/commit/ca0af6e1c15cb75f79466cb737103cdf26fd7584))
* **android:** report buffered time ranges in player-state ([a5879cf](https://github.com/Viren070/AIOStreams/commit/a5879cf75bd6385aafabdd9fa19ef8171dfbf334))
* **web:** add a random pick for a show's episodes and your favourites ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** add a setting for the reactions sent in a party ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** add a time-left toggle and an end time above the player's seek bar ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** allow a negative subtitle height ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** ask for a second Back before leaving the Android app from Home ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** draw each buffered range on the seek bar ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** leave the thumbnail out of double-tap seek previews ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** put the profile first in the TV rail and corner menu ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** reorder the player's option buttons by purpose ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** select tabs as a remote or keyboard moves onto them ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** send continue watching to the Android TV app's Watch Next row ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** send X-AIOStreams-* headers to servers listing clientHints ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** show cover immediately on auto play first ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** show party reactions beside the open party sheet ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** show the cache size setting in the desktop app ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** show the cache's time behind in Exo stats ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** sort the merged Continue watching row by watch time ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))


### Bug Fixes

* **android:** evict past the next landing when the stream cache is full ([7af178c](https://github.com/Viren070/AIOStreams/commit/7af178c473c2ba5b3f05315144ae494435966e26))
* **android:** pad ExoPlayer text subtitles by mpv's bottom margin ([d0bda72](https://github.com/Viren070/AIOStreams/commit/d0bda7269f58f8e4f54c7ef60e3fb4a109f7bbef))
* **web:** abort item and image fetches nothing waits on ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** dont gate party settings on party feature ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** drop the focus ring from body and #root ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** focus the custom CSS toast's Keep when applied from keys ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** keep the TV rail's fading layers composited with will-change ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** move along the player menu's stepper rows with left and right ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** paint the page's scrollbar in the page colour ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** send a pending settings save before reading them back ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** send a segment already skipped as offered ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** size the shut TV rail's buttons to its icons ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** skip the navigation when a key press starts focus on a page ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** take Back in the profile PIN prompt ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))


### Performance Improvements

* **android:** skip empty and fill opaque blocks when blending subtitles ([413f9e5](https://github.com/Viren070/AIOStreams/commit/413f9e5b82cd532be88313e869be541a157df61c))
* **android:** update libmpv for the libass patches ([454e8b4](https://github.com/Viren070/AIOStreams/commit/454e8b43c82ccbd2564e6a2dd6aed20d1d893c45))
* **web:** fade cards and artwork in only when on screen ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** find glide layers among a box's children ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))
* **web:** save a query's answer once it stops changing ([136876d](https://github.com/Viren070/AIOStreams/commit/136876dfdcd963f8780d8374a57f53a35401e97c))

## [0.8.0](https://github.com/Viren070/AIOStreams/compare/android-v0.7.0...android-v0.8.0) (2026-10-20)


### Features

* **android:** add the exception's message to an unexpected ExoPlayer error ([7afb135](https://github.com/Viren070/AIOStreams/commit/7afb135fff0d67216d88006ee30b4db504f48a64))
* **android:** answer player-subtitle-index with every own subtitle's lines ([e5592d2](https://github.com/Viren070/AIOStreams/commit/e5592d2c8ffc96a0ac62c83ce97558831b9d943f))
* **android:** build packages/native into a natives module with cargo-ndk ([3494f9d](https://github.com/Viren070/AIOStreams/commit/3494f9daba7b80f827733c96102455c9595cf55a))
* **android:** make seek-bar thumbnails for player-thumbnail requests ([bd6663c](https://github.com/Viren070/AIOStreams/commit/bd6663c3b43b5eb6252b764685c86de62e1a04a9))
* **android:** read picture subtitles' lines from the index alone ([ad34e94](https://github.com/Viren070/AIOStreams/commit/ad34e9419845a7f01998cdbc9c85f6bf22445955))
* **android:** report a file's own subtitle lines to the page ([6c1abd7](https://github.com/Viren070/AIOStreams/commit/6c1abd7cc727fde90287daa7f534fe860ab884cc))
* **android:** report whether the sound passes through ([d4992c1](https://github.com/Viren070/AIOStreams/commit/d4992c145c0af533e538560593699fb7546383aa))
* **android:** send the reference subtitle's lines from the file's index ([8f911ea](https://github.com/Viren070/AIOStreams/commit/8f911ea44a4411111cd4fde9b9ef2bd85c0fc5f0))
* **desktop:** play HDR on macOS with a choice of video output ([#1563](https://github.com/Viren070/AIOStreams/issues/1563)) ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **ui:** let a carousel keep a focused slide where the first one starts ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** add CSS hooks to party members, messages and the player cover ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** add data-favourite and data-type to poster cards ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** add tooltips to the player buttons and the show download menu ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** give subtitle timing, subtitle style and sound their own menu pages ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** keep key focus at a row's start ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** line added subtitles up with the file's own subtitles ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** match added subtitles against a PGS track when a file has no text one ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** offer favourite only on movies and shows ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** open titles from aiostreams:// item and play links ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** play titles on and control other devices ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** raise the player controls' idle delay to 5 seconds ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** scroll the calendar agenda to today on a new visit ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** send and show avatars in watch parties ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** settle unsure subtitle syncs on when lines start and end ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** show a retimed copy of subtitles made for another frame rate ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** show keyframe thumbnails over the seek bar ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** show notices at their index among the versions ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** skip a file's own subtitle its other subtitles don't back ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** skip row titles and the hero's dots in arrow navigation everywhere ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** take remote commands from the session socket ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** title a report of a page restart as one ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))


### Bug Fixes

* **android:** keep the thumbnail listener that the Rust side calls over JNI ([dc970e4](https://github.com/Viren070/AIOStreams/commit/dc970e40cca4304ab95e83298fd560ca6c28ab94))
* **android:** recreate the page when its renderer ends ([84c2d58](https://github.com/Viren070/AIOStreams/commit/84c2d580f7c5ed1489486d759dfad9b35f44b0b0))
* **android:** set only the subtitle style properties that changed ([65ea3ce](https://github.com/Viren070/AIOStreams/commit/65ea3ce59248bb1d63e5b35f0fd47ce37da698b5))
* **web:** change party playback speed only for a drift that lasts ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** check downloads before finding the next episode's version ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** enter a row lying between focus and the card in line with it ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** keep a skip's seek-bar thumbnail up after the skip lands ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** leave room for the focus ring in desktop rows ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** let up and down leave a text box from its first and last line ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** open the version list with nothing focused on touch screens ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** paint the Android app's root in the page colour outside the player ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))
* **web:** take a party player's position from its soonest report ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))


### Performance Improvements

* **android:** update libmpv for its HEVC decoding patches ([6d68a9d](https://github.com/Viren070/AIOStreams/commit/6d68a9d08f6cdded17bf2b925bf6fca88a836840))
* **web:** reuse the subtitle matcher's curves ([dbaf7b3](https://github.com/Viren070/AIOStreams/commit/dbaf7b3156a51d0e1e9885475d1a5ff586d63f03))

## [0.7.0](https://github.com/Viren070/AIOStreams/compare/android-v0.6.0...android-v0.7.0) (2026-10-18)


### Features

* **web:** add a people row to search ([ae832fc](https://github.com/Viren070/AIOStreams/commit/ae832fc21c052a451b51f7af94f9ec3b895f70b3))


### Bug Fixes

* **android:** always report the exit reason with Android's description ([e65aeb0](https://github.com/Viren070/AIOStreams/commit/e65aeb0f27b284dfc5d3a7398e82400cf859dccd))
* **android:** share the stream cache's connection closer instead of shutting it down ([411b7f0](https://github.com/Viren070/AIOStreams/commit/411b7f03b1e4988f968002c0866644aac494b5e5))
* **web:** accept a slash after the host in party app links ([ae832fc](https://github.com/Viren070/AIOStreams/commit/ae832fc21c052a451b51f7af94f9ec3b895f70b3))
* **web:** pick the following hero's card on pointer moves, not enters ([ae832fc](https://github.com/Viren070/AIOStreams/commit/ae832fc21c052a451b51f7af94f9ec3b895f70b3))

## [0.6.0](https://github.com/Viren070/AIOStreams/compare/android-v0.5.0...android-v0.6.0) (2026-10-18)


### Features

* **android:** cache the playing stream in native memory for ExoPlayer ([ae6fa0e](https://github.com/Viren070/AIOStreams/commit/ae6fa0ef6b9f22abdcaeb0b425d30686488a12ce))
* **android:** move the app's own words into string resources ([9904f5b](https://github.com/Viren070/AIOStreams/commit/9904f5b566c446fdaf578cd727acb1e976693d7a))
* **android:** record how the last run ended ([54ef5e0](https://github.com/Viren070/AIOStreams/commit/54ef5e0d44a8031aaeb6835a3e85ed59ce5ad70c))
* **android:** report web fields to the keyboard as native fields on TV ([045c536](https://github.com/Viren070/AIOStreams/commit/045c536a550295c668d3523b86f58df9d2102f75))
* **android:** send a download file's headers with every request ([42a5ffa](https://github.com/Viren070/AIOStreams/commit/42a5ffa37c73ebcafced07d7c5fcf7681795aab1))
* **android:** send a loadfile's headers from both engines ([307e63f](https://github.com/Viren070/AIOStreams/commit/307e63f204a91ad67ec8e6e8e71d86e0aa0904f8))
* **android:** set the subtitle font and shadow from player-style ([7e59389](https://github.com/Viren070/AIOStreams/commit/7e59389c2ba2fd0c0765760683fca813f881eb58))
* **android:** skip unreferenced frames and early Opus and Vorbis audio on seeks ([8fc59bd](https://github.com/Viren070/AIOStreams/commit/8fc59bdaaad30b11c072d26a307f480894661b1d))
* **ui:** add a replaceable table of the kit's own words ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **ui:** add swatches and an optional picker to the colour input ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **ui:** mark a drawer's side ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **ui:** ring the whole row of a right-side switch when focused ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **ui:** support right-to-left layouts ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **ui:** write sizes in a chosen locale ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** add a cache size setting ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** add quick filters and badges to the version list ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** add subtitle font and shadow settings ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** add translations with Lingui and a language setting ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** add watch parties ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** apply the server's CSS under the user's own ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** cover the player until its first frame ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** keep a user with a PIN unlocked until they switch away ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** keep the app language per user ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** keep the subtitle look on the user's account ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** offer colour swatches, without the picker on TVs ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** open the user switcher from the avatar ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** pass a version's required headers to app downloads ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** play a card's animatedPoster while it is hovered or focused ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** play trailers with the user's track preferences ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** play versions that need headers or YouTube in the app's player ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** send a report from troubleshooting or after a crash ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** send the party offset when it changes ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** send the player the segments it skips ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** show home's Activity and Calendar buttons only with the bottom bar ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** suggest aiostreams.viren070.me's relay to servers without party info ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** support right-to-left layouts ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** wrap every message in Lingui ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))


### Bug Fixes

* **android:** decode DTS with FFmpeg rather than the device's decoders ([59a0a02](https://github.com/Viren070/AIOStreams/commit/59a0a02a0ac299200a90b7133e5351bc0d0eb699))
* **android:** report a new ExoPlayer as paused ([604c661](https://github.com/Viren070/AIOStreams/commit/604c6612ec2235174872fe758a02c6abb6144761))
* **android:** report mpv's track picks before the loaded event ([40f96ce](https://github.com/Viren070/AIOStreams/commit/40f96cef74414bde41ca4265ccb7d6be6d2b5015))
* **android:** trust the ISRG roots on devices whose store predates them ([#1526](https://github.com/Viren070/AIOStreams/issues/1526)) ([79bdff7](https://github.com/Viren070/AIOStreams/commit/79bdff793b3eaefed648078331212761dc1ae548))
* **android:** unset WebVTT's automatic line so cues follow the bottom padding ([aa73a5e](https://github.com/Viren070/AIOStreams/commit/aa73a5e6f81bc460ccb9fea89a2358bd08be8f8d))
* **web:** draw card focus rings outside the picture ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** fill landscape cards from landscapePoster before the poster ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** keep a replaced artwork copy until it ages out ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** match track languages by the addon's language names ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** move focus through a scrolled box before leaving it ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** name the badge summary's plural counts ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** offer version fields only on servers that send them ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** open drawers below the desktop app's window buttons ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** play a version's own address rather than the stream route ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** return focus to a card after a dialog its menu opened ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** start Favourites on its first poster ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** start on Home after switching users or signing out ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** stop rejoining the last party when the app opens ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** tie the item backdrop's fade to the image that loaded ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** treat a dialog holding focus itself as nothing focused for key moves ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))
* **web:** write single watched counts as whole plural messages ([58a189c](https://github.com/Viren070/AIOStreams/commit/58a189c237109cbb6dd77eac788b6eb0d544a1fa))


### Performance Improvements

* **android:** cut subtitle memory during playback ([6c3b60a](https://github.com/Viren070/AIOStreams/commit/6c3b60a04b47fb76b291a8832344142600dee3fa))
* **android:** shrink Media3's buffer while the stream cache reads ahead ([dd31172](https://github.com/Viren070/AIOStreams/commit/dd31172d88abee0d4f4e17927eb8328bd68cd921))

## [0.5.0](https://github.com/Viren070/AIOStreams/compare/android-v0.4.1...android-v0.5.0) (2026-10-14)


### Features

* **android:** add dialogue boost, night mode, audio delay and AC-3 encoding ([1f86c38](https://github.com/Viren070/AIOStreams/commit/1f86c384b7f7f1a8a5da6e08a396f55bf8e90b8c)), closes [#1504](https://github.com/Viren070/AIOStreams/issues/1504)
* **android:** mix ExoPlayer's sound down to the channel setting ([d2d403a](https://github.com/Viren070/AIOStreams/commit/d2d403ae83aaa9fdadd205ba4d6ad85e092d69df))
* **android:** report ExoPlayer's audio description tracks ([7cc4044](https://github.com/Viren070/AIOStreams/commit/7cc4044c166a13747a5ec387db0ae36a09e227c8))
* **android:** report ExoPlayer's audio output and memory in its stats ([8065692](https://github.com/Viren070/AIOStreams/commit/80656922b60f344ab4ab0a4c12fdab5d25626696))
* **web:** add sound and output settings for the apps ([59ce8ca](https://github.com/Viren070/AIOStreams/commit/59ce8cad61f354c6b626871829184c54345c9d9c))
* **web:** honour "play the version's default track first" when re-picking audio ([59ce8ca](https://github.com/Viren070/AIOStreams/commit/59ce8cad61f354c6b626871829184c54345c9d9c))
* **web:** re-pick the audio track by the user's audio types ([59ce8ca](https://github.com/Viren070/AIOStreams/commit/59ce8cad61f354c6b626871829184c54345c9d9c))
* **web:** show the audio output and memory in ExoPlayer's stats ([59ce8ca](https://github.com/Viren070/AIOStreams/commit/59ce8cad61f354c6b626871829184c54345c9d9c))
* **web:** show the channel setting in the Android app ([59ce8ca](https://github.com/Viren070/AIOStreams/commit/59ce8cad61f354c6b626871829184c54345c9d9c))


### Bug Fixes

* **android:** decode the sound the device can't with libmpv's FFmpeg ([b6b78f4](https://github.com/Viren070/AIOStreams/commit/b6b78f4115b8799913176109206a46683184a959))
* **android:** parse ExoPlayer's file subtitles only as a shown track reaches them ([8ec4679](https://github.com/Viren070/AIOStreams/commit/8ec4679efa1566319df8626072aecb44d717be00))
* **ui:** measure a slider's thumb as the whole slider for key navigation ([59ce8ca](https://github.com/Viren070/AIOStreams/commit/59ce8cad61f354c6b626871829184c54345c9d9c))
* **web:** compile dependencies to the build's browser targets ([59ce8ca](https://github.com/Viren070/AIOStreams/commit/59ce8cad61f354c6b626871829184c54345c9d9c))
* **web:** hide pages kept beneath others with visibility as well ([59ce8ca](https://github.com/Viren070/AIOStreams/commit/59ce8cad61f354c6b626871829184c54345c9d9c))

## [0.4.1](https://github.com/Viren070/AIOStreams/compare/android-v0.4.0...android-v0.4.1) (2026-10-12)


### Bug Fixes

* **android:** install updates with an automatic install location ([d1e4c80](https://github.com/Viren070/AIOStreams/commit/d1e4c80215b228cc4594a6338de3fb673d8b460c))

## [0.4.0](https://github.com/Viren070/AIOStreams/compare/android-v0.3.0...android-v0.4.0) (2026-10-12)


### Features

* **android:** pass surround audio through by what the output reports ([6cc6828](https://github.com/Viren070/AIOStreams/commit/6cc6828e1afeb49773bf7244445d241e8340085a))
* **jellyfin:** rank subtitle tracks by type ([d37af67](https://github.com/Viren070/AIOStreams/commit/d37af67e46ce9b8180250a19ce92bf4c61863e6f)), closes [#1485](https://github.com/Viren070/AIOStreams/issues/1485)
* **web:** add a Dolby Vision switch that plays the HDR10 picture instead ([e27353e](https://github.com/Viren070/AIOStreams/commit/e27353e9883eb8ff5ef62fa11e821bfbe30c489b))
* **web:** add a trailer player and a sheet of named trailers ([b1c84c1](https://github.com/Viren070/AIOStreams/commit/b1c84c17ab15cdd371e0dc1a29dacc3a0fee4714))
* **web:** add data-ui hooks to the parts that had none ([5143370](https://github.com/Viren070/AIOStreams/commit/5143370f6b8b0c24be3603d538a0b2e89bbe921e))
* **web:** list only the user's subtitle languages in the subtitle menu ([5143370](https://github.com/Viren070/AIOStreams/commit/5143370f6b8b0c24be3603d538a0b2e89bbe921e))
* **web:** reuse the server's kept version list in the player ([5143370](https://github.com/Viren070/AIOStreams/commit/5143370f6b8b0c24be3603d538a0b2e89bbe921e))
* **web:** suggest titles from search hints while typing ([9f36d38](https://github.com/Viren070/AIOStreams/commit/9f36d38c4ceb92309834c647ec979ddab9748367)), closes [#1491](https://github.com/Viren070/AIOStreams/issues/1491)


### Bug Fixes

* **web:** fill the player controls' focus with an inset shadow ([5143370](https://github.com/Viren070/AIOStreams/commit/5143370f6b8b0c24be3603d538a0b2e89bbe921e))
* **web:** show an early end of file as a failure with a resume button ([5143370](https://github.com/Viren070/AIOStreams/commit/5143370f6b8b0c24be3603d538a0b2e89bbe921e))
* **web:** stack keyed glides on layers again, easing held repeats in and out ([5143370](https://github.com/Viren070/AIOStreams/commit/5143370f6b8b0c24be3603d538a0b2e89bbe921e))

## [0.3.0](https://github.com/Viren070/AIOStreams/compare/android-v0.2.1...android-v0.3.0) (2026-10-12)


### Features

* **android:** ask for notifications before installing an update ([bbb97a3](https://github.com/Viren070/AIOStreams/commit/bbb97a3e74460651e54eacee6cc1d8bfcf0c556d))
* **android:** run voice search in the app ([cf0939c](https://github.com/Viren070/AIOStreams/commit/cf0939ca54d3c5946c92dc0ec593940aaa591ad8))
* **web:** add an episode list to the player ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** ask who's watching when the app opens ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** crossfade the home hero's titles with a swipe ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** offer a ready update in a dialog on TVs ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** press a showing skip button on Select ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** show where a run of skips is headed on the seek bar ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** step through the TV hero's titles with Left and Right ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** toggle playback with Enter on the seek bar ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))


### Bug Fixes

* **android:** keep the system bars in their dark style ([de0f134](https://github.com/Viren070/AIOStreams/commit/de0f134a5390b8e59a01f9e512410285804311f3))
* **web:** draw the watched mark on episode images on TVs ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** hold focus at a loading episode row ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** ignore player swipes from the top and bottom edges ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** keep presses that move the desktop window from the page ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** measure in-view targets on each scroll, without the glide's offset ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))


### Performance Improvements

* **web:** ask for a title before reading its saved copy ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** ask for the show's poster for a season that carries it ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** chase keyed jumps on one layer at an even speed ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** give the apps' build an empty page icon ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** hold an unfetched row's place with one placeholder ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** keep the layout and Home mounted under the player ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** measure in-view targets once a scroll settles ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** measure in-view targets once after a navigation ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** memoise the Home page kept under other pages ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** memoise the item header's toggles, overview, rating and links ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** memoise the season posters row ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** scroll rows natively on touch screens ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))
* **web:** step along a row's cards without measuring the others ([29b5335](https://github.com/Viren070/AIOStreams/commit/29b533521744a1c88bdcf969d39e33a82df83633))

## [0.2.1](https://github.com/Viren070/AIOStreams/compare/android-v0.2.0...android-v0.2.1) (2026-10-11)


### Bug Fixes

* send alang and slang lists to mpv as -append options ([fc10515](https://github.com/Viren070/AIOStreams/commit/fc10515af600dd9d667035830435bcd5d95d6823))
* **web:** drop a show's picked language from the rest of its list ([2b81254](https://github.com/Viren070/AIOStreams/commit/2b8125435d1483f8eccbe68918dd10f836610ba8))

## [0.2.0](https://github.com/Viren070/AIOStreams/compare/android-v0.1.0...android-v0.2.0) (2026-10-10)


### Features

* **android:** add a download queue in a foreground service ([d9ee314](https://github.com/Viren070/AIOStreams/commit/d9ee314ca77b15a41e60aeed76e594dcc3bdc127))
* **android:** add a media session with picture-in-picture and audio focus ([9e64db8](https://github.com/Viren070/AIOStreams/commit/9e64db82e8eb04c7b91cd838874711f74db38319))
* **android:** add an Android TV launcher entry and banner ([9c945d1](https://github.com/Viren070/AIOStreams/commit/9c945d104f1424fee1dcc51d60da2b2972c618c6))
* **android:** add an ExoPlayer engine ([764da86](https://github.com/Viren070/AIOStreams/commit/764da86a4b82d5ace8caa42490a57122700f90bc))
* **android:** add the Android app ([2132721](https://github.com/Viren070/AIOStreams/commit/21327210619cdbb5c3f7fe3b35fc958341e30ac3))
* **android:** add the subtitle files the page sends ([18b972c](https://github.com/Viren070/AIOStreams/commit/18b972cce7352f6a67ebe6df659b25c5d2cabe79))
* **android:** add tunneled playback to ExoPlayer ([58be863](https://github.com/Viren070/AIOStreams/commit/58be863c62ba19e3879752690cb2f6e463bbc10a))
* **android:** answer player-stats with ExoPlayer's formats and the app's CPU time ([8b1cd9f](https://github.com/Viren070/AIOStreams/commit/8b1cd9f4666876fd80319f57cce914aa0e70cd96))
* **android:** decode Dolby Vision profile 5 in software in mpv ([484ce7c](https://github.com/Viren070/AIOStreams/commit/484ce7cb88eaa181736b73a18398c8d08c22a95f))
* **android:** fall back to mpv when ExoPlayer can't decode a file ([e54d2b6](https://github.com/Viren070/AIOStreams/commit/e54d2b6093c3679d5e6cbfa17ba0f515d13e90bd))
* **android:** fetch libmpv from a pinned, hash-checked release ([983666a](https://github.com/Viren070/AIOStreams/commit/983666a10d4268fe329670974cc387dff1669457))
* **android:** hand Back to the page ([36ae5a0](https://github.com/Viren070/AIOStreams/commit/36ae5a0fe62464c7845e072c716acdcbf5fa922d))
* **android:** inflate zlib-compressed Matroska tracks for ExoPlayer ([196737f](https://github.com/Viren070/AIOStreams/commit/196737fc9ca9db3af3d2894f9a1238dad4014d1d))
* **android:** lower the minimum SDK to 24 ([0b901d8](https://github.com/Viren070/AIOStreams/commit/0b901d82a89d7765ae566458a873138721511ce3))
* **android:** open aiostreams:// links and external players ([f38203a](https://github.com/Viren070/AIOStreams/commit/f38203a88d21606c1f48f6179ff74661b9646ac3))
* **android:** open the system's speech recogniser for the page ([7657b76](https://github.com/Viren070/AIOStreams/commit/7657b761b60fbff6c963bd72fb4922102cfc922b))
* **android:** play a failed file again on the other engine when the page asks ([ba2416c](https://github.com/Viren070/AIOStreams/commit/ba2416c570e565c4424a52ce801405d8a198ccf2))
* **android:** read back to the subtitle lines a seek lands in ([7592d22](https://github.com/Viren070/AIOStreams/commit/7592d222a6dff1770e669ff32957d4cd5bb92381))
* **android:** rewrite Dolby Vision samples in native code, profile 7 RPUs as 8.1 with libdovi ([0bae7a7](https://github.com/Viren070/AIOStreams/commit/0bae7a7c9143cc16bce465355c8267c50b8dafb5))
* **android:** route Dolby Vision tracks by the display's HDR types and the decoders' profiles ([a97ff28](https://github.com/Viren070/AIOStreams/commit/a97ff281e033f647d1cb76294ba66d56bfd55167))
* **android:** run downloads in a user-initiated data transfer job on Android 14 and later ([943b52b](https://github.com/Viren070/AIOStreams/commit/943b52b4b3d071350a580c10801034f76c6ee587))
* **android:** save files the page sends to Downloads ([59e175a](https://github.com/Viren070/AIOStreams/commit/59e175a7997ea6b9889346a4e1b7e792618488a1))
* **android:** set the media volume and window brightness for the page ([0c77762](https://github.com/Viren070/AIOStreams/commit/0c77762d12a24cd79cb7cb105e554b306db9e185))
* **android:** switch the display mode to the video's frame rate ([a7d94f8](https://github.com/Viren070/AIOStreams/commit/a7d94f8c13e82e7f5f8a1444a9db1028f0c57b7b))
* **android:** tell the page it runs on a TV ([da3281c](https://github.com/Viren070/AIOStreams/commit/da3281cf7db564d238693223943738599797cd13))
* **android:** tell the page whether the device has picture-in-picture ([abc59e4](https://github.com/Viren070/AIOStreams/commit/abc59e45bf5ef5a9a32b52b685f97d086c949d74))
* **android:** turn ExoPlayer's passthrough on and off with audio-spdif ([8a1af3e](https://github.com/Viren070/AIOStreams/commit/8a1af3e7e4bc4f4319465d88262958b2dfc0a330))
* **android:** update from the release feeds ([f6cdf7c](https://github.com/Viren070/AIOStreams/commit/f6cdf7c1b92e19a0dfa4ec18d75ab3e0f0fb157b))
* **jellyfin:** keep a user separate, on a sign-in address of their own ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **ui:** add a right-side sheet to the modal ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** add a follow hero that keeps its artwork in the top corner ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** add a frame-rate matching setting on Android TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** add a solid navigation bar background and put navigation settings in one card ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** add a tooltip to the rating button ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** add a tunneled playback setting on Android TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** add a TV layout ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** add a voice search button on Android TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** add an Automatic player engine and make it the default ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** add data-nav-exit focus boxes ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** add floating and corner side rails ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** allow the following hero on TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** blur liquid glass without its bend while it resizes ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** bring the page to its top for focus in the item header ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** choose the Android app's player engine ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** draw ExoPlayer's statistics over the player ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** drop copying stream links on TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** drop downloads on Android TV ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** drop the follow hero's buttons on TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** drop the Shortcuts settings tab on TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** drop the versions filter on TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** enter a focus group from outside at the start of its row ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** export the watch history through the Android app ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** fill focused list rows instead of outlining them ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** fit the sign-in pickers to a remote ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** float a TV's top bar over the page on glass ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** focus an item page's Play when keys open it ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** focus the first item on Select with nothing focused ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** give liquid glass a wider, stronger rim and edge highlights ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** give the Android and Android TV apps their own client names ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** glide keyed scrolls on a spring of our own ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** hear back from external players in the Android app ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** hide an episode's buttons on TVs and add Details to its menu ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** hide external links and skip the hero's dots on TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** hide scrollbars on TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** hide the player's controls on Back before leaving on a TV ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** keep a show's Play button in place while its next episode loads ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** land focus where it last was in rows, grids and lists ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** leave volume out of the player on TVs and touch screens ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** let a held key's action run until the key is let go ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** list versions in a drawer over the player and on short screens ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** list versions in a side sheet over the player ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** mark a focused settings tab on its sliding marker ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** mark webOS and Tizen as TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** offer the other engine on the Android app's error screen ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** open a TV's keyboard on Select rather than on focus ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** open a user's own address on their sign-in ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** play full screen on tablets in the app ([beee186](https://github.com/Viren070/AIOStreams/commit/beee186d02697a6b82ffb769841a7f32b5dc477d))
* **web:** put a TV's keyboard away on its own Enter ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** remove a recent search from its context menu ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** rework the player's controls ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** run a button's hold action on a held Select ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** say which picture fit the button picked ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** scroll to the top when the rotating hero takes focus ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** send Back into a TV's navigation from the pages it leads to ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** show the display's HDR types and the Dolby Vision route in ExoPlayer's statistics ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** show the passthrough switch in the Android app ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** show the picture-in-picture setting only where the device has it ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** show the player's controls on Up and Down on TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** skip row headers and hide minor buttons on TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** slide a TV's top bar away while focus is in the following hero's rows ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** start Discover's focus on its first card ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** start the version picker on the first version for keys ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** take ordered audio and subtitle language lists ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** take the Android app's Back ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** thicken card focus rings on TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** wrap focus across card grid rows ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))


### Bug Fixes

* **android:** apply sub-ass-override to ASS in ExoPlayer ([2e4da69](https://github.com/Viren070/AIOStreams/commit/2e4da694ac9bfd6c65c710a178bf56a9017aff34))
* **android:** copy the web build into the app on every build ([4829b1e](https://github.com/Viren070/AIOStreams/commit/4829b1e920fa1398ec468f917ca808481fb5aadc))
* **android:** fall back to mpv on ExoPlayer failures other than loading the link ([21d1201](https://github.com/Viren070/AIOStreams/commit/21d12018dba72a50c1d3945b84a423ab94377ecc))
* **android:** hide the video view once the page closes the player ([51a7fbe](https://github.com/Viren070/AIOStreams/commit/51a7fbe59c333e9b57988ba66e323d6bfefaf646))
* **android:** replace the launcher PNG with an adaptive icon ([79ad343](https://github.com/Viren070/AIOStreams/commit/79ad343a79c7771065f59d252830a8733b614743))
* **android:** start libass's renderer over when clearing a file's fonts ([e08efdf](https://github.com/Viren070/AIOStreams/commit/e08efdfe07ebc2501d7fa438f137305355eaef30))
* **android:** strip native libraries with the pinned NDK ([cf96344](https://github.com/Viren070/AIOStreams/commit/cf9634418baa68410d449a52d7c76233c7ea7457))
* **android:** time embedded text subtitles by the video's frames ([3c4db7b](https://github.com/Viren070/AIOStreams/commit/3c4db7b4f8b622bbceae1ea3213bbdc241cefd11))
* **android:** write mpv's CA bundle from Android's certificate store ([1a3f43d](https://github.com/Viren070/AIOStreams/commit/1a3f43d0f0d30524d3619f1c3e9cbe5255c9d267))
* **ui:** focus a combobox's list when keys open it ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **ui:** ignore a loading button's presses instead of disabling it ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **ui:** keep a modal's overlay and content on their own layers ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **ui:** show a controlled Select's value again after a pick it didn't take ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **ui:** size a modal's column to its box rather than its widest text ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **ui:** transition a tab's colours rather than all its properties ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** bring a focused field into view when the Android app's keyboard opens ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** copy mpv's decoded frames back on TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** drop a page's focus spot only when the pointer leaves it ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** fade each hero backdrop in as a layer over the last ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** fade the item page's backdrop out at its bottom edge ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** fall back to the title when the hero's logo fails to load ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** fix TV focus around the rail, page starts, grids and rows ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** give focus back to what opened the version picker ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** go up or down to the nearest row when nothing is in line ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** hand a remote's Back in a list to the back action ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** hide the volume step on TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** jump rather than restart a smooth scroll that's still going ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** keep every arrow key on a TV ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** keep fading hero backdrops on their own layers ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** keep keyed scroll steps off the page behind a dialog ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** keep Left and Right on focus's own line ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** keep the page still for focus in a dialog or bar ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** keep the player's controls awake while keys move in them ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** keep the player's TV layout on TVs that report a touch pointer ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** leave row posters room only for the caption lines shown ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** list ExoPlayer before mpv in the player engine setting ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** mark a focused episode on its thumbnail in rows and its row in lists ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** measure an episode's title as its whole card for focus moves ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** measure focus moves from where scrolls under way end ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** move focus sideways into the nearest bar ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** narrow row cards to the height left under the following hero ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** press Enter in a field on a gamepad's A ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** retry rate-limited download version searches after Retry-After ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** reveal the outermost nav box and make rows nav boxes ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** rework the download rows for phones ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** ring a focused season poster inside its image ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** ring a focused version inside its card ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** ring focused menu items and options inside their edges ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** scroll a focused episode's whole card into view ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** set the item menu's width on phones and clamp where it opens ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** skip inert elements when returning focus to a page ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** skip rows scrolled out of their own scroller when moving focus ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** take a held key's quick presses as repeats ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** treat sticky bars like fixed ones in arrow navigation ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))


### Performance Improvements

* **android:** tell the page whether a game controller is attached ([1c679bc](https://github.com/Viren070/AIOStreams/commit/1c679bcd1654007e5d52add7575243a52ad54776))
* **ui:** glide a carousel to focus with a CSS transition ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** ask for a show's next episode, seasons and opening episodes as its page starts to draw ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** ask the Android app's mpv for direct MediaCodec decoding ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** check a row's end in a frame rather than in its effect ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** count saved bytes so a prune reads every entry only near the limit ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** draw a home library row's cards only once it nears the screen ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** draw a title's page from a loaded list's copy of it while it loads ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** draw only the cards near a long row's view ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** ease keyed page and hero row scrolls on the compositor on TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** fade card overlays rather than colouring them in ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** fade cards in with the Web Animations API ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** give focus transitions on cards the keyed glide's duration ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** hold placeholders still in rows not loading yet ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** keep React from listening for transition and animation events ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** keep saved artwork as Blobs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** keep the home page while others are open ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** keep the playhead out of the player's React state ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** leave the touch navigation bar out on TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** make form-less buttons submit buttons on Android ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** measure nearness by hand and keep link addresses in data-href on TVs ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** measure only cards near the screen when moving focus ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** open a settings tab once focus rests on it ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** open item menus without blocking the page ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** open the docked TV rail with a fade rather than a widening ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** pace a held key's repeats to the screen ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** pause the rotating hero while it is out of sight ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** put a submit button before the page's first control on Android ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** read fewer layouts when moving focus ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** save the small copies of shrunk artwork ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** scale artwork at rest and look for open dialogs only in portals ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** scale focused artwork in 200 ms ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** scroll TV rows natively with a compositor glide ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** share intersection observers between elements ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** share one item menu between all cards ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** show artwork as images kept in memory ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** shrink artwork in a pool of workers ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** start gamepad support in the Android app only with a controller attached ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
* **web:** start the artwork workers with the page and make blob addresses in them ([691dc9b](https://github.com/Viren070/AIOStreams/commit/691dc9b6a66b66f391dcaf25ecabce7fbaad511f))
