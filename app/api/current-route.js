// Current-location running: ORS walking candidates ranked by running-friendly way types.
// Server-side ORS_API_KEY only. This is heuristic ranking, not trained AI.
const ORS = "https://api.openrouteservice.org/v2/directions/foot-walking/geojson";
const TYPES = { 4: 80, 5: 70, 6: 88, 7: 100, 8: 0 };
function scoreRoute(feature) {
  const coords = feature.geometry?.coordinates || [];
  const segments = feature.properties?.extras?.waytype?.values || [];
  let weighted = 0, total = 0, steps = 0;
  for (const [start, end, type] of segments) {
    const count = Math.max(0, end - start);
    let meters = 0;
    for (let i = Math.max(1,start+1); i <= Math.min(end,coords.length-1); i++) {
      const a=coords[i-1],b=coords[i], dy=(b[1]-a[1])*111195,dx=(b[0]-a[0])*111195*Math.cos(a[1]*Math.PI/180);
      meters += Math.hypot(dx,dy);
    }
    if (!meters && count) continue;
    weighted += meters * (TYPES[type] ?? 45);
    total += meters;
    if (type === 8) steps += meters;
  }
  const distance = feature.properties?.summary?.distance ?? 0;
  // Missing waytype coverage is explicitly neutral, never assumed to be safe.
  const coverage = total / Math.max(distance, 1);
  const friendliness = total ? (weighted + Math.max(0,distance-total)*45)/Math.max(distance,1) : 45;
  const score = friendliness - Math.min(30,steps/Math.max(distance,1)*100) - Math.min(12,distance/1000*0.6);
  return { score: Math.round(score*10)/10, friendliness:Math.round(friendliness), waytypeCoverage:Math.min(1,Math.round(coverage*100)/100), stepsEstimateM:Math.round(steps) };
}
export default async function handler(req,res) {
  if(req.method!=="POST") return res.status(405).json({error:"POST only"});
  const key=process.env.ORS_API_KEY;
  if(!key) return res.status(503).json({error:"서버에 ORS_API_KEY 환경변수가 없습니다."});
  const { origin, destination, destinationId } = typeof req.body==="string" ? JSON.parse(req.body) : (req.body||{});
  const valid = (p)=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=124&&p[0]<=132&&p[1]>=33&&p[1]<=39;
  if(!valid(origin)||!valid(destination)) return res.status(400).json({error:"유효한 한국 내 좌표가 필요합니다. [경도, 위도]"});
  try {
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),16000);
    let response;
    try {
      response=await fetch(ORS,{method:"POST",headers:{"Authorization":key,"Content-Type":"application/json"},body:JSON.stringify({
        coordinates:[origin,destination],alternative_routes:{target_count:3,weight_factor:1.6,share_factor:0.6},
        extra_info:["waytype"],instructions:true
      }),signal:controller.signal});
    } finally {clearTimeout(timer);}
    if(!response.ok) return res.status(502).json({error:"ORS 경로 생성 실패",upstream:response.status});
    const data=await response.json();
    const candidates=(data.features||[]).filter(f=>f.geometry?.coordinates?.length>1).map((f,i)=>({
      id:`gps-${destinationId||"spot"}-${i}`,
      path:f.geometry.coordinates.map(([lng,lat])=>({lat,lng})),
      meters:f.properties.summary.distance,
      duration:f.properties.summary.duration,
      ...scoreRoute(f)
    })).sort((a,b)=>b.score-a.score);
    if(!candidates.length) return res.status(404).json({error:"연결 가능한 보행 경로가 없습니다."});
    return res.status(200).json({candidates,method:"heuristic-waytype",note:"도로 유형 기반 추정치이며 실제 안전성·러닝 적합성을 보증하지 않습니다."});
  } catch(e) {return res.status(502).json({error:e.name==="AbortError"?"경로 탐색 시간 초과":"경로 탐색 오류"});}
}
