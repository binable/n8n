const { src, dest } = require('gulp');

// Copies node icons and i18n translation files into the dist folder, preserving
// structure, so that `icon: 'file:binable.svg'` and the per-locale translation
// files (nodes/Binable/translations/<locale>/<node>.json) resolve at runtime.
function buildIcons() {
	return src(['nodes/**/*.{png,svg}', 'nodes/**/translations/**/*.json'], {
		base: '.',
		encoding: false,
	}).pipe(dest('dist'));
}

exports['build:icons'] = buildIcons;
