# Рендеры систем миссии

Картинки на вкладке Mission concept — рендеры официальных 3D-моделей NASA
(github.com/nasa/NASA-3D-Resources) на прозрачном фоне.

1. Скачайте three@0.160 (build/, examples/) рядом с render.html и положите .glb в models/.
2. `python -m http.server 8810` в этой папке.
3. `python render.py '[["suit","m=suit.glb&az=28&el=6&fill=0.6"]]'` → out_suit.png.

Модели: Habitat Demonstration Unit, Z2 Spacesuit, InSight (panels deployed), Mars 2020 Perseverance,
RASSOR, ISS (A), Space Exploration Vehicle, Mars Reconnaissance Orbiter (A).
