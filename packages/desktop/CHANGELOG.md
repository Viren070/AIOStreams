# Changelog

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
