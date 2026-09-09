import { execSync } from 'child_process';

execSync('vp dev --open=/.sandbox/index.html --port=3100 --host', { stdio: 'inherit' });
