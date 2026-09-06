# Releases and hosting

**English** · [Deutsch](RELEASING.de.md) · [Game README](../README.md)

The open-source repository is [t3ramos/neustadt](https://github.com/t3ramos/neustadt), owned by the personal account **t3ramos**. Original source and assets are released under the [MIT License](../LICENSE); third-party components retain the licenses documented in [ASSETS.md](../ASSETS.md).

## Verify and package

```sh
npm ci
npm test
npm run build -- --outDir dist-release
cp LICENSE dist-release/LICENSE
```

Use a clean output directory for every release. `dist-release/` is a static website build. Its relative asset paths support both a domain root and a project path such as `/neustadt/`. Serve it over HTTP or HTTPS; opening `index.html` directly using `file://` is unsupported.

Package only the contents of this fresh build, keeping `index.html`, `LICENSE`, `assets/`, and `licenses/` at the ZIP root. `licenses/neustadt.txt` also contains the identical MIT license for the game; the other license files preserve the third-party notices. Local QA output, personal saves, browser captures, `node_modules/`, and older builds do not belong in the repository or website ZIP. The source repository contains the game code and tests; the website ZIP contains the compiled browser game, the game’s MIT license, and the bundled third-party license notices.

The **Test and build** workflow installs locked dependencies, runs tests, type-checks and builds the game, and uploads a Pages website artifact for eligible runs. Pull requests run the same checks without publishing the website. Use a release tag matching the version in `package.json`, for example `v2.1.0`, and attach the clean website ZIP with the corresponding release notes.

## GitHub Pages

Play in your browser: **[t3ramos.github.io/neustadt](https://t3ramos.github.io/neustadt/)**. This is a public repository and a public website; it does not need the private-repository Pages plan upgrade. GitHub Pages is available for public repositories on GitHub Free, subject to GitHub's service limits. See [GitHub's Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

Repository setup:

1. In **Settings → Pages**, select **GitHub Actions** as the build and deployment source.
2. Set the repository Actions variable **PAGES_ENABLED** to `true`.
3. Run **Test and build** on `main`, or push the completed changes to `main`.
4. Check the successful deployment in the `github-pages` environment and open the published game address.

The deployment job runs only for `main`, after the build succeeds, when `PAGES_ENABLED` is `true`. Pull requests and version tags do not independently deploy the website. Set the variable to `false` or remove it to stop automatic future deployments; this does not remove an already published website.

Before announcing a release, verify the actual hosted URL, asset loading under `/neustadt/`, language switching, and save export/import. A successful local build or uploaded artifact alone is not confirmation that Pages is live. The repository remains public when Pages is enabled, so both the original source and browser build are publicly accessible.

## Player saves

Saves stay in the player's browser and are not uploaded to GitHub. A local city does not automatically appear at the online address. To move it:

1. Open the local game in the browser profile holding the city.
2. Use **City menu → Export save** and keep the downloaded JSON file.
3. Open the hosted game and use **City menu → Import save** to select that file.

Importing replaces the active city at the destination. The old local save remains associated with the local address. Export/import is also needed when changing domain, browser profile, or device. Keep JSON backups before clearing browser data.
