from __future__ import annotations
import csv, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).resolve().parent
index=json.loads((OUT/'routes.json').read_text(encoding='utf-8'))
geo=json.loads((OUT/'routes.geojson').read_text(encoding='utf-8'))
features={str(f.get('id')):f for f in geo.get('features',[])}
slots=[]; pairs=[]; checks=[]
def read_route(rel):return json.loads((ROOT/rel).read_text(encoding='utf-8'))
def shared_edge_fraction(a,b):
    def edge_map(route):
        return ((route.get('running_analysis') or {}).get('network_metrics') or {}).get('mapped_edge_lengths_m') or {}
    x,y=edge_map(a),edge_map(b)
    if not x or not y:return None
    den=min(sum(x.values()),sum(y.values()))
    if not den:return None
    return round(sum(min(x[k],y[k]) for k in x.keys() & y.keys())/den,6)
for dest_id,dest in index['destinations'].items():
  for distance_key,distance in dest['distances'].items():
    target=int(distance_key[:-2]); mode_routes=distance['routes']; pair_modes={}
    for mode in ('low','high'):
      item=mode_routes[mode]; pair_modes[mode]=item
      raw=None; coords=[]; direction_count=0; ors_ok=False; geometry_matches=False
      if item.get('available'):
        raw=read_route(item['source_json']); coords=(raw.get('geometry') or {}).get('coordinates') or []
        direction_count=len(raw.get('steps') or [])
        ors_ok=raw.get('profile')=='foot-walking' and (raw.get('ors') or {}).get('source')=='OpenRouteService Directions API' and bool(coords)
        if not ors_ok and raw.get('source_ors_response'):
          source=read_route(raw['source_ors_response']); response=source.get('response') or {}
          source_coords=(((response.get('features') or [{}])[0].get('geometry') or {}).get('coordinates') or [])
          source_profile=(((response.get('metadata') or {}).get('query') or {}).get('profile') or '')
          ors_ok=raw.get('profile')=='foot-walking' and source_profile=='foot-walking' and source_coords==coords
        feat=features.get(item.get('feature_id'))
        geometry_matches=bool(feat and feat.get('geometry',{}).get('coordinates')==coords)
        if not ors_ok or not geometry_matches:
          raise SystemExit(f"Route provenance/geometry mismatch: {item['slot_id']}")
      summary=item.get('summary') or {}; slope=item.get('slope') or {}; safety=item.get('walking_safety') or {}; run=item.get('running') or {}; elev=item.get('elevation') or {}
      slots.append({'destination_id':dest_id,'target_distance_km':target,'mode':mode,'status':item.get('status'),'available':item.get('available'),'formal_recommendation':item.get('formal_recommendation'),'route_id':item.get('route_id'),'distance_km':summary.get('distance_km'),'ascent_m':summary.get('ascent_m'),'grade_burden':slope.get('grade_burden_score'),'uphill_8_share':slope.get('uphill_8_share'),'uphill_10_share':slope.get('uphill_10_share'),'max_100m_grade':slope.get('max_sustained_100m_grade_percent'),'max_200m_grade':slope.get('max_sustained_200m_grade_percent'),'fitness':run.get('fitness_score'),'stairs_share':safety.get('stairs_share'),'repeat_m':safety.get('repeat_segment_m'),'u_turns':safety.get('u_turn_count'),'restriction_check_available':safety.get('restriction_check_available'),'elevation_confidence':elev.get('confidence'),'geometry_points':len(coords),'directions_steps':direction_count,'ors_geometry_matches_geojson':geometry_matches})
      checks.append({'slot_id':item.get('slot_id'),'route_id':item.get('route_id'),'actual_ors_foot_walking':ors_ok,'ors_geometry_matches_geojson':geometry_matches,'geometry_point_count':len(coords),'directions_steps_saved':direction_count,'ors_attempts_in_source':raw.get('ors_request_attempts') if raw else None,'start_snap_m':(item.get('geometry_endpoints') or {}).get('start_to_geometry_snap_m'),'destination_snap_m':(item.get('geometry_endpoints') or {}).get('destination_to_geometry_snap_m')})
    low,high=pair_modes['low'],pair_modes['high']; lm=low.get('slope') or {}; hm=high.get('slope') or {}
    lr=read_route(low['source_json']) if low.get('available') else None; hr=read_route(high['source_json']) if high.get('available') else None
    overlap=shared_edge_fraction(lr,hr) if lr and hr else None
    lh=(low.get('geometry') or {}).get('geometry_sha256_20'); hh=(high.get('geometry') or {}).get('geometry_sha256_20')
    burden_ok=lm.get('grade_burden_score') is not None and hm.get('grade_burden_score') is not None and lm['grade_burden_score']<=hm['grade_burden_score']
    up8_ok=lm.get('uphill_8_share') is not None and hm.get('uphill_8_share') is not None and lm['uphill_8_share']<=hm['uphill_8_share']
    up10_ok=lm.get('uphill_10_share') is not None and hm.get('uphill_10_share') is not None and lm['uphill_10_share']<=hm['uphill_10_share']
    pairs.append({'destination_id':dest_id,'target_distance_km':target,'low_route_id':low.get('route_id'),'high_route_id':high.get('route_id'),'low_status':low.get('status'),'high_status':high.get('status'),'low_formal_recommendation':low.get('formal_recommendation'),'high_formal_recommendation':high.get('formal_recommendation'),'low_km':(low.get('summary') or {}).get('distance_km'),'high_km':(high.get('summary') or {}).get('distance_km'),'low_ascent_m':(low.get('summary') or {}).get('ascent_m'),'high_ascent_m':(high.get('summary') or {}).get('ascent_m'),'low_burden':lm.get('grade_burden_score'),'high_burden':hm.get('grade_burden_score'),'low_uphill8':lm.get('uphill_8_share'),'high_uphill8':hm.get('uphill_8_share'),'low_uphill10':lm.get('uphill_10_share'),'high_uphill10':hm.get('uphill_10_share'),'low_fitness':(low.get('running') or {}).get('fitness_score'),'high_fitness':(high.get('running') or {}).get('fitness_score'),'low_high_same_geometry':bool(lh and hh and lh==hh),'shared_edge_fraction_shorter':overlap,'burden_order_ok':burden_ok,'uphill8_order_ok':up8_ok,'uphill10_order_ok':up10_ok,'all_slope_orders_ok':burden_ok and up8_ok and up10_ok,'burden_gap':hm.get('grade_burden_score')-lm.get('grade_burden_score') if lm.get('grade_burden_score') is not None and hm.get('grade_burden_score') is not None else None})
