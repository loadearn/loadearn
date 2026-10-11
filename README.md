# LoadEarn client

Source for the LoadEarn browser extension. Published so anyone can verify what runs on their machine.

## What the extension does

- Detects when ChatGPT, Claude, Gemini or DeepSeek is generating a reply, using only page structure such as the stop button.
- Shows one sponsored line below the user's last message, labelled "Sponsored · LoadEarn".
- Counts a view after 10 seconds on screen while the tab is visible, focused and in use.

## What it never does

- Read the text of prompts, replies or any other page content.
- Run code received from a server. Remote configuration is data only and is validated before use.
- Run in private browsing windows.

## Data sent

| Destination | When | Fields |
| --- | --- | --- |
| `api.loadearn.com` | Ad request, config refresh, event upload | Site, event id, view id, type, ad source, ad id, timestamp |
| `loadearn.com/uninstalled` | Opened by the browser after uninstall | Extension version, random install id |

## Development

Requires Node.js 22+ and pnpm 9.

```sh
pnpm install
pnpm dev            # Chrome with hot reload
pnpm --filter @loadearn/extension dev:firefox
pnpm test
pnpm typecheck
pnpm build          # .output/chrome-mv3
pnpm --filter @loadearn/extension build:local   # .output/chrome-mv3-localstack, wired to localhost:3000 (API) and localhost:3001 (site)
```

Development builds talk to `http://localhost:3000`, so testing never creates real impressions. Override the API with `WXT_API_BASE`; production builds accept HTTPS origins only.

## License

[PolyForm Strict 1.0.0](LICENSE). Copyright © 2026 Norakon.
