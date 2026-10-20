import {Motion, pointStats, regionStats} from './motion.js';

const $ = id => document.getElementById(id);
const motion = new Motion();
let axis=0, selection=null, pairing=null, socket=null, producer=false;
let retries=0, lastReceived=0, reconnectTimer, dirty=true, rebuilding=false;
const fields=['p','v','a'];
const units={p:'m',v:'m/s',a:'m/s²'};
const slopeUnits={p:'m/s',v:'m/s²',a:'m/s³'};
const colors={p:'#4076c8',v:'#178575',a:'#cc812e'};
const plots=new Map();
const fmt = value => value===null || !Number.isFinite(value) ? '—' : Number(value.toPrecision(4)).toLocaleString('en-US',{maximumFractionDigits:6});

function toast(text) { $('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,3500); }
function updateControls() {
  const ready=producer && Date.now()-lastReceived<5000 && socket?.readyState===WebSocket.OPEN;
  $('start').disabled=!ready || motion.recording;
  $('stop').disabled=!motion.recording;
  $('export').disabled=!motion.rows.length;
  $('clearSelection').disabled=!selection;
  document.body.classList.toggle('recording',motion.recording);
  $('statusDot').classList.toggle('ready',ready);
  $('connectionText').textContent=ready ? 'Ball connected · live data' : producer ? 'Connected · waiting for samples' : socket?.readyState===WebSocket.OPEN ? 'Receiver ready · connect the ball' : 'Reconnecting to receiver…';
  $('trialText').textContent=motion.message;
  const last=motion.rows.at(-1);
  $('duration').replaceChildren(document.createTextNode((last?.t||0).toFixed(2)+' '),Object.assign(document.createElement('span'),{textContent:'s'}));
  $('sampleCount').textContent=motion.rows.length.toLocaleString()+' samples';
}

async function newPairing() {
  if(rebuilding)return;
  rebuilding=true;
  try {
    const res=await fetch('/api/session',{method:'POST'});
    if(!res.ok)throw Error('The receiver could not create a session. Please try again shortly.');
    pairing=await res.json();
    try{sessionStorage.setItem('ball2-pairing',JSON.stringify(pairing));}catch{}
    retries=0;openSocket();
  } catch(error) {
    $('connectionText').textContent='Receiver unavailable';
    $('pairNote').textContent=error.message;
    toast(error.message);
  } finally {rebuilding=false;}
}

function openSocket() {
  clearTimeout(reconnectTimer);
  if(socket){socket.onclose=null;socket.close();}
  producer=false;lastReceived=0;
  const protocol=location.protocol==='https:'?'wss:':'ws:';
  $('streamAddress').value=`${protocol}//${location.host}/ingest/${pairing.id}/${pairing.ingestKey}`;
  const ws=new WebSocket(`${protocol}//${location.host}/viewer/${pairing.id}/${pairing.viewKey}`);
  socket=ws;
  ws.onopen=()=>{retries=0;$('pairNote').textContent='Paste this full address into Ball 2. Keep it private.';updateControls();};
  ws.onmessage=event=>{
    let data;try{data=JSON.parse(event.data);}catch{return;}
    if(data.type==='status') {
      producer=data.connected;
      if(!producer && motion.recording)motion.stop('Ball disconnected. Trial stopped; recorded data is preserved.');
    }
    if(data.type==='stream') {
      producer=true;lastReceived=Date.now();
      const before=motion.rows.length;
      motion.push(data.event);
      if(motion.rows.length!==before)dirty=true;
      if(before===0 && motion.rows.length)$('pairDetails').open=false;
    }
    updateControls();
  };
  ws.onclose=()=>{
    if(socket!==ws)return;
    producer=false;
    if(motion.recording)motion.stop('Receiver connection lost. Trial stopped; recorded data is preserved.');
    updateControls();
    if(++retries<=5)reconnectTimer=setTimeout(openSocket,Math.min(1000*2**retries,15000));
    else {
      $('connectionText').textContent='Pairing expired or receiver unavailable';
      $('pairNote').textContent='If the server restarted, generate a new pairing address and reconnect Ball 2.';
      $('pairDetails').open=true;
    }
  };
  ws.onerror=()=>{};
}

$('start').onclick=()=>{
  if($('start').disabled)return;
  if(motion.rows.length && !confirm('Start a fresh trial? This replaces the current graph data. Export CSV first if you need to keep it.'))return;
  motion.start();selection=null;dirty=true;updateControls();
};
$('stop').onclick=()=>{motion.stop();dirty=true;updateControls();};
$('clear').onclick=()=>{
  if(motion.rows.length && !confirm('Clear this trial? Export CSV first if you need to keep it.'))return;
  motion.clear();selection=null;dirty=true;updateControls();
};
$('axis').onchange=()=>{axis=Number($('axis').value);dirty=true;};
$('clearSelection').onclick=()=>{selection=null;dirty=true;updateControls();};
$('copyAddress').onclick=async()=>{
  try {await navigator.clipboard.writeText($('streamAddress').value);toast('Pairing address copied.');}
  catch {$('streamAddress').focus();$('streamAddress').select();toast('Select and copy the full address.');}
};
$('newSession').onclick=()=>{
  if(motion.recording){toast('Stop the trial before changing the pairing address.');return;}
  if(pairing && !confirm('Generate a new address? Reconnect the Ball 2 app using the new address.'))return;
  newPairing();
};
$('export').onclick=()=>{
  if(!motion.rows.length)return;
  const rows=['time_s,x_m,y_m,z_m,vx_m_s,vy_m_s,vz_m_s,ax_m_s2,ay_m_s2,az_m_s2'];
  for(const row of motion.rows)rows.push([row.t,...row.p,...row.v,...row.a].map(n=>Number.isFinite(n)?n:'').join(','));
  const url=URL.createObjectURL(new Blob([rows.join('\n')],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`ball2-trial-${new Date().toISOString().replace(/[:.]/g,'-')}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
};

function metric(name,value,unit='') {return `<div class="metric"><span>${name}</span><strong>${fmt(value)} <small>${unit}</small></strong></div>`;}
function stats(field,times,values) {
  const box=$('stats-'+field);
  if(!selection) {
    box.innerHTML='<div class="statsLabel">'+(motion.recording?'Recording':'Explore your trial')+'</div><p class="statsPrompt">'+(motion.recording?'Press Stop when your motion is complete.':'Tap a point to see its slope.<br>Drag a region for its statistics.')+'</p>';return;
  }
  if(selection.type==='point') {
    const result=pointStats(times,values,selection.t);
    if(!result){box.innerHTML='<p class="statsPrompt">No valid value at this point.<br>Choose a nearby sample.</p>';return;}
    box.innerHTML=`<div class="statsLabel">POINT · ${fmt(result.time)} s</div>`+
      metric('Value',result.value,units[field])+metric('Local slope',result.slope,slopeUnits[field])+
      '<p class="statsNote">Slope estimated from adjacent samples.<br>Purple line shows the local tangent.</p>';
  } else {
    const result=regionStats(times,values,selection.left,selection.right);
    if(!result){box.innerHTML='<p class="statsPrompt">Not enough valid data here.<br>Select a wider region.</p>';return;}
    box.innerHTML=`<div class="statsLabel">REGION · ${fmt(result.left)}–${fmt(result.right)} s</div>`+
      metric('Avg slope',result.slope,slopeUnits[field])+metric('Mean value',result.mean,units[field])+
      metric('Peak',result.peak,units[field])+metric('Minimum',result.min,units[field])+metric('Maximum',result.max,units[field])+
      `<p class="statsNote">Peak is the largest |value|, at ${fmt(result.peakTime)} s.<br>Average slope uses the endpoints.</p>`;
  }
}

function draw(field) {
  const canvas=$('plot-'+field),rect=canvas.getBoundingClientRect();
  const dpr=Math.min(devicePixelRatio||1,2),width=rect.width,height=rect.height;
  if(!width)return;
  if(canvas.width!==Math.round(width*dpr) || canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  const rows=motion.rows,times=rows.map(r=>r.t),values=rows.map(r=>r[field][axis]);
  let min=0,max=0;
  for(const y of values)if(Number.isFinite(y)){min=Math.min(min,y);max=Math.max(max,y);}
  if(min===max){min-=1;max+=1;}
  const pad=(max-min)*.1;min-=pad;max+=pad;
  const bounds={l:58,r:width-14,t:13,b:height-37};
  const end=Math.max(.1,times.at(-1)||5);
  const x=t=>bounds.l+t/end*(bounds.r-bounds.l),y=v=>bounds.b-(v-min)/(max-min)*(bounds.b-bounds.t);
  plots.set(field,{bounds,end,x,y});
  ctx.font='10px -apple-system, sans-serif';ctx.lineWidth=1;
  for(let i=0;i<=4;i++) {
    const v=min+(max-min)*i/4,py=y(v);
    ctx.strokeStyle='#e8eeeb';ctx.beginPath();ctx.moveTo(bounds.l,py);ctx.lineTo(bounds.r,py);ctx.stroke();
    ctx.fillStyle='#7f908b';ctx.textAlign='right';ctx.fillText(fmt(v),bounds.l-9,py+3);
    const t=end*i/4,px=x(t);
    ctx.beginPath();ctx.moveTo(px,bounds.t);ctx.lineTo(px,bounds.b);ctx.stroke();
    ctx.textAlign='center';ctx.fillText(fmt(t),px,bounds.b+17);
  }
  ctx.fillStyle='#8a9a95';ctx.textAlign='center';ctx.fillText('Time (s)',(bounds.l+bounds.r)/2,height-3);
  ctx.save();ctx.beginPath();ctx.rect(bounds.l,bounds.t,bounds.r-bounds.l,bounds.b-bounds.t);ctx.clip();
  if(selection?.type==='region') {
    ctx.fillStyle='#f3bb3433';ctx.fillRect(x(selection.left),bounds.t,x(selection.right)-x(selection.left),bounds.b-bounds.t);
  }
  ctx.strokeStyle=colors[field];ctx.lineWidth=1.8;ctx.beginPath();
  // Preserve each bucket's min/max so narrow impact spikes survive display downsampling.
  const bucket=Math.max(1,Math.ceil(rows.length/Math.max(1,bounds.r-bounds.l)));
  let pen=false;
  for(let start=0;start<values.length;start+=bucket) {
    const finish=Math.min(start+bucket,values.length),indices=[start,finish-1];
    let low=start,high=start;
    for(let i=start;i<finish;i++) {if(!Number.isFinite(values[low]) || values[i]<values[low])low=i;if(!Number.isFinite(values[high]) || values[i]>values[high])high=i;}
    indices.push(low,high);
    for(const i of [...new Set(indices)].sort((a,b)=>a-b)) {
      if(!Number.isFinite(values[i])){pen=false;continue;}
      if(!pen){ctx.moveTo(x(times[i]),y(values[i]));pen=true;}else ctx.lineTo(x(times[i]),y(values[i]));
    }
  }
  ctx.stroke();
  if(selection?.type==='point') {
    const result=pointStats(times,values,selection.t);
    if(result) {
      const px=x(result.time),py=y(result.value);
      ctx.strokeStyle='#815ac0';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(px,bounds.t);ctx.lineTo(px,bounds.b);ctx.stroke();ctx.setLineDash([]);
      if(result.slope!==null) {
        const half=end*.05;
        ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x(result.time-half),y(result.value-result.slope*half));ctx.lineTo(x(result.time+half),y(result.value+result.slope*half));ctx.stroke();
      }
      ctx.fillStyle='#815ac0';ctx.beginPath();ctx.arc(px,py,4,0,Math.PI*2);ctx.fill();
    }
  }
  ctx.restore();
  if(!rows.length){ctx.fillStyle='#a1aea8';ctx.textAlign='center';ctx.font='12px -apple-system, sans-serif';ctx.fillText('Your trial will appear here',(bounds.l+bounds.r)/2,(bounds.t+bounds.b)/2);}
  stats(field,times,values);
}

for(const field of fields) {
  const canvas=$('plot-'+field);let drag=null;
  const time=event=>{
    const {bounds,end}=plots.get(field),rect=canvas.getBoundingClientRect();
    return Math.max(0,Math.min(motion.rows.at(-1)?.t||0,(event.clientX-rect.left-bounds.l)/(bounds.r-bounds.l)*end));
  };
  canvas.addEventListener('pointerdown',event=>{
    if(motion.recording || !motion.rows.length || event.button!==0)return;
    const rect=canvas.getBoundingClientRect(),b=plots.get(field).bounds;
    if(event.clientX-rect.left<b.l || event.clientX-rect.left>b.r || event.clientY-rect.top<b.t || event.clientY-rect.top>b.b)return;
    drag={x:event.clientX,t:time(event)};canvas.setPointerCapture(event.pointerId);event.preventDefault();
  });
  canvas.addEventListener('pointermove',event=>{
    if(!drag)return;
    if(Math.abs(event.clientX-drag.x)>5){const t=time(event);selection={type:'region',left:Math.min(t,drag.t),right:Math.max(t,drag.t)};dirty=true;}
  });
  canvas.addEventListener('pointerup',event=>{
    if(!drag)return;
    if(Math.abs(event.clientX-drag.x)<=5)selection={type:'point',t:drag.t};
    else {const t=time(event);selection={type:'region',left:Math.min(t,drag.t),right:Math.max(t,drag.t)};}
    drag=null;dirty=true;updateControls();
    if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel',()=>{drag=null;});
  canvas.addEventListener('keydown',event=>{
    if(motion.recording || !motion.rows.length || !['ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();const target=selection?.type==='point'?selection.t:0;
    const index=motion.rows.findIndex(r=>r.t>=target);
    const next=Math.max(0,Math.min(motion.rows.length-1,index+(event.key==='ArrowRight'?1:-1)));
    selection={type:'point',t:motion.rows[next].t};dirty=true;updateControls();
  });
  new ResizeObserver(()=>{dirty=true;}).observe(canvas);
}

document.addEventListener('visibilitychange',()=>{
  if(document.hidden && motion.recording){motion.stop('Page left the foreground. Trial stopped; return here to inspect or start again.');dirty=true;updateControls();}
});
window.addEventListener('beforeunload',event=>{if(motion.rows.length){event.preventDefault();event.returnValue='';}});
setInterval(()=>{
  if(motion.recording && Date.now()-lastReceived>5000){motion.stop('No sensor data for 5 seconds. Trial stopped; check Sensor Lab and your connection.');dirty=true;}
  updateControls();
},1000);
let lastDraw=0;
function frame(now){if(dirty && now-lastDraw>80){for(const field of fields)draw(field);dirty=false;lastDraw=now;}requestAnimationFrame(frame);}
requestAnimationFrame(frame);
try {pairing=JSON.parse(sessionStorage.getItem('ball2-pairing'));}catch{}
if(pairing?.id && pairing.viewKey && pairing.ingestKey)openSocket();else newPairing();
updateControls();
