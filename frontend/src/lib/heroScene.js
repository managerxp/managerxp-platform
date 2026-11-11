import { mountScene } from './scene3d';
import india3d from './scenes/india3d';

/*
 * The homepage hero's 3D scene (interactive India map), as one lazily-loaded
 * chunk with three.js and GSAP. On phones and other fallback devices the
 * page shows a still poster instead (src/assets/hero/network-poster.webp),
 * rendered from this scene's finished state: re-render it whenever the
 * scene changes.
 */
export const mountHeroScene = (host, opts = {}) => mountScene(host, india3d, { interactive: true, ...opts });
