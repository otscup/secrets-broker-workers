// Check-only update helper. It never downloads or installs anything; the
// caller gets the release URL so a human can choose when to update.
const REPO = 'otscup/secrets-broker-workers'

export function compareVersions(a, b) {
  const parse = (value) => {
    const clean = String(value || '').trim().replace(/^v/i, '')
    const [core, pre = ''] = clean.split('-', 2)
    const nums = core.split('.').map((part) => Number(part))
    if (nums.length !== 3 || nums.some((part) => !Number.isInteger(part) || part < 0)) {
      throw new Error('not a semantic version: ' + value)
    }
    return { nums, pre }
  }
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < 3; index += 1) {
    if (left.nums[index] !== right.nums[index]) return left.nums[index] - right.nums[index]
  }
  if (left.pre === right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  return left.pre.localeCompare(right.pre)
}

export async function checkForUpdate({
  repo = REPO,
  current,
  fetchImpl = fetch,
  token = process.env.GITHUB_TOKEN,
} = {}) {
  if (!current) throw new Error('current version is required')
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'secrets-broker-update-check',
  }
  if (token) headers.Authorization = 'Bearer ' + token
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, { headers })
  if (response.status === 404) {
    return { current: String(current), latest: '', update: false, url: '', download: '', noReleases: true }
  }
  if (response.status === 403 || response.status === 429) {
    return { current: String(current), latest: '', update: false, url: '', download: '', rateLimited: true }
  }
  if (!response.ok) throw new Error(`GitHub releases returned ${response.status}`)
  const release = await response.json()
  const latest = String(release.tag_name || release.name || '').replace(/^v/i, '')
  if (!latest) throw new Error('latest release has no tag_name')
  return {
    current: String(current),
    latest,
    update: compareVersions(latest, current) > 0,
    url: release.html_url || '',
    download: (release.assets || []).find((asset) => /\.msi$/i.test(asset.name || ''))?.browser_download_url || '',
  }
}
