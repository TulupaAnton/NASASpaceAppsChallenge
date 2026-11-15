import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFinlandGeometry } from '../public/legacy/finland-geometry.js';
import { project, IMAGE_WIDTH, IMAGE_HEIGHT } from '../public/legacy/projection.js';
const root = new URL('../', import.meta.url);

// Exercise the real canvas draw loop with a deterministic clock and recorded gradients.
// Other map layers are inert so the assertion measures only photo-edge darkening.
test('full-screen reveal adds black edges continuously as the photo retracts', () => {
  const { rings } = decodeFinlandGeometry(fs.readFileSync(new URL('public/legacy/assets/finland-geometry.bin', root)));
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) for (const point of ring) {
    const [x,y] = project(...point);
    bounds[0] = Math.min(bounds[0],x); bounds[1] = Math.min(bounds[1],y);
    bounds[2] = Math.max(bounds[2],x); bounds[3] = Math.max(bounds[3],y);
  }
  let now = 0, id = 0, queue = new Map(), gradients = [], pose, state, stack = [];
  state = { globalAlpha:1, fillStyle:null, x:0,y:0,k:1 };
  const methods = {
    save(){stack.push({...state});}, restore(){state=stack.pop();},
    translate(x,y){state.x=x;state.y=y;pose={x,y,k:state.k};},
    scale(k){state.k=k;pose={x:state.x,y:state.y,k};},
    createLinearGradient(x1,y1,x2,y2){return {gradient:true,x1,y1,x2,y2,addColorStop(){}};},
    fillRect(x,y,w,h){if(state.fillStyle?.gradient)gradients.push({...state.fillStyle,x,y,w,h,alpha:state.globalAlpha,pose:{...state}});},
  };
  const ctx = new Proxy({}, {get:(_,key)=>key in methods ? methods[key] : key in state ? state[key] : ()=>{}, set:(_,key,value)=>{state[key]=value;return true;}});
  const width=1854,height=927;
  const canvas={style:{},getContext:()=>ctx,getBoundingClientRect:()=>({width,height}),addEventListener(){},removeEventListener(){}};
  const context={IMAGE_WIDTH,IMAGE_HEIGHT,project,unproject(){},sites:[],comparisonColors:[],selection(){},selectionKey(){},destination(){},
   window:{devicePixelRatio:1},performance:{now:()=>now},ResizeObserver:class {observe(){} disconnect(){}},
   requestAnimationFrame:callback=>{queue.set(++id,callback);return id;},cancelAnimationFrame:key=>queue.delete(key)};
  const source=fs.readFileSync(new URL('app/lib/map-view.js', root),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function createMapView','function createMapView');
  vm.createContext(context);vm.runInContext(source+'\nglobalThis.createMapView=createMapView;',context);
  const layer={bitmap:{},x:0,y:0,width:1280,height:720};
  const assets={bounds,image:{},borders:layer,zoomBorders:layer};
  const view=context.createMapView(canvas,{},assets,()=>{},()=>{},()=>false);
  function sample(ms){now=ms;gradients=[];const callbacks=[...queue.values()];queue.clear();for(const callback of callbacks)callback(ms);
   const sx=10,sy=height/2;let transmission=(sx<pose.x||sx>pose.x+IMAGE_WIDTH*pose.k||sy<pose.y||sy>pose.y+IMAGE_HEIGHT*pose.k)?0:1;
   for(const g of gradients){const {x:tx,y:ty,k}=g.pose;const x=(sx-tx)/k,y=(sy-ty)/k;
    if(x<g.x||x>g.x+g.w||y<g.y||y>g.y+g.h)continue;
    const dx=g.x2-g.x1,dy=g.y2-g.y1;
    const t=Math.max(0,Math.min(1,((x-g.x1)*dx+(y-g.y1)*dy)/(dx*dx+dy*dy)));
    transmission*=1-(1-t)*g.alpha;
   }
   return {ms,pose:{...pose},gradientCount:gradients.length,edgeAlpha:1-transmission};
  }
  view.prepareReveal();sample(0);view.finishReveal();
  let previous=sample(0),largest={delta:0};
  for(let ms=1;ms<=747;ms++){const frame=sample(ms),delta=Math.abs(frame.edgeAlpha-previous.edgeAlpha);
   if(delta>largest.delta)largest={delta,before:previous,after:frame};previous=frame;}
  view.destroy();

  assert.ok(largest.delta<.1,'Black-edge opacity must not jump by 10% or more in a 1ms frame step');

});
