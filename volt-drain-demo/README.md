# Volt drain demo

A small standalone demo of the proposed drain model for Volt's social battery, so the numbers can be tested before anything changes in the iOS app.

Open `index.html` in a browser (no build step, no server needed). Pick a preset day or edit the schedule, then tune the model and persona numbers. The dashed grey line is the formula the app uses today (`updateBatteryState` in `Volt/Volt/ContentView.swift`), assuming a perfect Bluetooth count.

## The model

Once a minute:

1. **People nearby** `N`: Bluetooth devices with RSSI ≥ −75 dBm seen in the last 2 min, minus devices seen continuously for over an hour, divided by 2 devices per person. The demo takes `N` directly.
2. **Social load** `L = 0.10 (if out) + (N / 30) ^ 0.6`, × 0.6 with close friends. Home alone or asleep is 0.
3. **Drain** (%/h) `= 9 × temperament × max(0, L − comfort) × (1 + 0.3 × (1 − level/100)) × hrvFactor`. 60% applies now, 40% goes into a fatigue debt released over ~90 min.
4. **Recharge** when below comfort: exponential toward 100 with a half-life of 2 h asleep and 2.5 to 3.5 h awake. Extroverts' target drops to 80 after 6 h awake alone.

| Persona   | Temperament | Comfort | Awake half-life |
|-----------|------------:|--------:|----------------:|
| Introvert | 1.4 | 0.05 | 2.5 h |
| Ambivert  | 1.0 | 0.12 | 3.0 h |
| Extrovert | 0.7 | 0.25 | 3.5 h |

All of these are starting points chosen so typical days land somewhere believable. They are not values taken from a study.

## Files

- `drain-model.js`: the model as pure functions (browser global `VoltModel` or Node `require`). This is the part to port to Swift.
- `index.html`: the interactive demo.
- `test/drain-model.test.js`: behaviour checks (`node --test`, Node 18+).
