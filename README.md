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
