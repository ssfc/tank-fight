(() => {
  'use strict';
  const canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
  const $ = id => document.getElementById(id);
  const T = 24, N = 26, SIZE = N * T;
  const vectors = [[0,-1],[1,0],[0,1],[-1,0]];
  const keys = new Set();
  let mode = 1, state = 'menu', previous = 0, time = 0, stage = 1, score = 0, best = 0;
  let map, tanks = [], bullets = [], particles = [], drops = [], kills = 0, spawned = 0;
  let spawnTimer = 0, freeze = 0, fortify = 0, transition = 0, baseAlive = true;
  let lives = [3,3], upgrades = [0,0], sound = false, audio;
  try { best = Number(localStorage.getItem('tank90-best')) || 0; } catch {}
  $('best').textContent = String(best).padStart(6,'0');
  function beep(freq=220, duration=.08, type='square', volume=.035) {
    if (!sound) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const o = audio.createOscillator(), g = audio.createGain();
      o.type=type; o.frequency.setValueAtTime(freq,audio.currentTime);
      o.frequency.exponentialRampToValueAtTime(Math.max(30,freq/2),audio.currentTime+duration);
      g.gain.setValueAtTime(volume,audio.currentTime); g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime+duration);
    } catch {}
  }
  function generateMap(level) {
    map = Array.from({length:N}, () => Array(N).fill(0));
    for(let y=2;y<23;y++) for(let x=1;x<25;x++) {
      if (x<3 || x>22 || (x>=11&&x<=14) || y%5===0) continue;
      if (x%4===0 || x%4===1) {
        map[y][x] = ((y+Math.floor(x/4)+level)%13===0) ? 2 : 1;
      }
    }
    for(let x=5;x<10;x++) map[12][x]=map[13][x]=3;
    for(let x=17;x<21;x++) for(let y=17;y<20;y++) map[y][x]=4;
    if(level%2===0) for(let x=16;x<21;x++) map[7][x]=map[8][x]=3;
    // Two-tile-wide spawn lanes and a clear approach to the base.
    for(const sx of [0,12,24]) for(let y=0;y<3;y++) for(let x=sx;x<sx+2;x++) map[y][x]=0;
    for(let y=22;y<26;y++) for(let x=7;x<19;x++) map[y][x]=0;
    baseWall(1);
  }
  function baseWall(value) {
    for(let x=11;x<=14;x++) map[23][x]=value;
    for(let y=24;y<26;y++) { map[y][11]=value; map[y][14]=value; }
  }
  function tank(x,y,dir,player=-1,type=0) {
    return {x,y,dir,player,type,size:36,speed:player>=0?125:62+Math.min(stage,8)*4+(type===1?25:0),hp:type===2?3:1,cooldown:0,think:0,shield:player>=0?3:0,flash:0,carrier:player<0&&spawned%4===3,stuck:0};
  }
  function spawnPlayer(p) {
    if(lives[p]<=0) return;
    tanks.push(tank(p===0?8*T:16*T,24*T-6,0,p));
  }
  function setupLevel() {
    generateMap(stage); tanks=[];bullets=[];particles=[];drops=[];kills=0;spawned=0;spawnTimer=.8;freeze=0;fortify=0;baseAlive=true;
    spawnPlayer(0); if(mode===2) spawnPlayer(1);
    $('stage-label').textContent='STAGE '+String(stage).padStart(2,'0');
    document.querySelector('.mission .eyebrow span').textContent=String(stage).padStart(2,'0')+' / ∞';
    updateHUD();
  }
  function start() {
    score=0;stage=1;lives=[3,3];upgrades=[0,0];setupLevel();state='playing';keys.clear();
    $('overlay').classList.add('hidden');$('game-status').textContent='作战进行中';$('pause').textContent='Ⅱ 暂停';beep(660,.18);
  }
  function updateHUD() {
    $('score').textContent=String(score).padStart(6,'0');
    if(score>best) {best=score;try{localStorage.setItem('tank90-best',String(best));}catch{}}
    $('best').textContent=String(best).padStart(6,'0');
    $('enemies').innerHTML=(20-kills)+' <small>辆</small>';
    $('enemy-grid').innerHTML=Array.from({length:20},(_,i)=>'<span class="'+(i<kills?'dead':'')+'"></span>').join('');
    $('life1').textContent='× '+lives[0];$('life2').textContent=mode===2?'× '+lives[1]:'—';
    $('p2-label').textContent=mode===2?'僚机 / 绿色坦克':'等待战友加入';
  }
  function overlay(title,desc,kicker,button) {
    $('overlay-title').textContent=title;$('overlay-desc').textContent=desc;$('overlay-kicker').textContent=kicker;
    $('start').innerHTML=button+' <span>↗</span>';$('modes').style.display='none';$('overlay-tip').textContent='按 ENTER '+(state==='paused'?'继续作战':'再战一局');
    $('overlay').classList.remove('hidden');
  }
  function end(reason) {
    state='over';keys.clear();$('game-status').textContent='作战结束';
    overlay('下次，一定守住。',reason+' · 本局得分 '+score,'MISSION FAILED','再战一局');beep(110,.6,'sawtooth');
  }
  function pause() {
    if(state==='playing') {state='paused';keys.clear();overlay('休息一下，战友。','战场已暂停，准备好后继续。','TAKE A BREATHER','继续作战');$('pause').textContent='▶ 继续';$('game-status').textContent='作战已暂停';}
    else if(state==='paused'){state='playing';$('overlay').classList.add('hidden');$('pause').textContent='Ⅱ 暂停';$('game-status').textContent='作战进行中';}
  }
  function intersects(a,b,pad=0) {return Math.abs(a.x-b.x)<(a.size+b.size)/2-pad && Math.abs(a.y-b.y)<(a.size+b.size)/2-pad;}
  function blocked(t,x,y) {
    const r=t.size/2-2;
    if(x-r<0||y-r<0||x+r>SIZE||y+r>SIZE) return true;
    for(let gy=Math.floor((y-r)/T);gy<=Math.floor((y+r-.01)/T);gy++) for(let gx=Math.floor((x-r)/T);gx<=Math.floor((x+r-.01)/T);gx++) {
      const cell=map[gy]?.[gx]; if(cell===1||cell===2||cell===3) return true;
    }
    if(baseAlive && Math.abs(x-13*T)<r+T-2 && Math.abs(y-25*T)<r+T-2) return true;
    return tanks.some(other=>other!==t&&intersects({x,y,size:t.size},other,3));
  }
  function move(t,dt) {
    const [dx,dy]=vectors[t.dir],step=t.speed*dt;
    // Small alignment assist keeps narrow lanes comfortable with a keyboard.
    let nx=t.x+dx*step,ny=t.y+dy*step;
    if(!blocked(t,nx,ny)){t.x=nx;t.y=ny;return true;}
    const perpendicular=t.dir%2===0?'x':'y';
    const center=Math.round(t[perpendicular]/T)*T;
    if(Math.abs(center-t[perpendicular])<9) {
      if(perpendicular==='x') nx=center;else ny=center;
      if(!blocked(t,nx,ny)){t.x=nx;t.y=ny;return true;}
    }
    return false;
  }
  function fire(t) {
    if(t.cooldown>0 || bullets.filter(b=>b.owner===t).length>=(t.player>=0&&upgrades[t.player]>=2?2:1)) return;
    const [dx,dy]=vectors[t.dir];
    bullets.push({x:t.x+dx*23,y:t.y+dy*23,dir:t.dir,owner:t,size:7,speed:t.player>=0?(upgrades[t.player]>=1?460:360):240,strong:t.player>=0&&upgrades[t.player]>=3});
    t.cooldown=t.player>=0?(upgrades[t.player]>=1?.18:.26):.9+Math.random()*.9;
    if(t.player>=0) beep(380,.045,'square',.018);
  }
  function burst(x,y,color='#efc16a',amount=16) {
    for(let i=0;i<amount;i++){const a=Math.random()*Math.PI*2,s=30+Math.random()*145;particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.25+Math.random()*.35,color});}
  }
  function dropPower() {
    for(let attempt=0;attempt<100;attempt++) {
      const x=(2+Math.floor(Math.random()*22))*T,y=(3+Math.floor(Math.random()*18))*T;
      if(!blocked({size:28},x,y)) {drops.push({x,y,size:32,kind:Math.floor(Math.random()*5),life:15});break;}
    }
  }
  function destroy(t, reward=true) {
    if(!tanks.includes(t))return;
    tanks.splice(tanks.indexOf(t),1);burst(t.x,t.y);beep(90,.16,'sawtooth');
    if(t.player<0) {kills++;if(reward)score+=t.type===2?300:t.type===1?200:100;if(t.carrier)dropPower();}
    else {lives[t.player]--;upgrades[t.player]=0;if(lives[t.player]>0)spawnPlayer(t.player);}
    updateHUD();
    if(lives[0]<=0&&(mode===1||lives[1]<=0))end('所有坦克已损失');
    if(kills===20&&state==='playing'){state='transition';transition=2.5;$('game-status').textContent='区域肃清，准备进入下一关';score+=1000;updateHUD();beep(880,.3,'triangle');}
  }
  function collect(t,d) {
    if(d.kind===0)upgrades[t.player]=Math.min(3,upgrades[t.player]+1);
    if(d.kind===1){for(const e of [...tanks])if(e.player<0)destroy(e);}
    if(d.kind===2)freeze=8;
    if(d.kind===3){fortify=15;baseWall(2);}
    if(d.kind===4){lives[t.player]++;}
    score+=200;beep(900,.15,'triangle');updateHUD();
  }
  function update(dt) {
    time+=dt;
    for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;}particles=particles.filter(p=>p.life>0);
    if(state==='transition'){transition-=dt;if(transition<=0){stage++;setupLevel();state='playing';$('game-status').textContent='作战进行中';}return;}
    if(state!=='playing')return;
    freeze=Math.max(0,freeze-dt);
    if(fortify>0){fortify-=dt;if(fortify<=0)baseWall(1);}
    spawnTimer-=dt;
    if(spawnTimer<=0&&spawned<20&&tanks.filter(t=>t.player<0).length<4+Math.min(2,stage-1)) {
      const positions=[T,13*T,25*T],x=positions[spawned%3];
      if(!tanks.some(t=>Math.abs(t.x-x)<40&&t.y<65)) {spawned++;const e=tank(x,T,2,-1,spawned%7===0?2:spawned%3===0?1:0);e.shield=.7;tanks.push(e);spawnTimer=1.8;}
    }
    for(const t of [...tanks]) {
      if(!tanks.includes(t))continue;
      t.cooldown=Math.max(0,t.cooldown-dt);t.shield=Math.max(0,t.shield-dt);t.flash=Math.max(0,t.flash-dt);
      if(t.player>=0) {
        const controls=t.player===0?['KeyW','KeyD','KeyS','KeyA']:['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'];
        let dir=-1;for(let i=0;i<4;i++)if(keys.has(controls[i]))dir=i;
        if(dir>=0){t.dir=dir;move(t,dt);}
        if(keys.has(t.player===0?'Space':'Enter'))fire(t);
        for(const d of [...drops])if(intersects(t,d)){drops.splice(drops.indexOf(d),1);collect(t,d);}
      } else if(freeze<=0) {
        t.think-=dt;
        if(t.think<=0){t.dir=Math.random()<.55?2:Math.floor(Math.random()*4);t.think=.6+Math.random()*1.8;}
        if(!move(t,dt)){t.stuck+=dt;if(t.stuck>.15){t.dir=Math.floor(Math.random()*4);t.think=.6;t.stuck=0;}}else t.stuck=0;
        if(Math.random()<dt*1.7)fire(t);
      }
    }
    // Substeps prevent fast shots from passing through thin obstacles.
    for(const b of [...bullets]) {
      if(!bullets.includes(b))continue;
      let dead=false;
      for(let s=0;s<3&&!dead;s++) {
        const [dx,dy]=vectors[b.dir];b.x+=dx*b.speed*dt/3;b.y+=dy*b.speed*dt/3;
        if(b.x<0||b.y<0||b.x>SIZE||b.y>SIZE){dead=true;break;}
        const gx=Math.floor(b.x/T),gy=Math.floor(b.y/T),cell=map[gy]?.[gx];
        if(cell===1||cell===2) {
          if(cell===1||b.strong){map[gy][gx]=0;burst(b.x,b.y,'#b68459',6);}
          else burst(b.x,b.y,'#b5c0b2',4);
          dead=true;break;
        }
        if(baseAlive&&Math.abs(b.x-13*T)<T-3&&Math.abs(b.y-25*T)<T-3){baseAlive=false;burst(13*T,25*T,'#efb04f',45);dead=true;end('基地已被摧毁');break;}
        for(const t of [...tanks]) {
          if((t.player<0)===(b.owner.player<0))continue;
          if(intersects(b,t,2)){dead=true;if(t.shield<=0){t.hp--;t.flash=.13;if(t.hp<=0)destroy(t);else {beep(180,.06);if(t.carrier){dropPower();t.carrier=false;}}}break;}
        }
        if(!dead)for(const other of bullets){if(other!==b&&(other.owner.player<0)!==(b.owner.player<0)&&intersects(b,other,-3)){bullets.splice(bullets.indexOf(other),1);dead=true;burst(b.x,b.y,'#e4d7a5',4);break;}}
      }
      if(dead&&bullets.includes(b))bullets.splice(bullets.indexOf(b),1);
    }
    for(const d of drops)d.life-=dt;drops=drops.filter(d=>d.life>0);
  }
  function rect(x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),w,h);}
  function tile(x,y,type) {
    const px=x*T,py=y*T;
    if(type===1){rect(px,py,24,24,'#694631');for(let row=0;row<3;row++){let offset=row%2?6:0;for(let col=-1;col<3;col++){let left=px+col*12+offset;ctx.save();ctx.beginPath();ctx.rect(px,py,24,24);ctx.clip();rect(left+1,py+row*8+1,10,6,'#a36b46');rect(left+1,py+row*8+1,10,1,'#bf8758');ctx.restore();}}}
    if(type===2){rect(px,py,24,24,'#606a60');rect(px+2,py+2,20,20,'#a1ab99');rect(px+5,py+5,14,14,'#7b8775');rect(px+3,py+3,18,2,'#c0c6b2');rect(px+20,py+4,2,18,'#444e43');}
    if(type===3){rect(px,py,24,24,'#294c57');ctx.fillStyle='#4b7880';for(let j=0;j<3;j++){let offset=Math.floor(time*12+j*4)%12;ctx.fillRect(px+offset,py+4+j*8,9,2);}}
    if(type===4){rect(px,py,24,24,'#2e4125');for(let j=0;j<6;j++){rect(px+(j*7)%20,py+(j*11)%20,5,8,j%2?'#6a7c44':'#4d6336');}}
  }
  function drawTank(t) {
    ctx.save();ctx.translate(Math.round(t.x),Math.round(t.y));ctx.rotate(t.dir*Math.PI/2);
    const main=t.flash>0?'#f9edcf':t.player===0?'#d9ad50':t.player===1?'#91b976':t.carrier&&Math.floor(time*6)%2===0?'#e3a277':t.type===2?'#a0b7af':'#c6c5b0';
    const dark=t.player===0?'#84682d':t.player===1?'#4a7043':'#657064';
    rect(-18,-17,9,35,dark);rect(9,-17,9,35,dark);
    for(let i=0;i<6;i++){let y=-16+i*6+Math.floor(time*(t.player>=0?12:6))%3;rect(-17,y,7,2,'#343e31');rect(10,y,7,2,'#343e31');}
    rect(-10,-13,20,28,main);rect(-7,-10,3,23,'#ffffff25');rect(6,-8,3,22,dark);
    rect(-8,-6,16,17,dark);rect(-6,-7,12,13,main);rect(-3,-24,6,24,main);rect(-1,-24,2,20,'#ffffff33');rect(-4,8,8,4,dark);
    if(t.type===2&&t.player<0){rect(-5,5,10,3,'#e1b96a');}
    ctx.restore();
    if(t.shield>0&&Math.floor(time*12)%2===0){ctx.strokeStyle='#d4e5b0';ctx.lineWidth=2;ctx.strokeRect(t.x-22,t.y-22,44,44);}
  }
  function drawBase() {
    const x=12*T,y=24*T;
    rect(x,y,48,48,'#242a22');
    if(!baseAlive){rect(x+8,y+18,32,20,'#514a3b');return;}
    ctx.save();ctx.translate(x+24,y+25);ctx.fillStyle='#d3c49b';
    ctx.beginPath();ctx.moveTo(0,-12);ctx.lineTo(6,-7);ctx.lineTo(18,-15);ctx.lineTo(17,0);ctx.lineTo(8,10);ctx.lineTo(3,8);ctx.lineTo(0,16);ctx.lineTo(-3,8);ctx.lineTo(-8,10);ctx.lineTo(-17,0);ctx.lineTo(-18,-15);ctx.lineTo(-6,-7);ctx.closePath();ctx.fill();
    rect(-3,-9,6,17,'#8b7d5e');rect(-2,-15,7,6,'#e5d8ae');rect(2,-14,2,2,'#272e23');ctx.restore();
  }
  function render() {
    rect(0,0,SIZE,SIZE,'#151b14');
    for(let y=0;y<N;y++)for(let x=0;x<N;x++){if(map[y][x]!==4)tile(x,y,map[y][x]);else tile(x,y,0);}
    drawBase();
    for(const d of drops){if(d.life<3&&Math.floor(time*7)%2===0)continue;rect(d.x-16,d.y-16,32,32,'#e1c575');rect(d.x-13,d.y-13,26,26,'#35412c');ctx.fillStyle='#ecd486';ctx.font='bold 24px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(['★','✹','◷','▤','+'][d.kind],d.x,d.y+1);}
    for(const t of tanks)drawTank(t);
    for(const b of bullets){rect(b.x-3,b.y-3,6,6,'#f8e7a9');}
    for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(map[y][x]===4)tile(x,y,4);
    for(const p of particles){ctx.globalAlpha=Math.min(1,p.life*3);rect(p.x,p.y,4,4,p.color);}ctx.globalAlpha=1;
    // Very subtle scanlines preserve the CRT feeling without hiding gameplay.
    ctx.fillStyle='#0000000c';for(let y=0;y<SIZE;y+=4)ctx.fillRect(0,y,SIZE,1);
    if(freeze>0){ctx.fillStyle='#8cc2ce';ctx.font='12px monospace';ctx.textAlign='left';ctx.fillText('TIME STOP '+Math.ceil(freeze),12,20);}
    if(state==='transition'){rect(100,260,424,100,'#172013ee');ctx.fillStyle='#e8c575';ctx.font='bold 28px monospace';ctx.textAlign='center';ctx.fillText('STAGE CLEAR',SIZE/2,300);ctx.font='14px monospace';ctx.fillStyle='#c2cdb2';ctx.fillText('+ 1000  /  NEXT STAGE '+(stage+1),SIZE/2,331);}
  }
  function frame(now) {const dt=Math.min((now-previous)/1000||0,1/30);previous=now;update(dt);render();requestAnimationFrame(frame);}
  document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{mode=Number(button.dataset.mode);document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('selected',b===button));updateHUD();}));
  $('start').addEventListener('click',()=>state==='paused'?pause():start());
  $('pause').addEventListener('click',pause);
  $('restart').addEventListener('click',start);
  $('sound').addEventListener('click',()=>{sound=!sound;$('sound').textContent='声音：'+(sound?'开':'关');$('sound').setAttribute('aria-label',sound?'关闭音效':'开启音效');beep(600,.1);});
  const gameKeys=['KeyW','KeyA','KeyS','KeyD','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','KeyP','Escape'];
  window.addEventListener('keydown',e=>{
    if(!gameKeys.includes(e.code))return;
    e.preventDefault();
    if(!e.repeat){if(e.code==='KeyP'||e.code==='Escape'){pause();return;}if(e.code==='Enter'&&['menu','over','paused'].includes(state)){state==='paused'?pause():start();return;}}
    keys.add(e.code);
  });
  window.addEventListener('keyup',e=>keys.delete(e.code));
  window.addEventListener('blur',()=>{keys.clear();if(state==='playing')pause();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state==='playing')pause();});
  document.querySelectorAll('[data-key]').forEach(button=>{
    button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);keys.add(button.dataset.key);});
    for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>keys.delete(button.dataset.key));
  });
  setupLevel();requestAnimationFrame(frame);
})();
