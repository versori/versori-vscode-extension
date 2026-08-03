import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Only the vscode-free modules are unit tested; see docs/superpowers/specs.
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
});
