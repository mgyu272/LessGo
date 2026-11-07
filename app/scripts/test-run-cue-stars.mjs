import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { distance } from "../src/lib/geo.js";

globalThis.window = { speechSynthesis: null };
globalThis.document = { addEventListener() {} };

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { advanceCues, nextCue } = await server.ssrLoadModule("/src/state/useRun.js");
  const { StarCard } = await server.ssrLoadModule("/src/screens/Run.jsx");

  await test("passing a later cue keeps an earlier unpassed cue available", () => {
    assert.equal(typeof advanceCues, "function");
    assert.equal(typeof nextCue, "function");
    const cues = [
      { pos: { lat: 0, lng: 0 }, text: { ko: "출발" } },
      { pos: { lat: 0, lng: 0.001 }, text: { ko: "왼쪽" } },
      { pos: { lat: 0, lng: 0.002 }, text: { ko: "오른쪽" } },
    ];
    const run = {
      course: { cues }, me: [0, 0.002], cuesFired: new Set([0, 2]),
      cuesPassed: new Set([0]), cueClosest: new Map(),
    };
    assert.equal(nextCue(run).i, 2);
    assert.deepEqual(advanceCues(run, cues[2].pos), { dir: "right" });
    run.me = [0, 0.001];
    assert.equal(nextCue(run).i, 1);
  });

  await test("all route cues remain reachable through a full course replay", async () => {
    const { buildCourses } = await server.ssrLoadModule("/src/lib/routes.js");
    const read = (name) => JSON.parse(readFileSync(new URL(`../public/data/lessgo/${name}`, import.meta.url), "utf8"));
    const courses = buildCourses(read("routes.json"), read("routes.geojson"), {}).list;
    assert.ok(courses.length > 0);
    for (const course of courses) {
      const run = {
        course, me: [course.path[0].lat, course.path[0].lng], cuesFired: new Set([0]),
        cuesPassed: new Set([0]), cueClosest: new Map(),
      };
      for (const point of course.path) {
        run.me = [point.lat, point.lng];
        course.cues.forEach((cue, i) => {
          if (distance(point, cue.pos) <= 25) run.cuesFired.add(i);
        });
        advanceCues(run, point);
      }
      assert.equal(run.cuesPassed.size, course.cues.length, course.id);
      assert.equal(nextCue(run), null, course.id);
    }
  });

  await test("a six-star course still renders ten progress icons", () => {
    assert.equal(typeof StarCard, "function");
    const html = renderToStaticMarkup(React.createElement(StarCard, {
      v: { course: {}, starsGot: 3, starsTotal: 6, nextStarM: 240 },
    }));
    const stars = html.match(/<span class="rp-stars"[^>]*>(.*?)<\/span>/)?.[1];
    assert.ok(stars);
    assert.equal([...stars.matchAll(/<svg\b/g)].length, 10);
    assert.equal([...stars.matchAll(/<svg[^>]*class="on"/g)].length, 5);
  });
} finally {
  await server.close();
}
