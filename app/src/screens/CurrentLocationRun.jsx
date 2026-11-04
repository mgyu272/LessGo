import { useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { MapView, Route, Me, SpotMarker, FitBounds } from "../components/MapView.jsx";
import { distance } from "../lib/geo.js";
import { DESTINATIONS } from "../lib/routes.js";
import { loc } from "../lib/i18n.js";

export default function CurrentLocationRun() {
  const app=useApp();
  const [dest,setDest]=useState("simujang");
  const [origin,setOrigin]=useState(null);
  const [routes,setRoutes]=useState([]);
  const [selected,setSelected]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const spot=app.data?.spotById?.[dest];
  const locateAndSearch=async()=>{
    if(!spot) return;
    if(!navigator.geolocation){setError("이 브라우저는 GPS를 지원하지 않습니다.");return;}
    setBusy(true);setError("");setRoutes([]);
    try {
      const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
      if(position.coords.accuracy>100) throw new Error("현재 위치 오차가 큽니다. 실외에서 다시 시도해 주세요.");
      const here={lat:position.coords.latitude,lng:position.coords.longitude};
      setOrigin(here);
      if(distance(here,spot)<50) throw new Error("목적지에 이미 도착해 있습니다.");
      const r=await fetch("/api/current-route",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({origin:[here.lng,here.lat],destination:[spot.lng,spot.lat],destinationId:dest})});
      const json=await r.json();
      if(!r.ok) throw new Error(json.error||"경로 생성 실패");
      setRoutes(json.candidates||[]);setSelected(0);
    } catch(e) {setError(e.code===1?"위치 권한을 허용해 주세요.":e.message||"GPS를 확인할 수 없습니다.");}
    finally {setBusy(false);}
  };
  const route=routes[selected];
  const start=()=>{
    if(!route)return;
    const course={
      id:route.id,
      path:route.path,
      len:route.meters,
      cues:[],
      properties:{
        id:route.id,dest,spots:[dest],mode:"high",
        distance_km:Math.round(route.meters/100)/10,
        minutes:Math.round(route.meters/1000*6.5),
        ascent_m:null,
        status:"review_required",
        name:{ko:`현위치 → ${spot.name.ko}`,en:`Current location → ${spot.name.en}`},
        modeName:{ko:"러닝 친화 경로",en:"Running-friendly route"}
      }
    };
    // 현위치 출발은 반드시 실제 GPS로 기록 (앱 기본 시연 모드와 무관).
    app.run.start(course,{demo:false,speedup:speedParam()});
  };
  return <section className="screen picker-screen">
    <MapView className="picker-map">
      {route && <Route path={route.path} color="#2F6512" weight={6}/>}
      {origin && <Me at={[origin.lat,origin.lng]}/>}
      {spot && <SpotMarker spot={spot}/>}
      {route && <FitBounds points={route.path.map(p=>[p.lat,p.lng])} fitKey={route.id}/>}
    </MapView>
    <div className="picker-top">
      <div className="picker-title"><button className="round-btn glass" onClick={()=>app.go("home")} aria-label="뒤로">←</button><h1 className="glass">현위치 출발</h1></div>
    </div>
    <div className="hanji-sheet" style={{position:"absolute",bottom:0,left:0,right:0,padding:20,borderRadius:"22px 22px 0 0",zIndex:10}}>
      <h2 style={{margin:"0 0 12px"}}>러닝 친화 경로 찾기</h2>
      <label htmlFor="gps-destination">목적지</label>
      <select id="gps-destination" value={dest} onChange={e=>{setDest(e.target.value);setRoutes([]);setOrigin(null);}} style={{width:"100%",padding:12,margin:"8px 0 12px",borderRadius:10}}>
        {DESTINATIONS.map(id=><option key={id} value={id}>{loc(app.data.spotById[id]?.name)||id}</option>)}
      </select>
      <button className="btn btn-cta" disabled={busy} onClick={locateAndSearch} style={{width:"100%"}}>{busy?"GPS·경로 검색 중...":"GPS로 러닝 경로 찾기"}</button>
      {error && <p role="alert" style={{color:"#a33"}}>{error}</p>}
      {!!routes.length && <>
        <p style={{margin:"12px 0 6px"}}>경로 후보 {routes.length}개 · 러닝 친화도 순</p>
        <div style={{display:"flex",gap:8,overflowX:"auto"}}>
          {routes.map((r,i)=><button key={r.id} className="soft" onClick={()=>setSelected(i)} aria-pressed={selected===i} style={{minWidth:120,padding:10,border:selected===i?"2px solid #2F6512":"1px solid #ddd",borderRadius:10}}>
            <b>{(r.meters/1000).toFixed(2)}km</b><br/><small>친화도 {r.score}점</small>
          </button>)}
        </div>
        <p style={{fontSize:12,margin:"8px 0"}}>도로 유형 기반 추정 점수입니다. 계단·차량·현장 안전은 별도 확인이 필요합니다. 고도와 급경사는 평가하지 않습니다.</p>
        <button className="btn btn-cta" onClick={start} style={{width:"100%"}}>이 경로로 러닝 시작</button>
      </>}
    </div>
  </section>;
}
