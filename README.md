<p align="center">
    <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/selfhst/icons/png/aiostreams-light.png">
          <img alt="AIOStreams Logo" src="https://cdn.jsdelivr.net/gh/selfhst/icons/png/aiostreams.png" width=256 height=256>
    </picture>
</p>

<h1 align="center">AIOStreams</h1>

<p align="center">
  <strong>One addon to rule them all.</strong>
  <br />
  AIOStreams consolidates multiple Stremio addons and debrid services - including its own suite of built-in addons - into a single, highly customisable super-addon.
</p>

<p align="center">
    <a href="https://github.com/Viren070/AIOStreams/actions/workflows/deploy-docker.yml"> 
        <img src="https://img.shields.io/github/actions/workflow/status/viren070/aiostreams/deploy-docker.yml?style=for-the-badge&logo=github" alt="Build Status">
    </a>
    <a href="https://github.com/Viren070/AIOStreams/releases/latest">
        <img src="https://img.shields.io/github/v/release/viren070/aiostreams?style=for-the-badge&logo=github" alt="Latest Release">
    </a>
    <a href="https://github.com/Viren070/AIOStreams/stargazers">
        <img src="https://img.shields.io/github/stars/Viren070/AIOStreams?style=for-the-badge&logo=github " alt="GitHub Stars">
    </a>
    <a href="https://github.com/sponsors/Viren070">
        <img src="https://img.shields.io/github/sponsors/viren070?style=for-the-badge&logo=githubsponsors" alt="GitHub Sponsors">
    </a>
    <a href="https://hub.docker.com/r/viren070/aiostreams">
        <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry-stats.viren070.me%2Fapi%2Fdh%3Aviren070%2Faiostreams%2Cghcr%3Aviren070%2Faiostreams%2Faiostreams&query=%24.total_downloads_formatted&logo=docker&label=pulls&style=for-the-badge" alt="Docker Pulls">
    </a>
    <a href="https://discord.viren070.me">
        <img src="https://img.shields.io/discord/1225024298490662974?style=for-the-badge&logo=discord&color=7289DA" alt="Discord Server">
    </a>

</p>

---

## ✨ What is AIOStreams?

AIOStreams was created to give users ultimate control over their Stremio experience. Instead of juggling multiple addons with different configurations and limitations, AIOStreams acts as a central hub. It fetches results from all your configured sources, then deduplicates, filters, sorts, and formats them according to _your_ rules before presenting them in a single, clean list.

Whether you're a casual user who wants a simple, unified stream list or a power user who wants to fine-tune every aspect of your results, AIOStreams has you covered.

<p align="center">
  <img src="https://github.com/user-attachments/assets/ba15f9f6-b8d4-4060-9b1f-00adeb0d1d9b" alt="AIOStreams in action" width="850" />
</p>

---

## 🚀 Key Features

### 🔌 All Your Addons, One Interface

Add any Stremio addon you already use - Torrentio, Comet, MediaFusion, and many more - alongside AIOStreams' own built-in addons. All results flow through a single, unified pipeline.

- **Addon Marketplace**: Browse and enable 80+ community addons directly from the configuration page. AIOStreams automatically applies your debrid API keys to compatible addons, so you configure your credentials once and they work everywhere.
- **Custom Addon Support**: Add _any_ Stremio addon by URL. If it works in Stremio, it works here.
- **Automatic Updates**: Addon manifests are generated dynamically, so you always get the latest addon updates without reconfiguring anything.
- **Full Stremio Support**: Streams, catalogs, metadata, subtitles, and addon catalogs are all supported.
- **Addon Categorisation**: Categorise your addons to keep things neat and organised.

<p align="center">
  <img src="https://github.com/user-attachments/assets/4af785d1-dec3-438b-b62c-5aaf6d3d62c5" alt="Addon Marketplace" width="850"/>

  <img width="850"  alt="image" src="https://github.com/user-attachments/assets/fc85afc5-1367-40e0-9018-40002dd0878f" />

</p>

### 🧩 Built-in Addons

AIOStreams ships with a suite of its own addons - search engines and integrations that are hosted alongside AIOStreams itself and available exclusively to your instance. They're configured and used just like any other addon in the marketplace.

