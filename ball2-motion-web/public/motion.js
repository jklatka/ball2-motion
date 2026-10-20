export class Motion {
  constructor() {this.clear();}
  clear() {
    this.rows = []; this.recording = false; this.previous = null;
    this.origin = null; this.position = [0,0,0]; this.ball = null;
    this.message = 'Ready for a new trial.';
  }
  start() {if (this.recording) return; this.clear(); this.recording = true; this.message = 'Recording — make your motion, then press Stop.';}
  stop(message = 'Trial stopped. Tap a point or drag across a region to inspect it.') {this.recording = false; this.message = message;}
  push(event) {
    if (!this.recording || event?.eventType !== 'stream') return;
    if (this.ball !== null && this.ball !== event.ballId) {this.stop('A different ball connected. Start a new trial.');return;}
    if (!Array.isArray(event.samples) || !Array.isArray(event.velocities) || !event.velocities.length) {
      this.message = 'Waiting for velocity data. Enable Raw IMU stream in Sensor Lab.';return;
    }
    for (let i=0; i<Math.min(event.samples.length,event.velocities.length); i++) {
      const t = event.samples[i]?.timestamp, raw = event.velocities[i];
      if (!Number.isFinite(t) || !Array.isArray(raw) || raw.length !== 3 || !raw.every(Number.isFinite)) continue;
      const v = [raw[0],raw[2],raw[1]];
      const a = [NaN,NaN,NaN];
      if (this.previous) {
        const dt=t-this.previous.t;
        if (dt===0) continue;
        if (dt<0 || dt>.5) {this.stop('Sensor clock changed or samples were lost. Trial stopped to preserve valid data.');return;}
        for (let axis=0;axis<3;axis++) {
          this.position[axis] += .5*(this.previous.v[axis]+v[axis])*dt;
          a[axis] = (v[axis]-this.previous.v[axis])/dt;
        }
      }
      this.ball = event.ballId;
      if (this.origin===null) this.origin=t;
      this.previous = {t,v};
      this.rows.push({t:t-this.origin,p:[...this.position],v,a});
      if (this.rows.length>=200000) {this.stop('Trial reached 200,000 samples. Export it before starting another.');return;}
    }
  }
}

export function pointStats(times,values,target) {
  if (!times.length) return null;
  let lo=0,hi=times.length-1;
  while(lo<hi) {const mid=(lo+hi)>>1;if(times[mid]<target)lo=mid+1;else hi=mid;}
  let i=lo;
  if(i>0 && Math.abs(times[i-1]-target)<Math.abs(times[i]-target))i--;
  if(!Number.isFinite(values[i]))return null;
  const near=[];
  for(let n=Math.max(0,i-1);n<Math.min(times.length,i+2);n++)if(Number.isFinite(values[n]))near.push(n);
  let slope=null;
  if(near.length===2) {const[a,b]=near;slope=(values[b]-values[a])/(times[b]-times[a]);}
  if(near.length===3) {
    slope=0;
    for(const n of near) {const[j,k]=near.filter(x=>x!==n);slope+=values[n]*(2*times[i]-times[j]-times[k])/((times[n]-times[j])*(times[n]-times[k]));}
  }
  return {time:times[i],value:values[i],slope};
}

export function regionStats(times,values,left,right) {
  if(left>right)[left,right]=[right,left];
  let first=null,last=null,duration=0,area=0,peak=null,peakTime=0,min=Infinity,max=-Infinity;
  for(let i=0;i<times.length-1;i++) {
    const t0=times[i],t1=times[i+1],y0=values[i],y1=values[i+1];
    const lo=Math.max(left,t0),hi=Math.min(right,t1);
    if(hi<=lo || !Number.isFinite(y0) || !Number.isFinite(y1))continue;
    const a=y0+(y1-y0)*(lo-t0)/(t1-t0),b=y0+(y1-y0)*(hi-t0)/(t1-t0);
    if(first===null)first={t:lo,y:a};last={t:hi,y:b};
    area+=(hi-lo)*(a+b)/2;duration+=hi-lo;
    for(const[t,y]of[[lo,a],[hi,b]]) {
      min=Math.min(min,y);max=Math.max(max,y);
      if(peak===null || Math.abs(y)>Math.abs(peak)){peak=y;peakTime=t;}
    }
  }
  return first ? {left:first.t,right:last.t,mean:area/duration,slope:(last.y-first.y)/(last.t-first.t),peak,peakTime,min,max}:null;
}
