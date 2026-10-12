# GitHub, Netlify e central da casa

O nome é **Casa Universal**; a marca visual do painel é **casa.**.

## Publicar no Netlify pelo GitHub

1. No Netlify, escolha **Add new project → Import an existing project → GitHub**.
2. Selecione `DrLucasPCD/Casa-Universal-` e a branch `main`.
3. O `netlify.toml` define o comando `python3 scripts/build_site.py` e a pasta publicada `dist`. Não é necessário instalar as dependências Python da central para construir o site.
4. Publique. A página inicial permite informar e guardar o endereço da central, ou explorar `/?demo=1` com estados simulados.

O build copia apenas os nove arquivos públicos da interface. SQLite, chaves de dispositivos, APKs, análises brutas e configuração MCP específica de cada computador ficam fora da publicação. `firebase/config.json` identifica o projeto Firebase, sem credenciais de administrador; ele também não é copiado para o site. As regras de acesso são implantadas separadamente pelo console Firebase, não pelo Netlify.

## Usar no iPhone

Inicie **Iniciar no Wi-Fi.command** no Mac. No painel local, abra **No iPhone** e consulte o endereço da central e o código de acesso. No site Netlify, informe esse endereço, por exemplo `http://192.168.1.100:8787`, e toque em **Abrir minha central**. O navegador navega para o painel local, onde você entra com o código. Isso não cria um proxy entre o Netlify e sua casa. O acesso HTTP local é o modo de testes já existente; para HTTPS, configure certificado confiável na central.

O endereço é salvo somente no navegador. Não há descoberta automática da central pelo site, leitura direta do Firestore, sincronização de sessões entre origens nem comando real no modo de demonstração. Adicione o endereço **da central** à Tela de Início para abrir os controles diretamente. Salvar o site Netlify na Tela de Início abre a entrada pública.

## Por que usar o mesmo Wi-Fi não basta?

O navegador do iPhone usa a rede do iPhone, mas não oferece os sockets UDP e a descoberta multicast usados por BroadLink, Tuya, Sonoff e Samsung neste projeto. Safari também não disponibiliza Web Bluetooth para a fechadura. A interface envia pedidos HTTP à central; os drivers Python da central falam os protocolos dos dispositivos e usam o Bluetooth do computador.

Um app iOS nativo poderia usar recursos de rede local e Core Bluetooth, mediante permissões e implementação dos protocolos. Isso é uma implementação diferente desta PWA; não basta hospedar estes arquivos no Netlify. A fechadura HAHA ainda precisa de validação do protocolo e não pode ser aberta por este projeto atualmente.

## Como funciona o MCP?

Fluxos atuais:

```text
iPhone → painel da central → drivers → Wi-Fi / BroadLink IR / Bluetooth
Codex no Mac → MCP local por stdio → mesmos cadastros e drivers
central → Firestore privado → cópia das configurações sem credenciais
Netlify → entrada pública / demonstração / link para central
```

O MCP expõe 11 ferramentas para consultar dispositivos, estado e histórico, enviar os comandos disponíveis, descobrir aparelhos e configurar controles IR. Ele roda localmente com `.venv/bin/python -m casa.mcp_server`. Para configurar outro computador, copie o exemplo de `docs/mcp-config.example.toml` para a configuração MCP do seu cliente, ajustando os dois caminhos absolutos. A configuração específica desta instalação permanece em `.codex/config.toml` e não vai para o GitHub. Recarregue a conexão MCP para carregar as ferramentas.

Infravermelho sem fonte de retorno informa estado não confirmado. A fechadura HAHA permanece pendente. O MCP não expõe destrancamento. O Firestore guarda configurações; não substitui uma central ligada nem fornece telemetria física.

Ainda não existe endpoint MCP HTTP remoto neste projeto. Publicar no Netlify não cria esse endpoint. Acesso remoto ao painel requer uma conexão privada com a central; um MCP para um cliente na nuvem requer um servidor acessível e autenticado, além da comunicação com a central. Não exponha a porta local diretamente na internet. Como o Mac ficará ligado só durante os testes, o controle físico fica disponível apenas durante esses períodos.

Referências: [configuração Netlify](https://docs.netlify.com/build/configure-builds/file-based-configuration/), [MCP no Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Web Bluetooth e compatibilidade](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API#browser_compatibility), [Core Bluetooth da Apple](https://developer.apple.com/documentation/corebluetooth).
