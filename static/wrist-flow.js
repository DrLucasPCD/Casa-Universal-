(function(root){
  'use strict';
  const median=values=>{const sorted=values.slice().sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
  // Short, image-measured continuity. Never extrapolate a lost wrist or infer a ray.
  function create(cv){
    let previous=null,points=[],wrist=null,seen=-Infinity,last=-Infinity,width=0,height=0;
    function reset(){previous=null;points=[];wrist=null;seen=last=-Infinity;}
    function seed(image,point){
      const radius=22,cx=point.x*width,cy=point.y*height;
      const left=Math.max(0,Math.floor(cx-radius)),top=Math.max(0,Math.floor(cy-radius));
      const w=Math.min(45,width-left),h=Math.min(45,height-top),roi=new cv.matrix_t(w,h,cv.U8C1_t);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++)roi.data[y*w+x]=image.data[(top+y)*width+left+x];
      const corners=Array.from({length:w*h},()=>new cv.keypoint_t());
      cv.fast_corners.set_threshold(10);
      const count=cv.fast_corners.detect(roi,corners,4);
      const ranked=corners.slice(0,count).map(p=>({x:p.x+left,y:p.y+top,score:p.score})).filter(p=>Math.hypot(p.x-cx,p.y-cy)<=radius&&p.x>10&&p.y>10&&p.x<width-10&&p.y<height-10).sort((a,b)=>b.score-a.score);
      const chosen=[];
      for(const p of ranked){if(chosen.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>4))chosen.push(p);if(chosen.length===32)break;}
      return chosen;
    }
    function update(rgba,w,h,measurement,timestamp,{ambiguous=false}={}){
      if(!Number.isFinite(timestamp)||timestamp<=last)return null;
      if(w!==width||h!==height||timestamp-last>350||ambiguous){reset();width=w;height=h;}
      const image=new cv.matrix_t(w,h,cv.U8C1_t);cv.imgproc.grayscale(rgba,w,h,image);
      const current=new cv.pyramid_t(3);current.allocate(w,h,cv.U8C1_t);current.build(image,false);
      let output=null;
      const valid=measurement&&Number.isFinite(measurement.x)&&Number.isFinite(measurement.y)&&measurement.x>=0&&measurement.x<=1&&measurement.y>=0&&measurement.y<=1;
      if(ambiguous){points=[];wrist=null;}
      else if(valid){wrist={x:measurement.x,y:measurement.y};seen=timestamp;points=seed(image,wrist);}
      else if(previous&&wrist&&points.length>=5&&timestamp-seen<=1800){
        const n=points.length,from=new Float32Array(n*2),to=new Float32Array(n*2),back=new Float32Array(n*2),status=new Uint8Array(n),backStatus=new Uint8Array(n);
        for(let i=0;i<n;i++){from[i*2]=points[i].x;from[i*2+1]=points[i].y;}
        cv.optical_flow_lk.track(previous,current,from,to,n,15,30,status,.01,.001);
        cv.optical_flow_lk.track(current,previous,to,back,n,15,30,backStatus,.01,.001);
        const tracked=[];
        for(let i=0;i<n;i++){
          const x=to[i*2],y=to[i*2+1],dx=x-from[i*2],dy=y-from[i*2+1];
          if(!status[i]||!backStatus[i]||!Number.isFinite(x+y)||x<10||y<10||x>w-10||y>h-10||Math.hypot(back[i*2]-from[i*2],back[i*2+1]-from[i*2+1])>1.2||Math.hypot(dx,dy)>w*.10)continue;
          let error=0;for(let py=-2;py<=2;py++)for(let px=-2;px<=2;px++)error+=Math.abs(previous.data[0].data[(Math.round(from[i*2+1])+py)*w+Math.round(from[i*2])+px]-image.data[(Math.round(y)+py)*w+Math.round(x)+px]);
          if(error/25<=22)tracked.push({x,y,dx,dy});
        }
        if(tracked.length>=5){
          const dx=median(tracked.map(p=>p.dx)),dy=median(tracked.map(p=>p.dy));
          const inliers=tracked.filter(p=>Math.hypot(p.dx-dx,p.dy-dy)<2.5);
          const next={x:wrist.x+dx/w,y:wrist.y+dy/h};
          if(inliers.length>=5&&inliers.length/n>=.65&&next.x>=0&&next.x<=1&&next.y>=0&&next.y<=1){
            wrist=next;points=inliers;output={...wrist,z:0,source:'image-flow',points:inliers.length,ageMs:timestamp-seen};
          }
        }
        if(!output){points=[];wrist=null;}
      }else {points=[];wrist=null;}
      previous=current;last=timestamp;return output;
    }
    return {update,reset};
  }
  root.CasaWristFlow={create};
})(globalThis);
