import { FormatterContext } from './base.js';
import { BaseFormatter } from './base.js';

export class TorrentioFormatter extends BaseFormatter {
  constructor(ctx: FormatterContext) {
    super(
      {
        name: `
{stream.proxied::istrue["🕵️‍♂️ "||""]}{stream.private::istrue["🔑 "||""]}{stream.type::=p2p["[P2P] "||""]}{service.id::exists["[{service.shortName}"||""]}{service.cached::istrue["+] "||""]}{service.cached::isfalse[" download] "||""]}{addon.name} {stream.resolution::exists["{stream.resolution}"||"Unknown"]}
{stream.visualTags::exists["{stream.visualTags::join(' | ')}"||""]}      
`,
        description: `
{stream.message::exists["ℹ️{stream.message}"||""]}
{stream.folderName::exists["{stream.folderName}"||""]}
{stream.filename::exists["{stream.filename}"||""]}
{stream.size::>0["💾{stream.size::bytes2} "||""]}{stream.folderSize::>0["/ 💾{stream.folderSize::bytes2}"||""]}{stream.seeders::>=0["👤{stream.seeders} "||""]}{stream.age::exists["📅{stream.age} "||""]}{stream.indexer::exists["⚙️{stream.indexer}"||""]}
{stream.languageEmojis::exists["{stream.languageEmojis::join(' / ')}"||""]}
`,
      },
      ctx
    );
  }
}

export class TorboxFormatter extends BaseFormatter {
  constructor(ctx: FormatterContext) {
    super(
      {
        name: `
{stream.proxied::istrue["🕵️‍♂️ "||""]}{stream.private::istrue["🔑 "||""]}{stream.type::=p2p["[P2P] "||""]}{addon.name}{stream.library::istrue[" (Your Media) "||""]}{service.cached::istrue[" (Instant "||""]}{service.cached::isfalse[" ("||""]}{service.id::exists["{service.shortName})"||""]}{stream.resolution::exists[" ({stream.resolution})"||""]}
      `,
        description: `
Quality: {stream.quality::exists["{stream.quality}"||"Unknown"]}
Name: {stream.filename::exists["{stream.filename}"||"Unknown"]}
Size: {stream.size::>0["{stream.size::bytes} "||""]}{stream.folderSize::>0["/ {stream.folderSize::bytes} "||""]}{stream.indexer::exists["| Source: {stream.indexer} "||""]}{stream.duration::>0["| Duration: {stream.duration::time} "||""]}
Language: {stream.languages::exists["{stream.languages::join(', ')}"||""]}
Type: {stream.type::title}{stream.seeders::>=0[" | Seeders: {stream.seeders}"||""]}{stream.age::exists[" | Age: {stream.age}"||""]}
{stream.message::exists["Message: {stream.message}"||""]}
      `,
      },
      ctx
    );
  }
}

export class GDriveFormatter extends BaseFormatter {
  constructor(ctx: FormatterContext) {
    super(
      {
        name: `
{stream.proxied::istrue["🕵️ "||""]}{stream.private::istrue["🔑 "||""]}{stream.type::=p2p["[P2P] "||""]}{service.shortName::exists["[{service.shortName}"||""]}{service.cached::istrue["⚡] "||""]}{service.cached::isfalse["⏳] "||""]}{addon.name}{stream.library::istrue[" (Your Media)"||""]} {stream.resolution::exists["{stream.resolution}"||""]}{stream.seadexBest::istrue[" (Best)"||""]}{stream.seadex::istrue::and::stream.seadexBest::isfalse[" (SeaDex Alt.)"||""]}{stream.regexMatched::exists::and::stream.seadex::isfalse[" ({stream.regexMatched})"||""]}      `,
        description: `
{stream.quality::exists["🎥 {stream.quality} "||""]}{stream.encode::exists["🎞️ {stream.encode} "||""]}{stream.releaseGroup::exists["🏷️ {stream.releaseGroup} "||""]}{stream.network::exists["📡 {stream.network} "||""]}
{stream.visualTags::exists["📺 {stream.visualTags::join(' | ')} "||""]}{stream.audioTags::exists["🎧 {stream.audioTags::join(' | ')} "||""]}{stream.audioChannels::exists["🔊 {stream.audioChannels::join(' | ')}"||""]}
{stream.size::>0["📦 {stream.size::rbytes} "||""]}{stream.folderSize::>0["/ {stream.folderSize::rbytes} "||""]}{stream.bitrate::>0["({stream.bitrate::rbitrate})"||""]}{stream.duration::>0["⏱️ {stream.duration::time} "||""]}{stream.seeders::>0["👥 {stream.seeders} "||""]}{stream.age::exists["📅 {stream.age} "||""]}{stream.indexer::exists["🔍 {stream.indexer}"||""]}
{stream.languages::exists["🌎 {stream.languages::join(' | ')}"||""]}
{stream.filename::exists["📁"||""]} {stream.folderName::exists["{stream.folderName}/"||""]}{stream.filename::exists["{stream.filename}"||""]}
{stream.message::exists["ℹ️ {stream.message}"||""]}
      `,
      },
      ctx
    );
  }
}

