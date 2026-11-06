import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {main} from '../.CyDocBuild/stage-pages.mjs';
export {inspectHelpExport,stageHelpPages} from '../.CyDocBuild/stage-pages.mjs';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
