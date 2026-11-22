# dsh-provod-analytics

DSH plugin: **Provod spending panel** — adds a "Spending" panel to the DSH sidebar showing Provod workspace analytics.

## Features

- **Today & Month-to-date totals** — current spending summary
- **Month-end forecast** — projected spending based on current rate
- **Daily breakdown** — spending by day with bar chart
- **Model breakdown** — costs grouped by model with charts and tables
- **Model efficiency** — input cache hits, error rate, response time, speed & price per million tokens
- **Model latency** — median, p90, and medians at similar output size

## Requirements

- DSH 0.2.2+ with Web interface
- Provod workspace **management key** (not a regular API key)
- Network access to `https://api.provod.ai`

## Installation

### From GitHub (no npm registry)

A public GitHub repository is enough: the plugin is installed from a pinned
commit, and GitHub Actions commits the plugin-market index (`index.json`) back
to the branch. `GITHUB.md` has the full walkthrough; the short form is:

1. Push this package to the repository root.
2. The first push runs **Actions → Update plugin index**, which commits
   `index.json`.
3. Add its raw URL as a market source in **Plugins → Discover**, or install
   directly with the pinned git spec:

   ```text
   plugin_manager action=install_bundle
   target=git+https://github.com/<owner>/<repo>.git#<40-hex commit>
   ```

   Index URL: `https://raw.githubusercontent.com/<owner>/<repo>/main/index.json`

### From an npm registry

Publish with `npm publish` (see `PUBLISH.md`, including GitHub Packages), then:

1. Open **Plugins** → **Discover**
2. Search for "provod"
3. Click **Install** on "dsh-provod-analytics"

### Manual installation

```bash
# Clone or download the plugin
git clone https://github.com/zakn112/dsh-provod-analytics.git

# In DSH: Plugins → Add plugin → select the plugin directory
```

## Configuration

After installation, open the **Spending** panel from the sidebar and:

1. Click the **Key** section
2. Paste your Provod workspace **management key**
3. Click **Save key**

The key is stored in DSH's credential store and never sent to the browser.

Alternatively, set the `PROVOD_MANAGEMENT_API_KEY` environment variable before starting DSH.

## Data privacy

- All API requests are made from the **Host** (your machine), not the browser
- The management key never reaches the browser
- Only the key and date ranges are sent to `api.provod.ai`
- No session data is read or modified
- Disabling the plugin removes the panel and routes

## Limits

- Provod analytics API: 2 requests/second, 30 requests/minute
- Each panel refresh makes 4 API requests

## License

MIT