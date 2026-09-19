import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  webServer:{command:'npx wrangler dev --config wrangler.dev.toml --local --env-file tests/demo.env --port 8789 --persist-to .wrangler/browser-tests',url:'http://127.0.0.1:8789/api/auth/session',reuseExistingServer:false,timeout:120000},
  testDir:'./tests/browser',fullyParallel:false,workers:1,
  use:{baseURL:'http://127.0.0.1:8789',headless:true,channel:'chrome',trace:'retain-on-failure'},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{...devices['Pixel 7'],defaultBrowserType:'chromium'}}],
});
