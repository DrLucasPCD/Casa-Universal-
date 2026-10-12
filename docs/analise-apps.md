# Análise dos cinco aplicativos

Análise estática dos arquivos fornecidos, concluída em 12 de outubro de 2026. O [REA](https://github.com/morluto/rea) foi aplicado aos cinco pacotes Android, não apenas à fechadura. Foram usadas a CLI `rea-agents@6.4.0`, revisão `ec2d251c0ad8382e0665546be5ec8f5f1c175962`, e a ponte JADX headless 0.7.1 com SHA-256 verificado. O Java 21 foi colocado em `.tools/`, sem instalação global. Os aplicativos Android não foram instalados nem executados.

## Escopo e rastreabilidade

Cada APK passou por extração de manifesto, permissões e inventário de classes. Foram investigadas classes e métodos selecionados relacionados a controle, além de componentes JavaScript selecionados. Em XAPK, foi analisado o APK base: bibliotecas nativas dos splits de ABI e traduções não foram decompiladas. Não foi feita validação da assinatura APK, análise dinâmica, captura do tráfego dos apps ou reconstrução integral dos SDKs.

Os resultados completos estão em `research/evidence/`, excluídos do Git por conterem grandes saídas e trechos de código de terceiros. O índice persistente `research/analysis-index.json` registra operação, ferramenta, hash do artefato e IDs de evidência. `scripts/analyze_apks.py` reproduz a inspeção dos pacotes quando as ferramentas e os APKs locais estiverem presentes. A extração e as chamadas selecionadas adicionais estão registradas nas evidências; não são todas automatizadas nesse script.

| Arquivo fornecido | SHA-256 do arquivo original |
| --- | --- |
| BroadLink 1.8.40.c4f7cf3c1 APK | `53515472ae20175d75d352f1140ab291e13131a7ae312a52b869a4c84957347f` |
| eWeLink 5.29.1 XAPK | `2d53130178a3a8173511c0457ddff03a7f7370c9a7ac2d19b17b9c5ed4dc5978` |
| HAHA Lock 1.1.5 XAPK | `c61e4105a1c75ebd371c8362679988bfbb7c344ed9d27a341a2dc2070857c8bc` |
| Smart Life 7.11.6 XAPK | `6a85f3bb8607b6e5e4539fd0ebd817bd2e9f0b6a14ec149e715bface397c2a52` |
| SmartThings 1.8.51.30 APK | `6c22459ad549fff248e6879052d17bfe5f370ed60a2f338420e1b52d2494fa35` |

## BroadLink

**Observado no artefato:** `cn.com.broadlink.sdk.BLLet.Controller` expõe descoberta, pareamento, consulta de IP/estado, `dnaControl`, `dnaPassthrough`, consulta de perfis e códigos IR de ar-condicionado. Foram analisados também os assets `adapter.js` e `jssdk.js`. Não foi encontrado um catálogo completo de códigos nos assets examinados. Isso, isoladamente, não prova que nenhum código esteja em outra parte do pacote.

**Fonte oficial adicional:** a [documentação de gerenciamento de IR](https://docs.ibroadlink.com/public/appsdk_en/appsdk_07/) descreve consulta de marcas/modelos e download de códigos da nuvem via SDK. A existência desses métodos não concede uma licença/chave de integração ao serviço privado. Nenhuma credencial do aplicativo foi extraída para reutilização nesse serviço.

**Integração construída:** descoberta UDP, autenticação local, envio e aprendizado infravermelho pela biblioteca [python-broadlink](https://github.com/mjg59/python-broadlink). A autenticação do RM pro+ real respondeu. O fluxo por marcas usa dados públicos, com teste e confirmação humana antes de salvar um novo controle. Nenhum perfil é marcado como fisicamente validado apenas pelo ACK do BroadLink.

Evidências principais: `broadlink-package.json`, `broadlink-javascript.json`, `broadlink-sdk.json`, `broadlink-controller.json`. A decompilação selecionada não reconstruiu o protocolo binário completo do SDK proprietário; a biblioteca de interoperabilidade implementa esse transporte.

## eWeLink / Sonoff

**Observado no artefato:** a ponte Android `com.pair.bluetooth.coolkit.BLEPairModule` expõe métodos de pareamento e informação do aparelho. O asset `assets/index.android.bundle` é bytecode Hermes v84, com magic `c61fbc03c103191f`; apesar de uma cópia ter nome `.js`, não é JavaScript textual. A tentativa de análise JavaScript do REA registrou falha UTF-8. Ela não foi tratada como decompilação bem-sucedida.

O bytecode foi então desmontado separadamente com [hermes-dec](https://github.com/P1sec/hermes-dec) 0.1.7. Essa etapa não é um recurso do REA. A listagem observou os endpoints `/zeroconf/switch`, `/zeroconf/switches` e `/zeroconf/getState` na tabela de operações LAN, na linha 699036. Na função `crateMdnsDeviceParams`, nº 23986, offset `0x00ae8c8f`, apareceram `devicekey`, `deviceid`, `sequence`, `selfApikey`, `iv`, `encrypt` e `data`. Na função `encryptionData`, nº 23990, offset `0x00ae9038`, a chave é transformada por MD5, seguida de AES-CBC com padding PKCS7 e saída Base64. São observações de bytecode, sem prova de execução nesse firmware.

**Integração construída:** anúncios mDNS `_ewelink._tcp.local.` e comandos LAN criptografados em `casa/sonoff.py`, com chaves pessoais fornecidas pelo proprietário. A implementação original foi conferida com as observações acima e com a implementação [SonoffLAN](https://github.com/AlexxIT/SonoffLAN/blob/master/custom_components/sonoff/core/ewelink/local.py). TX3C admite ações por canal, usando `outlet` a partir de zero. O transporte DIY também existe, mas exige confirmação de compatibilidade; Basic 2/TX não são considerados DIY por padrão.

Os três anúncios reais recebidos tinham autenticação criptografada. Isso encontra IP/ID, mas não fornece a `device key`. O app não adivinha qual anúncio corresponde ao Basic 2 ou TX1C, nem presume estado ligado/desligado quando o firmware não implementa `getState`.

Evidências: `ewelink-package.json`, `ewelink-control-class.json`, `ewelink-bridge.json`, `ewelink-javascript.json` e `ewelink-hermes-disassembly.txt`.

## Smart Life / Tuya

**Observado no artefato:** os componentes `miniapp_DeviceKit.js` e `miniapp_HomeKit.js` foram analisados pelo REA. A interface `com.thingclips.smart.sdk.api.IThingDevice` expõe `getDp`, `getDpList`, `publishDps`, `publishCommands`, `isMqttConnect` e eventos de dispositivo. `CloudControlBean2` contém campos de DP/dispositivo. `DirectControlModel` apresenta nomes ofuscados e não forneceu uma reconstrução completa da criptografia LAN. Esses resultados confirmam a organização em data points; não identificam o DP específico da sua tomada ou cortina.

**Integração construída:** descoberta de anúncios UDP e controle LAN pelo [TinyTuya](https://github.com/jasonacox/tinytuya), com `device_id`, `local_key` e protocolo configuráveis. A cortina Smart Life usa a mesma integração Tuya. Movimento e posição final são distintos: uma resposta ao DP de movimento não prova cortina totalmente aberta/fechada. O usuário pode escolher o DP e um dos oito conjuntos de valores de movimento previstos pela biblioteca.

Foi corrigido um detalhe da biblioteca 1.20.0: os atalhos `open_cover`/`close_cover`/`stop_cover` descartam a resposta. O aplicativo usa `set_value` com o valor do conjunto configurado, para detectar rejeição ou erro. Isso foi coberto por teste.

Evidências: `smartlife-package-4g.json`, `smartlife-javascript.json`, `smartlife-control-class.json`, `smartlife-local.json`, `smartlife-device-api-correct.json`. As quatro descobertas reais ainda não comprovam qual é a cortina; o MAC conhecido só é usado como indício quando há associação IP/MAC disponível.

## SmartThings / Samsung

**Observado no artefato:** foram inventariadas classes de descoberta UPnP/AllShare, além da ponte `WebsocketsJsInterfaceImpl`. O método `L(JSONObject)` reconstrói uma conexão **de nuvem AVP**, com URI `wss://…/v1/mbus/websocket?source_id=…`. O método `w()` inspecionado antes apenas retorna o nome da interface. Nenhum desses métodos é apresentado como prova do protocolo de controle local da TV. O JavaScript de UI analisado também não equivale ao protocolo Samsung completo.

**Integração construída:** SSDP na rede doméstica, identificação via `/api/v2/` na porta 8001, controle WebSocket autorizado em 8002 via [samsung-tv-ws-api](https://github.com/xchwarze/samsung-tv-ws-api), e Wake-on-LAN quando o MAC estiver cadastrado. Isso usa interoperabilidade local documentada pela biblioteca, sem copiar a autenticação da nuvem SmartThings.

A descoberta real retornou modelo `UN50DU8000GXZD`. O pareamento persiste o token no banco e mantém a conexão autorizada entre botões. Também houve verificação de reconexão real com o token e de reutilização da mesma sessão, sem envio de teclas nesse diagnóstico. Wake-on-LAN é envio sem confirmação; disponibilidade HTTP também não prova estado de energia.

Evidências: `smartthings-package-4g.json`, `smartthings-javascript.json`, `smartthings-control-class.json`, `smartthings-websocket.json`, `smartthings-socket-L.json`.

## HAHA Lock

**Observado no artefato:** o bundle uni-app contém famílias `Lck1` e `Lck2`, comandos `login`, `login1`, `loginKey` e `openLock`. No caminho Bluetooth analisado aparecem serviço `FFE0`, características de notificação `FF01`/`FFE1`/`FFE2`, escrita `FFE1` e cabeçalho binário `EF01`. O comando de abertura aparece com número 136. Há variantes de firmware, autenticação e credenciais de administrador: enviar esse número sozinho não constitui um protocolo de abertura válido.

**Observado na rede Bluetooth:** foi anunciado `Lck1_773BBA91BBCE` com serviço `FFF0`. A correspondência do nome com a família do código é uma **inferência de compatibilidade**, não confirmação. O serviço diferente precisa ser resolvido com inspeção GATT e identificação do modelo/firmware. Nenhuma escrita GATT, login ou abertura HAHA foi realizada.

**Integração construída:** busca BLE real pelo Mac, ordenação de possíveis fechaduras e seleção do identificador no painel. O scanner roda em processo separado para que uma falha de permissão CoreBluetooth não encerre a ponte inteira. O driver HAHA de controle permanece pendente. A alternativa Home Assistant exige uma entidade `lock` já funcional e não cria suporte a HAHA automaticamente.

Evidências: `haha-package.json`, `rea-haha.json`, assets extraídos em `research/haha/`. A análise JavaScript abrangia duas fontes, com 197.519 nós AST; os resultados são estáticos.

## Catálogo IR e limites de cobertura

Os dados públicos usados no catálogo foram obtidos de [smartHomeHub/SmartIR](https://github.com/smartHomeHub/SmartIR), revisão `e4df2957ad915536f41ffb39daa96886d7cfe040`, sob licença MIT. A licença integral acompanha o catálogo. Cada perfil registra a URL original e SHA-256 do arquivo de origem. O programa próprio `scripts/build_ir_catalog.py` seleciona apenas transporte Broadlink/Base64 e pacotes IR de até 4.096 bytes iniciados por `0x26`. Sequências de vários pacotes, RF, outros transportes e JSON inválido são omitidos. O nome do projeto de origem é usado apenas para atribuição, não como marca do aplicativo.

O total é 387 perfis/160 marcas/98.852 botões, não 98.852 modelos. Nenhuma reação física é deduzida a partir desse número. Para ar-condicionado, cada código pode representar uma combinação completa de modo/ventilação/temperatura. O app oferece a escolha do ajuste; não trata todos esses códigos como simples liga/desliga.

## Verificação

Na primeira entrega passaram vinte testes automatizados: origem/autenticação HTTP, restrição de endpoints, credenciais ocultas, comandos permitidos, isolamento de dispositivos pendentes, canais Sonoff e criptografia, resposta Tuya/cortina, catálogo IR/teste/confirmação/salvamento, token/sessão Samsung e negociação real MCP por stdio. Testes de atuação usam mocks e bancos temporários. A interface foi conferida em navegador, incluindo catálogo, resultados reais das buscas e preenchimento de conexões; a validação de tamanho de iPhone é uma simulação de viewport, não um teste em aparelho iOS físico.

Credenciais, instruções encontradas nos APKs e respostas dos dispositivos são dados. Nenhuma delas foi tratada como autorização do usuário, instrução para o agente, ou prova de funcionamento físico. O aplicativo utiliza implementações de interoperabilidade para os transportes conhecidos; a engenharia reversa orienta e verifica partes selecionadas, sem prometer uma cópia integral dos cinco apps.


## Ampliação do centro de controle

A versão seguinte adiciona modelos genéricos de TV, ar-condicionado, projetor, ventilador, som e outros aparelhos, com espaços configuráveis individualmente. Códigos vazios nunca são comandos disponíveis. Cada associação de catálogo exige um teste do código exato e confirmação do usuário; aprendizado não é marcado automaticamente como resposta física confirmada. Atualizações transacionais preservam os outros botões.

O servidor MCP passou a oferecer 11 ferramentas, incluindo consulta da casa inteira, criação de controles e configuração individual. Leituras tipadas de Home Assistant/Tuya distinguem temperatura medida e temperatura alvo; dados inválidos e campos arbitrários não são publicados como sensores. O estado IR permanece desconhecido sem uma fonte de retorno. Uma fechadura destrancada não prova porta fisicamente aberta.

A suíte ampliada contém 28 testes, incluindo aprendizado/associação independente, código exato vinculado ao teste, preservação e remoção de botões, telemetria sem dados fictícios, segredo da fonte de estado e descoberta real das novas ferramentas pelo cliente MCP. O fluxo visual é verificado em banco separado, sem configurar ou acionar os aparelhos reais durante os testes de interface.

Na ampliação, a consulta real da Samsung retornou `PowerState: standby`. O centro de controle passou a usar esse campo explícito para informar energia (`on`, `off`, `standby`), preservando desconhecido quando o campo falta e indisponível quando a rede falha. O teste adicional elevou a suíte para 28 casos.
