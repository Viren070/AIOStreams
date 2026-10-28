//! The licences of what the app ships besides the page, in the page's list shape.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Each distinct text once; a library lists the indexes of its own.
#[derive(Debug, Default, Serialize)]
pub struct LicenseList {
    pub texts: Vec<String>,
    pub libraries: Vec<Library>,
}

#[derive(Debug, Serialize)]
pub struct Library {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// An SPDX expression.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub licence: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub texts: Vec<usize>,
}

/// The libs release's `licenses/index.json`, with each library's files in `licenses/<name>/`.
#[derive(Deserialize)]
struct Index {
    libraries: Vec<IndexEntry>,
}

#[derive(Deserialize)]
struct IndexEntry {
    name: String,
    #[serde(default)]
    pins: BTreeMap<String, String>,
    files: Vec<String>,
}

/// `cargo about generate --format json`: each licence text with the crates under it.
#[derive(Deserialize)]
struct About {
    licenses: Vec<AboutLicence>,
}

#[derive(Deserialize)]
struct AboutLicence {
    text: String,
    used_by: Vec<UsedBy>,
}

#[derive(Deserialize)]
struct UsedBy {
    #[serde(rename = "crate")]
    krate: Crate,
}

#[derive(Deserialize)]
struct Crate {
    name: String,
    version: String,
    license: Option<String>,
    repository: Option<String>,
}

impl LicenseList {
    fn append(&mut self, other: LicenseList) {
        let offset = self.texts.len();
        self.texts.extend(other.texts);
        self.libraries
            .extend(other.libraries.into_iter().map(|mut l| {
                l.texts.iter_mut().for_each(|t| *t += offset);
                l
            }));
    }
}

/// The native libraries in `<dir>/licenses` and the crates in `<dir>/third-party-licenses.json`,
/// each from the first of `dirs` that has it.
pub fn read(dirs: &[PathBuf]) -> LicenseList {
    let mut list = LicenseList::default();
    if let Some(natives) = dirs.iter().find_map(|d| natives(&d.join("licenses"))) {
        list.append(natives);
    }
    let crates = dirs.iter().find_map(|d| {
        let json = fs::read(d.join("third-party-licenses.json")).ok()?;
        serde_json::from_slice::<About>(&json).ok()
    });
    if let Some(about) = crates {
        list.append(crates_of(about));
    }
    list
}

fn crates_of(about: About) -> LicenseList {
    let mut list = LicenseList::default();
    let mut index = BTreeMap::new();
    for licence in about.licenses {
        list.texts.push(licence.text.trim().to_owned());
        let text = list.texts.len() - 1;
        for UsedBy { krate } in licence.used_by {
            let at =
                *index
                    .entry((krate.name.clone(), krate.version.clone()))
                    .or_insert_with(|| {
                        list.libraries.push(Library {
                            url: Some(krate.repository.unwrap_or_else(|| {
                                format!("https://crates.io/crates/{}", krate.name)
                            })),
                            name: krate.name,
                            version: Some(krate.version),
                            licence: krate.license,
                            texts: Vec::new(),
                        });
                        list.libraries.len() - 1
                    });
            list.libraries[at].texts.push(text);
        }
    }
    list
}

fn natives(dir: &Path) -> Option<LicenseList> {
    let index: Index = serde_json::from_slice(&fs::read(dir.join("index.json")).ok()?).ok()?;
    let mut list = LicenseList::default();
    for entry in index.libraries {
        let texts = entry
            .files
            .iter()
            .filter_map(|f| fs::read_to_string(dir.join(&entry.name).join(f)).ok())
            .map(|text| {
                list.texts.push(text.trim().to_owned());
                list.texts.len() - 1
            })
            .collect();
        // shaderc pins its dependencies too.
        let own = format!("v_{}", entry.name.replace('-', "_"));
        let version = entry
            .pins
            .get(&own)
            .or_else(|| entry.pins.values().next())
            .cloned();
        list.libraries.push(Library {
            name: entry.name,
            version,
            licence: None,
            url: None,
            texts,
        });
    }
    Some(list)
}
