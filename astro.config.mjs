// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	redirects: {
		'/libraries/results': '/libraries/results/overview/',
		'/libraries/unions': '/libraries/unions/overview/',
		'/libraries/roslyn': '/libraries/roslyn/overview/',
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
					label: 'Haitch.Unions',
					autogenerate: { directory: 'libraries/unions' },
				},
				{
					label: 'Haitch.Roslyn',
					autogenerate: { directory: 'libraries/roslyn' },
				},
				{
					label: 'Haitch.Results (deprecated)',
					autogenerate: { directory: 'libraries/results' },
				},
			],
		}),
	],
});
