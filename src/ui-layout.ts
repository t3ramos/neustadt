export interface ScreenRect { left:number; top:number; right:number; bottom:number }

/** Keep transient construction feedback inside the playable viewport and off nearby controls. */
export function placeFloatingPanel(bounds:ScreenRect,size:{width:number;height:number},pointer:{x:number;y:number},obstacles:ScreenRect[]=[]){
 const width=Math.min(size.width,Math.max(0,bounds.right-bounds.left));
 const height=Math.min(size.height,Math.max(0,bounds.bottom-bounds.top));
 const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
 const overlap=(a:ScreenRect,b:ScreenRect)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
 const gap=22;
 const xs=[pointer.x+gap,pointer.x-width-gap,pointer.x-width/2,bounds.left,bounds.right-width];
 const ys=[pointer.y-40,pointer.y-height-gap,pointer.y+gap,bounds.top,bounds.bottom-height];
 for(const obstacle of obstacles){xs.push(obstacle.right+8,obstacle.left-width-8);ys.push(obstacle.bottom+8,obstacle.top-height-8);}
 const pointerArea={left:pointer.x-14,top:pointer.y-14,right:pointer.x+14,bottom:pointer.y+14};
 let best={left:bounds.left,top:bounds.top,score:Infinity};
 for(const x of xs)for(const y of ys){
  const left=clamp(x,bounds.left,bounds.right-width),top=clamp(y,bounds.top,bounds.bottom-height);
  const rect={left,top,right:left+width,bottom:top+height};
  const score=overlap(rect,pointerArea)*1000+obstacles.reduce((total,obstacle)=>total+overlap(rect,obstacle),0)*10+Math.hypot(left-pointer.x-gap,top-pointer.y+40);
  if(score<best.score)best={left,top,score};
 }
 return {left:best.left,top:best.top};
}
