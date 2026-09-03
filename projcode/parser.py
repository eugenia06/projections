import json, re
from pathlib import Path

def parse_wkt(t):
    p = {}
    patterns = [
        (r'PROJCRS\["([^"]+)"', 'Имя'),
        (r'GEOGCRS\["([^"]+)"', 'Имя'),
        (r'GEODCRS\["([^"]+)"', 'Имя'),
        (r'VERTCRS\["([^"]+)"', 'Имя'),
        (r'DATUM\["([^"]+)"', 'Датум'),
        (r'ELLIPSOID\["([^"]+)",([^,]+),([^,]+)', 'Эллипсоид'),
        (r'METHOD\["([^"]+)"', 'Математическая модель'),
        (r'PROJECTION\["([^"]+)"', 'Математическая модель'),
        (r'PARAMETER\["Longitude of natural origin",([^,]+)', 'Главный меридиан'),
        (r'PARAMETER\["central_meridian",([^,]+)', 'Главный меридиан'),
        (r'PARAMETER\["Latitude of natural origin",([^,]+)', 'Главная параллель'),
        (r'PARAMETER\["latitude_of_origin",([^,]+)', 'Главная параллель'),
        (r'PARAMETER\["Scale factor at natural origin",([^,]+)', 'Масштабный коэффициент'),
        (r'PARAMETER\["scale_factor",([^,]+)', 'Масштабный коэффициент'),
        (r'PARAMETER\["False easting",([^,]+)', 'Ложное смещение по X'),
        (r'PARAMETER\["false_easting",([^,]+)', 'Ложное смещение по X'),
        (r'PARAMETER\["False northing",([^,]+)', 'Ложное смещение по Y'),
        (r'PARAMETER\["false_northing",([^,]+)', 'Ложное смещение по Y'),
        (r'SCOPE\["([^"]+)"', 'Сфера применения'),
        (r'AREA\["([^"]+)"', 'Территория'),
        (r'VDATUM\["([^"]+)"', 'Датум'),
        (r'LENGTHUNIT\["([^"]+)"', 'Единицы измерения'),
        (r'CS\[[^,]+,(\d+)\]', 'Размерность'),
        (r'BBOX\[([^\]]+)\]', 'Границы'),
        (r'AUTHORITY\["EPSG",(\d+)\]', 'EPSG'),
        (r'AUTHORITY\["ESRI",(\d+)\]', 'ESRI'),
    ]
    
    for pattern, key in patterns:
        m = re.search(pattern, t)
        if m:
            if key == 'Эллипсоид':
                p[key] = [m.group(1), float(m.group(2)), float(m.group(3))]
            elif key in ['Главный меридиан', 'Главная параллель']:
                p[key] = float(m.group(1))
            elif key == 'Масштабный коэффициент':
                p[key] = float(m.group(1))
            elif key in ['Ложное смещение по X', 'Ложное смещение по Y']:
                p[key] = float(m.group(1))
            elif key == 'Границы':
                vals = m.group(1).split(',')
                p[key] = [float(v.strip()) for v in vals]
            elif key == 'Размерность':
                p[key] = m.group(1)
            else:
                p[key] = m.group(1)
    
    if 'PROJCRS' in t:
        p['Тип'] = 'Общий'
    elif 'GEOGCRS' in t:
        p['Тип'] = 'Географическая'
    elif 'GEODCRS' in t:
        p['Тип'] = 'Геоцентрическая'
    elif 'VERTCRS' in t:
        p['Тип'] = 'Вертикальная'
    else:
        p['Тип'] = 'Локальная'
    
    axes = re.findall(r'AXIS\["([^"]+)",([^\]]+)\]', t)
    if axes:
        p['Оси'] = [a[0] for a in axes]
    
    return p

def parse_file(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        d = parse_wkt(content)
        code = file_path.stem
        source = 'EPSG' if 'EPSG' in str(file_path) else 'ESRI'
        return {
            'code': code,
            'source': source,
            'Имя': d.get('Имя', '—'),
            'Тип': d.get('Тип', '—'),
            'Датум': d.get('Датум', '—'),
            'Эллипсоид': d.get('Эллипсоид', '—'),
            'Главный меридиан': d.get('Главный меридиан', '—'),
            'Главная параллель': d.get('Главная параллель', '—'),
            'Масштабный коэффициент': d.get('Масштабный коэффициент', '—'),
            'Ложное смещение по X': d.get('Ложное смещение по X', '—'),
            'Ложное смещение по Y': d.get('Ложное смещение по Y', '—'),
            'Математическая модель': d.get('Математическая модель', '—'),
            'Сфера применения': d.get('Сфера применения', '—'),
            'Территория': d.get('Территория', '—'),
            'Границы': d.get('Границы', '—'),
            'Единицы измерения': d.get('Единицы измерения', '—'),
            'Размерность': d.get('Размерность', '—'),
            'Оси': d.get('Оси', '—'),
        }
    except Exception as e:
        return None

def collect_folders(folders):
    all_data, total_files, errors, duplicates = {}, 0, 0, 0
    print('В папках:')
    for folder in folders:
        path = Path(folder)
        files = list(path.rglob('*.txt'))
        print(f"{folder}: найдено {len(files)} кодов")
        total_files += len(files)
        for fp in files:
            try:
                r = parse_file(fp)
                if r:
                    code = r['code']
                    if code in all_data:
                        if r['source'] == 'EPSG' and all_data[code]['source'] == 'ESRI':
                            all_data[code] = r
                            duplicates += 1
                        else:
                            new_code = f"{code}_{r['source']}"
                            all_data[new_code] = r
                    else:
                        all_data[code] = r
                else:
                    errors += 1
            except Exception:
                errors += 1
    print(f"\nОбработано: {len(all_data)} из {total_files}")
    print(f"Ошибок: {errors}")
    print(f"Дублей: {duplicates}")
    return all_data

def save(data, o='data.json'):
    def sort_key(k):
        try:
            return int(k.split('_')[0]) 
        except:
            return 0
    sorted_keys = sorted(data.keys(), key=sort_key)
    sorted_data = {k: data[k] for k in sorted_keys}
    
    json.dump(sorted_data, open(o, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'Сохранено в {o}')
    print(f'\nИТОГО')
    print(f"Всего: {len(data)}")

def main():
    folders = ['projcode/wkt2/EPSG', 'projcode/wkt2/ESRI']
    data = collect_folders(folders)
    save(data)
    
    sources = {}
    for d in data.values():
        s = d.get('source', 'Неизвестный')
        sources[s] = sources.get(s, 0) + 1
    
    for s, count in sorted(sources.items()):
        print(f"{s}: {count}")
    
    print('\nПо типу:')
    types = {}
    for d in data.values():
        t = d.get('Тип', 'Неизвестный')
        types[t] = types.get(t, 0) + 1
    for t, count in sorted(types.items()):
        print(f"{t}: {count}")
        
    #for i, (code, d) in enumerate(list(data.items())[:10], 1000):
    #    print(f"Пример: {code} [{d['source']}]: {d['Имя']}")

if __name__ == '__main__':
    main()