export class LightGDriveFormatter extends BaseFormatter {
  constructor(ctx: FormatterContext) {
    super(
      {
        name: `
{stream.proxied::istrue["🕵️ "||""]}{stream.private::istrue["🔑 "||""]}{stream.type::=p2p["[P2P] "||""]}{service.shortName::exists["[{service.shortName}"||""]}{stream.library::istrue["☁️"||""]}{service.cached::istrue["⚡] "||""]}{service.cached::isfalse["⏳] "||""]}{addon.name}{stream.resolution::exists[" {stream.resolution}"||""]}{stream.seadexBest::istrue[" (Best)"||""]}{stream.seadex::istrue::and::stream.seadexBest::isfalse[" (SeaDex Alt.)"||""]}{stream.regexMatched::exists::and::stream.seadex::isfalse[" ({stream.regexMatched})"||""]}
`,
        description: `
{stream.title::exists["📁 {stream.title::title}"||""]}{stream.year::exists[" ({stream.year})"||""]}{stream.seasonEpisode::exists[" {stream.seasonEpisode::join(' • ')}"||""]}
{stream.quality::exists["🎥 {stream.quality} "||""]}{stream.encode::exists["🎞️ {stream.encode} "||""]}{stream.releaseGroup::exists["🏷️ {stream.releaseGroup}"||""]}{stream.network::exists["📡 {stream.network} "||""]}
{stream.visualTags::exists["📺 {stream.visualTags::join(' • ')} "||""]}{stream.audioTags::exists["🎧 {stream.audioTags::join(' • ')} "||""]}{stream.audioChannels::exists["🔊 {stream.audioChannels::join(' • ')}"||""]}
{stream.size::>0["📦 {stream.size::rbytes} "||""]}{stream.folderSize::>0["/ {stream.folderSize::rbytes} "||""]}{stream.duration::>0["⏱️ {stream.duration::time} "||""]}{stream.age::exists["📅 {stream.age} "||""]}{stream.indexer::exists["🔍 {stream.indexer}"||""]}
{stream.languageEmojis::exists["🌐 {stream.languageEmojis::join(' / ')}"||""]}
{stream.message::exists["ℹ️ {stream.message}"||""]}
`,
      },
      ctx
    );
  }
}

