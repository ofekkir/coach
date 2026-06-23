/** @type {import('@ladle/react').UserConfig} */
export default {
  // Served as a subpath of the viz app on Vercel (viz at /, catalog at /ladle),
  // so asset URLs and the router must be rooted at /ladle/.
  base: '/ladle/',
  // Build into the viz app's dist so a single Vercel output dir serves both.
  // Must run AFTER `vite build` (emptyOutDir wipes dist) — see vercel.json.
  outDir: 'dist/ladle',
};
