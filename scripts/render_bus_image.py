import json, math
import numpy as np
from PIL import Image

# Warm ramp, dark (no bus service) to bright (excellent), distinct from the viridis total layer.
COLORS = np.array([
    (40, 10, 10), (84, 19, 19), (128, 25, 25), (170, 35, 30), (205, 60, 30),
    (230, 90, 30), (245, 125, 35), (252, 165, 60), (255, 215, 130)
], dtype=np.uint8)

# PTAL band edges (lower bounds of 1a, 1b, 2, 3, 4, 5, 6a, 6b) from the AI ranges in the data.
EDGES = np.array([0.3, 2.5, 5.0, 10.0, 15.0, 20.0, 25.0, 40.0])
LABELS = ["0", "1a", "1b", "2", "3", "4", "5", "6a", "6b"]

rows = np.array(json.load(open("data/ptal_compact.json")))
lon, lat, ai, bus = rows[:, 0], rows[:, 1], rows[:, 3], rows[:, 4]

# Band 0 only when the bus score is zero; otherwise count how many edges it passes.
band = np.where(bus <= 0, 0, 1 + np.searchsorted(EDGES[1:], bus, side="right"))
band = np.where((bus > 0) & (bus < EDGES[0]), 0, band).astype(int)

def merc_y(lat_deg):
    return np.log(np.tan(np.pi / 4 + np.radians(lat_deg) / 2))

pad = 0.002
west, east = lon.min() - pad, lon.max() + pad
south, north = lat.min() - pad, lat.max() + pad
W = 3000
y_top, y_bottom = merc_y(north), merc_y(south)
H = int(W * (y_top - y_bottom) / math.radians(east - west))

px = ((lon - west) / (east - west) * W).astype(int)
py = ((y_top - merc_y(lat)) / (y_top - y_bottom) * H).astype(int)

img = np.zeros((H, W, 4), dtype=np.uint8)
rgb = COLORS[band]
for dx in range(-3, 3):
    for dy in range(-3, 3):
        x = np.clip(px + dx, 0, W - 1)
        y = np.clip(py + dy, 0, H - 1)
        img[y, x, :3] = rgb
        img[y, x, 3] = 255

Image.fromarray(img, "RGBA").save("apps/website/public/ptal_bus.png", optimize=True)

n = len(rows)
bus_only = (bus > 0) & (np.abs(ai - bus) < 0.01)
served = ai > 0
print("size:", W, "x", H)
print(f"coordinates: [[{west:.5f}, {north:.5f}], [{east:.5f}, {north:.5f}], "
      f"[{east:.5f}, {south:.5f}], [{west:.5f}, {south:.5f}]]")
print("bus-only squares:", int(bus_only.sum()), f"= {bus_only.mean()*100:.1f}% of all squares")
print(f"bus-only share of squares with any service: {bus_only.sum() / served.sum() * 100:.1f}%")
print("bus-equivalent band shares (% of squares):")
for i, label in enumerate(LABELS):
    print(f"  {label}: {np.mean(band == i) * 100:.1f}")