> [!NOTE]
> Built-in addons that search for torrents require a debrid service. Usenet results can be streamed directly via [NZBDav](https://github.com/nzbdav-dev/nzbdav) or [AltMount](https://github.com/javi11/altmount), or through TorBox (Pro plan). All built-in addons support anime and Kitsu/MAL catalogs.

The built-in addons include:

| Addon               | Description                                                      |
| ------------------- | ---------------------------------------------------------------- |
| **Stremio GDrive**  | Stream files directly from your Google Drive.                    |
| **TorBox Search**   | Search TorBox's index with more options than the official addon. |
| **Knaben**          | Proxy search across The Pirate Bay, 1337x, Nyaa.si, and more.    |
| **Zilean**          | Scrape a Zilean DMM hashlist instance.                           |
| **AnimeTosho**      | Mirror of most Nyaa.si and TokyoTosho anime releases.            |
| **Torrent Galaxy**  | Search Torrent Galaxy for results.                               |
| **Easynews Search** | Text-based search of Easynews' Usenet index.                     |
| **SeaDex**          | Best-release database for anime (community curated).             |
| **NekoBT**          | Anime results via nekoBT.                                        |
| **EZTV**            | TV show torrent search via EZTV.                                 |
| **Bitmagnet**       | Connect your self-hosted Bitmagnet DHT crawler.                  |
| **Jackett**         | Connect your Jackett instance by URL and API key.                |
| **Prowlarr**        | Connect your Prowlarr instance by URL and API key.               |
| **NZBHydra2**       | Connect your NZBHydra2 instance to search Usenet indexers.       |
| **Newznab**         | Directly configure any Newznab-compatible Usenet indexer.        |
| **Torznab**         | Configure any Torznab API to search torrent results.             |
| **Library**         | Browse and stream content from your debrid/usenet library        |

### 🌐 Debrid & Usenet Service Support

AIOStreams supports all major debrid and Usenet services, including:

**Debrid**: Real-Debrid, AllDebrid, Debrid-Link, Premiumize, TorBox, EasyDebrid, PikPak, Offcloud, Seedr, put.io, and more.

**Usenet**: Easynews, NzbDAV, AltMount, Stremio NNTP, StremThru Newz.

Services are configured once in the **Services** tab and automatically applied to every compatible addon in your configuration.

<p align="center">
    <img width="1500" alt="image" src="https://github.com/user-attachments/assets/fbf40e7d-b303-4bef-a43e-5ce3d26684bb" />
</p>

### 🔬 Advanced Filtering Engine

Because every addon is routed through AIOStreams, you only configure your filters **once** and they apply universally.

- **Property Filters**: Include, require, or exclude results by resolution (240p–2160p), quality (CAM through BluRay REMUX), encode (AVC, HEVC, AV1...), HDR/Dolby Vision tags, audio format (Atmos, TrueHD, DTS...), audio channels, stream type (debrid, usenet, P2P...), and language.
- **Size, Bitrate & Seeder Filters**: Set minimum and maximum bounds for file size, bitrate, seeder count, and result age.
- **Cached/Uncached Control**: Filter by cache status globally or scoped to specific services or addons.
- **Keyword Filters**: Match or exclude results by simple keyword against the filename.
- **Regex Filters**: Full regular expression matching against filenames, indexer names, and release groups.
- **Stream Expression Language (SEL)**: Write dynamic conditional rules using a purpose-built expression language.
  - _Example_: Only remove 720p results when more than five 1080p results are already present: `count(resolution(streams, '1080p')) > 5 ? resolution(streams, '720p') : false`
  - Full reference: [docs.aiostreams.viren070.me/reference/stream-expressions](https://docs.aiostreams.viren070.me/reference/stream-expressions)
- **Accurate Matching**: Uses various metadata sources to precisely verify titles, years, and episode numbers - so you only ever see the right content. Can be applied per-addon or per-content type.
- **Smart Deduplication**: Detect duplicate streams by filename, infohash, or a "smart detect" hash computed from a configurable set of file attributes (size, resolution, encode, release group, etc.).

<p align="center">
  <img src="https://github.com/user-attachments/assets/4bab4c2c-a47a-482b-a623-079fc792dc33" alt="Filtering Configuration" width="750"/>
</p>

### 📊 Powerful Sorting

Build your ideal sort order from a wide range of criteria - resolution, quality, encode, language, audio, visual tags, stream type, cache status, seeders, size, bitrate, service, addon, age, and more. Sorting is:

- **Fully Customisable**: Stack any number of criteria in any order.
- **Content-Aware**: Define separate sort orders for movies, series, and anime, and separate rules for cached vs. uncached results.
- **Expression/Regex Scored**: Use Stream Expressions / Regex Patterns to compute a numeric score per stream and sort by that score for maximum precision.
- **Preferred Lists**: Define ranked lists of preferred values (e.g. prefer `HDR10+` over `HDR` over `SDR`) and have the sorter use those rankings automatically.

Full guide: [docs.aiostreams.viren070.me/guides/scored-sorting](https://docs.aiostreams.viren070.me/guides/scored-sorting)

<p align="center">
    <img width="920" alt="image" src="https://github.com/user-attachments/assets/88eb560d-d95d-4964-93ed-7b6b82c861b9" />
</p>

### 🎨 Custom Stream Formatter

Design exactly how stream information appears in Stremio using a powerful templating system.

- **Live Preview**: See exactly what your streams will look like as you build your template.
- **Built-in Formats**: Start from one of the included presets - some are built in, others are inspired by popular addons and community contributions.
- **Full Customisation**: The template system gives you access to every parsed stream attribute. See the [Custom Formatter reference](https://docs.aiostreams.viren070.me/reference/custom-formatter) for the full variable and function list.

<p align="center">
  <img src="https://github.com/user-attachments/assets/44ba6860-6778-4f0f-a192-e3f28df6b893" alt="Custom Formatter" width="900"/>
</p>

### 🗃️ Unified Catalog Management

Take control of your Stremio home page from one place.

- **Rename**: Rename any catalog's title or type to whatever you want.
- **Reorder & Disable**: Drag catalogs into your preferred order or hide the ones you don't use.
- **Shuffle**: Discover new content by shuffling the results of any catalog. You can persist the shuffle for a set period.
- **Enhanced Posters**: Automatically upgrade catalog posters with high-quality artwork from supported poster services (e.g. [RPDB](https://rpdb.net/)) - even for addons that don't natively support it.
- **Merged Catalogs**: Combine results from multiple catalogs into one unified catalog.

<p align="center"> 
    <img width="900"  alt="image" src="https://github.com/user-attachments/assets/24d2ea64-f742-48f0-8552-bb8a62f61a75" />
</p>

### 🛡️ Proxy Support

- **Built-in Proxy**: AIOStreams includes its own proxy for forwarding streams.
- **External Proxy**: Integrate with [MediaFlow Proxy](https://github.com/mhdzumair/mediaflow-proxy) or [StremThru](https://github.com/MunifTanjim/stremthru) by providing your instance URL and credentials.
- **Bypass IP Restrictions**: Essential for debrid services that restrict simultaneous connections from different IP addresses.
- **NZB Proxying**: The built-in proxy can also forward NZB download requests for the Newznab built-in addon.
- **Outgoing Request Proxy**: Route AIOStreams' own requests to upstream addons through an HTTP/SOCKS5 proxy - useful when your server's IP is blocked by an upstream service.

---

## 🚀 Getting Started

1. **Choose how to run it**
   - **Public Instance**: Use a [community-hosted instance](https://docs.aiostreams.viren070.me/getting-started/public-instances) - free, no setup required.
   - **Self-Host**: Run it yourself with Docker for full control and no limits.
   - **Managed Hosting**: Use a managed AIOStreams instance via **[ElfHosted](https://store.elfhosted.com/product/aiostreams/?utm_source=github&utm_medium=readme&utm_campaign=aiostreams-readme)** (ElfHosted are a project sponsor).

2. **Configure your addon**
   - Open the `/stremio/configure` page of your instance in a browser.
   - Add your debrid or Usenet credentials, install addons from the marketplace, and set up your filters, sorting, and formatting.

3. **Create your user**
   - On the **Save & Install** page, enter a password to protect your configuration

4. **Install the addon**
   - Use the Installation Options provided to install the addon to whatever app you are using.

For full setup and configuration instructions, see the **[documentation](https://docs.aiostreams.viren070.me)**.

---

## ❤️ Support the Project

AIOStreams is a passion project developed and maintained for free. If you find it useful, please consider:

- ⭐ **[Star the repository](https://github.com/Viren070/AIOStreams)** on GitHub.
- ⭐ **[Star the addon](https://stremio-addons.net/addons/aiostreams)** in the Stremio Community Catalog.
- 🤝 **Contribute**: Report issues, suggest features, or submit pull requests.
- ☕ **Donate**:
  - **[Ko-fi](https://ko-fi.com/viren070)**
  - **[GitHub Sponsors](https://github.com/sponsors/Viren070)**

---

<h2 align="center">⭐ Star History</h2>

<p align="center">
  <img src="https://api.star-history.com/svg?repos=Viren070/AIOStreams&type=Date" href="https://www.star-history.com/#Viren070/AIOStreams&Date" alt="Star History" width="750"/>
</p>

---

## ⚠️ Disclaimer

AIOStreams is a tool for aggregating and managing data from other Stremio addons. It does not host, store, or distribute any content. The developer does not endorse or promote access to copyrighted content. Users are solely responsible for complying with all applicable laws and the terms of service of any addons or services they use with AIOStreams.

## 🙏 Credits

This project wouldn't be possible without the foundational work of many others in the community, especially those who develop the addons that AIOStreams integrates. Special thanks to the developers of all integrated addons, the creators of [mhdzumair/mediaflow-proxy](https://github.com/mhdzumair/mediaflow-proxy) and [MunifTanjim/stremthru](https://github.com/MunifTanjim/stremthru), and the open-source projects that inspired parts of AIOStreams' design:

- UI components and issue templates adapted with permission from [5rahim/seanime](https://github.com/5rahim/seanime)
- [NzbDAV](https://github.com/nzbdav-dev/nzbdav) & [AltMount](https://github.com/javi11/altmount) integration inspired by [Sanket9225/UsenetStreamer](https://github.com/Sanket9225/UsenetStreamer/)
- [sleeyax/stremio-easynews-addon](https://github.com/sleeyax/stremio-easynews-addon) for the project's initial structure
- Custom formatter system inspired by and adapted from [diced/zipline](https://github.com/diced/zipline)
- Stream Expression Language powered by [silentmatt/expr-eval](https://github.com/silentmatt/expr-eval)
