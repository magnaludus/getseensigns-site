# Vendored libraries

Every file here is a third-party library copied or built at a pinned version. Licenses must be
MIT, BSD, Apache-2.0 or OFL. Nothing here is loaded from a CDN.

| File | Library | Version | License | Notes |
|---|---|---|---|---|
| `three.module.min.js` | [three.js](https://github.com/mrdoob/three.js) | 0.186.1 | MIT (`three.LICENSE`) | Tree-shaken ES module bundle of the names listed in `.design-dev/scripts/three-entry.js`, minified with esbuild 0.25.5. The npm package ships no `.min.js`, so it is built from the pinned release. Loaded only when the 3D view opens. |

## Rebuild

```
cd .design-dev
npm install
npm run vendor
```

The build reads `three@0.186.1` from `.design-dev/node_modules` and rewrites
`three.module.min.js` and `three.LICENSE`. To add a Three.js export, add its name to
`three-entry.js` and rebuild. To upgrade, change the version in `.design-dev/package.json`,
reinstall, rebuild, and update this table.

Phase 3 adds `pdf-lib` (MIT) and `opentype.js` (MIT) here. They are not vendored in Phase 1.
