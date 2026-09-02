import { execSync } from 'child_process';

execSync('vite --open=/.sandbox/index.html --port=3100 --host', { stdio: 'inherit' });
