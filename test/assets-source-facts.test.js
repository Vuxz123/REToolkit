import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createUnityFixture} from './fixtures/unity-export-fixture.mjs';
import {createUnitySourceFacts} from '../src/assets/source-facts.js';
import {indexUnityProject} from '../src/assets/graph.js';

test('library staging facts preserve full source identities without pretending to contain serialized objects',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-source-facts-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const fixture=await createUnityFixture(root),binding={test:'exact'},full=await indexUnityProject(fixture.projectDir,{binding}),facts=await createUnitySourceFacts(fixture.projectDir,{binding});assert.equal(facts.kind,'retoolkit-unity-source-facts');assert.equal(facts.coverage.serializedReferences,'unverified');assert.equal(facts.nodes,undefined);assert.equal(facts.edges,undefined);assert.equal(facts.revision,full.revision);assert.deepEqual(facts.files,full.files);assert.deepEqual(facts.assets,full.assets);assert.equal(facts.unityVersion,full.unityVersion);
});
