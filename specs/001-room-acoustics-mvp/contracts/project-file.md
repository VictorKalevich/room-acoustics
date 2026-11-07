# Contract: файл проекта (экспорт/импорт)

Расширение `.roomacoustics.json`, UTF-8.

```json
{
  "format": "room-acoustics-project",
  "version": 1,
  "project": {
    "id": "uuid",
    "name": "Гостиная",
    "updatedAt": "2026-11-07T18:00:00Z",
    "room": { "depth": 5, "width": 4, "height": 2.5, "temperatureC": 20,
              "furnishing": "typical", "source": "manual",
              "materials": { "floor": "parquet", "ceiling": "concrete-painted",
                             "front": "plaster", "back": "plaster",
                             "left": "plaster", "right": "plaster" } },
    "sources": [ { "id": "spkL", "kind": "speaker", "fLow": 80, "fHigh": 20000, "height": 1.0 } ],
    "constraints": { "speakerMinFront": 0.2, "speakerMinSide": 0.3,
                     "listenerMinX": 1.5, "listenerMaxX": 4.4, "earHeight": 1.1,
                     "subZone": "walls", "subWallGap": 0.15 },
    "scanInfo": null,
    "result": null,
    "selectedIndex": 0
  }
}
```

Правила импорта: неизвестный `format` или `version` > 1 → понятная ошибка; отсутствующие
поля заполняются умолчаниями; значения вне допустимых диапазонов отклоняются с указанием поля.
