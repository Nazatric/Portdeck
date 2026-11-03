import { mkdirSync, writeFileSync } from 'node:fs';
import { demoSources } from '../src/lib/samples';

mkdirSync('multiplatform/composeApp/src/androidMain/assets', { recursive: true });
writeFileSync('multiplatform/composeApp/src/androidMain/assets/demos.json', JSON.stringify(demoSources));
