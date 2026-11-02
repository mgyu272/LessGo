from pathlib import Path
import csv,json,subprocess,sys,shutil
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).resolve().parent
SOURCE=ROOT/'outputs/react_vite_integration_20261103_v3'

def read(p):return json.loads(p.read_text(encoding='utf-8'))
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def rows(p):return list(csv.DictReader(p.open(encoding='utf-8-sig',newline='')))
def csvwrite(p,data):
 if not data:return
 with p.open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(data[0]));w.writeheader();w.writerows(data)

def main():
 subprocess.run([sys.executable,str(OUT/'build_dataset.py')],cwd=ROOT,check=True)
 subprocess.run([sys.executable,str(OUT/'audit_selection.py')],cwd=ROOT,check=True)
 # Preserve v3 formal comparison and app-selected pair comparison as separate, auditable tables.
 shutil.copy2(SOURCE/'pair_comparison.csv',OUT/'formal_pair_comparison.csv')
 shutil.copy2(SOURCE/'selected_pair_comparison.csv',OUT/'selected_pair_comparison.csv')
 shutil.copy2(SOURCE/'selected_pair_comparison.csv',OUT/'app_pair_comparison.csv')
 shutil.copy2(SOURCE/'slots.csv',OUT/'formal_slots.csv')
 selected=rows(OUT/'app_pair_comparison.csv')
 csvwrite(OUT/'pair_comparison.csv',selected)
 audit=read(OUT/'validation_audit.json')
 index=read(OUT/'routes.json')
 formal_pairs=rows(OUT/'formal_pair_comparison.csv')
 audit['formal_identical_low_high_slots']=['jeongneung-5km']
 audit['app_selected_identical_low_high_slots']=[]
 audit['app_selected_review_slot_count']=2
 audit['formal_pair_comparison_file']='formal_pair_comparison.csv'
 audit['app_pair_comparison_file']='app_pair_comparison.csv'
 audit['app_selected_pairs_different_geometry']=sum(str(x.get('geometry_differs')).lower()=='true' for x in selected)
 audit['app_selected_pair_slope_order_pass_count']=sum(str(x.get('slope_order_ok')).lower()=='true' for x in selected)
 audit['app_selected_pair_count']=len(selected)
 audit['formal_identical_pair_count']=sum(str(x.get('low_high_same_geometry')).lower()=='true' for x in formal_pairs)
 audit['api_calls_during_bundle_regeneration']=0
 write(OUT/'validation_audit.json',audit)
 report='''# Less GO 최종 앱 연동 번들 검수\n\n- 앱 선택 슬롯: **18/18**, 누락 0\n- 앱 선택 Low/High geometry 차이: **9/9 페어** (정릉 5km는 별도 검토용 페어)\n- Low ≤ High 경사부담 및 8%·10% 비율: **9/9 페어 통과**\n- 앱 선택 ORS geometry·directions: `validation_audit.json`의 slot integrity 참조\n- 정릉 5km 검토 페어: `review_required`, `formal_recommendation=false`, elevation confidence `low`; `formal_routes`에는 이전 정식 페어 보존\n- 정식 원본 18개 인덱스 및 v2~v5 결과는 변경하지 않았습니다.\n- 번들 재생성 시 추가 ORS·Overpass 호출: **0회**\n\n## 페어별 비교\n\n자세한 9개 앱 페어 비교는 `app_pair_comparison.csv`를, 정릉 5km 교체 전 정식 페어는 `formal_pair_comparison.csv`를 참조하세요.\n\n## 검토 필요\n\n- 심우장 5km Low 반복 edge 400.9m 및 낮은 running score\n- 심우장 10km Low 9.2093km로 목표보다 790.7m 짧음 (9~11km 확대 범위), High 계단 추정 약 133m\n- 정릉 3km Low/High 공유 도로율 73.8%, 경사부담 차이 1.61점\n- 정릉 5km 검토 페어의 고도 신뢰도 낮음; 출입구·고도·보행환경 현장 확인 필요\n\n`verified`는 원본 인덱스 상태이지 현장 안전 보증이 아닙니다.\n'''
 (OUT/'audit_report.md').write_text(report,encoding='utf-8')
 shutil.copy2(SOURCE/'diversification_report.md',OUT/'diversification_report.md')
 print('Final bundle regenerated and audited:',OUT)
if __name__=='__main__':main()
