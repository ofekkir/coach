import { defineConfig } from 'vitest/config';

export default defineConfig({
  // esbuild (vitest's default transformer) handles JSX with the automatic runtime,
  // matching tsconfig `jsx: react-jsx`. No react plugin needed — pulling it in drags
  // a second vite version into typecheck and conflicts under exactOptionalPropertyTypes.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
