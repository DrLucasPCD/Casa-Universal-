import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../static/app.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('function climatePresets(d){'),source.indexOf('function climateFeature('));
const presets=vm.runInNewContext(body+';climatePresets');
test('all Philco signals retain distinct mode, fan, swing and temperature selections',()=>{
 const profile=JSON.parse(readFileSync(new URL('../catalog/profiles/climate_3000.json',import.meta.url)));
 const rows=presets({actions:Object.keys(profile.commands)});
 assert.equal(rows.length,408);
 const key=r=>[r.mode,r.fan,r.swing,r.temperature].join(':');
 assert.equal(new Set(rows.map(key)).size,408);
 assert.equal(rows.find(r=>r.action==='heat_cool_mid_swing_24').mode,'auto');
 assert.equal(rows.find(r=>r.action==='cool_mid_stop_24').fan,'medium');
 assert.ok(rows.some(r=>r.mode==='heat'&&r.temperature===24));
 assert.ok(rows.some(r=>r.mode==='cool'&&r.swing==='swing'&&r.temperature===24));
});
test('learned climate presets retain configured meaning without inventing a temperature for arbitrary buttons',()=>{
 const rows=presets({actions:['custom_abc','temperature_up'],generic_remote:{buttons:[{id:'custom_abc',preset:{mode:'cool',fan:'low',swing:'swing',temperature:22}}],sources:{}}});
 assert.equal(rows.length,1);assert.equal(rows[0].temperature,22);assert.equal(rows[0].swing,'swing');
});
