import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Only the vscode-free modules are unit tested.
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
});