review_checks=[]
for review in index.get('review_routes',[]):
    raw=read_route(review['source_json']); coords=(raw.get('geometry') or {}).get('coordinates') or []
    feature=features.get(review.get('feature_id'))
    source=read_route(review['source_ors_response'])
    response=source.get('response') or {}
    ors_coords=(((response.get('features') or [{}])[0].get('geometry') or {}).get('coordinates') or [])
    ors_profile=(((response.get('metadata') or {}).get('query') or {}).get('profile') or '')
    actual=raw.get('profile')=='foot-walking' and ors_profile=='foot-walking' and bool(coords) and ors_coords==coords
    matches=bool(feature and feature.get('geometry',{}).get('coordinates')==coords)
    if not actual or not matches or review.get('formal_recommendation') is not False:
        raise SystemExit(f"Review route integrity/status check failed: {review.get('slot_id')}")
    review_checks.append({'slot_id':review.get('slot_id'),'route_id':review.get('route_id'),'status':review.get('status'),'formal_recommendation':review.get('formal_recommendation'),'actual_ors_foot_walking':actual,'geometry_matches_geojson':matches,'directions_steps_saved':len(raw.get('steps') or []),'source_ors_response':review.get('source_ors_response')})
if len(slots)!=18 or len(pairs)!=9:raise SystemExit('Expected 18 route slots and 9 Low/High pairs')
if not all(c['actual_ors_foot_walking'] and c['ors_geometry_matches_geojson'] for c in checks):raise SystemExit('Saved ORS route integrity check failed')
if len(features)!=20:raise SystemExit(f'Expected 18 slot features plus 2 review features; got {len(features)}')
for name,records in [('slots.csv',slots),('pair_comparison.csv',pairs)]:
  with (OUT/name).open('w',encoding='utf-8-sig',newline='') as f:
    writer=csv.DictWriter(f,fieldnames=list(records[0]));writer.writeheader();writer.writerows(records)
