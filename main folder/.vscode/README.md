<p align="center">
  <img src="https://raw.githubusercontent.com/Viren070/AIOStreams/main/packages/frontend/public/assets/logo.png" alt="AIOStreams Logo" width="200"/>
</p>

<h1 align="center">AIOStreams</h1>

<p align="center">
  <strong>One addon to rule them all.</strong>
  <br />
  AIOStreams consolidates multiple Stremio addons and debrid services into a single, highly customisable super-addon.
</p>

<p align="center">
    <a href="https://github.com/Viren070/AIOStreams/actions/workflows/deploy-docker.yml"> 
        <img src="https://img.shields.io/github/actions/workflow/status/viren070/aiostreams/deploy-docker.yml?style=for-the-badge&logo=github" alt="Build Status">
    </a>
    <a href="https://github.com/Viren070/AIOStreams/releases/latest">
        <img src="https://img.shields.io/github/v/release/viren070/aiostreams?style=for-the-badge&logo=github" alt="Latest Release">
    </a>
    <a href="https://github.com/Viren070/AIOStreams/stargazers">
        <img src="https://img.shields.io/github/stars/Viren070/AIOStreams?style=for-the-badge&logo=github" alt="GitHub Stars">
    </a>
    <a href="https://hub.docker.com/r/viren070/aiostreams">
        <img src="https://img.shields.io/docker/pulls/viren070/aiostreams?style=for-the-badge&logo=docker" alt="Docker Pulls">
    </a>
    <a href="https://discord.gg/aiostreams">
        <img src="https://img.shields.io/badge/Discord-Join_Chat-7289DA?logo=discord&logoColor=white&style=for-the-badge" alt="Discord Server">
    </a>
</p>

---

## ✨ What is AIOStreams?

AIOStreams was created to give users ultimate control over their Stremio experience. Instead of juggling multiple addons with different configurations and limitations, AIOStreams acts as a central hub. It fetches results from all your favorite sources, then filters, sorts, and formats them according to *your* rules before presenting them in a single, clean list.

Whether you're a casual user who wants a simple, unified stream list or a power user who wants to fine-tune every aspect of your results, AIOStreams has you covered.


<p align="center">
  <img src="https://github.com/user-attachments/assets/6179efdb-abc9-4e0c-ae11-fb0e3ca9606a" alt="AIOStreams in action"  width="750" />
</p>

## 🚀 Key Features

### 🔌 All Your Addons, One Interface
- **Unified Results**: Aggregate streams from multiple addons into one consistently sorted and formatted list.
- **Simplified Addon Management**: AIOStreams features a built-in addon marketplace. Many addons require you to install them multiple times to support different debrid services. AIOStreams handles this automatically. Just enable an addon from the marketplace, and AIOStreams dynamically applies your debrid keys, so you only have to configure it once.
- **Automatic Updates**: Because addon manifests are generated dynamically, you get the latest updates and fixes without ever needing to reconfigure or reinstall.
- **Custom Addon Support**: Add *any* Stremio addon by providing its configured URL. If it works in Stremio, it works here.
- **Full Stremio Support**: AIOStreams doesn't just manage streams; it supports all Stremio resources, including catalogs, metadata, and even addon catalogs.

<p align="center">
  <img src="https://github.com/user-attachments/assets/eb47063c-7519-4619-804f-ad84a34d6591" alt="Addon Configuration" width="750"/>
</p>

### 🔬 Advanced Filtering & Sorting Engine
Because all addons are routed through AIOStreams, you only have to **configure your filters and sorting rules once**. This powerful, centralized engine offers far more options and flexibility than any individual addon.

- **Granular Filtering**: Define `include` (prevents filtering), `required`, or `excluded` rules for a huge range of properties:
    - **Video/Audio**: Resolution, quality, encodes, visual tags (`HDR`, `DV`), audio tags (`Atmos`), and channels.
    - **Source**: Stream type (`Debrid`, `Usenet`, `P2P`), language, seeder ranges, and cached/uncached status (can be applied to specific addons/services).
