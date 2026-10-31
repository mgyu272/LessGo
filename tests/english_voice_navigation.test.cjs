const test = require("node:test");
const assert = require("node:assert/strict");
const { RouteGuidanceEngine, EnglishVoiceNavigation } = require("../web/english_voice_navigation.js");

const metersToLon = meters => meters / 111320;
const route = {
  supported: true,
  coordinates: Array.from({ length: 13 }, (_, i) => [metersToLon(i * 50), 0]),
  maneuvers: [
    { id: "left", turn: "left", chainage_m: 200 },
    { id: "right", turn: "right", chainage_m: 400 },
  ],
};
const at = (meters, latitude = 0) => ({ longitude: metersToLon(meters), latitude, accuracy: 4 });

test("emits left and right guidance at the 100m and 40m thresholds once", () => {
  const engine = new RouteGuidanceEngine(route);
  assert.deepEqual(engine.updatePosition(0, at(0).longitude, 4).events, []);
  assert.equal(engine.updatePosition(0, at(120).longitude, 4).events[0].text, "In one hundred meters, turn left.");
  assert.deepEqual(engine.updatePosition(0, at(120).longitude, 4).events, []);
  assert.equal(engine.updatePosition(0, at(170).longitude, 4).events[0].text, "In forty meters, turn left.");
  engine.updatePosition(0, at(200).longitude, 4);
  assert.equal(engine.updatePosition(0, at(310).longitude, 4).events[0].text, "In one hundred meters, turn right.");
  assert.equal(engine.updatePosition(0, at(370).longitude, 4).events[0].text, "In forty meters, turn right.");
});

test("off-route warning requires three consecutive fixes and only announces once", () => {
  const engine = new RouteGuidanceEngine(route);
  const outside = at(0, metersToLon(100));
  engine.updatePosition(outside.latitude, outside.longitude, outside.accuracy);
  engine.updatePosition(outside.latitude, outside.longitude, outside.accuracy);
  const third = engine.updatePosition(outside.latitude, outside.longitude, outside.accuracy);
  assert.ok(third.events.some(event => event.text === "You are off the route."));
  assert.deepEqual(engine.updatePosition(outside.latitude, outside.longitude, outside.accuracy).events, []);
});

test("arrival requires three fixes at route end", () => {
  const engine = new RouteGuidanceEngine(route);
  for (const meters of [0, 100, 200, 300, 400, 500]) engine.updatePosition(0, at(meters).longitude, 4);
  const end = at(600);
  engine.updatePosition(0, end.longitude, 4);
  engine.updatePosition(0, end.longitude, 4);
  const arrived = engine.updatePosition(0, end.longitude, 4);
  assert.ok(arrived.events.some(event => event.text === "You have arrived at your destination."));
});

test("route replacement clears progress and spoken-event history", () => {
  const engine = new RouteGuidanceEngine(route);
  engine.updatePosition(0, at(120).longitude, 4);
  assert.ok(engine.announced.size > 0);
  engine.setRoute(route);
  assert.equal(engine.progressM, 0);
  assert.equal(engine.announced.size, 0);
});

test("GPS progress never moves backward after noisy fixes", () => {
  const engine = new RouteGuidanceEngine(route);
  engine.updatePosition(0, at(0).longitude, 4);
  const forward = engine.updatePosition(0, at(180).longitude, 4).progressM;
  const noisyBack = engine.updatePosition(0, at(90).longitude, 4).progressM;
  assert.ok(noisyBack >= forward);
});

test("stop cancels speech and clears the active GPS watcher", () => {
  let callback;
  let clearedWatch = null;
  let canceled = 0;
  const spoken = [];
  class FakeUtterance { constructor(text) { this.text = text; } }
  const nav = new EnglishVoiceNavigation({
    geolocation: {
      watchPosition(success) { callback = success; return 17; },
      clearWatch(id) { clearedWatch = id; },
    },
    speechSynthesis: { speak(item) { spoken.push(item); }, cancel() { canceled += 1; } },
    Utterance: FakeUtterance,
  });
  nav.setRoute(route);
  assert.equal(nav.start({ mode: "gps", voiceEnabled: true }), true);
  callback({ coords: { latitude: 0, longitude: at(120).longitude, accuracy: 4 } });
  assert.equal(spoken[0].lang, "en-US");
  nav.stop();
  assert.equal(clearedWatch, 17);
  assert.ok(canceled >= 2);
  assert.equal(nav.running, false);
});

test("simulation uses the same English speech output", () => {
  let tick;
  const spoken = [];
  class FakeUtterance { constructor(text) { this.text = text; } }
  const nav = new EnglishVoiceNavigation({
    geolocation: null,
    speechSynthesis: { speak(item) { spoken.push(item); }, cancel() {} },
    Utterance: FakeUtterance,
    setIntervalFn(callback) { tick = callback; return 1; },
    clearIntervalFn() {},
  });
  nav.setRoute(route);
  assert.equal(nav.start({ mode: "simulation", speedMultiplier: 15, voiceEnabled: true }), true);
  tick(); tick(); tick();
  assert.ok(spoken.some(item => item.text === "In one hundred meters, turn left."));
  assert.equal(spoken[0].lang, "en-US");
  nav.stop();
});

test("repeated GPS fixes do not queue duplicate speech", () => {
  const spoken = [];
  let canceled = 0;
  class FakeUtterance { constructor(text) { this.text = text; } }
  const nav = new EnglishVoiceNavigation({
    geolocation: null,
    speechSynthesis: { speak(item) { spoken.push(item); }, cancel() { canceled += 1; } },
    Utterance: FakeUtterance,
  });
  nav.setRoute(route);
  nav.running = true;
  nav._handlePosition(0, at(0).longitude, 4);
  nav._handlePosition(0, at(120).longitude, 4);
  nav._handlePosition(0, at(120).longitude, 4);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, "In one hundred meters, turn left.");
  assert.ok(canceled >= 1);
  nav.stop();
});