export class PrismFormatter extends BaseFormatter {
  constructor(ctx: FormatterContext) {
    super(
      {
        name: `
{stream.resolution::exists["{stream.resolution::replace('2160p', '🔥4K UHD')::replace('1440p','✨ QHD')::replace('1080p','🚀 FHD')::replace('720p','💿 HD')::replace('576p','💩 Low Quality')::replace('480p','💩 Low Quality')::replace('360p','💩 Low Quality')::replace('240p','💩 Low Quality')::replace('144p','💩 Low Quality')}"||"💩 Unknown"]}
`,
        description: `
{stream.title::exists["🎬 {stream.title::title} "||""]}{stream.year::exists["({stream.year}) "||""]}{stream.formattedSeasons::exists["🍂 {stream.formattedSeasons} "||""]}{stream.formattedEpisodes::exists["🎞️ {stream.formattedEpisodes}"||""]}{stream.seadexBest::istrue["🎚️ Best "||""]}{stream.seadex::istrue::and::stream.seadexBest::isfalse["🎚️ Alternative"||""]}{stream.regexMatched::exists::and::stream.seadex::isfalse["🎚️ {stream.regexMatched} "||""]}
{stream.quality::exists["🎥 {stream.quality} "||""]}{stream.visualTags::exists["📺 {stream.visualTags::join(' | ')} "||""]}{stream.encode::exists["🎞️ {stream.encode} "||""]}{stream.duration::>0["⏱️ {stream.duration::time} "||""]}
{stream.audioTags::exists["🎧 {stream.audioTags::join(' | ')} "||""]}{stream.audioChannels::exists["🔊 {stream.audioChannels::join(' | ')} "||""]}{stream.languages::exists["🗣️ {stream.languageEmojis::join(' / ')}"||""]}
{stream.size::>0["📦 {stream.size::rbytes} "||""]}{stream.folderSize::>0["/ {stream.folderSize::rbytes} "||""]}{stream.bitrate::>0["📊 {stream.bitrate::rbitrate} "||""]}{service.cached::isfalse::or::stream.type::=p2p::and::stream.seeders::>0["🌱 {stream.seeders} "||""]}{stream.type::=usenet::and::stream.age::exists["📅 {stream.age} "||""]}
{stream.releaseGroup::exists["🏷️ {stream.releaseGroup} "||""]}{stream.indexer::exists["📡 {stream.indexer} "||""]}{stream.network::exists["🎭 {stream.network}"||""]}
{service.cached::istrue["⚡Ready "||""]}{service.cached::isfalse["❌ Not Ready "||""]}{service.id::exists["({service.shortName}) "||""]}{stream.library::istrue["📌 Library "||""]}{stream.type::=Usenet["📰 Usenet "||""]}{stream.type::=p2p["⚠️ P2P "||""]}{stream.type::=http["💻 Web Link "||""]}{stream.type::=youtube["▶️ Youtube "||""]}{stream.type::=live["📺 Live "||""]}{stream.proxied::istrue["🔒 Proxied "||""]}{stream.private::istrue["🔑 Private "||""]}🔍{addon.name} 
{stream.message::exists["ℹ️ {stream.message}"||""]}
`,
      },
      ctx
    );
  }
}