- **Preferred Lists**: Manually define and order a list of preferred properties to prioritize certain results, for example, always showing `HDR` streams first.
- **Keyword & Regex Filtering**: Filter by simple keywords or complex regex patterns matched against filenames, indexers and release groups for ultimate precision.
- **Accurate Title Matching**: Leverages the TMDB API to precisely match titles, years, and season/episode numbers, ensuring you always get the right content. This can be granularly applied to specific addons or content types.
- **Powerful Conditional Engine**: Create dynamic rules with a simple yet powerful expression language.
    - *Example*: Only exclude 720p streams if more than five 1080p streams are available: `count(resolution(streams, '1080p')) > 5 ? resolution(streams, '720p') : false`.
    - Check the wiki for a [full function reference](https://github.com/Viren070/AIOStreams/wiki/Stream-Expression-Language).
- **Customisable Deduplication**: Choose how duplicate streams are detected: by filename, infohash, and a unique "smart detect" hash generated from certain file attributes.
- **Sophisticated Sorting**:
    - Build your perfect sort order using any combination of criteria.
    - Define separate sorting logic for movies, series, anime, and even for cached vs. uncached results.
    - The sorting system automatically uses the rankings from your "Preferred Lists".

### 🗂️ Unified Catalog Management
Take control of your Stremio home page. AIOStreams lets you manage catalogs from all your addons in one place.
- **Rename**: Rename both the name and the type of the catalog to whatever you want. (e.g. Changing Cinemeta's `Popular - Movies` to `Popular - 📺`)
- **Reorder & Disable**: Arrange catalogs in your preferred order or hide the ones you don't use.
- **Shuffle Catalogs**: Discover new content by shuffling the results of any catalog. You can even persist the shuffle for a set period.
- **Enhanced Posters**: Automatically apply high-quality posters from [RPDB](https://rpdb.net/) to catalogs that provide a supported metadata source, even if the original addon doesn't support it.

<p align="center">

  <img src="https://github.com/user-attachments/assets/12c26705-a373-42b4-9164-0c23b9e9cbe6" alt="Filtering and Sorting Rules" width="750"/>
</p>

### 🎨 Total Customization
- **Custom Stream Formatting**: Design exactly how stream information is displayed using a powerful templating system.
- **Live Preview**: See your custom format changes in real-time as you build them.
- **Predefined Formats**: Get started quickly with built-in formats, some created by me and others inspired by other popular addons like Torrentio and the TorBox Stremio Addon.
- **[Custom Formatter Wiki](https://github.com/Viren070/AIOStreams/wiki/Custom-Formatter)**: Dive deep into the documentation to create your perfect stream title.


<p align="center">
  <img src="https://github.com/user-attachments/assets/906cc3fc-16d1-4702-99c7-425b2445387b" alt="Custom Formatter UI" width="750"/>
</p>

<p align="center">
  <sub>
    This format was created by one of our community members in the 
    <a href="https://discord.gg/aiostreams">Discord Server</a>
  </sub>
</p>


### 🛡️ Proxy & Performance
- **Proxy Integration**: Seamlessly proxy streams through **[MediaFlow Proxy](https://github.com/mhdzumair/mediaflow-proxy)** or **[StremThru](https://github.com/MunifTanjim/stremthru)**.
- **Bypass IP Restrictions**: Essential for services that limit simultaneous connections from different IP addresses.
- **Improve Compatibility**: Fixes playback issues with certain players (like Infuse) and addons.

And much much more...

## 🚀 Getting Started

Setting up AIOStreams is simple.

1.  **Choose a Hosting Method**
    - **🔓 Public Instance**: Use the **[Community Instance (Hosted by ElfHosted)](https://aiostreams.elfhosted.com/configure)**. It's free, but rate-limited and has Torrentio disabled.
    - **🛠️ Self-Host / Paid Hosting**: For full control and no rate limits, host it yourself (Docker) or use a paid service like **[ElfHosted](https://store.elfhosted.com/product/aiostreams/elf/viren070/)** (using this link supports the project!).

2.  **Configure Your Addon**
    - Open the `/stremio/configure` page of your AIOStreams instance in a web browser.
    - Enable the addons you use, add your debrid API keys, and set up your filtering, sorting, and formatting rules.

3.  **Install**
    - Click the "Install" button. This will open your Stremio addon compatible app and add your newly configured AIOStreams addon.

For detailed instructions, check out the Wiki:
- **[Deployment Guide](https://github.com/Viren070/AIOStreams/wiki/Deployment)**
- **[Configuration Guide](https://github.com/Viren070/AIOStreams/wiki/Configuration)**

## ❤️ Support the Project

AIOStreams is a passion project developed and maintained for free. If you find it useful, please consider supporting its development.

- ⭐ **Star the Repository** on [GitHub](https://github.com/Viren070/AIOStreams).
- ⭐ **Star the Addon** in the [Stremio Community Catalog](https://beta.stremio-addons.net/addons/aiostreams).
- 🤝 **Contribute**: Report issues, suggest features, or submit pull requests.
- ☕ **Donate**:
  - **[Ko-fi](https://ko-fi.com/viren070)**
  - **[GitHub Sponsors](https://github.com/sponsors/Viren070)**

---

<h2 align="center"> ⭐ Star History</h2>

<p align="center">
  <img src="https://api.star-history.com/svg?repos=Viren070/AIOStreams&type=Date" href="https://www.star-history.com/#Viren070/AIOStreams&Date" alt="Filtering and Sorting Rules" width="750"/>
</p>

---

## ⚠️ Disclaimer

AIOStreams is a tool for aggregating and managing data from other Stremio addons. It does not host, store, or distribute any content. The developer does not endorse or promote access to copyrighted content. Users are solely responsible for complying with all applicable laws and the terms of service for any addons or services they use with AIOStreams.

## 🙏 Credits

This project wouldn't be possible without the foundational work of many others in the community, especially those who develop the addons that AIOStreams integrates. Special thanks to the developers of all the integrated addons, the creators of [mhdzumair/mediaflow-proxy](https://github.com/mhdzumair/mediaflow-proxy) and [MunifTanjim/stremthru](https://github.com/MunifTanjim/stremthru), and the open-source projects that inspired parts of AIOStreams' design:

* UI Components and issue templates adapted with permission from [5rahim/seanime](https://github.com/5rahim/seanime) (which any anime enthusiast should definitely check out!)
* [sleeyax/stremio-easynews-addon](https://github.com/sleeyax/stremio-easynews-addon) for the projects initial structure
* Custom formatter system inspired by and adapted from [diced/zipline](https://github.com/diced/zipline).
* Condition engine powered by [expr-eval](https://github.com/silentmatt/expr-eval)
