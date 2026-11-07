# Less GO UI/UX experiment (Codex guidance)

This branch is an isolated UI/UX experiment. Keep main untouched.

## Design goal
Use the UI UX Pro Max skill (nextlevelbuilder/ui-ux-pro-max-skill) to improve the existing React + Vite Less GO mobile UI. Prefer restrained, production-like minimalism: reduce overly rounded shapes, excessive gradients, heavy shadows, and decorative clutter. Preserve brand recognition, Korean/English labels, readability, and touch targets.

## Scope
Start with app/src/screens/Home.jsx and app/src/screens/Courses.jsx and their shared presentational components/styles. Inspect existing styles and theme conventions before editing. Do not redesign other screens until the first two are reviewed.

## Hard constraints
- Preserve route data, scoring, GPS, Kakao map behavior, API integrations, navigation, and business logic.
- Do not edit history/heritage lens, audio guidance, Supabase/Firebase, or shop/business logic.
- Do not modify public/data route files, API endpoints, environment variables, or secrets.
- Do not add large dependencies without approval.
- Keep mobile responsiveness, accessible contrast, and keyboard/touch focus.
- Make changes only on this branch; do not merge or deploy automatically.

## Verification
Run `npm --prefix app run build` and report changed files, visible UI differences, and any issues. Compare the home and course picker before and after.
