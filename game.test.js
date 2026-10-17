import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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
  vm.runInContext(source.replace(/\}\)\(\);\s*$/,`globalThis.testGame={start,update,pause,fire,tank,destroy,collect,blocked,keys,updateAlly,planAlly,safeAllyShot,
    get state(){return state},get tanks(){return tanks},get bullets(){return bullets},get map(){return map},get lives(){return lives},get score(){return score},get stage(){return stage},get upgrades(){return upgrades},get freeze(){return freeze},
    set mode(v){mode=v},set spawned(v){spawned=v},set kills(v){kills=v}};})();`),context);
  return {g:context.testGame,e:element,listeners};
}
test('start, movement, pause, and restart work even when a button has focus',()=>{
  const {g,listeners}=game();g.start();const p=g.tanks[0],y=p.y;
  listeners.keydown({code:'KeyW',target:{tagName:'BUTTON'},preventDefault(){}});g.update(.03);
  assert.ok(p.y<y);g.pause();const stopped=p.y;g.update(.2);assert.equal(p.y,stopped);
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
  assert.ok(g.blocked(p,-2,100));assert.ok(g.blocked(p,5*24+12,12*24+12));
  g.map[10][10]=1;assert.ok(g.blocked(p,10*24+12,10*24+12));
  const enemy=g.tank(100,100,2);g.tanks.push(enemy);assert.ok(g.blocked(p,100,100));
});
test('single-player spawns an AI ally with independent lives; two-player keeps manual control',()=>{
  const {g,e}=game();g.start();let ally=g.tanks.find(t=>t.player===1);
  assert.equal(ally.ai,true);assert.equal(e('p2-title').textContent,'AI TEAMMATE');
  g.destroy(ally);assert.equal(g.lives[0],3);assert.equal(g.lives[1],2);
  assert.equal(g.tanks.find(t=>t.player===1).ai,true);
  g.mode=2;g.start();ally=g.tanks.find(t=>t.player===1);
  assert.equal(ally.ai,false);const x=ally.x;
  g.keys.add('ArrowRight');g.update(.03);assert.ok(ally.x>x);
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
    for(let y=1;y<26;y++)if(y<9||y>11)g.map[y][12]=material;
    const ally=g.tanks.find(t=>t.ai);ally.x=240;ally.y=480;
    const target=g.tank(384,480,2);g.tanks.push(target);
    // Steel blocks shots; water only blocks movement. Force a steel firing screen
    // on the far side so both terrain cases require a detour.
    if(material===3)for(let y=12;y<26;y++)g.map[y][13]=2;
    const path=g.planAlly(ally,target);
    assert.ok(path.some(p=>p.y<=11*24));
    for(const p of path)assert.equal(g.blocked(ally,p.x,p.y,true),false);
    for(let i=0;i<90;i++)g.updateAlly(ally,1/60);
    assert.ok(ally.y<480);
  }
});
test('AI refuses shots through the base or its protective walls',()=>{
  const {g}=game();g.start();const ally=g.tanks.find(t=>t.ai);
  assert.equal(g.safeAllyShot({x:240,y:600},{x:384,y:600},1),false);
  assert.equal(g.safeAllyShot({x:240,y:552},{x:384,y:552},1),false);
  ally.x=240;ally.y=600;const enemy=g.tank(384,600,3);g.tanks.push(enemy);
  g.updateAlly(ally,.03);assert.equal(g.bullets.length,0);
});
