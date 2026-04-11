// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	redirects: {
		'/libraries/results': '/libraries/results/overview/',
	},
	integrations: [
		starlight({
			title: 'Haitch',
			logo: {
				src: './src/assets/haitch-logo.svg',
			},
			customCss: ['./src/styles/custom.css'],
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/HaitchDev' }],
			sidebar: [
				{
					label: 'Haitch.Results',
					autogenerate: { directory: 'libraries/results' },
				},
			],
		}),
	],
});
