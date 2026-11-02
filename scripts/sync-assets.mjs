// Copies takram's precomputed atmosphere and cloud textures from node_modules into public/assets,
// so the site serves its own copies (no third-party hosts at runtime). Runs before dev and build.
import { cpSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = (name)=>path.join(root, 'node_modules/@takram', name, 'assets');
const out = path.join(root, 'public/assets');

/* combined scattering is on, so the single-Mie table is never requested */
const copy = (from, to, keep)=>{
  mkdirSync(to, { recursive:true });
  for(const f of readdirSync(from).filter(keep)) if(!existsSync(path.join(to, f))) cpSync(path.join(from, f), path.join(to, f));
};
copy(pkg('three-atmosphere'), path.join(out, 'atmosphere'), (f)=>f.endsWith('.exr') && !f.startsWith('single_mie'));
copy(pkg('three-clouds'), path.join(out, 'clouds'), ()=>true);
if(!existsSync(path.join(out, 'stbn.bin'))) throw new Error('public/assets/stbn.bin is missing (it is committed to the repo)');
console.log('assets ready in public/assets');
