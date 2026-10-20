import test from 'node:test';
import assert from 'node:assert/strict';
import {Motion,pointStats,regionStats} from '../public/motion.js';
const event=times=>({eventType:'stream',ballId:'ball',samples:times.map(timestamp=>({timestamp})),velocities:times.map(t=>[2*t,3*t,-9.8*t])});
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} should be ${b}`);

test('recording boundaries, axis swap, integration and derivative',()=>{
  const m=new Motion();m.push(event([0,.1]));assert.equal(m.rows.length,0);
  m.start();m.push(event(Array.from({length:101},(_,i)=>i/100)));
  const last=m.rows.at(-1);
  [1,-4.9,1.5].forEach((v,i)=>approx(last.p[i],v));
  [2,-9.8,3].forEach((v,i)=>{approx(last.v[i],v);approx(last.a[i],v);});
  m.stop();m.push(event([2]));assert.equal(m.rows.length,101);
  m.start();assert.equal(m.rows.length,0);m.push(event([10,10.1]));assert.equal(m.rows[0].t,0);
});
test('data gaps, reversed clocks and wrong balls stop instead of inventing a trajectory',()=>{
  const m=new Motion();m.start();m.push(event([0,.1,1]));assert.equal(m.recording,false);assert.equal(m.rows.length,2);
  m.start();m.push(event([2,2.1,0]));assert.equal(m.recording,false);assert.equal(m.rows.length,2);
  m.start();m.push(event([0,.1]));m.push({...event([.2]),ballId:'other'});assert.equal(m.recording,false);
});
test('local derivative handles nonuniform sample timing',()=>{
  const t=[0,.1,.4,.9,1];const y=t.map(v=>v*v);
  approx(pointStats(t,y,.4).slope,.8);
  assert.equal(pointStats([0],[2],0).slope,null);
  assert.equal(pointStats([0,1],[NaN,2],0),null);
});
test('region uses interpolated boundaries, weighted mean, and signed peak',()=>{
  const r=regionStats([0,1,3],[1,3,7],2,.5);
  approx(r.mean,3.5);approx(r.slope,2);approx(r.peak,5);
  const impact=regionStats([0,1,2],[0,-10,2],0,2);
  assert.equal(impact.peak,-10);assert.equal(impact.max,2);assert.equal(impact.min,-10);
  assert.equal(regionStats([0,1],[NaN,1],0,1),null);
  assert.equal(regionStats([0,1],[0,1],.5,.5),null);
});
