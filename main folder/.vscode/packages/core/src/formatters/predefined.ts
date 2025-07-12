import { BaseFormatter, FormatterConfig } from './base';

export class TorrentioFormatter extends BaseFormatter {
  constructor(addonName?: string) {
    super(
      {
        name: `
{stream.proxied::istrue["🕵️‍♂️ "||""]}{stream.type::=p2p["[P2P] "||""]}{service.id::exists["[{service.shortName}"||""]}{service.cached::istrue["+] "||""]}{service.cached::isfalse[" download] "||""]}{addon.name} {stream.resolution::exists["{stream.resolution}"||"Unknown"]}
{stream.visualTags::exists["{stream.visualTags::join(' | ')}"||""]}      
`,
        description: `
{stream.message::exists["ℹ️{stream.message}"||""]}
{stream.folderName::exists["{stream.folderName}"||""]}
{stream.filename::exists["{stream.filename}"||""]}
{stream.size::>0["💾{stream.size::bytes2} "||""]}{stream.folderSize::>0["/ 💾{stream.folderSize::bytes2}"||""]}{stream.seeders::>=0["👤{stream.seeders} "||""]}{stream.age::exists["📅{stream.age} "||""]}{stream.indexer::exists["⚙️{stream.indexer}"||""]}
{stream.languageEmojis::exists["{stream.languageEmojis::join( / ')}"||""]}
`,
      },
      addonName
    );
  }
}

export class TorboxFormatter extends BaseFormatter {
  constructor(addonName?: string) {
    super(
      {
        name: `
{stream.proxied::istrue["🕵️‍♂️ "||""]}{stream.type::=p2p["[P2P] "||""]}{addon.name}{stream.library::istrue[" (Your Media) "||""]}{service.cached::istrue[" (Instant "||""]}{service.cached::isfalse[" ("||""]}{service.id::exists["{service.shortName})"||""]}{stream.resolution::exists[" ({stream.resolution})"||""]}
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
      addonName
    );
  }
}

export class GDriveFormatter extends BaseFormatter {
  constructor(addonName?: string) {
    super(
      {
        name: `
{stream.proxied::istrue["🕵️ "||""]}{stream.type::=p2p["[P2P] "||""]}{service.shortName::exists["[{service.shortName}"||""]}{service.cached::istrue["⚡] "||""]}{service.cached::isfalse["⏳] "||""]}{addon.name}{stream.library::istrue[" (Your Media)"||""]} {stream.resolution::exists["{stream.resolution}"||""]}{stream.regexMatched::exists[" ({stream.regexMatched})"||""]}
      `,
        description: `
{stream.quality::exists["🎥 {stream.quality} "||""]}{stream.encode::exists["🎞️ {stream.encode} "||""]}{stream.releaseGroup::exists["🏷️ {stream.releaseGroup}"||""]}
{stream.visualTags::exists["📺 {stream.visualTags::join(' | ')} "||""]}{stream.audioTags::exists["🎧 {stream.audioTags::join(' | ')} "||""]}{stream.audioChannels::exists["🔊 {stream.audioChannels::join(' | ')}"||""]}
{stream.size::>0["📦 {stream.size::bytes} "||""]}{stream.folderSize::>0["/ 📦 {stream.folderSize::bytes}"||""]}{stream.duration::>0["⏱️ {stream.duration::time} "||""]}{stream.seeders::>0["👥 {stream.seeders} "||""]}{stream.age::exists["📅 {stream.age} "||""]}{stream.indexer::exists["🔍 {stream.indexer}"||""]}
{stream.languages::exists["🌎 {stream.languages::join(' | ')}"||""]}
{stream.filename::exists["📁"||""]} {stream.folderName::exists["{stream.folderName}/"||""]}{stream.filename::exists["{stream.filename}"||""]}
{stream.message::exists["ℹ️ {stream.message}"||""]}
      `,
      },
      addonName
    );
  }
}

export class LightGDriveFormatter extends BaseFormatter {
  constructor(addonName?: string) {
    super(
      {
        name: `
{stream.proxied::istrue["🕵️ "||""]}{stream.type::=p2p["[P2P] "||""]}{service.shortName::exists["[{service.shortName}"||""]}{stream.library::istrue["☁️"||""]}{service.cached::istrue["⚡] "||""]}{service.cached::isfalse["⏳] "||""]}{addon.name}{stream.resolution::exists[" {stream.resolution}"||""]}{stream.regexMatched::exists[" ({stream.regexMatched})"||""]}
`,
        description: `
{stream.message::exists["ℹ️ {stream.message}"||""]}
{stream.title::exists["📁 {stream.title::title}"||""]}{stream.year::exists[" ({stream.year})"||""]}{stream.season::>=0[" S"||""]}{stream.season::<=9["0"||""]}{stream.season::>0["{stream.season}"||""]}{stream.episode::>=0[" • E"||""]}{stream.episode::<=9["0"||""]}{stream.episode::>0["{stream.episode}"||""]}
{stream.quality::exists["🎥 {stream.quality} "||""]}{stream.encode::exists["🎞️ {stream.encode} "||""]}{stream.releaseGroup::exists["🏷️ {stream.releaseGroup}"||""]}
{stream.visualTags::exists["📺 {stream.visualTags::join(' • ')} "||""]}{stream.audioTags::exists["🎧 {stream.audioTags::join(' • ')} "||""]}{stream.audioChannels::exists["🔊 {stream.audioChannels::join(' • ')}"||""]}
{stream.size::>0["📦 {stream.size::bytes} "||""]}{stream.folderSize::>0["/ 📦 {stream.folderSize::bytes}"||""]}{stream.duration::>0["⏱️ {stream.duration::time} "||""]}{stream.age::exists["📅 {stream.age} "||""]}{stream.indexer::exists["🔍 {stream.indexer}"||""]}
{stream.languageEmojis::exists["🌐 {stream.languageEmojis::join(' / ')}"||""]}
`,
      },
      addonName
    );
  }
}

export class MinimalisticGdriveFormatter extends BaseFormatter {
  constructor(addonName?: string) {
    super(
      {
        name: '{stream.title} {stream.quality}',
        description: '{stream.size::bytes} {stream.seeders} seeders',
      },
      addonName
    );
  }
}
