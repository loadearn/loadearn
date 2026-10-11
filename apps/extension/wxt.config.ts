import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  imports: false,
  zip: {
    artifactTemplate: 'loadearn-{{version}}-{{browser}}.zip',
    sourcesTemplate: 'loadearn-{{version}}-sources.zip',
    sourcesRoot: '../..',
    excludeSources: ['**/.output/**', '**/.wxt/**', '**/coverage/**', '.agents/**', '.claude/**', 'skills-lock.json'],
  },
  manifest: ({ browser, mode, command }) => ({
    name: 'LoadEarn',
    description: 'Get paid while AI thinks. One sponsored line while your AI chat is writing a reply.',
    homepage_url: 'https://loadearn.com',
    permissions: ['storage', 'alarms'],
    host_permissions:
      command === 'serve' || mode === 'localstack'
        ? ['https://api.loadearn.com/*', 'http://localhost:3000/*']
        : ['https://api.loadearn.com/*'],
    incognito: 'not_allowed',
    action: { default_title: 'LoadEarn' },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'extension@loadearn.com',
          strict_min_version: '140.0',
          data_collection_permissions: { required: ['browsingActivity', 'websiteActivity'] },
        },
      },
    }),
  }),
});
