<p align="center"><img src="https://raw.githubusercontent.com/Viren070/AIOStreams/refs/heads/main/packages/frontend/public/assets/logo.png" /></p>
<h1 align="center" id="title">AIOStreams</h1>

<p align="center">
  <a> 
    <img src="https://img.shields.io/github/actions/workflow/status/viren070/aiostreams/deploy-docker.yml?style=for-the-badge" alt="Discord Server">
  </a>
  <a>
    <img src="https://img.shields.io/github/v/release/viren070/aiostreams?style=for-the-badge" alt="version">
  </a>
  <a href="https://github.com/Viren070/AIOStreams/stargazers">
    <img src="https://img.shields.io/github/stars/Viren070/AIOStreams?style=for-the-badge" alt="GitHub Stars">
  </a>
  <a href="https://hub.docker.com/r/viren070/aiostreams">
    <img src="https://img.shields.io/docker/pulls/viren070/aiostreams?style=for-the-badge" alt="Docker Pulls">
  </a>
  <a href="https://discord.gg/9Dn9mSxW6t"> <!-- <<<--- REPLACE abcdefg with your Discord invite code -->
    <img src="https://img.shields.io/badge/Discord-Join_Chat-7289DA?logo=discord&logoColor=white&style=for-the-badge" alt="Discord Server">
  </a>

  <!-- Add other badges here if needed -->
</p>

## 📦 Description