export class TamtaroFormatter extends BaseFormatter {
  constructor(ctx: FormatterContext) {
    super(
      {
        name: `
{stream.resolution::exists["{stream.resolution::replace('2160p','  4K ')::replace('1440p','    2K ')::replace('p','P')}"||"      "]} {stream.type::replace('debrid','   ')::replace('p2p','⁽ᵖ²ᵖ⁾')::replace('live','⁽ˡᶦᵛᵉ⁾')::replace('http','⁽ʷᵉᵇ⁾')::replace('usenet','⁽ⁿᶻᵇ⁾')::replace('stremio-usenet','⁽ⁿᶻᵇ⁾')::replace('statistic','⁽ˢᵗᵃᵗˢ⁾')::replace('external','⁽ᵉˣᵗ⁾')::replace('error','⁽ᵉʳʳᵒʳ⁾')::replace('youtube','⁽ʸᵗ⁾')}{service.cached::istrue["⚡"||""]}{service.cached::isfalse["⏳"||""]}{tools.newLine}{stream.quality::exists["  \n〈{stream.quality::title::replace('Bluray Remux','Remux')}〉 "||""]}{stream.message::~Download["{tools.removeLine}\n‎ "||""]}
`,
        description: `
{stream.title::exists::and::stream.library::isfalse["▤  {stream.title::title::truncate(15)}"||""]}{stream.title::exists::and::stream.library::istrue["☁︎  {stream.title::title::truncate(15)} "||""]}{stream.year::exists::and::stream.episodes::exists::isfalse::and::stream.seasons::exists::isfalse[" ({stream.year})"||""]}{stream.seasonEpisode::exists["   {stream.seasonEpisode::join('·')::replace('E','ᴇ')::replace('S','s')::replace('0','₀')::replace('1','₁')::replace('2','₂')::replace('3','₃')::replace('4','₄')::replace('5','₅')::replace('6','₆')::replace('7','₇')::replace('8','₈')::replace('9','₉')}"||""]}
{stream.encode::exists["▣  {stream.encode}  "||""]}{stream.visualTags::exists["✧  {stream.visualTags::join(' · ')}  "||""]}
{stream.audioTags::exists["♬  {stream.audioTags::join(' · ')}  "||""]}{stream.audioChannels::exists["☊  {stream.audioChannels::join(' · ')} "||""]}
{stream.size::>0::and::stream.seasonPack::istrue["⧉  "||""]}{stream.size::>0::and::stream.seasonPack::isfalse["◧  "||""]}{stream.size::>0["{stream.size::bytes}"||""]}{stream.folderSize::>0["/ {stream.folderSize::rbytes}"||""]}{stream.bitrate::exists[" · {stream.bitrate::bitrate::replace('Mbps','ᴹᵇᵖˢ')::replace('Kbps','ᴷᵇᵖˢ')} "||""]}{stream.message::~Download["{tools.removeLine}"||""]}{service.cached::isfalse::or::stream.type::=p2p::and::stream.seeders::>0["⇋ {stream.seeders}𖧧"||""]}{stream.age::exists[" · ⟳ {stream.age}"||""]}
{stream.proxied::istrue["⛊  "||"⛉  "]}{service.shortName::exists["[{service.shortName}] "||""]}{addon.name}{stream.releaseGroup::exists[" · {stream.releaseGroup::truncate(13)}"||""]}{stream.indexer::exists::and::stream.type::~usenet[" · {stream.indexer::truncate(13)}"||""]}{stream.message::~Download["{tools.removeLine}\n"||""]}
{stream.uLanguages::exists[" ⚐  {stream.uSmallLanguageCodes::join(' · ')::replace('ᴅᴜᴀʟ ᴀᴜᴅɪᴏ','ᴅᴜᴏ')::replace('ᴅᴜʙʙᴇᴅ','ᴅᴜʙ')}  "||""]}{stream.edition::exists::and::stream.visualTags::~IMAX::isfalse::or::stream.regexMatched::exists::and::stream.seadex::isfalse::or::stream.seadex::istrue::or::stream.network::exists::or::stream.message::exists::or::stream.upscaled::istrue::or::stream.repack::istrue::or::stream.uncensored::istrue::or::stream.unrated::istrue[" » "||""]}{stream.seadexBest::istrue[" ʙᴇsᴛ ʀᴇʟᴇᴀsᴇ "||""]}{stream.seadex::istrue::and::stream.seadexBest::isfalse[" ᴀʟᴛ ʙᴇsᴛ ʀᴇʟᴇᴀsᴇ "||""]}{stream.regexMatched::exists::and::stream.seadex::isfalse[" {stream.regexMatched::replace('Bad','ᴜɴʀᴇʟɪᴀʙʟᴇ')::replace('0','₀')::replace('1','₁')::replace('2','₂')::replace('3','₃')::replace('4','₄')::replace('5','₅')::replace('6','₆')::replace('7','₇')::replace('8','₈')::replace('9','₉')::smallcaps} "||""]}{stream.network::exists[" {stream.network::smallcaps} "||""]}{stream.upscaled::istrue[" ᴜᴘsᴄᴀʟᴇᴅ "||""]}{stream.remastered::istrue::and::stream.edition::~Remastered::isfalse[" ʀᴇᴍᴀsᴛᴇʀᴇᴅ "||""]}{stream.uncensored::istrue[" ᴜɴᴄᴇɴsᴏʀᴇᴅ "||""]}{stream.repack::istrue[" ʀᴇᴘᴀᴄᴋᴇᴅ "||""]}{stream.unrated::istrue[" ᴜɴʀᴀᴛᴇᴅ "||""]}{stream.message::exists[" {stream.message::replace('NZB Health: ✅','☑ ɴᴢʙ')::replace('NZB Health: 🧝','☑ ᴇʟғ ɴᴢʙ')::replace('NZB Health: ⚠️','ᴜɴᴠᴇʀɪғɪᴇᴅ ɴᴢʙ')::replace('NZB Health: 🚫','☒ ɴᴢʙ')::smallcaps} "||""]}{stream.edition::exists::and::stream.visualTags::~IMAX::isfalse["  {stream.edition::smallcaps} "||""]}{stream.message::~Download["{tools.removeLine}"||""]}{service.cached::istrue::and::stream.message::~Download::istrue["\n⭳ DL Stream"||""]}
`,
      },
      ctx
    );
  }
}

export class MinimalisticGdriveFormatter extends BaseFormatter {
  constructor(ctx: FormatterContext) {
    super(
      {
        name: `
{stream.resolution::exists["{stream.resolution::replace('2160p','✨ 4K')::replace('1440p','📀 2K')::replace('1080p','🧿1080p')::replace('720p','💿720p')}"||"N/A"]}{service.cached::istrue[" 🎫 "||""]}{service.cached::isfalse[" 🎟️ "||""]}
{stream.quality::exists["{stream.quality::upper}"||""]}
`,
        description: `
{stream.visualTags::exists["🔆 {stream.visualTags::join(' • ')}  "||""]}{stream.audioTags::exists["🔊 {stream.audioTags::join(' • ')}"||""]}
{stream.size::>0["📦 {stream.size::rbytes} "||""]}
{stream.languages::exists["🌎 {stream.languages::join(' • ')}"||""]}
`,
      },
      ctx
    );
  }
}
