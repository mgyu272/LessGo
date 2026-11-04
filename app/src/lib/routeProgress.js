// Map GPS positions to the saved route polyline, not to distance already run.
import { distance } from "./geo.js";

export function nearestOnRoute(path, point) {
  if (!path?.length || !point) return null;
  if (path.length === 1) return { offsetM: 0, distanceM: distance(point,path[0]), progressM: 0, totalM: 0 };
  let totalM=0, best={distanceM:Infinity,progressM:0,offsetM:0,totalM:0};
  const metersPerDegree=111195;
  for(let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i];
    const latRad=(a.lat+b.lat)/2*Math.PI/180;
    const kx=metersPerDegree*Math.cos(latRad),ky=metersPerDegree;
    const dx=(b.lng-a.lng)*kx,dy=(b.lat-a.lat)*ky;
    const px=(point.lng-a.lng)*kx,py=(point.lat-a.lat)*ky;
    const segLen=Math.hypot(dx,dy);
    const f=segLen<0.01?0:Math.max(0,Math.min(1,(px*dx+py*dy)/(segLen*segLen)));
    const d=Math.hypot(px-f*dx,py-f*dy);
    if(d<best.distanceM) best={distanceM:d,progressM:totalM+segLen*f,offsetM:i-1,totalM:0};
    totalM+=segLen;
  }
  return {...best,totalM,remainingM:Math.max(0,totalM-best.progressM)};
}
