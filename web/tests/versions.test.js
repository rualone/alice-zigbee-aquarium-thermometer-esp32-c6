import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareVersions} from '../versions.js';
test('numeric releases, equivalent formats and unknown versions',()=>{
 assert.equal(compareVersions('1.10','1.9'),1);
 assert.equal(compareVersions('0.8','1.0'),-1);
 assert.equal(compareVersions('1.0','1.0.0'),0);
 for(const v of ['',null,'1.0-dev','v1.0','garbage'])assert.equal(compareVersions(v,'1.0'),null);
});
