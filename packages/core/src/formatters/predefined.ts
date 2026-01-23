import { UserData } from '../db/schemas.js';
import { BaseFormatter } from './base.js';

export class TorrentioFormatter extends BaseFormatter {
  constructor(userData: UserData) {
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
      userData
    );
  }
}

export class TorboxFormatter extends BaseFormatter {
  constructor(userData: UserData) {
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
      userData
    );
  }
}

export class GDriveFormatter extends BaseFormatter {
  constructor(userData: UserData) {
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
      userData
    );
  }
}

export class LightGDriveFormatter extends BaseFormatter {
  constructor(userData: UserData) {
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
      userData
    );
  }
}

export class PrismFormatter extends BaseFormatter {
  constructor(userData: UserData) {
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
      userData
    );
  }
}

export class MinimalisticGdriveFormatter extends BaseFormatter {
  constructor(userData: UserData) {
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
      userData
    );
  }
}
