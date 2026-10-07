// "Is there a newer version?": one request to GitHub's public releases API, only when the user switched
// it on (Settings → More settings → "Check for new versions"), and at most once a day. It sends nothing
// about the user or the machine; GitHub sees an ordinary request for a public page.

use serde::{Deserialize, Serialize};

/// The fork's repository.
const LATEST: &str = "https://api.github.com/repos/Lapius7/coucou-repatch/releases/latest";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// "v1.2.1".
    pub tag: String,
    pub url: String,
    /// True when that is newer than the version that is running.
    pub newer: bool,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
}

/// "v1.10.2" → (1, 10, 2); anything that is not that → None.
fn parse(version: &str) -> Option<(u64, u64, u64)> {
    let v = version.trim().trim_start_matches('v');
    let mut parts = v.split(|c: char| c == '.' || c == '-').map(|p| p.parse::<u64>().ok());
    Some((parts.next()??, parts.next()??, parts.next()??))
}

/// Is `latest` a higher version than `current`?
pub fn is_newer(latest: &str, current: &str) -> bool {
    matches!((parse(latest), parse(current)), (Some(a), Some(b)) if a > b)
}

pub async fn check() -> Result<UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent(concat!("coucou-update-check/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let release: Release = client
        .get(LATEST)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    // Only ever open a page on github.com (the link is shown to the user and handed to the browser).
    let url = if release.html_url.starts_with("https://github.com/") { release.html_url } else { String::new() };
    let newer = is_newer(&release.tag_name, env!("CARGO_PKG_VERSION"));
    Ok(UpdateInfo { tag: release.tag_name, url, newer })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_compared_by_number_not_by_text() {
        assert!(is_newer("v1.2.1", "1.2.0"));
        assert!(is_newer("v1.10.0", "1.9.9"));
        assert!(is_newer("2.0.0", "1.99.99"));
        assert!(!is_newer("v1.2.0", "1.2.0"));
        assert!(!is_newer("v1.1.9", "1.2.0"));
    }

    #[test]
    fn something_that_is_not_a_version_is_never_newer() {
        assert!(!is_newer("nightly", "1.2.0"));
        assert!(!is_newer("v1.2", "1.2.0"));
        assert!(!is_newer("", "1.2.0"));
    }
}
