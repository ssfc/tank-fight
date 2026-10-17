import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

function game() {
  const elements = new Map(), listeners = {};
  function element(id) {
    if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},addEventListener(name,fn){this[name]=fn;},setAttribute(){},getContext(){return new Proxy({},{get:()=>()=>{}});}});
    return elements.get(id);
  }
  const context = vm.createContext({
    document:{getElementById:element,querySelector:element,querySelectorAll:()=>[],addEventListener(){}},
    window:{addEventListener(name,fn){listeners[name]=fn;}},localStorage:{getItem(){return null;},setItem(){}},requestAnimationFrame(){},Math,console
  });
  const source=readFileSync(new URL('./game.js',import.meta.url),'utf8');
  vm.runInContext(readFileSync(new URL('./stages.js',import.meta.url),'utf8'),context);
  vm.runInContext(source.replace(/\}\)\(\);\s*$/,`globalThis.testGame={start,update,pause,fire,tank,destroy,collect,blocked,keys,updateAlly,planAlly,safeAllyShot,generateMap,move,setupLevel,clearSpawn,
    get state(){return state},get tanks(){return tanks},get bullets(){return bullets},get map(){return map},get lives(){return lives},get score(){return score},get stage(){return stage},get upgrades(){return upgrades},get freeze(){return freeze},
    set mode(v){mode=v},set spawned(v){spawned=v},set kills(v){kills=v}};})();`),context);
  return {g:context.testGame,e:element,listeners,stages:context.TankStages};
}
test('start, movement, pause, and restart work even when a button has focus',()=>{
  const {g,listeners}=game();g.start();const p=g.tanks[0],x=p.x;
  listeners.keydown({code:'KeyA',target:{tagName:'BUTTON'},preventDefault(){}});g.update(.03);
  assert.ok(p.x<x);g.pause();const stopped=p.x;g.update(.2);assert.equal(p.x,stopped);
  g.pause();assert.equal(g.state,'playing');g.destroy(p);assert.equal(g.lives[0],2);
  g.start();assert.equal(g.lives[0],3);assert.equal(g.score,0);
});
test('shots break bricks, standard shots stop at steel, upgraded shots break steel',()=>{
  for(const [material,strong,destroyed] of [[1,false,true],[2,false,false],[2,true,true]]){
    const {g}=game();g.start();g.map[20][8]=material;
    const p=g.tanks[0];p.x=8*24+12;p.y=22*24;p.dir=0;
    g.fire(p);g.bullets[0].strong=strong;
    for(let i=0;i<12;i++)g.update(1/60);
    assert.equal(g.map[20][8],destroyed?0:material);
  }
});
test('friendly fire cannot damage a partner, but an exposed base ends the game',()=>{
  const {g}=game();g.mode=2;g.start();const [p1,p2]=g.tanks;
  for(const row of g.map)row.fill(0);
  p1.x=192;p1.y=570;p1.dir=1;p2.x=240;p2.y=570;p2.shield=0;
  g.fire(p1);for(let i=0;i<12;i++)g.update(1/60);assert.equal(g.lives[1],3);
  g.bullets.length=0;g.map[23][13]=0;p1.x=312;p1.y=550;p1.dir=2;p1.cooldown=0;g.fire(p1);
  for(let i=0;i<12;i++)g.update(1/60);assert.equal(g.state,'over');
});
test('powerups upgrade, freeze, fortify, and add lives',()=>{
  const {g}=game();g.start();const p=g.tanks[0];
  for(const kind of [0,0,0,0,2,3,4])g.collect(p,{kind});
  assert.equal(g.upgrades[0],3);assert.equal(g.freeze,8);assert.equal(g.map[23][12],2);assert.equal(g.lives[0],4);
});
test('clearing 20 enemies awards a bonus and advances the stage',()=>{
  const {g}=game();g.start();g.spawned=20;g.kills=19;
  const enemy=g.tank(100,100,2);g.tanks.push(enemy);g.destroy(enemy);
  assert.equal(g.state,'transition');assert.equal(g.score,1100);
  g.update(3);assert.equal(g.stage,2);assert.equal(g.state,'playing');assert.equal(g.lives[0],3);
});
test('tank collision blocks walls, water, other tanks and field boundaries',()=>{
  const {g}=game();g.start();const p=g.tanks[0];
  g.map[12][5]=3;
  assert.ok(g.blocked(p,-2,100));assert.ok(g.blocked(p,5*24+12,12*24+12));
  g.map[10][10]=1;assert.ok(g.blocked(p,10*24+12,10*24+12));
  const enemy=g.tank(100,100,2);g.tanks.push(enemy);assert.ok(g.blocked(p,100,100));
});
test('single-player spawns an AI ally with independent lives; two-player keeps manual control',()=>{
  const {g,e}=game();g.start();let ally=g.tanks.find(t=>t.player===1);
  assert.equal(ally.ai,true);assert.equal(e('p2-title').textContent,'AI TEAMMATE');
  assert.equal(g.lives[1],1);
  g.destroy(ally);assert.equal(g.lives[0],3);assert.equal(g.lives[1],0);
  assert.equal(g.tanks.some(t=>t.ai),false);
  assert.equal(e('p2-label').textContent,'已阵亡 · 下一关归队');
  g.mode=2;g.start();ally=g.tanks.find(t=>t.player===1);
  assert.equal(ally.ai,false);const x=ally.x;
  g.keys.add('ArrowRight');g.update(.03);assert.ok(ally.x>x);
});
test('AI returns next stage with one life and full armor; surviving AI cannot accumulate lives',()=>{
  const {g,e}=game();g.start();g.destroy(g.tanks.find(t=>t.ai));
  g.spawned=20;g.kills=19;
  const enemy=g.tank(24,24,2);g.tanks.push(enemy);g.destroy(enemy);g.update(3);
  assert.equal(g.stage,2);assert.equal(g.lives[1],1);
  const ally=g.tanks.find(t=>t.ai);assert.ok(ally);assert.equal(ally.hp,2);
  assert.equal(e('p2-label').textContent,'护甲 2/2 · 每关 1 命');
  ally.hp=1;g.setupLevel();assert.equal(g.lives[1],1);assert.equal(g.tanks.find(t=>t.ai).hp,2);
  g.mode=2;g.start();g.destroy(g.tanks.find(t=>t.player===1));g.setupLevel();
  assert.equal(g.lives[1],2);assert.equal(g.tanks.find(t=>t.player===1).hp,1);
});
test('AI armor absorbs one hit, protects briefly, then a second hit removes it for the stage',()=>{
  const {g,e}=game();g.start();g.spawned=20;
  const ally=g.tanks.find(t=>t.ai);ally.shield=0;
  const shoot=()=>{g.bullets.push({x:ally.x,y:ally.y-24,dir:2,owner:g.tank(ally.x,ally.y-70,2),size:7,speed:240});g.update(.03);};
  shoot();assert.equal(ally.hp,1);assert.equal(g.lives[1],1);assert.ok(g.tanks.includes(ally));
  assert.equal(e('p2-label').textContent,'护甲 1/2 · 每关 1 命');
  shoot();assert.equal(ally.hp,1);
  for(let i=0;i<30;i++)g.update(.03);
  shoot();assert.equal(g.lives[1],0);assert.equal(g.tanks.some(t=>t.ai),false);assert.equal(g.state,'playing');
});
test('AI sidesteps an incoming enemy shot and stops dodging into blocked terrain',()=>{
  const {g}=game();g.start();g.spawned=20;for(const row of g.map)row.fill(0);
  const ally=g.tanks.find(t=>t.ai);ally.x=384;ally.y=400;
  const enemy=g.tank(384,280,2);g.bullets.push({x:384,y:320,dir:2,owner:enemy,size:7,speed:240});
  g.updateAlly(ally,1/60);assert.ok(ally.x>384);assert.equal(ally.y,400);
  ally.x=384;ally.y=400;ally.dodgeTime=0;
  g.map[16][14]=2;g.map[16][17]=3;
  g.updateAlly(ally,1/60);assert.equal(ally.x,384);assert.equal(g.blocked(ally,ally.x,ally.y),false);
});
test('AI automatically shoots enemies and awards the shared score',()=>{
  const {g}=game();g.start();g.spawned=20;
  for(const row of g.map)row.fill(0);
  const ally=g.tanks.find(t=>t.ai);ally.x=384;ally.y=480;
  const enemy=g.tank(384,360,2);enemy.shield=0;g.tanks.push(enemy);
  g.collect(ally,{kind:2});
  for(let i=0;i<50;i++)g.update(1/60);
  assert.ok(!g.tanks.includes(enemy));assert.equal(g.score,300);
});
test('AI prioritizes the enemy near the base over an aligned distant enemy',()=>{
  const {g}=game();g.start();for(const row of g.map)row.fill(0);
  const ally=g.tanks.find(t=>t.ai);ally.x=384;ally.y=400;
  const distant=g.tank(384,100,2),threat=g.tank(240,510,2);
  g.tanks.push(distant,threat);g.updateAlly(ally,.03);
  assert.equal(ally.target,threat);assert.equal(g.bullets.length,0);
});
test('AI routes around steel and water using corridors wide enough for its hull',()=>{
  for(const material of [2,3]) {
    const {g}=game();g.start();for(const row of g.map)row.fill(0);
    for(let y=1;y<26;y++)if(y<18||y>20)g.map[y][12]=material;
    const ally=g.tanks.find(t=>t.ai);ally.x=240;ally.y=480;
    const target=g.tank(384,480,2);g.tanks.push(target);
    // Steel blocks shots; water only blocks movement. Force a steel firing screen
    // on the far side so both terrain cases require a detour.
    if(material===3)for(let y=21;y<26;y++)g.map[y][13]=2;
    const path=g.planAlly(ally,target);
    assert.ok(path.some(p=>p.y<=20*24));
    assert.ok(path.every(p=>p.y>=14*24));
    for(const p of path)assert.equal(g.blocked(ally,p.x,p.y,true),false);
    for(let i=0;i<90;i++)g.updateAlly(ally,1/60);
    assert.ok(ally.y>=14*24);
  }
});
test('AI refuses shots through the base or its protective walls',()=>{
  const {g}=game();g.start();const ally=g.tanks.find(t=>t.ai);
  assert.equal(g.safeAllyShot({x:240,y:600},{x:384,y:600},1),false);
  assert.equal(g.safeAllyShot({x:240,y:552},{x:384,y:552},1),false);
  ally.x=240;ally.y=600;const enemy=g.tank(384,600,3);g.tanks.push(enemy);
  g.updateAlly(ally,.03);assert.equal(g.bullets.length,0);
});
test('defender holds the opposite lower post and ignores even aligned frontline enemies',()=>{
  const {g}=game();g.start();const ally=g.tanks.find(t=>t.ai);
  const distant=g.tank(408,120,2);g.tanks.push(distant);
  for(let i=0;i<600;i++){g.updateAlly(ally,1/60);assert.ok(ally.y>=336);}
  assert.equal(ally.guardSide,1);assert.equal(ally.x,408);assert.equal(ally.y,528);
  assert.equal(ally.target,undefined);assert.equal(g.bullets.length,0);
});
test('defender waits for a sustained player side change, then uses the lower cross-connection',()=>{
  const {g}=game();g.start();const [player,ally]=g.tanks;player.x=408;player.y=600;
  // Stand at the guard post to avoid overlapping the player during this test.
  ally.x=408;ally.y=528;
  for(let i=0;i<60;i++)g.updateAlly(ally,1/60);
  assert.equal(ally.guardSide,1);
  player.x=312;g.updateAlly(ally,1/60);player.x=408;
  for(let i=0;i<60;i++)g.updateAlly(ally,1/60);
  assert.equal(ally.guardSide,1,'a brief center crossing resets the confirmation timer');
  for(let i=0;i<300;i++){g.updateAlly(ally,1/60);assert.ok(ally.y>=336);}
  assert.equal(ally.guardSide,-1);assert.equal(ally.x,216);assert.equal(ally.y,528);
});
test('defender covers its own flank and helps the other flank for a base emergency',()=>{
  const {g}=game();g.start();for(const row of g.map)row.fill(0);
  const ally=g.tanks.find(t=>t.ai);ally.x=408;ally.y=528;
  const own=g.tank(480,390,2),other=g.tank(144,450,2);g.tanks.push(own,other);
  g.updateAlly(ally,1/60);assert.equal(ally.target,own);
  other.y=560;g.updateAlly(ally,1/60);assert.equal(ally.target,other);
});
test('defender disengages when an enemy retreats and returns to its post',()=>{
  const {g}=game();g.start();for(const row of g.map)row.fill(0);
  const ally=g.tanks.find(t=>t.ai);ally.x=480;ally.y=432;
  const enemy=g.tank(480,360,2);g.tanks.push(enemy);
  g.updateAlly(ally,1/60);assert.equal(ally.target,enemy);
  enemy.y=200;
  for(let i=0;i<240;i++)g.updateAlly(ally,1/60);
  assert.equal(ally.target,undefined);assert.equal(ally.x,408);assert.equal(ally.y,528);
});
test('defender refuses routes through the upper half even if it is the only detour',()=>{
  const {g}=game();g.start();for(const row of g.map)row.fill(0);
  for(let y=14;y<26;y++)g.map[y][12]=2;
  const ally=g.tanks.find(t=>t.ai);ally.x=240;ally.y=480;
  const enemy=g.tank(384,480,2);g.tanks.push(enemy);
  const path=g.planAlly(ally,enemy);
  assert.ok(path.every(p=>p.y>=336&&p.x<12*24));
  ally.y=336;ally.dir=0;assert.equal(g.move(ally,1/60),false);
});
test('defender dodges toward home instead of freezing at its northern boundary',()=>{
  const {g}=game();g.start();for(const row of g.map)row.fill(0);
  const ally=g.tanks.find(t=>t.ai);ally.x=384;ally.y=336;
  g.bullets.push({x:304,y:336,dir:1,owner:g.tank(250,336,1),size:7,speed:240});
  g.updateAlly(ally,1/60);assert.ok(ally.y>336);
});
test('defender yields space when the player approaches along its corridor',()=>{
  const {g}=game();g.start();const [player,ally]=g.tanks;
  player.x=360;player.y=528;player.dir=1;ally.x=408;ally.y=528;
  for(let i=0;i<60;i++)g.updateAlly(ally,1/60);
  assert.ok(Math.abs(ally.y-player.y)>=36,'AI must leave the player crossing clear');
  assert.equal(g.blocked(player,408,528),false);
});
test('all 35 stage records match the pinned original data and decode half walls correctly',()=>{
  const {stages}=game();assert.equal(stages.count,35);
  const data=Buffer.concat(stages.records.map(hex=>Buffer.from(hex,'hex')));
  assert.equal(data.length,35*91);
  assert.equal(createHash('sha256').update(data).digest('hex'),'429e25b8e8ed24ae360e9aff3d4697f752416a0aa6adc4c05cd629d0acbd5f0f');
  for(let level=1;level<=35;level++){
    const map=stages.decode(level);assert.equal(map.length,26);
    for(const row of map){assert.equal(row.length,26);for(const cell of row)assert.ok(cell>=0&&cell<=5);}
  }
  const map=stages.decode(1);
  // Stage 1 has no water/forest; its central steel and partial bricks are fixed.
  assert.equal(map.flat().includes(3),false);assert.equal(map.flat().includes(4),false);
  assert.equal(map[6][12],2);assert.equal(map[8][10],1);assert.equal(map[9][10],0);
  assert.equal(map[10][10],0);assert.equal(map[11][10],1);
  assert.deepEqual(stages.decode(36),map);
  map[0][0]=1;assert.equal(stages.decode(1)[0][0],0);
});
test('a real tank can drive from left spawn to the right side without firing on stage 1',()=>{
  const {g}=game();g.start();const p=g.tanks[0];g.tanks.splice(1);
  assert.equal(p.x,216);assert.equal(p.y,600);
  // Follow the original lower cross-connection above the eagle's wall.
  for(const [x,y] of [[216,528],[408,528],[408,600],[600,600]]) {
    let steps=0;
    while(Math.abs(p.x-x)>.01||Math.abs(p.y-y)>.01) {
      assert.ok(++steps<1000,'route must make progress');
      const dx=x-p.x,dy=y-p.y;p.dir=Math.abs(dx)>.01?(dx>0?1:3):(dy>0?2:0);
      const distance=p.dir%2?Math.abs(dx):Math.abs(dy);
      assert.equal(g.move(p,Math.min(1/60,distance/p.speed)),true,`blocked at ${p.x},${p.y} toward ${x},${y}`);
    }
  }
  assert.equal(p.x,600);assert.equal(p.y,600);
});
test('all original stages have valid spawn footprints and connect after destructible bricks are cleared',()=>{
  const {g}=game();g.start();const p=g.tanks[0];
  for(let stage=1;stage<=35;stage++) {
    g.generateMap(stage);
    const positions=[[216,600],[408,600],[24,24],[312,24],[600,24]];
    for(const [x,y] of positions){g.clearSpawn(x,y);assert.equal(g.blocked(p,x,y,true),false,`stage ${stage} spawn ${x},${y}`);}
    for(const row of g.map)for(let x=0;x<26;x++)if(row[x]===1)row[x]=0;
    const queue=[[9,25]],seen=new Set(['9,25']);
    for(let head=0;head<queue.length;head++)for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]]){
      const x=queue[head][0]+dx,y=queue[head][1]+dy,key=x+','+y;
      if(seen.has(key)||g.blocked(p,x*24,y*24,true))continue;
      seen.add(key);queue.push([x,y]);
    }
    for(const [x,y] of positions)assert.ok(seen.has(x/24+','+y/24),`stage ${stage} route to ${x},${y}`);
  }
});
