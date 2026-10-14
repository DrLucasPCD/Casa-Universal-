import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../static/visuals.js',import.meta.url),'utf8');
const window={matchMedia:()=>({matches:false,addEventListener(){}})};
vm.runInNewContext(code,{window,document:{addEventListener(){}}});
const stateFor=window.CasaVisuals.stateFor;
test('IR settings and unavailable readings never become confirmed animation states',()=>{
 const ir={available:true,state:'unknown',telemetry:{target_temperature:24},actions:['power_on']};
 assert.equal(stateFor(ir).active,false);assert.equal(stateFor(ir).confirmed,false);
 assert.equal(stateFor({...ir,available:false,state:'on'}).active,false);
 assert.equal(stateFor({...ir,state:'on'}).active,true);
 const preview=stateFor(ir,true);assert.equal(preview.active,true);assert.equal(preview.preview,true);assert.equal(preview.confirmed,false);
});
test('product scenes only render bounded numeric readings and valid colors',()=>{
 const state=stateFor({state:'unknown',telemetry:{position_percent:true,brightness_percent:NaN,color_hex:'red',target_temperature:Infinity}});
 assert.equal(state.position,null);assert.equal(state.temperature,null);assert.equal(state.brightness,70);assert.equal(state.color,'#eddbb7');
 assert.equal(stateFor({telemetry:{position_percent:79,brightness_percent:64.2,color_hex:'#ffffff'}}).position,79);
});
