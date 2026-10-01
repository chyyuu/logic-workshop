import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const installedChromium = 'C:/Users/chyyy/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const externalBase = process.env.LOGIC_WORKSHOP_TEST_URL;
export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.ts',
  workers: 1,
  use: {
    baseURL: externalBase ?? 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1000 },
    launchOptions: existsSync(installedChromium) ? { executablePath: installedChromium } : {},
    screenshot: 'only-on-failure',
  },
  webServer: externalBase ? undefined : { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
});
