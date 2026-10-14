# GitHub, Netlify e central da casa

O nome é **Casa Universal**; a marca visual do painel é **casa.**.

## Publicar no Netlify pelo GitHub

1. No Netlify, escolha **Add new project → Import an existing project → GitHub**.
2. Selecione `DrLucasPCD/Casa-Universal-` e a branch `main`.
3. O `netlify.toml` define o comando `python3 scripts/build_site.py` e a pasta publicada `dist`. Não é necessário instalar as dependências Python da central para construir o site.
4. Publique. Ao abrir a página inicial, o navegador segue automaticamente para `http://casa-universal.local/`, sem formulário nem código de acesso. `/?demo=1` abre os estados simulados, sem redirecionar.

O build copia apenas os dez arquivos públicos da interface. SQLite, chaves de dispositivos, APKs, análises brutas e configuração MCP específica de cada computador ficam fora da publicação. `firebase/config.json` identifica o projeto Firebase, sem credenciais de administrador; ele também não é copiado para o site. As regras de acesso são implantadas separadamente pelo console Firebase, não pelo Netlify.

## Usar no iPhone

Para comandos pelo **ChatGPT**, consulte [o guia da conexão remota](chatgpt.md). O endpoint `https://casa-universal.netlify.app/mcp` é uma função autenticada e precisa das variáveis privadas de produção; não encaminhe o endereço HTTP local como URL pública do ChatGPT.

Com o ESP32 ligado e o iPhone no mesmo Wi-Fi, abra o site Netlify. Ele abre automaticamente o painel pelo nome `casa-universal.local`. O firmware anuncia esse nome por mDNS; a rede precisa permitir sua resolução. Isso dispensa preencher o IP, mas não faz uma varredura da rede nem cria um proxy entre o Netlify e sua casa.

Para outra central, como o servidor de testes do Mac, ou quando a rede não resolve nomes `.local`, abra `SEU_SITE_NETLIFY/?configurar=1`. Nessa tela você pode informar outro endereço e salvá-lo neste navegador; nas próximas aberturas ele também será usado automaticamente. **Usar conexão automática** remove essa escolha e volta ao nome do ESP32. Se a central estiver desligada ou o iPhone estiver fora de casa, o navegador poderá mostrar uma falha de conexão. A entrada pública não consegue verificar antecipadamente uma central HTTP a partir do site HTTPS.

Adicione o endereço **da central** à Tela de Início para abrir os controles diretamente. Não há leitura direta do Firestore, sincronização de sessões entre origens nem comando real no modo de demonstração. Para os recursos da central ESP32 e o MCP HTTP local, veja [o guia do firmware](../firmware/esp32/README.md). As informações abaixo sobre drivers Python e MCP por stdio descrevem a alternativa de testes no Mac.

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

O MCP remoto autenticado está em `https://casa-universal.netlify.app/mcp`. A ponte Netlify recebe pedidos OAuth e o ESP32 consulta essa fila por HTTPS de saída, sem portas abertas no roteador. Veja [configuração ChatGPT](chatgpt.md). São 18 ferramentas remotas, com consulta e controle separados pela autorização existente. O ESP32 precisa permanecer alimentado e conectado à internet. O Mac pode ser desligado depois da configuração.

Referências: [configuração Netlify](https://docs.netlify.com/build/configure-builds/file-based-configuration/), [MCP no Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Web Bluetooth e compatibilidade](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API#browser_compatibility), [Core Bluetooth da Apple](https://developer.apple.com/documentation/corebluetooth).
