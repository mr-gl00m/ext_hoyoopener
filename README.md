# HoyoOpener

HoyoOpener is a small Manifest V3 Chrome extension that opens your selected HoYoLAB daily check-in pages at a scheduled local time.

## Features

- Per-game toggles for Genshin Impact, Honkai: Star Rail, Honkai Impact 3rd, and Zenless Zone Zero
- Configurable daily open time
- Asia, Europe, and America server reset tracking
- Toolbar badge showing the current check-in status
- Automatic recovery after missed or dropped browser alarms
- Manual check-in button for opening pages immediately

## Install

Node.js 20 or later is required to build the extension.

1. Download or clone this repository.
2. Build the extension:

   ```powershell
   npm ci
   npm run build
   ```

3. Open `chrome://extensions` in Chrome.
4. Enable **Developer mode**.
5. Select **Load unpacked** and choose the generated `dist/` directory.

## Development

```powershell
npm test
npm run build
```

## Permissions

HoyoOpener uses Chrome's storage, alarms, and notification permissions. Settings remain in local browser storage. The extension has no host permissions, content scripts, remote code, analytics, or user-configurable URLs.

## Support

If my work is interesting or useful to you, consider tossing something my way; it goes toward rent, food, and energy drinks, and every bit is genuinely appreciated.

[![Ko-fi](https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/mr_gl00m)
[![GitHub Sponsors](https://img.shields.io/badge/GitHub_Sponsors-EA4AAA?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sponsors/mr-gl00m)

**Crypto:**
- BTC: ```bc1qnedeq3dr2dmlwgmw2mr5mtpxh45uhl395prr0d```
- ETH: ```0x1bCbBa9854dA4Fc1Cb95997D5f42006055282e3c```
- SOL: ```3Wm8wS93UpG2CrZsMWHSspJh7M5gQ6NXBbgLHDFXmAdQ```
