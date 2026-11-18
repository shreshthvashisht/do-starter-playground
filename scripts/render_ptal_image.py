import json, math
import numpy as np
from PIL import Image

COLORS = np.array([
    (68, 1, 84), (72, 40, 120), (62, 74, 137), (49, 104, 142), (38, 130, 142),
    (31, 158, 137), (53, 183, 121), (109, 205, 89), (253, 231, 37)
], dtype=np.uint8)  # same viridis ramp as screen.tsx

rows = np.array(json.load(open("data/ptal_compact.json")))
lon, lat, level = rows[:, 0], rows[:, 1], rows[:, 2].astype(int)

def merc_y(lat_deg):
    return np.log(np.tan(np.pi / 4 + np.radians(lat_deg) / 2))

pad = 0.002
west, east = lon.min() - pad, lon.max() + pad
south, north = lat.min() - pad, lat.max() + pad

W = 3000
x_span = math.radians(east - west)
y_top, y_bottom = merc_y(north), merc_y(south)
H = int(W * (y_top - y_bottom) / x_span)

px = ((lon - west) / (east - west) * W).astype(int)
py = ((y_top - merc_y(lat)) / (y_top - y_bottom) * H).astype(int)

img = np.zeros((H, W, 4), dtype=np.uint8)
rgb = COLORS[level]
# Each 100 m cell is about 5 px wide at this size, so stamp 6x6 blocks to leave no gaps.
for dx in range(-3, 3):
    for dy in range(-3, 3):
        x = np.clip(px + dx, 0, W - 1)
        y = np.clip(py + dy, 0, H - 1)
        img[y, x, :3] = rgb
        img[y, x, 3] = 255

Image.fromarray(img, "RGBA").save("apps/website/public/ptal_ai.png", optimize=True)
print("size:", W, "x", H)
print(f"coordinates: [[{west:.5f}, {north:.5f}], [{east:.5f}, {north:.5f}], "
      f"[{east:.5f}, {south:.5f}], [{west:.5f}, {south:.5f}]]")