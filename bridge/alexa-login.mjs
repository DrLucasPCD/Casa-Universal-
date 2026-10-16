import cookieLibrary from 'alexa-cookie2';
import {mkdir, readFile, writeFile, chmod} from 'node:fs/promises';
import {resolve, join} from 'node:path';

// The upstream library speaks Amazon's mobile registration flow. Its logging is
// intentionally suppressed because its debug messages can contain credentials.
export class AlexaLogin {
  constructor({directory = resolve('data/alexa'), proxyPort = 8878, library = cookieLibrary} = {}) {
    this.directory = directory;
    this.proxyPort = proxyPort;
    this.library = library;
    this.registration = null;
    this.phase = 'disconnected';
    this.remember = false;
    this.generation = 0;
  }
  status() {
    return {phase: this.phase, authenticated: !!this.registration?.accessToken,
      remembered: this.remember, loginUrl: this.phase === 'awaiting_login' ? `http://127.0.0.1:${this.proxyPort}/` : null};
  }
  options() {
    return {amazonPage: 'amazon.com.br', baseAmazonPage: 'amazon.com',
      amazonPageProxyLanguage: 'pt_BR', acceptLanguage: 'pt-BR',
      deviceAppName: 'Casa Universal', proxyOnly: true, setupProxy: true,
      proxyOwnIp: '127.0.0.1', proxyListenBind: '127.0.0.1', proxyPort: this.proxyPort,
      proxyLogLevel: 'silent', logger: () => {},
      formerDataStorePath: join(this.directory, 'device-identity.json'),
      formerRegistrationData: this.registration || {},
      proxyCloseWindowHTML: '<!doctype html><meta charset="utf-8"><title>Casa · Amazon</title><h1>Login concluído</h1><p>Volte à aba Casa · Conectar Alexa para verificar a conexão.</p><a href="http://127.0.0.1:8877/">Voltar à Casa</a>'};
  }
  async begin({remember = false} = {}) {
    if (['starting', 'awaiting_login'].includes(this.phase)) return this.status();
    if (this.registration) return this.status();
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    await chmod(this.directory, 0o700);
    const generation = ++this.generation;
    this.remember = remember === true;
    this.phase = 'starting';
    this.library.generateAlexaCookie(this.options(), async (error, result) => {
      if (generation !== this.generation) return;
      if (result && typeof result.accessToken === 'string' && typeof result.refreshToken === 'string') {
        this.registration = result;
        this.phase = 'authenticated';
        if (this.remember) {
          try { await this.save(); } catch { this.remember = false; this.phase = 'authenticated_memory'; }
        }
        return;
      }
      // A first callback is the library's notification that the local proxy is ready.
      if (error?.message?.startsWith(`Please open http://127.0.0.1:${this.proxyPort}/`)) {
        this.phase = 'awaiting_login';
      } else {
        this.phase = 'login_failed';
      }
    });
    return this.status();
  }
  async save() {
    await writeFile(join(this.directory, 'registration.json'), JSON.stringify(this.registration), {mode: 0o600});
    await chmod(join(this.directory, 'registration.json'), 0o600);
  }
  async restore() {
    try {
      const registration = JSON.parse(await readFile(join(this.directory, 'registration.json'), 'utf8'));
      if (typeof registration.refreshToken !== 'string' || !registration.refreshToken) return;
      this.registration = registration;
      this.remember = true;
      this.phase = 'refreshing';
      await this.refresh();
    } catch { this.phase = 'disconnected'; this.registration = null; this.remember = false; }
  }
  async refresh() {
    if (!this.registration?.refreshToken) throw new Error('Faça o login na Amazon primeiro.');
    const generation = this.generation;
    return new Promise((resolveResult, reject) => {
      this.library.refreshAlexaCookie(this.options(), async (error, result) => {
        if (generation !== this.generation) return reject(new Error('Conexão encerrada.'));
        if (error || !result?.accessToken) { this.phase = 'login_expired'; return reject(new Error('A Amazon não renovou o login.')); }
        this.registration = result;
        this.phase = 'authenticated';
        if (this.remember) { try { await this.save(); } catch { this.remember = false; this.phase = 'authenticated_memory'; } }
        resolveResult(result.accessToken);
      });
    });
  }
  close() {
    this.generation++;
    this.library.stopProxyServer();
    this.registration = null;
    this.phase = 'disconnected';
  }
}
