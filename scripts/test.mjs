import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
const dir=await mkdtemp('.test-build-');
try {
  await build({entryPoints:['tests/core.test.ts'],outfile:`${dir}/core.test.cjs`,bundle:true,loader:{'.sql':'text'},platform:'node',format:'cjs',target:'node22'});
  const result=spawnSync(process.execPath,['--test',`${dir}/core.test.cjs`],{stdio:'inherit'});
  process.exitCode=result.status ?? 1;
} finally {await rm(dir,{recursive:true,force:true});}