AIOStreams consolidates multiple Stremio addons and debrid services into a single, easily configurable addon. It allows highly customisable filtering, sorting, and formatting of results and supports proxying all your streams through [MediaFlow Proxy](https://github.com/mhdzumair/mediaflow-proxy) or [StremThru](https://github.com/MunifTanjim/stremthru) for improved compatibility and IP restriction bypassing.

## ✨ Key Features

- **🔗 Unified Addon Interface** - Aggregate results from various addons into a single, streamlined list.
- **🌐 Wide Addon Support** - Configure and integrate results from various addons. Even an addon that is not officially supported can be added by providing its URL as a custom addon.
- **⚙️ Easy Configuration** – You can simply enable the services and addons you use, and AIOStreams will handle the rest.
- **🧰 Advanced Filtering**
  - Filter results by resolution, quality, visual tags (e.g., HDR, DV), audio tags (e.g., Atmos, DTS), and video encodes.
  - Filter by keywords present in the stream title.
  - Filter by custom regex pattern. (*Requires an `API_KEY` to be set*)
  - Specify minimum and maximum file sizes individually for episodes and movies.
  - Prioritise and/or exclude specific languages.
- **📊 Sophisticated Sorting** – Sort aggregated results by quality, resolution, size, cached status, visual tags, audio tags, encodes, seeders (for torrents), service provider, language, personal preferences, or multiple custom regex patterns (*Regex patterns require an `API_KEY` to be set*)
- **🗂️ Intelligent Deduplication** - Intelligently removes duplicate results and prioritises specific services and addons for the same file based on your configuration.
- **🚦 Result Limiting** - Limit the number of results shown per resolution.
- **🎨 Customizable Formatting**:
  - Choose from predefined formats (e.g., `gdrive`, `minimalistic-gdrive`, `torrentio`, `torbox`).
  - Utilise a **Custom Formatter** system to define exactly how stream information is displayed. See the [Custom Formatter Wiki page](https://github.com/Viren070/AIOStreams/wiki/Custom-Formatter) for details.
  - View the formatters in the live preview at the configuration page.
- **🔁 Proxy Integration** - Proxy your streams through either [**MediaFlow**](https://github.com/mhdzumair/mediaflow-proxy) or [**StremThru**](https://github.com/MunifTanjim/stremthru) to allow for:
  - **IP Restriction Bypass**: Bypass simultaneous IP restrictions on some services
  - **Improved Compatibility**: Using a proxy improves compatibility with some apps and external players (like Infuse)

## 🧩 Supported Addons

AIOStreams integrates results from, and has automated configuration for, the following addons:

- Torrentio
- MediaFusion
- Comet
- Torbox Addon
- Debridio
- Jackettio / Stremio-Jackett
- Peerflix
- DMM Cast
- Orion Stremio Addon
- Easynews
- Easynews++
- [Stremio GDrive](https://github.com/Viren070/stremio-gdrive-addon)
- Stremthru Store

You may also add any other Stremio addon by providing its **configured** URL as a `Custom Addon`. AIOStreams will fetch the results from that addon and display them in the same way as the other integrated addons. This is useful for addons that are not officially supported or for custom addons you may have created.

> [!NOTE]
> Avoid installing the addons directly in Stremio if you have enabled them within AIOStreams to prevent redundant requests. Enabling too many addons simultaneously is also generally not recommended as they often scrape overlapping sources.

## 🚀 Getting Started

There are several ways to use AIOStreams:

1. 🔓 **Public Instance:**

   - **[Community Instance (Hosted by ElfHosted)](https://aiostreams.elfhosted.com/configure)**: A free-to-use, ratelimited, public instance. Note that the Torrentio addon is disabled on this instance. This instance avoids rate limits for other ElfHosted addons (like Comet, MediaFusion) but might be rate-limited by non-ElfHosted addons.

2. 🛠️ **Self-Hosting / Paid Hosting:**
   - Host AIOStreams yourself using methods like Docker, Cloudflare Workers, or directly from the source.
   - Use a paid hosting provider like [ElfHosted](https://store.elfhosted.com/product/aiostreams/elf/viren070/) (using this link supports the project!) or Heroku.

> [!NOTE]
> A [private ElfHosted instance](https://store.elfhosted.com/product/aiostreams/elf/viren070/) will support all addons, including Torrentio, avoid ratelimits of all ElfHosted addons, and also have no rate limit of its own.

Regardless of the method you choose, once AIOStreams is accessible, navigate to its `/configure` page in your browser. Here, you can:

- Set your filtering and sorting preferences.
- Add API keys for services like Real-Debrid, Premiumize, etc.
- Select and configure the upstream addons you want to integrate.
- Finally, click "Install" to add the configured AIOStreams addon to the application of your choice. (AIOStreams is compatible with Stremio, Vidi, Fusion, Omni, and any other Stremio addon compatible application.)

📘 See the Wiki for full guides:

- **[Deployment Guide](https://github.com/Viren070/AIOStreams/wiki/Deployment)**
- **[Configuration Guide](https://github.com/Viren070/AIOStreams/wiki/Configuration)**
- **[Development Guide](https://github.com/Viren070/AIOStreams/wiki/Development)**

## ❓ FAQ

- **How does it work?** AIOStreams fetches results from each enabled addon, parses the stream information, applies your configured filtering and sorting rules, formats the results, and presents them as a single Stremio addon.
- **Why was this created?** To provide a centralised way to manage multiple addons and debrid services with fine-grained control over filtering, sorting, and result presentation, which many individual addons lack.
- **What is Stremio?** If you're new to Stremio, check out my [Stremio guide](https://guides.viren070.me/stremio).

## ❤️ Support the Project

AIOStreams is a free and open-source project maintained by me and its contributors. If you find it useful, you can support its development in the following ways:

- ⭐ **Star the Repository** - Show your support and help boost visibility.
- ⭐ **Star on [Stremio Addons](https://beta.stremio-addons.net/addons/aiostreams)** - Spread the word.
- 🤝 **Contributions Welcome** - Issues, pull requests, and ideas for improvement are always appreciated.
- ☕ **Donate**
  - [Ko-fi](https://ko-fi.com/viren070)
  - [GitHub Sponsors](https://github.com/sponsors/Viren070)

Your support, whether through a star, contribution, or donation, helps keep the project alive and growing. ❤️

## ⚠️ Disclaimer

AIOStreams and its developer do not host, store, or distribute any content. All content is sourced from the configured upstream addons. AIOStreams does not endorse or promote access to copyrighted content without authorisation. Users are responsible for ensuring they comply with all applicable laws and terms of service for the addons and content sources they use.

## 🙏 Credits

- Thanks to [sleeyax/stremio-easynews-addon](https://github.com/Sleeyax/stremio-easynews-addon) for the repository structure and Dockerfile..
- Thanks to all the developers of the upstream addons that AIOStreams integrates.
- [Mhdzumair/MediaFlow](https://github.com/Mhdzumair/mediaflow-proxy) and [MunifTanjim/stremthru](https://github.com/MunifTanjim/stremthru) which allow stream proxying. 
- Issue templates adapted from [5rahim/seanime](https://github.com/5rahim/seanime).
- Custom formatter system inspired by and adapted from [diced/zipline](https://github.com/diced/zipline).