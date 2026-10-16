import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createAlexaBridge} from './alexa-server.mjs';
export {createAlexaBridge} from './alexa-server.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const bridge = createAlexaBridge();
  bridge.start().then(url => console.log(`Casa · Conectar Alexa: ${url}`)).catch(() => {console.error('Não foi possível iniciar a ponte Alexa na porta 8877.'); process.exitCode = 1;});
  const stop = async () => {await bridge.close(); process.exit(0);};
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
