import json, re
from pathlib import Path
from pyproj import CRS
from pyproj.enums import WktVersion

# ============================================================
# ПАРСЕР WKT (универсальный: работает и с WKT1, и с WKT2)
# ============================================================
def parse_wkt(t):
    p = {}
    patterns = [
        (r'PROJCRS\["([^"]+)"', 'Имя'),
        (r'PROJCS\["([^"]+)"', 'Имя'),          # WKT1
        (r'GEOGCRS\["([^"]+)"', 'Имя'),
        (r'GEOGCS\["([^"]+)"', 'Имя'),          # WKT1
        (r'GEODCRS\["([^"]+)"', 'Имя'),
        (r'GEODETICCRS\["([^"]+)"', 'Имя'),
        (r'VERTCRS\["([^"]+)"', 'Имя'),
        (r'VERT_CS\["([^"]+)"', 'Имя'),         # WKT1
        (r'VDATUM\["([^"]+)"', 'Высотная система'),
        (r'DATUM\["([^"]+)"', 'Датум'),
        (r'DATUM\["([^"]+)"', 'Датум'),         # WKT1
        (r'ELLIPSOID\["([^"]+)",([^,]+),([^,]+)', 'Эллипсоид'),
        (r'SPHEROID\["([^"]+)",([^,]+),([^,]+)', 'Эллипсоид'),  # WKT1
        (r'METHOD\["([^"]+)"', 'Математическая модель'),
        (r'PROJECTION\["([^"]+)"', 'Математическая модель'),    # WKT1
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
        (r'LENGTHUNIT\["([^"]+)"', 'Единицы измерения'),
        (r'UNIT\["([^"]+)"', 'Единицы измерения'),   # WKT1
        (r'CS\[[^,]+,(\d+)\]', 'Размерность'),
        (r'BBOX\[([^\]]+)\]', 'Границы'),
    ]

    for pattern, key in patterns:
        m = re.search(pattern, t)
        if m and key not in p:                  # ← не перезаписываем уже найденное
            try:
                if key == 'Эллипсоид':
                    p[key] = [m.group(1), float(m.group(2)), float(m.group(3))]
                elif key in ['Главный меридиан', 'Главная параллель',
                             'Масштабный коэффициент',
                             'Ложное смещение по X', 'Ложное смещение по Y']:
                    p[key] = float(m.group(1))
                elif key == 'Границы':
                    vals = m.group(1).split(',')
                    p[key] = [float(v.strip()) for v in vals]
                else:
                    p[key] = m.group(1)
            except (ValueError, IndexError):
                pass

    # --- EPSG / ESRI из AUTHORITY (берём последний — он от самой CRS) ---
    epsg_matches = re.findall(r'AUTHORITY\["EPSG",\s*"?(\d+)"?\]', t)
    esri_matches = re.findall(r'AUTHORITY\["ESRI",\s*"?(\d+)"?\]', t)
    if epsg_matches:
        p['EPSG'] = epsg_matches[-1]
    if esri_matches:
        p['ESRI'] = esri_matches[-1]

    # --- Тип ---
    if re.search(r'\bPROJCRS\b|\bPROJCS\b', t):
        p['Тип'] = 'Общий'
    elif re.search(r'\bGEOGCRS\b|\bGEOGCS\b', t):
        p['Тип'] = 'Географическая'
    elif re.search(r'\bGEODCRS\b|\bGEODETICCRS\b', t):
        p['Тип'] = 'Геоцентрическая'
    elif re.search(r'\bVERTCRS\b|\bVERT_CS\b', t):
        p['Тип'] = 'Вертикальная'
    else:
        p['Тип'] = 'Локальная'

    # --- Оси ---
    axes = re.findall(r'AXIS\["([^"]+)"', t)
    if axes:
        p['Оси'] = axes

    return p