summary={'slot_count':len(slots),'pair_count':len(pairs),'geojson_feature_count':len(features),'available_slots':index['formal_available_slot_count'],'missing_slots':index['formal_missing_slot_count'],'formal_recommendation_slots':index['formal_recommendation_slot_count'],'review_required_slots':index['review_required_slot_count'],'identical_low_high_slots':index['identical_low_high_slots'],'all_geometry_is_saved_ors':True,'all_slope_order_checks_pass':all(p['all_slope_orders_ok'] for p in pairs),'all_directions_present':all(c['directions_steps_saved']>0 for c in checks),'shared_edge_target_over_50pct':[f"{p['destination_id']}-{p['target_distance_km']}km" for p in pairs if p['shared_edge_fraction_shorter'] is not None and p['shared_edge_fraction_shorter']>.5],'direction_counts_missing':[c['slot_id'] for c in checks if c['directions_steps_saved']==0],'route_integrity':checks,'review_route_integrity':review_checks,'pair_comparison':pairs}
(OUT/'validation_audit.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
report=OUT/'audit_report.md'; base=report.read_text(encoding='utf-8'); marker='\n## Low/High pair audit\n';
if marker in base:base=base.split(marker,1)[0]
lines=[marker,'',f"API calls during this build: 0; all route data came from saved ORS response files. Review route checks: {len(review_checks)}/2 passed.",'','| 목적지 | 거리 | Low/High geometry | 공유 edge율* | 경사부담 순서 | ≥8% 순서 | ≥10% 순서 | 차이(점) |','|---|---:|---|---:|---|---|---|---:|']
for p in pairs:
  overlap='—' if p['shared_edge_fraction_shorter'] is None else f"{100*p['shared_edge_fraction_shorter']:.1f}%"
  gap='—' if p['burden_gap'] is None else f"{p['burden_gap']:.2f}"
  same='누락' if not p['low_route_id'] or not p['high_route_id'] else ('같음' if p['low_high_same_geometry'] else '다름')
  lines.append(f"| {p['destination_id']} | {p['target_distance_km']}km | {same} | {overlap} | {'OK' if p['burden_order_ok'] else 'FAIL'} | {'OK' if p['uphill8_order_ok'] else 'FAIL'} | {'OK' if p['uphill10_order_ok'] else 'FAIL'} | {gap} |")
lines+=['','* 공유 edge율은 저장된 OSM edge 서명이 양쪽 경로에 일치하는 길이를 더 짧은 경로의 mapped edge 길이로 나눈 값입니다. 저장 네트워크 edge 정보가 빠진 페어는 미상입니다.','']
report.write_text(base.rstrip()+'\n'+'\n'.join(lines),encoding='utf-8')
print(json.dumps({k:summary[k] for k in ('slot_count','pair_count','geojson_feature_count','available_slots','missing_slots','formal_recommendation_slots','review_required_slots','identical_low_high_slots','all_geometry_is_saved_ors','all_slope_order_checks_pass','all_directions_present','shared_edge_target_over_50pct')},ensure_ascii=False,indent=2))
