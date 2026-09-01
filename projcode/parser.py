import json, re
from pathlib import Path
from pyproj import CRS

def parse_wkt(t):
    p = {}
    for k, r in {'name':r'PROJCRS\["([^"]+)"','epsg':r'ID\["EPSG",(\d+)\]','ellipsoid':r'ELLIPSOID\["([^"]+)",([^,]+),([^,]+)','method':r'METHOD\["([^"]+)"','cm':r'PARAMETER\["Longitude of natural origin",([^,]+)','sp':r'PARAMETER\["Latitude of natural origin",([^,]+)','sf':r'PARAMETER\["Scale factor at natural origin",([^,]+)','fe':r'PARAMETER\["False easting",([^,]+)','fn':r'PARAMETER\["False northing",([^,]+)','scope':r'SCOPE\["([^"]+)"','area':r'AREA\["([^"]+)"','units':r'LENGTHUNIT\["([^"]+)"'}.items():
        m = re.search(r, t)
        if m:
            p[k] = f"{m.group(1)}°" if k in ['cm','sp'] else f"{m.group(1)} м" if k in ['fe','fn'] else f"{m.group(1)} (a={m.group(2)}, 1/f={m.group(3)})" if k=='ellipsoid' else m.group(1)
    b = re.search(r'BBOX\[([^\]]+)\]', t)
    if b:
        v = b.group(1).split(','); p['bbox'] = f"{v[0].strip()}°, {v[1].strip()}°, {v[2].strip()}°, {v[3].strip()}°"
    return p

def parse(f):
    t = open(f, encoding='utf-8').read()
    d = parse_wkt(t)
    try:
        c = CRS.from_string(t); j = c.to_json_dict()
        def gp(n):
            for x in j.get('conversion',{}).get('parameters',[]):
                if n in x.get('name','').lower(): return x.get('value')
        e = c.to_epsg() or d.get('epsg') or f.stem
        try: p4 = c.to_proj4()
        except: p4 = '—'
        return {
            'code': e, 'EPSG': e, 'Имя': c.name or d.get('name','—'),
            'Эллипсоид': d.get('ellipsoid') or (lambda: (lambda e: f"{e.get('name')} (a={e.get('semi_major_axis')}, 1/f={e.get('inverse_flattening')})" if e else None)(j.get('base_crs',{}).get('datum',{}).get('ellipsoid')))() or '—',
            'Главный меридиан': d.get('cm') or (f"{gp('longitude of natural origin')}°" if gp('longitude of natural origin') else '—'),
            'Главная параллель': d.get('sp') or (f"{gp('latitude of natural origin')}°" if gp('latitude of natural origin') else '—'),
            'Масштабный коэффициент': d.get('sf') or str(gp('scale factor')) if gp('scale factor') else '—',
            'Ложное смещение по X': d.get('fe') or (f"{gp('false easting')} м" if gp('false easting') else '—'),
            'Ложное смещение по Y': d.get('fn') or (f"{gp('false northing')} м" if gp('false northing') else '—'),
            'Математическая модель': d.get('method') or j.get('conversion',{}).get('method',{}).get('name','—'),
            'Сфера применения': d.get('scope') or j.get('scope','—'),
            'Территория': d.get('area') or (j.get('area',{}).get('name') if isinstance(j.get('area'), dict) else j.get('area','—')),
            'Границы': d.get('bbox') or (lambda b: f"{b.get('south_latitude')}°, {b.get('west_longitude')}°, {b.get('north_latitude')}°, {b.get('east_longitude')}°" if b else None)(j.get('bbox') or j.get('usage',{}).get('bbox')) or '—',
            'Единицы измерения': d.get('units') or (lambda u: u.get('name') if isinstance(u,dict) else str(u) if u else None)(next((a.get('unit') for a in j.get('coordinate_system',{}).get('axis',[]) if 'unit' in a), None)) or '—',
            'proj4': p4
        }
    except:
        return {k: d.get(k,'—') for k in ['code','epsg','name','ellipsoid','method','cm','sp','sf','fe','fn','scope','area','units']} | {'bbox': d.get('bbox','—'), 'proj4': '—'}

def collect(f='.'):
    data = {}
    files = list(Path(f).rglob('*.txt'))
    print(f"Найдено {len(files)} файлов")
    for fp in files:
        try:
            r = parse(fp)
            code = str(r.get('code') or fp.stem)
            if not code.isdigit(): code = fp.stem
            data[code] = {'name': r.get('Имя',''), 'method': r.get('Математическая модель','—'), 'area': r.get('Территория','—'), 'proj4': r.get('proj4',''), 'source': fp.name, 'info': r}
        except Exception as e: print(f'{fp.name}: {e}')
    return data

def save(data, o='data.json'):
    keys = sorted([k for k in data.keys() if k.isdigit()], key=lambda x: int(x)) + sorted([k for k in data.keys() if not k.isdigit()])
    json.dump({k: data[k] for k in keys}, open(o,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'Сохранено в {o}')

def main():
    data = collect('projcode/wkt2/EPSG')
    save(data)
    print(f'\nОбработано: {len(data)}')
    if data:
        for code in data:
            if data[code]['method'] != '—':
                print(f'\nПример EPSG:{code}')
                for k,v in data[code]['info'].items():
                    if v and v != '—': print(f"  {k}: {v}")
                break

if __name__ == '__main__':
    main()