# ============================================================
# ПАРСЕР ОДНОГО КОДА (читает WKT1 и WKT2 из разных папок)
# ============================================================
def parse_code(code, source, wkt1_dir, wkt2_dir):
    """
    code   — например, "32636"
    source — "EPSG" или "ESRI"
    wkt1_dir — Path к projcode/wkt1/<source>
    wkt2_dir — Path к projcode/wkt2/<source>
    """
    wkt1_path = wkt1_dir / f"{code}.txt"
    wkt2_path = wkt2_dir / f"{code}.txt"

    wkt1_string = None
    wkt2_string = None
    meta = {}

    # 1. Читаем WKT2 (приоритетный источник метаданных)
    if wkt2_path.exists():
        wkt2_string = wkt2_path.read_text(encoding='utf-8').strip()
        meta = parse_wkt(wkt2_string)
    # 2. Читаем WKT1
    if wkt1_path.exists():
        wkt1_string = wkt1_path.read_text(encoding='utf-8').strip()
        # Если WKT2 нет — парсим WKT1
        if not meta:
            meta = parse_wkt(wkt1_string)

    # 3. Если ни одного файла нет — пропускаем
    if not wkt1_string and not wkt2_string:
        return None

    # 4. Если WKT2 нет, но есть WKT1 — сгенерируем WKT2 через pyproj (опционально)
    if wkt1_string and not wkt2_string:
        try:
            crs = CRS.from_wkt(wkt1_string)
            wkt2_string = crs.to_wkt()
        except Exception:
            pass  # оставим None

    # 5. Если WKT1 нет, но есть WKT2 — сгенерируем WKT1 через pyproj (опционально)
    if wkt2_string and not wkt1_string:
        try:
            crs = CRS.from_wkt(wkt2_string)
            wkt1_string = crs.to_wkt(WktVersion.WKT1_GDAL)
        except Exception:
            pass

    return {
        'code': code,
        'source': source,
        'name': meta.get('Имя') or '—',
        'type': meta.get('Тип') or '—',
        'datum': meta.get('Датум') or '—',
        'ellipsoid': meta.get('Эллипсоид') or '—',
        'CMeridian': meta.get('Главный меридиан') or '—',
        'CParallel': meta.get('Главная параллель') or '—',
        'MaschtabKoef': meta.get('Масштабный коэффициент') or '—',
        'FalseX': meta.get('Ложное смещение по X') or '—',
        'FalseY': meta.get('Ложное смещение по Y') or '—',
        'MathModel': meta.get('Математическая модель') or '—',
        'Primenenie': meta.get('Сфера применения') or '—',
        'Place': meta.get('Территория') or '—',
        'Granica': meta.get('Границы') or '—',
        'Dlina': meta.get('Единицы измерения') or '—',
        'Ugli': meta.get('Размерность') or '—',
        'Osi': meta.get('Оси') or '—',
        'WKT1': wkt1_string or '-',
        'WKT2': wkt2_string or '-',
    }


# ============================================================
# СБОР ВСЕХ КОДОВ ИЗ ПАПОК
# ============================================================
def collect_folders(base_dir='projcode'):
    """
    Ожидает структуру:
      projcode/wkt1/EPSG/*.txt
      projcode/wkt1/ESRI/*.txt
      projcode/wkt2/EPSG/*.txt
      projcode/wkt2/ESRI/*.txt
    """
    base = Path(base_dir)
    all_data = {}
    total_codes = 0
    errors = 0
    duplicates = 0

    for source in ('EPSG', 'ESRI'):
        wkt1_dir = base / 'wkt1' / source
        wkt2_dir = base / 'wkt2' / source

        if not wkt1_dir.exists() and not wkt2_dir.exists():
            print(f"[{source}] папки не найдены — пропускаем")
            continue

        # Собираем все коды из обеих папок
        codes = set()
        if wkt1_dir.exists():
            codes.update(fp.stem for fp in wkt1_dir.glob('*.txt'))
        if wkt2_dir.exists():
            codes.update(fp.stem for fp in wkt2_dir.glob('*.txt'))

        print(f"[{source}] найдено {len(codes)} кодов")
        total_codes += len(codes)

        for code in codes:
            try:
                r = parse_code(code, source, wkt1_dir, wkt2_dir)
                if not r:
                    errors += 1
                    continue

                # Дедупликация: если код уже есть
                if code in all_data:
                    # EPSG приоритетнее ESRI
                    if source == 'EPSG' and all_data[code]['source'] == 'ESRI':
                        all_data[code] = r
                        duplicates += 1
                    else:
                        new_code = f"{code}_{source}"
                        all_data[new_code] = r
                else:
                    all_data[code] = r

            except Exception as e:
                print(f"  Ошибка {source}/{code}: {e}")
                errors += 1

    print(f"\nОбработано: {len(all_data)} из {total_codes}")
    print(f"Ошибок: {errors}")
    print(f"Дублей: {duplicates}")
    return all_data


# ============================================================
# СОХРАНЕНИЕ
# ============================================================
def save(data, o='data.json'):
    def sort_key(k):
        try:
            return int(k.split('_')[0])
        except:
            return 0
    sorted_keys = sorted(data.keys(), key=sort_key)
    sorted_data = {k: data[k] for k in sorted_keys}

    json.dump(sorted_data, open(o, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    print(f'Сохранено в {o}')
    print(f'Всего: {len(data)}')


# ============================================================
# MAIN
# ============================================================
def main():
    data = collect_folders('projcode')
    save(data, 'data.json')

    # Статистика
    sources = {}
    for d in data.values():
        s = d.get('source', 'Неизвестный')
        sources[s] = sources.get(s, 0) + 1
    print('\nПо источнику:')
    for s, count in sorted(sources.items()):
        print(f"  {s}: {count}")

    types = {}
    for d in data.values():
        t = d.get('type', 'Неизвестный')
        types[t] = types.get(t, 0) + 1
    print('\nПо типу:')
    for t, count in sorted(types.items()):
        print(f"  {t}: {count}")

    print('\nПо математической модели:')
    models = {}
    for d in data.values():
        t = d.get('MathModel', 'Неизвестный')
        models[t] = models.get(t, 0) + 1
    for t, count in sorted(models.items(), key=lambda x: -x[1])[:20]:
        print(f"  {t}: {count}")


if __name__ == '__main__':
    main()