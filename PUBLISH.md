# Publishing dsh-provod-analytics to a Private Registry

> **GitHub without npm is also supported.** If the plugin can live in a public
> GitHub repository, the plugin-market index plus a pinned git source needs no
> registry at all — see [GITHUB.md](GITHUB.md). This file covers the npm route,
> including GitHub Packages.

This guide covers publishing to **GitHub Packages** (recommended for GitHub repos) or any npm-compatible registry.

## 1. Prepare the package

### For GitHub Packages: scope the package name

Edit `package.json` and change the `name` to include your GitHub username/org:

```json
"name": "@your-github-username/dsh-provod-analytics",
```

Also update `repository.url` and `homepage` to point to your actual repo.

### For other registries (npmmirror, Verdaccio, etc.)

Keep the name as `dsh-provod-analytics` or scope it per registry requirements.

## 2. Authenticate with the registry

### GitHub Packages

```bash
# Create a Personal Access Token (PAT) with 'packages:write' scope
# https://github.com/settings/tokens

# Login
npm login --registry=https://npm.pkg.github.com
# Username: your-github-username
# Password: your-PAT
# Email: your-email
```

### Other registries

```bash
npm login --registry=https://your-registry.example.com
```

## 3. Publish

```bash
cd dsh-provod-analytics
npm publish --registry=https://npm.pkg.github.com
# or for other registries:
# npm publish --registry=https://your-registry.example.com
```

## 4. Verify publication

```bash
npm view @your-github-username/dsh-provod-analytics --registry=https://npm.pkg.github.com
```

## 5. Add to a Plugin Market Index

For the plugin to appear in **Plugins → Discover**, it must be listed in a plugin market index (JSON file served via HTTP).

### Option A: Create your own index

Create `index.json` (format version 1):

```json
{
  "format": 1,
  "title": "My Plugin Index",
  "description": "Custom plugins for my team",
  "plugins": [
    {
      "name": "@your-github-username/dsh-provod-analytics",
      "title": { "en": "Provod Spending" },
      "description": { "en": "Provod analytics spending panel for DSH" },
      "icon": "https://raw.githubusercontent.com/your-github-username/dsh-provod-analytics/main/icon.svg",
      "repository": {
        "url": "https://github.com/your-github-username/dsh-provod-analytics"
      },
      "versions": [
        {
          "version": "0.1.0",
          "publishTimestamp": 1700000000,
          "source": {
            "type": "npm",
            "registry": "https://npm.pkg.github.com"
          },
          "engines": {
            "dsh": ">=0.2.2"
          }
        }
      ]
    }
  ]
}
```

Host this file (e.g., GitHub Pages, any static hosting), then in DSH:
- Settings → Plugins → Plugin Market Indexes
- Add your index URL

### Option B: Submit to official DSH index

If published to public npmjs.org, you can request inclusion in the official index maintained by DeepSeek.

## 6. Install from Discover

After the index is configured:
1. Open **Plugins** → **Discover**
2. Search "provod"
3. Click **Install**

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `403 Forbidden` on publish | Check PAT scopes (`packages:write`) and registry URL |
| `404 Not Found` on install | Verify index JSON is valid and hosted correctly |
| Plugin not in Discover | Check index URL in Settings → Plugins; verify index format with `dsh-plugin-market-index` |
| Version not showing | Increment version in `package.json` and republish |

## Updating

```bash
# Bump version
npm version patch  # or minor/major

# Republish
npm publish --registry=https://npm.pkg.github.com

# Update index.json with new version entry
```