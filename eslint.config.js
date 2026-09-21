import tseslint from 'typescript-eslint';

// Boundary rules. Keep ALLOWED in sync with each modules/<name>/MODULE.md and AGENTS.md.
const MODULES = ['project', 'script', 'asset', 'video', 'job'];
const ALLOWED = {
  project: [],
  job: [],
  script: ['project'],
  asset: ['project', 'job'],
  video: ['project', 'asset', 'job'],
};

const UP = '(?:\\.\\./)+'; // one or more "../"

const restrict = (patterns) => ({ 'no-restricted-imports': ['error', { patterns }] });

const moduleRules = MODULES.map((m) => {
  const others = MODULES.filter((x) => x !== m);
  const forbidden = others.filter((x) => !ALLOWED[m].includes(x));
  const patterns = [
    {
      regex: `^${UP}(?:${others.join('|')})/.+`,
      message: 'Import other modules only through their index.ts.',
    },
  ];
  if (forbidden.length > 0) {
    patterns.push({
      regex: `^${UP}(?:${forbidden.join('|')})$`,
      message: `Module "${m}" must not depend on: ${forbidden.join(', ')}.`,
    });
  }
  return { files: [`src/server/modules/${m}/**/*.{ts,tsx}`], rules: restrict(patterns) };
});

export default [
  { ignores: ['dist', 'node_modules'] },
  ...tseslint.configs.recommended,
  ...moduleRules,
  {
    files: ['src/worker/**/*.ts'],
    rules: restrict([
      {
        regex: `^${UP}server/modules/[^/]+/.+`,
        message: 'Worker may import modules only through their index.ts.',
      },
    ]),
  },
  {
    files: ['src/server/shared/**/*.ts'],
    rules: restrict([{ regex: `^${UP}modules(?:/|$)`, message: 'shared/ must not import modules/.' }]),
  },
  {
    files: ['src/client/**/*.{ts,tsx}'],
    rules: restrict([
      { regex: `^${UP}(?:server|worker)(?:/|$)`, message: 'client may import only contracts/ and client/.' },
    ]),
  },
  {
    files: ['src/contracts/**/*.ts'],
    rules: restrict([
      { regex: `^${UP}(?:server|client|worker)(?:/|$)`, message: 'contracts/ must not import server, client or worker.' },
    ]),
  },
];
