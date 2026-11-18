import json

ORDER = ["0", "1a", "1b", "2", "3", "4", "5", "6a", "6b"]
rows = []
multi = 0

with open("data/ptal2023.geojson", encoding="utf-8") as f:
    for line in f:
        line = line.strip().rstrip(",")
        if not line.startswith('{ "type": "Feature"'):
            continue
        feat = json.loads(line)
        geom = feat["geometry"]
        if not geom:
            continue
        if geom["type"] == "MultiPolygon":
            multi += 1
        ring = geom["coordinates"]
        while isinstance(ring[0][0], list):
            ring = ring[0]
        pts = ring[:-1]
        lon = sum(pt[0] for pt in pts) / len(pts)
        lat = sum(pt[1] for pt in pts) / len(pts)
        p = feat["properties"]
        rows.append([round(lon, 5), round(lat, 5),
                     ORDER.index(str(p["PTAL_2023"])),
                     round(p["AI"], 2), round(p["BUS"], 2)])

with open("data/ptal_compact.json", "w") as f:
    json.dump(rows, f, separators=(",", ":"))

print(len(rows), "squares written,", multi, "were MultiPolygon")