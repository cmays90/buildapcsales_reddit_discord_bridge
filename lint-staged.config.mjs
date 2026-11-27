export default {
  'reddit-interactions/**/*.{js,jsx,ts,tsx,json,jsonc}': () =>
    'npm run lint --workspace=reddit-interactions',
  'discord-interactions/**/*.rs': () =>
    'cargo fmt --check --manifest-path discord-interactions/Cargo.toml',
}
